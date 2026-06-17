'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { getConnectionWithPassword } = require('../connections/connections.service');
const { getApiConfigRaw } = require('../api-configs/api-configs.service');
const { getJob, getFieldMaps, updateJobStatus, getSnapshot } = require('./jobs.service');
const { getSourceService } = require('../../services/sources/index');
const { resolveAuth } = require('../../services/auth-resolver.service');
const { requestWithRetry } = require('../../services/http.service');
const { TRANSFORMS, SYNC_MODES, OP_MODES, BATCH_DEFAULTS } = require('../../config/constants');
const logger = require('../../services/logger.service');
const eventsService = require('../../services/events.service');

function now() { return new Date().toISOString(); }

function applyTransform(value, transform, defaultValue) {
  const val = (value === null || value === undefined) ? defaultValue : value;
  if (val === null || val === undefined) return null;

  switch (transform) {
    case TRANSFORMS.UPPERCASE: return String(val).toUpperCase();
    case TRANSFORMS.LOWERCASE: return String(val).toLowerCase();
    case TRANSFORMS.TRIM: return String(val).trim();
    case TRANSFORMS.NUMBER: return parseFloat(val);
    case TRANSFORMS.BOOLEAN: return val === 1 || val === true || val === 'true' || val === 'True';
    case TRANSFORMS.DATE_ISO: return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
    case TRANSFORMS.STRING: return String(val);
    case TRANSFORMS.NONE:
    default: return val;
  }
}

function setNestedValue(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

function filterRow(record, job) {
  if (!job.row_filter_enabled || !job.row_filter_expression) return true;
  const varNames = Object.keys(record);
  const varValues = varNames.map(k => record[k]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...varNames, `"use strict"; return !!(${job.row_filter_expression});`);
    return fn(...varValues);
  } catch (err) {
    logger.warn('Error evaluando row_filter_expression', { job_id: job.id, expression: job.row_filter_expression, error: err.message });
    return true;
  }
}

function evaluateExpression(expression, record) {
  // Construye un contexto con todas las columnas de la fila como variables
  const varNames = Object.keys(record);
  const varValues = varNames.map(k => record[k]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...varNames, `"use strict"; return (${expression});`);
    return fn(...varValues);
  } catch (err) {
    logger.warn('Error evaluando expresión de campo', { expression, error: err.message });
    return null;
  }
}

function resolveFieldValue(map, record) {
  const sourceType = map.source_type || 'field';

  if (sourceType === 'static') {
    // Valor literal siempre — usa default_value como el valor fijo
    return map.default_value ?? null;
  }

  if (sourceType === 'expression') {
    const raw = evaluateExpression(map.expression, record);
    return applyTransform(raw, map.transform, map.default_value);
  }

  // sourceType === 'field' (comportamiento original)
  return applyTransform(record[map.sql_field], map.transform, map.default_value);
}

function buildPayload(record, fieldMaps) {
  const payload = {};
  for (const map of fieldMaps) {
    const value = resolveFieldValue(map, record);
    setNestedValue(payload, map.api_field, value);
  }
  return payload;
}

function computeHash(payload) {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function diffWithSnapshot(records, fieldMaps, job, snapshot) {
  const toSend = [];
  const seenReferences = new Set();

  for (const record of records) {
    if (!filterRow(record, job)) continue;
    const reference = String(record[job.key_field] ?? '');
    if (!reference) {
      logger.warn('Registro sin key_field, ignorado', { job_id: job.id, key_field: job.key_field });
      continue;
    }

    seenReferences.add(reference);
    const payload = buildPayload(record, fieldMaps);
    const hash = computeHash(payload);
    const existing = snapshot.get(reference);

    if (!existing) {
      toSend.push({ _op: 'upsert', _action: 'created', reference, payload, hash });
    } else if (existing.data_hash !== hash) {
      toSend.push({ _op: 'upsert', _action: 'updated', reference, payload, hash });
    }
    // hash igual → skip (no se agrega)
  }

  // Referencias que estaban en snapshot y ya no aparecen en SQL → delete
  for (const [reference] of snapshot) {
    if (!seenReferences.has(reference)) {
      toSend.push({ _op: 'delete', _action: 'deleted', reference, payload: { reference }, hash: null });
    }
  }

  return { toSend, seenReferences };
}

function buildPassthroughItems(records, fieldMaps, job) {
  const items = [];
  for (const record of records) {
    if (!filterRow(record, job)) continue;
    const op = record[job.op_passthrough_field];
    if (!op) {
      logger.warn('Registro sin op_passthrough_field, ignorado', {
        job_id: job.id,
        field: job.op_passthrough_field,
      });
      continue;
    }
    const reference = String(record[job.key_field] ?? '');
    const payload = buildPayload(record, fieldMaps);
    const action = op === 'delete' ? 'deleted' : 'upserted';
    items.push({ _op: op, _action: action, reference, payload, hash: null });
  }
  return items;
}

function buildApiPayload(items, itemType) {
  return items.map(item => ({
    _op: item._op,
    type: itemType,
    ...item.payload,
  }));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const taskIdx = idx++;
      results[taskIdx] = await tasks[taskIdx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function updateSnapshotInDb(db, jobId, items, seenReferences, snapshot) {
  const upsertStmt = db.prepare(`
    INSERT INTO sync_snapshot (job_id, reference, data_hash, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(job_id, reference) DO UPDATE SET data_hash = excluded.data_hash, last_seen_at = excluded.last_seen_at
  `);
  const deleteStmt = db.prepare('DELETE FROM sync_snapshot WHERE job_id = ? AND reference = ?');
  const ts = now();

  const transaction = db.transaction(() => {
    for (const item of items) {
      if (item._op === 'delete') {
        deleteStmt.run(jobId, item.reference);
      } else {
        upsertStmt.run(jobId, item.reference, item.hash, ts);
      }
    }
  });
  transaction();
}

async function executeJob(jobId) {
  const db = getDb();
  const logId = crypto.randomUUID();
  const startedAt = now();

  const job = getJob(jobId);

  logger.info(`Job "${job.name}" iniciado`, { job_id: jobId, log_id: logId });
  eventsService.emitJobExecutionStarted(jobId, job.name);

  db.prepare(`
    INSERT INTO execution_logs (id, job_id, job_name, started_at, status,
      records_read, records_sent, records_failed,
      records_created, records_updated, records_deleted, records_skipped,
      retry_count)
    VALUES (?, ?, ?, ?, 'running', 0, 0, 0, 0, 0, 0, 0, 0)
  `).run(logId, jobId, job.name, startedAt);

  updateJobStatus(jobId, 'running', { last_run_at: startedAt });

  let recordsRead = 0;
  let recordsCreated = 0, recordsUpdated = 0, recordsDeleted = 0, recordsSkipped = 0;
  let recordsFailed = 0, retryCount = 0;
  let finalStatus = 'success';
  let errorMessage = null;
  let httpStatus = null;
  let detailsJson = null;

  try {
    const conn = getConnectionWithPassword(job.connection_id);

    if (conn.source_type === 'sqlserver' && conn.config && Object.keys(conn.config).length === 0) {
      conn.config = {
        host: conn.host,
        port: conn.port,
        database_name: conn.database_name,
        username: conn.username,
        password: conn.password,
        encrypt: conn.encrypt,
        trust_cert: conn.trust_cert,
      };
    }

    const apiConfig = getApiConfigRaw(job.api_config_id);
    const fieldMaps = getFieldMaps(jobId);

    if (fieldMaps.length === 0) {
      throw new Error('La tarea no tiene mapeos de campos configurados');
    }

    if (!job.item_type) {
      throw new Error('La tarea no tiene tipo de item configurado (item_type)');
    }

    const syncState = db.prepare('SELECT * FROM sync_state WHERE job_id = ?').get(jobId);

    const sourceSvc = getSourceService(conn.source_type || 'sqlserver');
    const jobContext = {
      table_or_view: job.table_or_view,
      sync_mode: job.sync_mode,
      date_field: job.date_field,
      syncState,
    };
    const records = await sourceSvc.getRecords(conn.config || conn, jobContext);
    recordsRead = records.length;
    logger.info(`Job "${job.name}" - registros leídos: ${recordsRead}`, { job_id: jobId });

    let itemsToProcess = [];

    if (job.op_mode === OP_MODES.PASSTHROUGH) {
      if (!job.op_passthrough_field) {
        throw new Error('op_mode es "passthrough" pero op_passthrough_field no está configurado');
      }
      itemsToProcess = buildPassthroughItems(records, fieldMaps, job);
      const upserted = itemsToProcess.filter(i => i._op !== 'delete').length;
      const deleted = itemsToProcess.filter(i => i._op === 'delete').length;
      recordsCreated = upserted;
      recordsDeleted = deleted;
    } else {
      // op_mode === snapshot
      const snapshot = getSnapshot(jobId);
      const { toSend } = diffWithSnapshot(records, fieldMaps, job, snapshot);
      itemsToProcess = toSend;
      recordsCreated = toSend.filter(i => i._action === 'created').length;
      recordsUpdated = toSend.filter(i => i._action === 'updated').length;
      recordsDeleted = toSend.filter(i => i._action === 'deleted').length;
      recordsSkipped = recordsRead - (recordsCreated + recordsUpdated);
    }

    const hasChanges = itemsToProcess.length > 0;

    if (!hasChanges && !job.send_empty_sync) {
      finalStatus = 'success';
      logger.info(`Job "${job.name}" sin cambios — no se envía request`, { job_id: jobId });
    } else {
      const batchSize = job.batch_size || BATCH_DEFAULTS.SIZE;
      const batchConcurrency = job.batch_concurrency || BATCH_DEFAULTS.CONCURRENCY;

      const authResult = await resolveAuth(apiConfig);
      const baseHeaders = {
        'Content-Type': 'application/json',
        ...authResult.headers,
        ...(apiConfig.headers_json || {}),
      };

      const onTokenExpired = apiConfig.auth_type === 'login'
        ? async () => {
          const { resolveAuth: ra } = require('../../services/auth-resolver.service');
          const newAuth = await ra(apiConfig);
          return newAuth.headers;
        }
        : null;

      const apiPayload = hasChanges ? buildApiPayload(itemsToProcess, job.item_type) : [];
      const batches = hasChanges ? chunkArray(apiPayload, batchSize) : [[]];
      const itemBatches = hasChanges ? chunkArray(itemsToProcess, batchSize) : [[]];

      logger.info(`Job "${job.name}" - enviando en lotes`, {
        job_id: jobId,
        log_id: logId,
        url: `${apiConfig.base_url}${apiConfig.endpoint_path}`,
        items_total: apiPayload.length,
        batch_size: batchSize,
        batch_count: batches.length,
        batch_concurrency: batchConcurrency,
      });

      const allDetails = [];
      let batchErrors = 0;
      let lastHttpStatus = null;

      const batchTasks = batches.map((batchPayload, batchIdx) => async () => {
        await yieldToEventLoop();

        const requestConfig = {
          method: apiConfig.method,
          url: `${apiConfig.base_url}${apiConfig.endpoint_path}`,
          headers: { ...baseHeaders },
          params: authResult.params,
          data: batchPayload,
        };

        const integrationStart = Date.now();
        let integrationOutcome = 'success';
        let integrationError = null;
        let integrationResponse = null;
        let integrationStatus = null;

        try {
          integrationResponse = await requestWithRetry(requestConfig, { onTokenExpired });
          integrationStatus = integrationResponse.status;
          lastHttpStatus = integrationResponse.status;

          logger.info(`Job "${job.name}" - lote ${batchIdx + 1}/${batches.length} OK`, {
            job_id: jobId,
            batch: batchIdx + 1,
            items: batchPayload.length,
            http_status: integrationResponse.status,
            duration_ms: Date.now() - integrationStart,
          });

          if (integrationResponse.data && typeof integrationResponse.data === 'object') {
            allDetails.push(integrationResponse.data);
          }

          return { response: integrationResponse, batchIdx, itemBatch: itemBatches[batchIdx] };
        } catch (httpErr) {
          integrationOutcome = 'error';
          integrationError = httpErr.message;
          integrationStatus = httpErr.originalError?.response?.status || null;
          lastHttpStatus = integrationStatus;
          batchErrors++;
          logger.error(`Job "${job.name}" - lote ${batchIdx + 1}/${batches.length} falló`, {
            job_id: jobId,
            batch: batchIdx + 1,
            error: httpErr.message,
          });
          throw httpErr;
        } finally {
          const integrationDuration = Date.now() - integrationStart;
          const requestPayloadStr = JSON.stringify(requestConfig.data);
          const responseBodyStr = integrationResponse?.data ? JSON.stringify(integrationResponse.data) : null;
          const requestHeadersStr = JSON.stringify(requestConfig.headers || {});
          db.prepare(`
            INSERT INTO integration_logs
              (id, execution_log_id, job_id, job_name, api_config_id, api_config_name,
               method, url, auth_type, request_payload, request_bytes, request_headers,
               response_status, response_body, response_bytes,
               duration_ms, attempt, outcome, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          `).run(
            crypto.randomUUID(), logId, jobId, job.name,
            apiConfig.id, apiConfig.name,
            requestConfig.method?.toUpperCase(), requestConfig.url,
            apiConfig.auth_type,
            requestPayloadStr, Buffer.byteLength(requestPayloadStr || ''),
            requestHeadersStr,
            integrationStatus,
            responseBodyStr, responseBodyStr ? Buffer.byteLength(responseBodyStr) : 0,
            integrationDuration, integrationOutcome, integrationError,
            new Date().toISOString()
          );
        }
      });

      let batchResults;
      try {
        batchResults = await runWithConcurrency(batchTasks, batchConcurrency);
      } catch (batchErr) {
        httpStatus = lastHttpStatus;
        throw batchErr;
      }

      httpStatus = lastHttpStatus;

      // Acumular stats de respuestas ArdisApp
      let totalCreatedFromApi = 0, totalUpdatedFromApi = 0, totalDeletedFromApi = 0, totalFailedFromApi = 0;
      let hasApiStats = false;
      for (const detail of allDetails) {
        if (detail.upserted) {
          hasApiStats = true;
          totalCreatedFromApi += detail.upserted.created ?? 0;
          totalUpdatedFromApi += detail.upserted.updated ?? 0;
        }
        if (detail.deactivated !== undefined) {
          hasApiStats = true;
          totalDeletedFromApi += detail.deactivated ?? 0;
        }
        if (Array.isArray(detail.errors)) {
          totalFailedFromApi += detail.errors.length;
        }
      }

      if (hasApiStats) {
        recordsCreated = totalCreatedFromApi;
        recordsUpdated = totalUpdatedFromApi;
        recordsDeleted = totalDeletedFromApi;
      }
      if (totalFailedFromApi > 0) {
        recordsFailed = totalFailedFromApi;
        finalStatus = recordsFailed >= itemsToProcess.length ? 'error' : 'partial';
      }

      if (allDetails.length > 0) {
        detailsJson = JSON.stringify(allDetails.length === 1 ? allDetails[0] : allDetails);
      }

      // Actualizar snapshot solo en modo snapshot con los lotes exitosos
      if (job.op_mode === OP_MODES.SNAPSHOT && hasChanges) {
        const successfulItems = (batchResults || [])
          .filter(Boolean)
          .flatMap(r => r.itemBatch || []);
        if (successfulItems.length > 0) {
          updateSnapshotInDb(db, jobId, successfulItems);
        }
      }

      // Actualizar sync_state
      const syncAt = now();
      const lastRecord = records[records.length - 1];
      const lastKeyValue = lastRecord && lastRecord[job.key_field]
        ? String(lastRecord[job.key_field])
        : null;

      db.prepare(`
        INSERT INTO sync_state (job_id, last_sync_at, last_key_value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          last_sync_at = excluded.last_sync_at,
          last_key_value = excluded.last_key_value,
          updated_at = excluded.updated_at
      `).run(jobId, syncAt, lastKeyValue, syncAt);
    }

  } catch (err) {
    finalStatus = 'error';
    errorMessage = err.message;
    retryCount = err.attempts || 0;
    httpStatus = err.originalError?.response?.status || null;
    logger.error(`Job "${job.name}" falló`, { job_id: jobId, error: err.message, retry_count: retryCount });
  }

  const finishedAt = now();
  const recordsSent = recordsCreated + recordsUpdated + recordsDeleted;

  db.prepare(`
    UPDATE execution_logs SET
      finished_at = ?, status = ?,
      records_read = ?, records_sent = ?, records_failed = ?,
      records_created = ?, records_updated = ?, records_deleted = ?, records_skipped = ?,
      error_message = ?, http_status = ?, retry_count = ?, details_json = ?
    WHERE id = ?
  `).run(
    finishedAt, finalStatus,
    recordsRead, recordsSent, recordsFailed,
    recordsCreated, recordsUpdated, recordsDeleted, recordsSkipped,
    errorMessage, httpStatus, retryCount, detailsJson,
    logId
  );

  updateJobStatus(jobId, finalStatus, { last_run_at: finishedAt });

  const updatedJob = getJob(jobId);
  eventsService.emitJobStatusChanged(updatedJob);

  const result = {
    status: finalStatus,
    recordsRead,
    recordsSent,
    recordsCreated,
    recordsUpdated,
    recordsDeleted,
    recordsSkipped,
    recordsFailed,
  };
  eventsService.emitJobExecutionFinished(jobId, job.name, result);

  const duration = new Date(finishedAt) - new Date(startedAt);
  logger.info(`Job "${job.name}" ${finalStatus}`, {
    job_id: jobId,
    records_read: recordsRead,
    records_created: recordsCreated,
    records_updated: recordsUpdated,
    records_deleted: recordsDeleted,
    records_skipped: recordsSkipped,
    records_failed: recordsFailed,
    duration_ms: duration,
  });

  return {
    status: finalStatus,
    recordsRead,
    recordsSent,
    recordsCreated,
    recordsUpdated,
    recordsDeleted,
    recordsSkipped,
    recordsFailed,
  };
}

module.exports = { executeJob };

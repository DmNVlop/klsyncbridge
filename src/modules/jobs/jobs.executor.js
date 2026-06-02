'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { getConnectionWithPassword } = require('../connections/connections.service');
const { getApiConfigRaw } = require('../api-configs/api-configs.service');
const { getJob, getFieldMaps, updateJobStatus, getSnapshot } = require('./jobs.service');
const sqlServerService = require('../../services/sqlserver.service');
const { resolveAuth } = require('../../services/auth-resolver.service');
const { requestWithRetry } = require('../../services/http.service');
const { TRANSFORMS, SYNC_MODES, OP_MODES } = require('../../config/constants');
const logger = require('../../services/logger.service');

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

function buildPayload(record, fieldMaps) {
  const payload = {};
  for (const map of fieldMaps) {
    const value = applyTransform(record[map.sql_field], map.transform, map.default_value);
    setNestedValue(payload, map.api_field, value);
  }
  return payload;
}

function buildQuery(job, syncState) {
  const table = `[${job.table_or_view}]`;

  if (job.sync_mode === SYNC_MODES.FULL) {
    return { query: `SELECT * FROM ${table}`, params: {} };
  }

  if (job.date_field && syncState?.last_sync_at) {
    return {
      query: `SELECT * FROM ${table} WHERE [${job.date_field}] > @lastSync ORDER BY [${job.date_field}] ASC`,
      params: { lastSync: { type: require('mssql').DateTime, value: new Date(syncState.last_sync_at) } },
    };
  }

  return { query: `SELECT * FROM ${table}`, params: {} };
}

function computeHash(payload) {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function diffWithSnapshot(records, fieldMaps, job, snapshot) {
  const toSend = [];
  const seenReferences = new Set();

  for (const record of records) {
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
    const apiConfig = getApiConfigRaw(job.api_config_id);
    const fieldMaps = getFieldMaps(jobId);

    if (fieldMaps.length === 0) {
      throw new Error('La tarea no tiene mapeos de campos configurados');
    }

    if (!job.item_type) {
      throw new Error('La tarea no tiene tipo de item configurado (item_type)');
    }

    const syncState = db.prepare('SELECT * FROM sync_state WHERE job_id = ?').get(jobId);
    const { query, params } = buildQuery(job, syncState);

    const records = await sqlServerService.executeQuery(conn, query, params);
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
      const apiPayload = buildApiPayload(itemsToProcess, job.item_type);

      const authResult = await resolveAuth(apiConfig);
      const headers = {
        'Content-Type': 'application/json',
        ...authResult.headers,
        ...(apiConfig.headers_json || {}),
      };

      const requestConfig = {
        method: apiConfig.method,
        url: `${apiConfig.base_url}${apiConfig.endpoint_path}`,
        headers,
        params: authResult.params,
        data: hasChanges ? apiPayload : [],
      };

      const onTokenExpired = apiConfig.auth_type === 'login'
        ? async () => {
          const { resolveAuth: ra } = require('../../services/auth-resolver.service');
          const newAuth = await ra(apiConfig);
          return newAuth.headers;
        }
        : null;

      const response = await requestWithRetry(requestConfig, { onTokenExpired });
      httpStatus = response.status;
      finalStatus = 'success';

      // Parsear respuesta de ArdisApp si tiene stats
      if (response.data && typeof response.data === 'object') {
        detailsJson = JSON.stringify(response.data);
        // Refinar stats con lo que confirma ArdisApp
        if (response.data.upserted) {
          recordsCreated = response.data.upserted.created ?? recordsCreated;
          recordsUpdated = response.data.upserted.updated ?? recordsUpdated;
        }
        if (response.data.deactivated !== undefined) {
          recordsDeleted = response.data.deactivated ?? recordsDeleted;
        }
        if (Array.isArray(response.data.errors) && response.data.errors.length > 0) {
          recordsFailed = response.data.errors.length;
          finalStatus = recordsFailed === itemsToProcess.length ? 'error' : 'partial';
        }
      }

      // Actualizar snapshot solo en modo snapshot
      if (job.op_mode === OP_MODES.SNAPSHOT && hasChanges) {
        updateSnapshotInDb(db, jobId, itemsToProcess);
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

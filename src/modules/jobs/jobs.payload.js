'use strict';

const crypto = require('crypto');
const { TRANSFORMS } = require('../../config/constants');
const logger = require('../../services/logger.service');

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

module.exports = {
  applyTransform,
  setNestedValue,
  filterRow,
  evaluateExpression,
  resolveFieldValue,
  buildPayload,
  computeHash,
  diffWithSnapshot,
  buildPassthroughItems,
  buildApiPayload,
  chunkArray,
};

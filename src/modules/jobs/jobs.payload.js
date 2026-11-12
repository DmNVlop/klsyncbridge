'use strict';

const crypto = require('crypto');
const logger = require('../../services/logger.service');
const {
  applyTransform, setNestedValue, evaluateExpression, resolveFieldValue, buildPayload, matchesFilter,
} = require('../../core/data-pipeline');

/** Filtro de fila de un job (compatibilidad: firma histórica record, job). */
function filterRow(record, job) {
  return matchesFilter(record, job.row_filter_enabled ? job.row_filter_expression : null, { job_id: job.id });
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

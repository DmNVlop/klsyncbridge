'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { NotFoundError, ConflictError, AppError } = require('../../utils/errors');
const { JOB_STATUSES } = require('../../config/constants');

function now() { return new Date().toISOString(); }

function serialize(job) {
  if (!job) return null;
  return {
    ...job,
    is_active: Boolean(job.is_active),
    send_empty_sync: Boolean(job.send_empty_sync),
    batch_size: job.batch_size || 500,
    batch_concurrency: job.batch_concurrency || 2,
  };
}

function listJobs() {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs ORDER BY name ASC').all().map(serialize);
}

function getJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw new NotFoundError('Tarea');
  return serialize(job);
}

function createJob(data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const n = now();
  db.prepare(`
    INSERT INTO jobs (id, name, description, connection_id, table_or_view, key_field, sync_mode, date_field,
      api_config_id, schedule_type, schedule_value, is_active,
      item_type, op_mode, op_passthrough_field, send_empty_sync, batch_size, batch_concurrency,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.name, data.description || null,
    data.connection_id, data.table_or_view, data.key_field,
    data.sync_mode || 'incremental', data.date_field || null,
    data.api_config_id, data.schedule_type, data.schedule_value,
    data.is_active ? 1 : 0,
    data.item_type,
    data.op_mode || 'snapshot',
    data.op_passthrough_field || null,
    data.send_empty_sync ? 1 : 0,
    data.batch_size || 500,
    data.batch_concurrency || 2,
    n, n
  );
  return getJob(id);
}

function updateJob(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError('Tarea');
  if (existing.last_run_status === JOB_STATUSES.RUNNING) {
    throw new ConflictError('No se puede modificar una tarea en ejecución');
  }

  const allowed = ['name', 'description', 'connection_id', 'table_or_view', 'key_field',
    'sync_mode', 'date_field', 'api_config_id', 'schedule_type', 'schedule_value',
    'item_type', 'op_mode', 'op_passthrough_field'];
  const fields = {};
  for (const key of allowed) {
    if (data[key] !== undefined) fields[key] = data[key];
  }
  if (data.is_active !== undefined) fields.is_active = data.is_active ? 1 : 0;
  if (data.send_empty_sync !== undefined) fields.send_empty_sync = data.send_empty_sync ? 1 : 0;
  if (data.batch_size !== undefined) fields.batch_size = parseInt(data.batch_size, 10) || 500;
  if (data.batch_concurrency !== undefined) fields.batch_concurrency = parseInt(data.batch_concurrency, 10) || 2;

  if (Object.keys(fields).length > 0) {
    const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE jobs SET ${setClauses}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(fields), now(), id);
  }
  return getJob(id);
}

function deleteJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw new NotFoundError('Tarea');
  if (job.last_run_status === JOB_STATUSES.RUNNING) {
    throw new ConflictError('No se puede eliminar una tarea en ejecución');
  }
  db.prepare('DELETE FROM sync_state WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

function activateJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw new NotFoundError('Tarea');
  db.prepare('UPDATE jobs SET is_active = 1, updated_at = ? WHERE id = ?').run(now(), id);
  return getJob(id);
}

function deactivateJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) throw new NotFoundError('Tarea');
  db.prepare('UPDATE jobs SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
  return getJob(id);
}

function updateJobStatus(id, status, extra = {}) {
  const db = getDb();
  const fields = { last_run_status: status, last_run_at: extra.last_run_at || now() };
  db.prepare('UPDATE jobs SET last_run_status = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
    .run(fields.last_run_status, fields.last_run_at, now(), id);
}

// Snapshot
function getSnapshot(jobId) {
  const db = getDb();
  const rows = db.prepare('SELECT reference, data_hash, last_seen_at FROM sync_snapshot WHERE job_id = ?').all(jobId);
  const map = new Map();
  for (const row of rows) map.set(row.reference, row);
  return map;
}

function resetSnapshot(jobId) {
  const db = getDb();
  const job = db.prepare('SELECT id, last_run_status FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new NotFoundError('Tarea');
  if (job.last_run_status === JOB_STATUSES.RUNNING) {
    throw new ConflictError('No se puede resetear el snapshot de una tarea en ejecución');
  }
  const result = db.prepare('DELETE FROM sync_snapshot WHERE job_id = ?').run(jobId);
  return { deleted: result.changes };
}

// Field maps
function getFieldMaps(jobId) {
  const db = getDb();
  return db.prepare('SELECT * FROM field_maps WHERE job_id = ? ORDER BY sort_order ASC').all(jobId);
}

function saveFieldMaps(jobId, maps) {
  const db = getDb();
  const n = now();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM field_maps WHERE job_id = ?').run(jobId);
    const insert = db.prepare(`
      INSERT INTO field_maps (id, job_id, sql_field, api_field, transform, default_value, sort_order, source_type, expression, expression_meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const map of maps) {
      const meta = (map.source_type === 'expression' && (map.expr_cond_field || map.expr_cond_op))
        ? JSON.stringify({
            expr_cond_field: map.expr_cond_field || null,
            expr_cond_op:    map.expr_cond_op    || null,
            expr_cond_val:   map.expr_cond_val   || null,
            expr_then:       map.expr_then        || null,
            expr_else:       map.expr_else        || null,
          })
        : null;

      insert.run(
        crypto.randomUUID(), jobId,
        map.sql_field, map.api_field,
        map.transform || 'none',
        map.default_value || null,
        map.sort_order || 0,
        map.source_type || 'field',
        map.expression || null,
        meta,
        n
      );
    }
  });
  transaction();
  return getFieldMaps(jobId);
}

module.exports = {
  listJobs, getJob, createJob, updateJob, deleteJob,
  activateJob, deactivateJob, updateJobStatus,
  getSnapshot, resetSnapshot,
  getFieldMaps, saveFieldMaps,
};

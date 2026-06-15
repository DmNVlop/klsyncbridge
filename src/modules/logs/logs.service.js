'use strict';

const { getDb } = require('../../config/database');
const { NotFoundError } = require('../../utils/errors');

function serializeLog(log) {
  if (!log) return null;
  return {
    ...log,
    details_json: log.details_json ? JSON.parse(log.details_json) : null,
  };
}

function serializeIntegrationLog(log) {
  if (!log) return null;
  return {
    ...log,
    request_payload: log.request_payload ? JSON.parse(log.request_payload) : null,
    response_body: log.response_body ? (() => { try { return JSON.parse(log.response_body); } catch { return log.response_body; } })() : null,
  };
}

function getLogs(filters = {}) {
  const db = getDb();
  const { job_id, status, date_from, date_to, page = 1, per_page = 25 } = filters;

  const conditions = [];
  const params = [];

  if (job_id) { conditions.push('job_id = ?'); params.push(job_id); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (date_from) { conditions.push('started_at >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('started_at <= ?'); params.push(date_to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * per_page;

  const total = db.prepare(`SELECT COUNT(*) as count FROM execution_logs ${where}`).get(...params).count;
  const data = db.prepare(
    `SELECT * FROM execution_logs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...params, per_page, offset).map(serializeLog);

  return { data, total };
}

function getLog(id) {
  const db = getDb();
  const log = db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id);
  if (!log) throw new NotFoundError('Registro de ejecución');
  return serializeLog(log);
}

function cleanupLogs(days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM execution_logs WHERE started_at < ?').run(cutoff);
  return { deleted: result.changes };
}

function getIntegrationLogs(filters = {}) {
  const db = getDb();
  const { job_id, outcome, api_config_id, date_from, date_to, search, page = 1, per_page = 25 } = filters;

  const conditions = [];
  const params = [];

  if (job_id) { conditions.push('job_id = ?'); params.push(job_id); }
  if (outcome) { conditions.push('outcome = ?'); params.push(outcome); }
  if (api_config_id) { conditions.push('api_config_id = ?'); params.push(api_config_id); }
  if (date_from) { conditions.push('created_at >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('created_at <= ?'); params.push(date_to); }
  if (search) { conditions.push('(url LIKE ? OR job_name LIKE ? OR api_config_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * per_page;

  const total = db.prepare(`SELECT COUNT(*) as count FROM integration_logs ${where}`).get(...params).count;
  const data = db.prepare(
    `SELECT id, execution_log_id, job_id, job_name, api_config_id, api_config_name,
            method, url, auth_type, request_bytes, response_status, response_bytes,
            duration_ms, attempt, outcome, error_message, created_at
     FROM integration_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, per_page, offset);

  return { data, total };
}

function getIntegrationLog(id) {
  const db = getDb();
  const log = db.prepare('SELECT * FROM integration_logs WHERE id = ?').get(id);
  if (!log) throw new NotFoundError('Log de integración');
  return serializeIntegrationLog(log);
}

function cleanupIntegrationLogs(days = 90) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM integration_logs WHERE created_at < ?').run(cutoff);
  return { deleted: result.changes };
}

function runScheduledCleanup() {
  const db = getDb();
  const retentionRow = db.prepare("SELECT value FROM app_settings WHERE key = 'integration_log_retention_days'").get();
  const days = retentionRow ? parseInt(retentionRow.value, 10) : 90;
  return cleanupIntegrationLogs(days);
}

module.exports = { getLogs, getLog, cleanupLogs, getIntegrationLogs, getIntegrationLog, cleanupIntegrationLogs, runScheduledCleanup };

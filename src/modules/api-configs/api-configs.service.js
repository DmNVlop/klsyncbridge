'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { encryptObject, decryptObject } = require('../../services/encryption.service');
const { NotFoundError, ConflictError } = require('../../utils/errors');
const { resolveAuth } = require('../../services/auth-resolver.service');
const { requestWithRetry } = require('../../services/http.service');

function now() { return new Date().toISOString(); }

function maskAuthConfig(config) {
  if (!config) return null;
  const masked = { ...config };
  if (masked.password) masked.password = '****';
  if (masked.token) masked.token = '****';
  if (masked.key_value) masked.key_value = '****';
  return masked;
}

function serialize(row) {
  if (!row) return null;
  const result = {
    ...row,
    is_active: Boolean(row.is_active),
    headers_json: row.headers_json ? JSON.parse(row.headers_json) : null,
    auth_config: row.auth_config ? maskAuthConfig(decryptObject(row.auth_config)) : null,
    payload_schema: row.payload_schema ? JSON.parse(row.payload_schema) : null,
  };
  return result;
}

function listApiConfigs() {
  const db = getDb();
  return db.prepare('SELECT * FROM api_configs ORDER BY name ASC').all().map(serialize);
}

function getApiConfig(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Configuración de API');
  return serialize(row);
}

function getApiConfigRaw(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Configuración de API');
  row.auth_config = row.auth_config ? decryptObject(row.auth_config) : null;
  row.headers_json = row.headers_json ? JSON.parse(row.headers_json) : null;
  row.payload_schema = row.payload_schema ? JSON.parse(row.payload_schema) : null;
  return row;
}

function createApiConfig(data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const n = now();
  db.prepare(`
    INSERT INTO api_configs (id, name, base_url, endpoint_path, method, headers_json, body_template, auth_type, auth_config, payload_schema, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, data.name, data.base_url, data.endpoint_path, data.method,
    data.headers_json ? JSON.stringify(data.headers_json) : null,
    data.body_template || null,
    data.auth_type,
    data.auth_config ? encryptObject(data.auth_config) : null,
    data.payload_schema ? JSON.stringify(data.payload_schema) : null,
    n, n
  );
  return getApiConfig(id);
}

function updateApiConfig(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError('Configuración de API');

  const fields = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.base_url !== undefined) fields.base_url = data.base_url;
  if (data.endpoint_path !== undefined) fields.endpoint_path = data.endpoint_path;
  if (data.method !== undefined) fields.method = data.method;
  if (data.headers_json !== undefined) fields.headers_json = data.headers_json ? JSON.stringify(data.headers_json) : null;
  if (data.body_template !== undefined) fields.body_template = data.body_template;
  if (data.auth_type !== undefined) fields.auth_type = data.auth_type;
  if (data.auth_config !== undefined) fields.auth_config = data.auth_config ? encryptObject(data.auth_config) : null;
  if (data.payload_schema !== undefined) fields.payload_schema = data.payload_schema ? JSON.stringify(data.payload_schema) : null;

  if (Object.keys(fields).length > 0) {
    const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE api_configs SET ${setClauses}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(fields), now(), id);
  }
  return getApiConfig(id);
}

function deleteApiConfig(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Configuración de API');
  const jobs = db.prepare('SELECT id FROM jobs WHERE api_config_id = ? AND is_active = 1').all(id);
  if (jobs.length > 0) throw new ConflictError('No se puede eliminar una API config con jobs activos');
  db.prepare('DELETE FROM api_configs WHERE id = ?').run(id);
}

async function testApiConfig(id) {
  const config = getApiConfigRaw(id);
  const authResult = await resolveAuth(config);
  const headers = {
    'Content-Type': 'application/json',
    ...authResult.headers,
    ...(config.headers_json || {}),
  };
  const body = config.payload_schema || undefined;
  try {
    const response = await requestWithRetry({
      method: config.method,
      url: `${config.base_url}${config.endpoint_path}`,
      headers,
      params: authResult.params,
      data: body,
      timeout: 10000,
    });
    return { ok: true, message: `Respuesta ${response.status}`, http_status: response.status };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = {
  listApiConfigs, getApiConfig, getApiConfigRaw,
  createApiConfig, updateApiConfig, deleteApiConfig, testApiConfig,
};

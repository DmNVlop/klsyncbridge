'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { encrypt, decrypt } = require('../../services/encryption.service');
const { NotFoundError, ConflictError } = require('../../utils/errors');
const sqlServerService = require('../../services/sqlserver.service');

function now() { return new Date().toISOString(); }

function sanitize(conn) {
  if (!conn) return null;
  const { password: _, ...safe } = conn;
  safe.encrypt = Boolean(safe.encrypt);
  safe.trust_cert = Boolean(safe.trust_cert);
  safe.is_active = Boolean(safe.is_active);
  return safe;
}

function listConnections() {
  const db = getDb();
  return db.prepare('SELECT * FROM connections ORDER BY name ASC').all().map(sanitize);
}

function getConnection(id) {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!conn) throw new NotFoundError('Conexión');
  return sanitize(conn);
}

function getConnectionWithPassword(id) {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!conn) throw new NotFoundError('Conexión');
  conn.password = decrypt(conn.password);
  conn.encrypt = Boolean(conn.encrypt);
  conn.trust_cert = Boolean(conn.trust_cert);
  conn.is_active = Boolean(conn.is_active);
  return conn;
}

function createConnection(data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const n = now();
  db.prepare(`
    INSERT INTO connections (id, name, host, port, database_name, username, password, encrypt, trust_cert, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, data.name, data.host, data.port, data.database_name, data.username,
    encrypt(data.password),
    data.encrypt ? 1 : 0,
    data.trust_cert ? 1 : 0,
    n, n
  );
  return getConnection(id);
}

function updateConnection(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError('Conexión');

  const fields = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.host !== undefined) fields.host = data.host;
  if (data.port !== undefined) fields.port = data.port;
  if (data.database_name !== undefined) fields.database_name = data.database_name;
  if (data.username !== undefined) fields.username = data.username;
  if (data.password) fields.password = encrypt(data.password);
  if (data.encrypt !== undefined) fields.encrypt = data.encrypt ? 1 : 0;
  if (data.trust_cert !== undefined) fields.trust_cert = data.trust_cert ? 1 : 0;

  if (Object.keys(fields).length > 0) {
    const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE connections SET ${setClauses}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(fields), now(), id);
  }

  return getConnection(id);
}

function deleteConnection(id) {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!conn) throw new NotFoundError('Conexión');

  const jobs = db.prepare('SELECT id FROM jobs WHERE connection_id = ? AND is_active = 1').all(id);
  if (jobs.length > 0) {
    throw new ConflictError('No se puede eliminar una conexión con jobs activos');
  }

  db.prepare('DELETE FROM connections WHERE id = ?').run(id);
}

async function testConnection(id) {
  const conn = getConnectionWithPassword(id);
  return sqlServerService.testConnection(conn);
}

async function getTables(id) {
  const conn = getConnectionWithPassword(id);
  return sqlServerService.getTables(conn);
}

async function getFields(id, tableName) {
  const conn = getConnectionWithPassword(id);
  return sqlServerService.getFields(conn, tableName);
}

module.exports = {
  listConnections, getConnection, getConnectionWithPassword,
  createConnection, updateConnection, deleteConnection,
  testConnection, getTables, getFields,
};

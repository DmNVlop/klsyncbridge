'use strict';

const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { encrypt, decrypt, encryptObject, decryptObject } = require('../../services/encryption.service');
const { NotFoundError, ConflictError } = require('../../utils/errors');
const { getSourceService } = require('../../services/sources/index');

function now() { return new Date().toISOString(); }

function sanitize(conn) {
  if (!conn) return null;
  // Strip legacy password column
  const { password: _, ...safe } = conn;
  // Parse config from JSON string if present, then strip sensitive keys
  if (safe.config && typeof safe.config === 'string') {
    try {
      const parsed = JSON.parse(safe.config);
      const { password: _p, ...safeConfig } = parsed;
      safe.config = safeConfig;
    } catch (_e) {
      safe.config = null;
    }
  }
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

function getConnectionConfig(id) {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!conn) throw new NotFoundError('Conexión');
  conn.encrypt = Boolean(conn.encrypt);
  conn.trust_cert = Boolean(conn.trust_cert);
  conn.is_active = Boolean(conn.is_active);
  if (conn.config) {
    try {
      conn.config = decryptObject(conn.config);
    } catch (_e) {
      conn.config = null;
    }
  } else {
    conn.config = null;
  }
  return conn;
}

function getConnectionWithPassword(id) {
  const conn = getConnectionConfig(id);
  // Backward compat: expose password from config for sqlserver
  if (conn.config && conn.config.password !== undefined) {
    conn.password = conn.config.password;
  } else if (conn.password) {
    // Legacy path: decrypt old flat password column
    try {
      conn.password = decrypt(conn.password);
    } catch (_e) {
      conn.password = null;
    }
  }
  return conn;
}

function createConnection(data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const n = now();
  const sourceType = data.source_type || 'sqlserver';

  let configObj = {};
  let host = null, port = null, databaseName = null, username = null;
  let encryptFlag = 0, trustCertFlag = 0;
  let legacyPassword = null;

  // config fields come nested in data.config (from validator) or flat in data (legacy/direct calls)
  const cfg = (data.config && typeof data.config === 'object' && Object.keys(data.config).length > 0)
    ? data.config
    : data;

  if (sourceType === 'sqlserver') {
    configObj = {
      host: cfg.host,
      port: cfg.port,
      database_name: cfg.database_name,
      username: cfg.username,
      password: cfg.password,
      encrypt: Boolean(cfg.encrypt),
      trust_cert: Boolean(cfg.trust_cert),
    };
    host = cfg.host;
    port = cfg.port;
    databaseName = cfg.database_name;
    username = cfg.username;
    encryptFlag = cfg.encrypt ? 1 : 0;
    trustCertFlag = cfg.trust_cert ? 1 : 0;
    legacyPassword = encrypt(cfg.password);
  } else if (sourceType === 'csv' || sourceType === 'excel') {
    configObj = {
      file_path: cfg.file_path,
      sheet_name: cfg.sheet_name,
      delimiter: cfg.delimiter,
      encoding: cfg.encoding,
      has_header: cfg.has_header,
      header_row: cfg.header_row,
    };
    // Remove undefined keys
    Object.keys(configObj).forEach(k => configObj[k] === undefined && delete configObj[k]);
    legacyPassword = null;
  } else {
    // Generic: store all data fields except name/source_type in config
    const { name: _n, source_type: _s, config: _c, ...rest } = data;
    configObj = rest;
    legacyPassword = null;
  }

  const encryptedConfig = encryptObject(configObj);

  db.prepare(`
    INSERT INTO connections (id, name, source_type, host, port, database_name, username, password, encrypt, trust_cert, config, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, data.name, sourceType,
    host, port, databaseName, username, legacyPassword,
    encryptFlag, trustCertFlag,
    encryptedConfig,
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

  const sourceType = existing.source_type || 'sqlserver';
  // config fields come nested in data.config (from validator) or flat in data (legacy/direct calls)
  const upd = (data.config && typeof data.config === 'object' && Object.keys(data.config).length > 0)
    ? data.config
    : data;

  const sqlserverKeys = ['host', 'port', 'database_name', 'username', 'password', 'encrypt', 'trust_cert'];
  const csvExcelKeys = ['file_path', 'sheet_name', 'delimiter', 'encoding', 'has_header', 'header_row'];

  if (sourceType === 'sqlserver') {
    const hasSqlserverField = sqlserverKeys.some(k => upd[k] !== undefined);
    if (hasSqlserverField) {
      // Merge with existing decrypted config
      let existingConfig = {};
      if (existing.config) {
        try { existingConfig = decryptObject(existing.config); } catch (_e) { existingConfig = {}; }
      }
      const merged = {
        host: upd.host !== undefined ? upd.host : existingConfig.host,
        port: upd.port !== undefined ? upd.port : existingConfig.port,
        database_name: upd.database_name !== undefined ? upd.database_name : existingConfig.database_name,
        username: upd.username !== undefined ? upd.username : existingConfig.username,
        password: upd.password ? upd.password : existingConfig.password,
        encrypt: upd.encrypt !== undefined ? Boolean(upd.encrypt) : Boolean(existingConfig.encrypt),
        trust_cert: upd.trust_cert !== undefined ? Boolean(upd.trust_cert) : Boolean(existingConfig.trust_cert),
      };
      fields.config = encryptObject(merged);
      // Update legacy flat columns too
      fields.host = merged.host;
      fields.port = merged.port;
      fields.database_name = merged.database_name;
      fields.username = merged.username;
      const encryptedPassword = encrypt(merged.password);
      if (encryptedPassword !== null) fields.password = encryptedPassword;
      fields.encrypt = merged.encrypt ? 1 : 0;
      fields.trust_cert = merged.trust_cert ? 1 : 0;
    }
  } else if (sourceType === 'csv' || sourceType === 'excel') {
    const hasCsvField = csvExcelKeys.some(k => upd[k] !== undefined);
    if (hasCsvField) {
      let existingConfig = {};
      if (existing.config) {
        try { existingConfig = decryptObject(existing.config); } catch (_e) { existingConfig = {}; }
      }
      const merged = {
        file_path: upd.file_path !== undefined ? upd.file_path : existingConfig.file_path,
        sheet_name: upd.sheet_name !== undefined ? upd.sheet_name : existingConfig.sheet_name,
        delimiter: upd.delimiter !== undefined ? upd.delimiter : existingConfig.delimiter,
        encoding: upd.encoding !== undefined ? upd.encoding : existingConfig.encoding,
        has_header: upd.has_header !== undefined ? upd.has_header : existingConfig.has_header,
        header_row: upd.header_row !== undefined ? upd.header_row : existingConfig.header_row,
      };
      // Remove undefined keys
      Object.keys(merged).forEach(k => merged[k] === undefined && delete merged[k]);
      fields.config = encryptObject(merged);
    }
  }

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
  const conn = getConnectionConfig(id);
  return getSourceService(conn.source_type).test(conn.config);
}

async function getTables(id) {
  const conn = getConnectionConfig(id);
  return getSourceService(conn.source_type).getTables(conn.config);
}

async function getFields(id, tableName) {
  const conn = getConnectionConfig(id);
  return getSourceService(conn.source_type).getFields(conn.config, tableName);
}

module.exports = {
  listConnections, getConnection, getConnectionWithPassword, getConnectionConfig,
  createConnection, updateConnection, deleteConnection,
  testConnection, getTables, getFields,
};

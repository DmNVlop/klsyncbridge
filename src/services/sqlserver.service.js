'use strict';

const sql = require('mssql');
const logger = require('./logger.service');
const { AppError } = require('../utils/errors');

function buildConfig(conn) {
  return {
    server: conn.host,
    port: conn.port,
    database: conn.database_name,
    user: conn.username,
    password: conn.password,
    options: {
      encrypt: conn.encrypt,
      trustServerCertificate: conn.trust_cert,
      enableArithAbort: true,
      connectTimeout: 15000,
      requestTimeout: 60000,
    },
  };
}

async function getPool(conn) {
  const config = buildConfig(conn);
  const pool = await sql.connect(config);
  return pool;
}

async function testConnection(conn) {
  let pool;
  try {
    pool = await getPool(conn);
    await pool.request().query('SELECT 1 AS ok');
    return { ok: true, message: 'Conexión exitosa' };
  } catch (err) {
    return { ok: false, message: sanitizeSqlError(err.message) };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

async function getTables(conn) {
  let pool;
  try {
    pool = await getPool(conn);
    const result = await pool.request().query(`
      SELECT TABLE_NAME as name, TABLE_TYPE as type
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY TABLE_TYPE, TABLE_NAME
    `);
    return result.recordset;
  } catch (err) {
    throw new AppError(sanitizeSqlError(err.message), 'SQL_ERROR', 500);
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

async function getFields(conn, tableName) {
  if (!tableName) throw new AppError('Nombre de tabla requerido', 'VALIDATION_ERROR', 400);
  let pool;
  try {
    pool = await getPool(conn);
    const request = pool.request();
    request.input('table', sql.NVarChar, tableName);
    const result = await request.query(`
      SELECT COLUMN_NAME as name, DATA_TYPE as type, IS_NULLABLE as nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);
    return result.recordset;
  } catch (err) {
    throw new AppError(sanitizeSqlError(err.message), 'SQL_ERROR', 500);
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

async function executeQuery(conn, query, params = {}) {
  let pool;
  try {
    pool = await getPool(conn);
    const request = pool.request();
    for (const [key, { type, value }] of Object.entries(params)) {
      request.input(key, type, value);
    }
    const result = await request.query(query);
    return result.recordset;
  } catch (err) {
    const safe = sanitizeSqlError(err.message);
    logger.error('Error ejecutando query SQL Server', { error: safe });
    throw new AppError(safe, 'SQL_ERROR', 500);
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

function sanitizeSqlError(message) {
  // Eliminar info de conexión (usuario, password, server) de mensajes de error
  return message
    .replace(/password=[^\s;,]*/gi, 'password=****')
    .replace(/user id=[^\s;,]*/gi, 'user id=****')
    .replace(/uid=[^\s;,]*/gi, 'uid=****');
}

module.exports = { testConnection, getTables, getFields, executeQuery };

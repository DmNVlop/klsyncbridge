'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const env = require('./env');
const logger = require('../services/logger.service');

let _db = null;

function getDb() {
  if (!_db) throw new Error('Base de datos no inicializada. Llamar initDatabase() primero.');
  return _db;
}

function initDatabase() {
  if (_db) return _db;

  const dataDir = path.resolve(env.DATA_DIR);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'klsyncbridge.db');
  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  createTables(_db);
  runMigrations(_db);

  logger.info('Base de datos SQLite inicializada', { path: dbPath });
  return _db;
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'admin',
      is_master   INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      host          TEXT NOT NULL,
      port          INTEGER NOT NULL DEFAULT 1433,
      database_name TEXT NOT NULL,
      username      TEXT NOT NULL,
      password      TEXT NOT NULL,
      encrypt       INTEGER NOT NULL DEFAULT 1,
      trust_cert    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_configs (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      base_url        TEXT NOT NULL,
      endpoint_path   TEXT NOT NULL,
      method          TEXT NOT NULL,
      headers_json    TEXT,
      body_template   TEXT,
      auth_type       TEXT NOT NULL,
      auth_config     TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT,
      connection_id    TEXT NOT NULL REFERENCES connections(id),
      table_or_view    TEXT NOT NULL,
      key_field        TEXT NOT NULL,
      sync_mode        TEXT NOT NULL DEFAULT 'incremental',
      date_field       TEXT,
      api_config_id    TEXT NOT NULL REFERENCES api_configs(id),
      schedule_type    TEXT NOT NULL,
      schedule_value   TEXT NOT NULL,
      is_active        INTEGER NOT NULL DEFAULT 1,
      last_run_at      TEXT,
      last_run_status  TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS field_maps (
      id             TEXT PRIMARY KEY,
      job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      sql_field      TEXT NOT NULL,
      api_field      TEXT NOT NULL,
      transform      TEXT DEFAULT 'none',
      default_value  TEXT,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id              TEXT PRIMARY KEY,
      job_id          TEXT NOT NULL REFERENCES jobs(id),
      job_name        TEXT NOT NULL,
      started_at      TEXT NOT NULL,
      finished_at     TEXT,
      status          TEXT NOT NULL,
      records_read    INTEGER DEFAULT 0,
      records_sent    INTEGER DEFAULT 0,
      records_failed  INTEGER DEFAULT 0,
      error_message   TEXT,
      http_status     INTEGER,
      retry_count     INTEGER DEFAULT 0,
      details_json    TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      job_id          TEXT PRIMARY KEY REFERENCES jobs(id),
      last_sync_at    TEXT,
      last_key_value  TEXT,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_snapshot (
      job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      reference       TEXT NOT NULL,
      data_hash       TEXT NOT NULL,
      last_seen_at    TEXT NOT NULL,
      PRIMARY KEY (job_id, reference)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_snapshot_job_id ON sync_snapshot(job_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_logs (
      id              TEXT PRIMARY KEY,
      execution_log_id TEXT REFERENCES execution_logs(id) ON DELETE CASCADE,
      job_id          TEXT NOT NULL REFERENCES jobs(id),
      job_name        TEXT NOT NULL,
      api_config_id   TEXT,
      api_config_name TEXT,
      method          TEXT NOT NULL,
      url             TEXT NOT NULL,
      auth_type       TEXT,
      request_payload TEXT,
      request_bytes   INTEGER DEFAULT 0,
      response_status INTEGER,
      response_body   TEXT,
      response_bytes  INTEGER DEFAULT 0,
      duration_ms     INTEGER,
      attempt         INTEGER DEFAULT 1,
      outcome         TEXT NOT NULL,
      error_message   TEXT,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_execution_logs_job_id ON execution_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON execution_logs(started_at);
    CREATE INDEX IF NOT EXISTS idx_field_maps_job_id ON field_maps(job_id);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_job_id ON integration_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_created_at ON integration_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_execution_log_id ON integration_logs(execution_log_id);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_outcome ON integration_logs(outcome);
  `);
}

function runMigrations(db) {
  const versionRow = db.prepare("SELECT value FROM app_settings WHERE key = 'db_version'").get();
  const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

  const migrations = [
    // v1: valores iniciales de app_settings
    () => {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)
      `);
      const defaults = [
        ['db_version', '1'],
        ['app_port', '3847'],
        ['app_name', 'KLSyncBridge'],
        ['setup_complete', 'false'],
        ['log_retention_days', '30'],
      ];
      const runMany = db.transaction((rows) => {
        for (const [k, v] of rows) insert.run(k, v);
      });
      runMany(defaults);
    },

    // v2: campos snapshot/op en jobs + stats detalladas en execution_logs
    () => {
      const addColIfNotExists = (table, col, definition) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.find(c => c.name === col)) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`).run();
        }
      };

      // jobs: nuevos campos para modo snapshot y tipo de item
      addColIfNotExists('jobs', 'item_type', 'TEXT');
      addColIfNotExists('jobs', 'op_mode', "TEXT NOT NULL DEFAULT 'snapshot'");
      addColIfNotExists('jobs', 'op_passthrough_field', 'TEXT');
      addColIfNotExists('jobs', 'send_empty_sync', 'INTEGER NOT NULL DEFAULT 0');

      // execution_logs: desglose de stats por operación
      addColIfNotExists('execution_logs', 'records_created', 'INTEGER DEFAULT 0');
      addColIfNotExists('execution_logs', 'records_updated', 'INTEGER DEFAULT 0');
      addColIfNotExists('execution_logs', 'records_deleted', 'INTEGER DEFAULT 0');
      addColIfNotExists('execution_logs', 'records_skipped', 'INTEGER DEFAULT 0');
    },

    // v3: schema de ejemplo del payload esperado por la API
    () => {
      const cols = db.prepare('PRAGMA table_info(api_configs)').all();
      if (!cols.find(c => c.name === 'payload_schema')) {
        db.prepare('ALTER TABLE api_configs ADD COLUMN payload_schema TEXT').run();
      }
    },

    // v4: TTL para integration_logs (90 días por defecto)
    () => {
      db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('integration_log_retention_days', '90')").run();
    },

    // v5: source_type y expression en field_maps (valores estáticos y expresiones condicionales)
    () => {
      const addColIfNotExists = (table, col, definition) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.find(c => c.name === col)) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`).run();
        }
      };
      addColIfNotExists('field_maps', 'source_type', "TEXT NOT NULL DEFAULT 'field'");
      addColIfNotExists('field_maps', 'expression', 'TEXT');
      // expression_meta guarda el estado del builder visual (JSON) para restaurar la UI
      addColIfNotExists('field_maps', 'expression_meta', 'TEXT');
    },

    // v6: batch_size y batch_concurrency en jobs para envío por lotes
    () => {
      const addColIfNotExists = (table, col, definition) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.find(c => c.name === col)) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`).run();
        }
      };
      addColIfNotExists('jobs', 'batch_size', 'INTEGER NOT NULL DEFAULT 500');
      addColIfNotExists('jobs', 'batch_concurrency', 'INTEGER NOT NULL DEFAULT 2');
    },

    // v7: request_headers en integration_logs para poder reproducir el cURL exacto
    () => {
      const cols = db.prepare('PRAGMA table_info(integration_logs)').all();
      if (!cols.find(c => c.name === 'request_headers')) {
        db.prepare('ALTER TABLE integration_logs ADD COLUMN request_headers TEXT').run();
      }
    },
  ];

  for (let v = currentVersion; v < migrations.length; v++) {
    migrations[v]();
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('db_version', ?)")
      .run(String(v + 1));
    logger.info(`Migración DB v${v + 1} aplicada`);
  }
}

function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
    logger.info('Base de datos SQLite cerrada');
  }
}

module.exports = { initDatabase, getDb, closeDatabase };

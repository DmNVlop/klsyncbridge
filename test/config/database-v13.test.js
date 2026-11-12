'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../../src/config/database');

const columns = (table) => getDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('migración v13 crea network_credentials y audit_events', () => {
  assert.deepEqual(columns('network_credentials'), [
    'id', 'name', 'domain', 'username', 'password', 'notes',
    'last_test_at', 'last_test_ok', 'last_test_message', 'last_test_path',
    'created_at', 'updated_at', 'created_by', 'updated_by',
  ]);
  assert.deepEqual(columns('audit_events'), [
    'id', 'at', 'user_id', 'username', 'action', 'resource_type', 'resource_id', 'summary',
  ]);
  const indexes = getDb().prepare('PRAGMA index_list(audit_events)').all().map((i) => i.name);
  assert.ok(indexes.includes('idx_audit_events_resource'));
  assert.ok(indexes.includes('idx_audit_events_at'));
});

test('migración v13 añade las columnas de credencial a jobs y connections', () => {
  assert.ok(columns('jobs').includes('output_credential_id'));
  assert.ok(columns('connections').includes('network_credential_id'));
});

test('db_version = nº de migraciones (15)', () => {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'db_version'").get();
  assert.equal(row.value, '15');
});

test('initDatabase es idempotente', () => {
  assert.doesNotThrow(() => initDatabase());
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'db_version'").get();
  assert.equal(row.value, '15');
});

test('name de credencial duplicado ⇒ violación UNIQUE', () => {
  const db = getDb();
  const insert = db.prepare(`INSERT INTO network_credentials (id, name, username, password, created_at, updated_at)
    VALUES (?, ?, 'u', 'p', 'now', 'now')`);
  insert.run('cred-a', 'Servidor A');
  assert.throws(() => insert.run('cred-b', 'Servidor A'), /UNIQUE/);
  db.prepare('DELETE FROM network_credentials').run();
});

test('borrar una credencial referenciada por un job ⇒ error de FK (RESTRICT)', () => {
  const db = getDb();
  db.prepare(`INSERT INTO network_credentials (id, name, username, password, created_at, updated_at)
    VALUES ('cred-fk', 'Con job', 'u', 'p', 'now', 'now')`).run();
  const jobCols = db.prepare('PRAGMA table_info(jobs)').all().filter((c) => c.notnull && c.dflt_value === null && !c.pk);
  // Se rellenan solo las columnas NOT NULL sin valor por defecto; las claves ajenas se desactivan un instante para el alta
  db.pragma('foreign_keys = OFF');
  const names = jobCols.map((c) => c.name);
  const values = jobCols.map((c) => (c.type.toUpperCase().includes('INT') ? 1 : 'x'));
  db.prepare(`INSERT INTO jobs (id, ${names.join(', ')}, output_credential_id)
    VALUES ('job-fk', ${names.map(() => '?').join(', ')}, 'cred-fk')`).run(...values);
  db.pragma('foreign_keys = ON');
  assert.throws(() => db.prepare("DELETE FROM network_credentials WHERE id = 'cred-fk'").run(), /FOREIGN KEY/);
  db.prepare("DELETE FROM jobs WHERE id = 'job-fk'").run();
  db.prepare("DELETE FROM network_credentials WHERE id = 'cred-fk'").run();
});

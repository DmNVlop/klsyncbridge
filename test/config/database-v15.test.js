'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../../src/config/database');

const columns = (table) => getDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('migración v15 crea mapping_templates con sus columnas', () => {
  assert.deepEqual(columns('mapping_templates'), [
    'id', 'name', 'description', 'target_kind', 'fields', 'filter_expression', 'reader', 'sample_fields',
    'origin', 'created_at', 'created_by', 'updated_at', 'updated_by',
  ]);
});

test('migración v15 añade jobs.mapping_origin', () => {
  assert.ok(columns('jobs').includes('mapping_origin'));
});

test('el nombre de plantilla es único sin distinguir mayúsculas', () => {
  const db = getDb();
  const insert = db.prepare(`INSERT INTO mapping_templates (id, name, target_kind, fields, created_at, updated_at)
    VALUES (?, ?, 'api', '[]', 'now', 'now')`);
  insert.run('t-a', 'Stock ERP');
  assert.throws(() => insert.run('t-b', 'stock erp'), /UNIQUE/);
  db.prepare('DELETE FROM mapping_templates').run();
});

test('initDatabase sigue siendo idempotente con v15', () => {
  assert.doesNotThrow(() => initDatabase());
  assert.equal(columns('mapping_templates').length, 13);
});

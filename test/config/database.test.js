'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');

const columns = (table) => getDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('migración v12 crea las tablas del motor de automatizaciones', () => {
  assert.deepEqual(columns('automations'), [
    'id', 'name', 'description', 'is_active', 'trigger_type', 'trigger_config',
    'health_state', 'health_message', 'last_success_at', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(columns('automation_steps'), ['id', 'automation_id', 'position', 'step_type', 'config']);
  assert.deepEqual(columns('work_items'), [
    'id', 'automation_id', 'item_key', 'display_name', 'fingerprint', 'status', 'attempts', 'next_retry_at',
    'last_http_status', 'last_result_status', 'last_message', 'external_ref', 'external_version',
    'requested_by', 'meta', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(columns('work_item_attempts'), [
    'id', 'work_item_id', 'attempted_at', 'fingerprint', 'outcome', 'http_status', 'result_status',
    'message', 'external_ref', 'external_version', 'duration_ms', 'triggered_by',
  ]);
});

test('índice único por automatización y clave de archivo', () => {
  const indexes = getDb().prepare('PRAGMA index_list(work_items)').all();
  const unique = indexes.find((i) => i.name === 'ux_work_items_key');
  assert.ok(unique && unique.unique === 1);
});

test('db_version = 12', () => {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'db_version'").get();
  assert.equal(row.value, '12');
});

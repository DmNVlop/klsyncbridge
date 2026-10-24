'use strict';

const { makeTempDir, getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../../src/modules/automations/automations.service');
const queue = require('../../src/core/queue/work-queue');
const { seedApiConfig } = require('../helpers/seed');
const { ValidationError } = require('../../src/utils/errors');

function definition(apiConfigId, overrides = {}) {
  return {
    name: 'XML LAMIPLAST',
    description: 'Carpeta de optimizaciones',
    is_active: false,
    trigger: { type: 'folder_watch', config: { path: makeTempDir() } },
    steps: [{ type: 'ardis_xml_import', config: { api_config_id: apiConfigId } }],
    ...overrides,
  };
}

test('crear: aplica valores por defecto del plugin y devuelve contadores', () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const created = svc.createAutomation(definition(api.id));
  assert.equal(created.trigger.config.pattern, '*.xml');
  assert.equal(created.steps[0].config.endpointPath, '/orders-v2/external/ardis-xml-imports');
  assert.equal(created.health_state, 'ok');
  assert.equal(created.counts.pending, 0);
});

test('error en la config del disparador ⇒ ValidationError con sección trigger', () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  assert.throws(() => svc.createAutomation(definition(api.id, { trigger: { type: 'folder_watch', config: { path: 'rel' } } })), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.details.section, 'trigger');
    assert.ok(err.details.fields.path);
    return true;
  });
});

test('api_config inexistente ⇒ ValidationError en el paso', () => {
  assert.throws(() => svc.createAutomation(definition('no-existe')), (err) => {
    assert.equal(err.details.section, 'step:0');
    assert.ok(err.details.fields.api_config_id);
    return true;
  });
});

test('actualizar sustituye pasos y vuelve a salud correcta', () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const created = svc.createAutomation(definition(api.id));
  svc.setHealth(created.id, 'needs_attention', 'Token');
  const updated = svc.updateAutomation(created.id, definition(api.id, { name: 'Nuevo nombre' }));
  assert.equal(updated.name, 'Nuevo nombre');
  assert.equal(updated.health_state, 'ok');
  assert.equal(updated.health_message, null);
  assert.equal(updated.steps.length, 1);
});

test('borrar elimina pasos, archivos e historial en cascada', () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const created = svc.createAutomation(definition(api.id));
  queue.enqueue({ automationId: created.id, itemKey: 'c:\\a.xml', displayName: 'a.xml', fingerprint: 'f', meta: {} });
  svc.deleteAutomation(created.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM work_items WHERE automation_id = ?').get(created.id).n, 0);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM automation_steps WHERE automation_id = ?').get(created.id).n, 0);
  assert.throws(() => svc.getAutomation(created.id), { code: 'NOT_FOUND' });
});

test('findAutomationIdsByApiConfig y listActiveAutomations', () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const active = svc.createAutomation(definition(api.id, { is_active: true }));
  assert.deepEqual(svc.findAutomationIdsByApiConfig(api.id), [active.id]);
  assert.ok(svc.listActiveAutomations().some((a) => a.id === active.id));
  svc.markSuccess(active.id);
  assert.ok(svc.getAutomation(active.id).last_success_at);
});

'use strict';

const { makeTempDir, getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { createServer } = require('../../src/server');
const { generateToken } = require('../../src/modules/auth/auth.service');
const queue = require('../../src/core/queue/work-queue');
const { seedApiConfig } = require('../helpers/seed');

getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();
const token = generateToken({ id: 'u1', username: 'tester', role: 'admin' });

let server;
let base;
test.before(async () => {
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, url, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

function definition(apiConfigId, folder) {
  return {
    name: 'XML', is_active: false,
    trigger: { type: 'folder_watch', config: { path: folder } },
    steps: [{ type: 'ardis_xml_import', config: { api_config_id: apiConfigId } }],
  };
}

test('sin token ⇒ 401', async () => {
  assert.equal((await call('GET', '/automations', null, false)).status, 401);
});

test('tipos registrados con su JSON Schema', async () => {
  const { status, body } = await call('GET', '/automation-types');
  assert.equal(status, 200);
  assert.equal(body.data.triggers[0].type, 'folder_watch');
  assert.ok(body.data.triggers[0].configSchema.properties.path);
  assert.equal(body.data.steps[0].configSchema.properties.api_config_id.resource, 'api_config');
});

test('probar carpeta', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.xml'), 'x');
  const { body } = await call('POST', '/automations/test-folder', { path: dir });
  assert.equal(body.data.accessible, true);
  assert.equal(body.data.matchingFiles, 1);
});

test('crear con error ⇒ 400 con sección; crear válida, listar archivos, borrar', async () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const bad = await call('POST', '/automations', definition(api.id, 'relativa'));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.details.section, 'trigger');

  const created = await call('POST', '/automations', definition(api.id, makeTempDir()));
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  const items = await call('GET', `/automations/${id}/work-items?page=1&per_page=10`);
  assert.equal(items.body.total, 0);

  const removed = await call('DELETE', `/automations/${id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data, { deleted: true });
  assert.equal((await call('GET', `/automations/${id}`)).status, 404);
});

test('reintento manual e historial de un archivo', async () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  const created = await call('POST', '/automations', definition(api.id, makeTempDir()));
  const id = created.body.data.id;
  const { item } = queue.enqueue({ automationId: id, itemKey: 'c:\\m.xml', displayName: 'm.xml', fingerprint: 'f', meta: {} });
  const retried = await call('POST', `/work-items/${item.id}/retry`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.requested_by, 'manual:tester');
  const attempts = await call('GET', `/work-items/${item.id}/attempts`);
  assert.deepEqual(attempts.body.data, []);
});

test('no se puede borrar una api_config usada por una automatización', async () => {
  const api = seedApiConfig('http://127.0.0.1:9');
  await call('POST', '/automations', definition(api.id, makeTempDir()));
  const res = await call('DELETE', `/api-configs/${api.id}`);
  assert.equal(res.status, 409);
});

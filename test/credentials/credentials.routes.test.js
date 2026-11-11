'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { once } = require('events');
const { createServer } = require('../../src/server');
const { generateToken } = require('../../src/modules/auth/auth.service');
const { seedApiConfig } = require('../helpers/seed');

getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();
const token = generateToken({ id: 'u1', username: 'tester', role: 'admin' });
const SECRET = 'Pw-Ruta-Secreta-987';

let server;
let base;
test.before(async () => {
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/network-credentials`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, url, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

let counter = 0;
async function createOne() {
  counter += 1;
  return call('POST', '', { name: `Cred ${counter}`, domain: 'EMP', username: 'svc', password: SECRET });
}

test('sin token ⇒ 401', async () => {
  assert.equal((await call('GET', '', null, false)).status, 401);
});

test('alta ⇒ 201 sin password en la respuesta', async () => {
  const res = await createOne();
  assert.equal(res.status, 201);
  assert.equal(res.body.data.username, 'svc');
  assert.equal('password' in res.body.data, false);
  assert.equal(res.text.includes(SECRET), false);
});

test('GET / y GET /:id no incluyen password', async () => {
  const created = (await createOne()).body.data;
  const list = await call('GET', '');
  assert.equal(list.status, 200);
  assert.equal(list.text.includes(SECRET), false);
  assert.equal(list.body.data.some((c) => 'password' in c), false);
  const one = await call('GET', `/${created.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.text.includes(SECRET), false);
  assert.equal((await call('GET', `/${crypto.randomUUID()}`)).status, 404);
});

test('PUT sin password conserva la guardada', async () => {
  const created = (await createOne()).body.data;
  const before = getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password;
  const res = await call('PUT', `/${created.id}`, { username: 'nuevo-usuario' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.username, 'nuevo-usuario');
  assert.equal(getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password, before);
  const blank = await call('PUT', `/${created.id}`, { notes: 'x', password: '' });
  assert.equal(blank.status, 200);
  assert.equal(getDb().prepare('SELECT password FROM network_credentials WHERE id = ?').get(created.id).password, before);
});

test('DELETE en uso ⇒ 409 con details.usages; libre ⇒ 200 { deleted: true }', async () => {
  const used = (await createOne()).body.data;
  const db = getDb();
  const ts = new Date().toISOString();
  const connectionId = crypto.randomUUID();
  db.prepare("INSERT INTO connections (id, name, created_at, updated_at) VALUES (?, 'c', ?, ?)").run(connectionId, ts, ts);
  const apiConfig = seedApiConfig('http://127.0.0.1:1');
  db.prepare(`INSERT INTO jobs (id, name, connection_id, table_or_view, key_field, api_config_id, schedule_type, schedule_value,
    output_credential_id, created_at, updated_at) VALUES (?, 'job', ?, 't', 'k', ?, 'interval', '5', ?, ?, ?)`)
    .run(crypto.randomUUID(), connectionId, apiConfig.id, used.id, ts, ts);
  const blocked = await call('DELETE', `/${used.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.details.usages.jobs.length, 1);
  const usages = await call('GET', `/${used.id}/usages`);
  assert.equal(usages.body.data.jobs.length, 1);

  const free = (await createOne()).body.data;
  const ok = await call('DELETE', `/${free.id}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data, { deleted: true });
  assert.equal((await call('GET', `/${free.id}`)).status, 404);
});

test('POST /test con ruta local ⇒ 400 y sin la contraseña en la respuesta', async () => {
  const res = await call('POST', '/test', { path: 'C:\\datos', username: 'svc', password: SECRET });
  assert.equal(res.status, 400);
  assert.equal(res.text.includes(SECRET), false);
});

test('POST /test sin credencial ni usuario ⇒ 400', async () => {
  assert.equal((await call('POST', '/test', { path: '\\\\srv\\rec' })).status, 400);
});

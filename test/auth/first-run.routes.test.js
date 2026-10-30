'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('events');
const { createServer } = require('../../src/server');

getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();

let server;
let base;
test.before(async () => {
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('sin maestro, GET /first-run indica que hace falta', async () => {
  const r = await call('GET', '/first-run');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { required: true, username: 'admin' });
});

test('POST /first-run rechaza contraseñas cortas', async () => {
  const r = await call('POST', '/first-run', { password: 'corta' });
  assert.equal(r.status, 400);
});

test('POST /first-run crea el maestro, devuelve token y permite login', async () => {
  const r = await call('POST', '/first-run', { password: 'ClaveSegura123' });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.token);
  assert.equal(r.body.data.user.username, 'admin');
  assert.equal(r.body.data.user.is_master, true);

  const login = await call('POST', '/login', { username: 'admin', password: 'ClaveSegura123' });
  assert.equal(login.status, 200);
});

test('con maestro, GET indica que no hace falta y POST responde 404', async () => {
  const g = await call('GET', '/first-run');
  assert.deepEqual(g.body.data, { required: false, username: 'admin' });
  const p = await call('POST', '/first-run', { password: 'OtraClave12345' });
  assert.equal(p.status, 404);
});

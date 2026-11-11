'use strict';

const { getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { once } = require('events');
const { createServer } = require('../../src/server');
const { generateToken } = require('../../src/modules/auth/auth.service');
const networkSession = require('../../src/core/network/network-session');
const credentialsService = require('../../src/modules/credentials/credentials.service');

const db = getDb();
db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', 'test-secret')").run();
const ts = new Date().toISOString();
db.prepare('INSERT INTO users (id, username, password, role, is_master, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
  .run('master-net', 'master-net', 'x', 'admin', ts, ts);
const token = generateToken({ id: 'master-net', username: 'master-net', role: 'admin' });
const SECRET = 'Pw-Sistema-Secreta-321';

let server;
let base;
let credential;
const originalGetNetworkSession = networkSession.getNetworkSession;

test.before(async () => {
  credential = credentialsService.createCredential({ name: 'Cred sistema', domain: 'EMP', username: 'svc', password: SECRET }, { id: 'master-net', username: 'master-net' });
  // Sesión simulada: una conexión con credencial conocida y otra con una credencial que ya no existe
  networkSession.getNetworkSession = () => ({
    listConnections: () => [
      { server: 'srv1', share: 'datos', credentialId: credential.id, connectedAt: '2026-11-11T10:00:00.000Z' },
      { server: 'srv2', share: 'otros', credentialId: crypto.randomUUID(), connectedAt: '2026-11-11T11:00:00.000Z' },
    ],
  });
  server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/system/network`;
});
test.after(() => new Promise((resolve) => {
  networkSession.getNetworkSession = originalGetNetworkSession;
  server.close(resolve);
}));

async function get(auth = true) {
  const headers = auth ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(base, { headers });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

test('sin token ⇒ 401', async () => {
  assert.equal((await get(false)).status, 401);
});

test('forma de la respuesta: cuenta, disponibilidad y conexiones con nombre de credencial', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const { account, available, connections } = res.body.data;
  assert.equal(typeof account.username, 'string');
  assert.ok(account.username.length > 0);
  assert.ok(account.domain === null || typeof account.domain === 'string');
  assert.equal(typeof available, 'boolean');
  assert.equal(connections.length, 2);
  assert.deepEqual(connections[0], {
    server: 'srv1', share: 'datos', credentialId: credential.id, credentialName: 'Cred sistema', connectedAt: '2026-11-11T10:00:00.000Z',
  });
  // Credencial inexistente ⇒ nombre nulo, sin romper la pantalla
  assert.equal(connections[1].credentialName, null);
});

test('la respuesta nunca contiene contraseñas', async () => {
  const res = await get();
  assert.equal(res.text.includes(SECRET), false);
  assert.equal(/password/i.test(res.text), false);
});

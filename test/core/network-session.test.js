'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const silentLogger = require('../helpers/silent-logger');
const { createNetworkSession } = require('../../src/core/network/network-session');
const { NetworkAccessError } = require('../../src/core/network/net-errors');

/** winNet simulado: cuenta llamadas y permite fijar el código por recurso. */
function fakeWinNet({ codes = {} } = {}) {
  const calls = { connect: [], disconnect: [] };
  return {
    calls,
    isAvailable: () => true,
    connect(args) {
      calls.connect.push(args);
      return codes[args.root] || 0;
    },
    disconnect(root, opts) {
      calls.disconnect.push({ root, opts });
      return 0;
    },
  };
}

const cred = (over = {}) => ({
  root: '\\\\srv\\datos', credentialId: 'c1', username: 'DOM\\ana', password: 'secreto', ...over,
});

test('dos ensureConnected simultáneos al mismo recurso: un solo connect', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await Promise.all([session.ensureConnected(cred()), session.ensureConnected(cred())]);
  assert.equal(winNet.calls.connect.length, 1);
});

test('mismo servidor, otro recurso y misma credencial: segundo connect y un solo servidor registrado', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  await session.ensureConnected(cred({ root: '\\\\srv\\otro' }));
  assert.equal(winNet.calls.connect.length, 2);
  const list = session.listConnections();
  assert.equal(list.length, 2);
  assert.equal(new Set(list.map((c) => c.server)).size, 1);
});

test('otra credencial en el mismo servidor: conflict sin llamar a winNet', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  await assert.rejects(
    session.ensureConnected(cred({ credentialId: 'c2', root: '\\\\SRV\\otro' })),
    (err) => err instanceof NetworkAccessError && err.kind === 'conflict',
  );
  assert.equal(winNet.calls.connect.length, 1);
});

test('1326 de Windows: credential y no se registra', async () => {
  const winNet = fakeWinNet({ codes: { '\\\\srv\\datos': 1326 } });
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await assert.rejects(session.ensureConnected(cred()), (err) => err.kind === 'credential' && err.winCode === 1326);
  assert.deepEqual(session.listConnections(), []);
});

test('1219 de Windows: conflict con el mensaje del límite por servidor', async () => {
  const winNet = fakeWinNet({ codes: { '\\\\srv\\datos': 1219 } });
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await assert.rejects(
    session.ensureConnected(cred()),
    (err) => err.kind === 'conflict' && /un usuario por servidor/.test(err.message),
  );
  assert.deepEqual(session.listConnections(), []);
});

test('reconnect: disconnect y connect una sola vez', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  await session.ensureConnected(cred(), { reconnect: true });
  assert.equal(winNet.calls.disconnect.length, 1);
  assert.equal(winNet.calls.disconnect[0].root, '\\\\srv\\datos');
  assert.equal(winNet.calls.connect.length, 2);
  assert.equal(session.listConnections().length, 1);
});

test('reconexión fallida: libera el servidor y otra credencial puede conectar', async () => {
  const codes = {};
  const winNet = fakeWinNet({ codes });
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  codes['\\\\srv\\datos'] = 1326;
  await assert.rejects(session.ensureConnected(cred(), { reconnect: true }), (err) => err.kind === 'credential');
  assert.deepEqual(session.listConnections(), []);
  codes['\\\\srv\\datos'] = 0;
  await session.ensureConnected(cred({ credentialId: 'c2' }));
  assert.equal(session.listConnections()[0].credentialId, 'c2');
});

test('disconnectCredential cancela todos sus recursos y libera el servidor', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  await session.ensureConnected(cred({ root: '\\\\srv\\otro' }));
  await session.ensureConnected(cred({ credentialId: 'c9', root: '\\\\otro-srv\\x' }));
  await session.disconnectCredential('c1');
  assert.equal(winNet.calls.disconnect.length, 2);
  assert.deepEqual(session.listConnections().map((c) => c.credentialId), ['c9']);
  // El servidor queda libre para otra credencial
  await session.ensureConnected(cred({ credentialId: 'c2' }));
  assert.equal(session.listConnections().length, 2);
});

test('disconnectAll vacía el registro', async () => {
  const winNet = fakeWinNet();
  const session = createNetworkSession({ winNet, logger: silentLogger });
  await session.ensureConnected(cred());
  await session.ensureConnected(cred({ credentialId: 'c9', root: '\\\\otro-srv\\x' }));
  await session.disconnectAll();
  assert.deepEqual(session.listConnections(), []);
  assert.equal(winNet.calls.disconnect.length, 2);
});

test('un connect pendiente del servidor A no retrasa al servidor B', async () => {
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  // connect asíncrono: el de A queda pendiente hasta soltar la puerta
  const winNet = {
    calls: [],
    isAvailable: () => true,
    async connect(args) {
      if (args.root === '\\\\a\\x') await gateA;
      this.calls.push(args.root);
      return 0;
    },
    disconnect: () => 0,
  };
  const session = createNetworkSession({ winNet, logger: silentLogger });
  const pendingA = session.ensureConnected(cred({ root: '\\\\a\\x' }));
  await session.ensureConnected(cred({ root: '\\\\b\\x', credentialId: 'c2' }));
  assert.deepEqual(winNet.calls, ['\\\\b\\x']);
  releaseA();
  await pendingA;
  assert.deepEqual(winNet.calls, ['\\\\b\\x', '\\\\a\\x']);
});

test('la contraseña no aparece en el registro ni en el logger', async () => {
  const logged = [];
  const logger = {
    info: (...a) => logged.push(a), warn: (...a) => logged.push(a), error: (...a) => logged.push(a), debug: (...a) => logged.push(a),
  };
  const session = createNetworkSession({ winNet: fakeWinNet({ codes: { '\\\\srv\\malo': 1326 } }), logger });
  await session.ensureConnected(cred());
  await assert.rejects(session.ensureConnected(cred({ root: '\\\\srv\\malo' })));
  await session.disconnectAll();
  assert.ok(!JSON.stringify(logged).includes('secreto'));
  assert.ok(!JSON.stringify(session.listConnections()).includes('secreto'));
});

'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWinNet } = require('../../src/core/network/win-net');
const { NetworkAccessError } = require('../../src/core/network/net-errors');

function fakeLoader(addResult = 0, cancelResult = 0) {
  const calls = { add: [], cancel: [] };
  const loader = () => ({
    add: (...args) => { calls.add.push(args); return addResult; },
    cancel: (...args) => { calls.cancel.push(args); return cancelResult; },
  });
  return { loader, calls };
}

test('connect: pasa recurso, tipo disco, sin letra local y flags 0; devuelve el código tal cual', () => {
  const { loader, calls } = fakeLoader(1326);
  const winNet = createWinNet({ loader });
  assert.equal(winNet.isAvailable(), true);
  const code = winNet.connect({ root: '\\\\srv\\datos', username: 'DOM\\ana', password: 'secreto' });
  assert.equal(code, 1326);
  assert.equal(calls.add.length, 1);
  const [resource, password, user, flags] = calls.add[0];
  assert.equal(resource.lpRemoteName, '\\\\srv\\datos');
  assert.equal(resource.dwType, 1);
  assert.equal(resource.lpLocalName, null);
  assert.equal(password, 'secreto');
  assert.equal(user, 'DOM\\ana');
  assert.equal(flags, 0);
});

test('disconnect: force se pasa como 1/0 y devuelve el código', () => {
  const { loader, calls } = fakeLoader(0, 2250);
  const winNet = createWinNet({ loader });
  assert.equal(winNet.disconnect('\\\\srv\\datos', { force: true }), 2250);
  winNet.disconnect('\\\\srv\\datos');
  assert.deepEqual(calls.cancel[0], ['\\\\srv\\datos', 0, 1]);
  assert.deepEqual(calls.cancel[1], ['\\\\srv\\datos', 0, 0]);
});

test('loader que lanza: no disponible y connect/disconnect rechazan con unavailable', () => {
  const winNet = createWinNet({ loader: () => { throw new Error('koffi no carga'); } });
  assert.equal(winNet.isAvailable(), false);
  assert.throws(
    () => winNet.connect({ root: '\\\\srv\\datos', username: 'a', password: 'b' }),
    (err) => err instanceof NetworkAccessError
      && err.kind === 'unavailable'
      && err.message === 'Conexión con credenciales no disponible en este equipo',
  );
  assert.throws(() => winNet.disconnect('\\\\srv\\datos'), (err) => err.kind === 'unavailable');
});

test('la carga es perezosa y se hace una sola vez', () => {
  let loads = 0;
  const winNet = createWinNet({ loader: () => { loads += 1; return { add: () => 0, cancel: () => 0 }; } });
  assert.equal(loads, 0);
  winNet.isAvailable();
  winNet.connect({ root: 'r', username: 'u', password: 'p' });
  assert.equal(loads, 1);
});

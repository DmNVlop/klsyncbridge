'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyWinError, NetworkAccessError } = require('../../src/core/network/net-errors');

test('classifyWinError: cada código Win32 a su tipo', () => {
  for (const code of [1326, 86, 1330, 1331, 1909, 2202, 5]) {
    assert.equal(classifyWinError(code).kind, 'credential', `código ${code}`);
  }
  assert.equal(classifyWinError(1219).kind, 'conflict');
  for (const code of [53, 67, 1222, 1311, 64, 121]) {
    assert.equal(classifyWinError(code).kind, 'network', `código ${code}`);
  }
});

test('classifyWinError: el mensaje de 1219 explica el límite de un usuario por servidor', () => {
  assert.match(classifyWinError(1219).message, /un usuario por servidor/);
});

test('classifyWinError: reintentable solo en network', () => {
  assert.equal(classifyWinError(53).retryable, true);
  assert.equal(classifyWinError(1326).retryable, false);
  assert.equal(classifyWinError(1219).retryable, false);
  assert.equal(classifyWinError(9999).retryable, false);
});

test('classifyWinError: código desconocido incluye el número', () => {
  const result = classifyWinError(9999);
  assert.equal(result.kind, 'unknown');
  assert.match(result.message, /9999/);
});

test('NetworkAccessError: propiedades, código y estado HTTP por tipo', () => {
  const credential = new NetworkAccessError({ kind: 'credential', winCode: 1326, retryable: false, message: 'x' });
  assert.equal(credential.kind, 'credential');
  assert.equal(credential.winCode, 1326);
  assert.equal(credential.retryable, false);
  assert.equal(credential.code, 'NETWORK_ACCESS_CREDENTIAL');
  assert.equal(credential.statusCode, 400);
  assert.equal(new NetworkAccessError({ kind: 'conflict', message: 'x' }).statusCode, 400);
  assert.equal(new NetworkAccessError({ kind: 'network', retryable: true, message: 'x' }).statusCode, 503);
  assert.equal(new NetworkAccessError({ kind: 'unavailable', message: 'x' }).statusCode, 503);
  assert.equal(new NetworkAccessError({ kind: 'unknown', message: 'x' }).statusCode, 500);
  assert.ok(credential instanceof Error);
});

'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUncRoot } = require('../../src/core/network/unc');

test('parseUncRoot: servidor en minúsculas y recurso con su caso original', () => {
  assert.deepEqual(parseUncRoot('\\\\SRV\\Datos\\sub\\x.xml'), { server: 'srv', share: 'Datos', root: '\\\\srv\\Datos' });
});

test('parseUncRoot: acepta barras normales y mixtas', () => {
  assert.deepEqual(parseUncRoot('//srv/datos'), { server: 'srv', share: 'datos', root: '\\\\srv\\datos' });
  assert.deepEqual(parseUncRoot('\\\\srv/datos/a\\b'), { server: 'srv', share: 'datos', root: '\\\\srv\\datos' });
});

test('parseUncRoot: recurso oculto con $ e IPv4', () => {
  assert.deepEqual(parseUncRoot('\\\\192.168.1.5\\Rec$'), { server: '192.168.1.5', share: 'Rec$', root: '\\\\192.168.1.5\\Rec$' });
  assert.deepEqual(parseUncRoot('\\\\DAMIAN-XPS15\\ArdisConfig$\\a\\b'), {
    server: 'damian-xps15', share: 'ArdisConfig$', root: '\\\\damian-xps15\\ArdisConfig$',
  });
});

test('parseUncRoot: null para lo que no es una ruta UNC válida', () => {
  assert.equal(parseUncRoot('\\\\srv'), null);
  assert.equal(parseUncRoot('\\\\srv\\'), null);
  assert.equal(parseUncRoot('\\\\\\share'), null);
  assert.equal(parseUncRoot('\\\\?\\C:\\x'), null);
  assert.equal(parseUncRoot('\\\\.\\pipe\\x'), null);
  assert.equal(parseUncRoot('C:\\x'), null);
  assert.equal(parseUncRoot(''), null);
  assert.equal(parseUncRoot(undefined), null);
});

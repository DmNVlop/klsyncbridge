'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeCp850 } = require('../../src/utils/windows-console');

test('decodeCp850 traduce la salida OEM de sc.exe en español', () => {
  // «CÓD_SALIDA» tal como lo escribe sc.exe (Ó = 0xE0 en cp850)
  assert.equal(decodeCp850(Buffer.from([0x43, 0xe0, 0x44, 0x5f])), 'CÓD_');
  assert.equal(decodeCp850(Buffer.from([0x49, 0x4e, 0x44, 0x49, 0x43, 0x41, 0x43, 0x49, 0xe0, 0x4e])), 'INDICACIÓN');
});

test('decodeCp850 deja intacto el texto ASCII', () => {
  assert.equal(decodeCp850(Buffer.from('STATE : 4 RUNNING', 'ascii')), 'STATE : 4 RUNNING');
});

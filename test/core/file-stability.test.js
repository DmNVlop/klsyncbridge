'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { readWhenComplete } = require('../../src/core/files/file-stability');

function writeTemp(name, content) {
  const file = path.join(makeTempDir(), name);
  fs.writeFileSync(file, content);
  return file;
}

const failingOpen = (code) => ({
  ...fsp,
  open: async () => { const err = new Error(code); err.code = code; throw err; },
});

test('archivo estable ⇒ listo con su contenido', async () => {
  const file = writeTemp('a.xml', '<a/>');
  const res = await readWhenComplete(file, { stableMs: 10 });
  assert.equal(res.ready, true);
  assert.equal(res.buffer.toString(), '<a/>');
  assert.equal(res.size, 4);
});

test('archivo vacío ⇒ no listo (empty)', async () => {
  const file = writeTemp('vacio.xml', '');
  assert.deepEqual(await readWhenComplete(file, { stableMs: 10 }), { ready: false, reason: 'empty' });
});

test('archivo que crece durante la espera ⇒ no listo (growing)', async () => {
  const file = writeTemp('crece.xml', '<a>');
  const res = await readWhenComplete(file, { stableMs: 10 }, { sleep: async () => fs.appendFileSync(file, 'más</a>') });
  assert.deepEqual(res, { ready: false, reason: 'growing' });
});

test('bloqueado por otro proceso (EBUSY) ⇒ no listo (locked)', async () => {
  const file = writeTemp('bloq.xml', '<a/>');
  const res = await readWhenComplete(file, { stableMs: 10 }, { fsApi: failingOpen('EBUSY') });
  assert.deepEqual(res, { ready: false, reason: 'locked' });
});

test('cuenta con solo lectura (EACCES en r+) ⇒ se lee igualmente', async () => {
  const file = writeTemp('ro.xml', '<a/>');
  const res = await readWhenComplete(file, { stableMs: 10 }, { fsApi: failingOpen('EACCES') });
  assert.equal(res.ready, true);
});

test('otro error al abrir ⇒ se propaga', async () => {
  const file = writeTemp('io.xml', '<a/>');
  await assert.rejects(readWhenComplete(file, { stableMs: 10 }, { fsApi: failingOpen('EIO') }), { code: 'EIO' });
});

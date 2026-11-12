'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hashStdContent, writeStdFile } = require('../../src/core/outputs/ardis-std/std-file');

const A = '﻿\r\n[ISTDALG]\r\nDATUM=120126\r\n[ISTDALG]\r\n';
const A_OTHER_DATE = A.replace('120126', '130126');
const B = A.replace('[ISTDALG]\r\n', '[ISTDALG]\r\nREST=X\r\n');

test('hashStdContent ignora DATUM, BOM y CRLF/LF', () => {
  assert.equal(hashStdContent(A), hashStdContent(A_OTHER_DATE));
  assert.equal(hashStdContent(A), hashStdContent(A.replace(/\r\n/g, '\n').replace('﻿', '')));
  assert.notEqual(hashStdContent(A), hashStdContent(B));
});

test('writeStdFile: escribe, no reescribe si solo cambia DATUM, reescribe si cambia', async () => {
  const dir = makeTempDir();
  const first = await writeStdFile({ dir, storeName: 'Almacen KL', content: A });
  assert.deepEqual(first, { filePath: path.join(dir, 'Almacen KL.STD'), changed: true });
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), A);
  const second = await writeStdFile({ dir, storeName: 'Almacen KL', content: A_OTHER_DATE });
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), A);
  const third = await writeStdFile({ dir, storeName: 'Almacen KL', content: B });
  assert.equal(third.changed, true);
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), B);
  assert.deepEqual(fs.readdirSync(dir), ['Almacen KL.STD']);
});

test('writeStdFile: EBUSY al renombrar ⇒ un reintento tras la espera', async () => {
  const dir = makeTempDir();
  let calls = 0;
  const waits = [];
  const rename = (from, to) => {
    calls++;
    if (calls === 1) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
    fs.renameSync(from, to);
  };
  const r = await writeStdFile({ dir, storeName: 'S', content: A, rename, sleep: async ms => { waits.push(ms); } });
  assert.equal(r.changed, true);
  assert.deepEqual(waits, [5000]);
  assert.equal(calls, 2);
});

test('writeStdFile: sigue ocupado ⇒ error claro y sin temporales', async () => {
  const dir = makeTempDir();
  const rename = () => { const e = new Error('perm'); e.code = 'EPERM'; throw e; };
  await assert.rejects(
    () => writeStdFile({ dir, storeName: 'S', content: A, rename, sleep: async () => {} }),
    /No se pudo sustituir el almacén «S\.STD»/,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

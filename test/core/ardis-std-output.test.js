'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const stdOutput = require('../../src/core/outputs/ardis-std/ardis-std.output');

const ok = (m) => ({ payload: { MATERIAAL: m, LENGTE: 2800, BREEDTE: 2070, DIKTE: 19 } });
const bad = { payload: { MATERIAAL: 'X', LENGTE: 2800, BREEDTE: 2070 } };
const config = (dir) => ({ outputDir: dir, storeName: 'Almacen Caroball', header: { REST: 'Retales' }, jobName: 'j', jobId: 'id' });

test('escribe el almacén y luego no lo reescribe si no cambia', async () => {
  const dir = makeTempDir();
  const r1 = await stdOutput.write({ items: [ok('A'), ok('B')], config: config(dir) });
  assert.equal(r1.status, 'success');
  assert.equal(r1.written, 2);
  assert.deepEqual(r1.filePaths, [path.join(dir, 'Almacen Caroball.STD')]);
  assert.equal(r1.unchanged, false);
  const r2 = await stdOutput.write({ items: [ok('A'), ok('B')], config: config(dir) });
  assert.equal(r2.status, 'success');
  assert.equal(r2.unchanged, true);
});

test('descartes ⇒ warning con motivos y se escriben los válidos', async () => {
  const dir = makeTempDir();
  const r = await stdOutput.write({ items: [ok('A'), bad], config: config(dir) });
  assert.equal(r.status, 'warning');
  assert.equal(r.written, 1);
  assert.equal(r.discardedCount, 1);
  assert.match(r.message, /1 registro descartado: fila 2 \(MATERIAAL=X\): falta DIKTE/);
  assert.ok(fs.existsSync(path.join(dir, 'Almacen Caroball.STD')));
});

test('0 válidos ⇒ no escribe y avisa (protege el almacén existente)', async () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'Almacen Caroball.STD');
  fs.writeFileSync(file, 'ANTERIOR');
  const r = await stdOutput.write({ items: [bad], config: config(dir) });
  assert.equal(r.status, 'warning');
  assert.equal(r.written, 0);
  assert.deepEqual(r.filePaths, []);
  assert.match(r.message, /No se ha escrito el almacén «Almacen Caroball»: 0 registros válidos/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'ANTERIOR');
});

test('sin nombre de almacén ⇒ error', async () => {
  await assert.rejects(() => stdOutput.write({ items: [ok('A')], config: { ...config(makeTempDir()), storeName: null } }),
    /nombre del almacén/);
});

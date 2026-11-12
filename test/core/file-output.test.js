'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fileOutput = require('../../src/core/outputs/file.output');

const items = [{ payload: { ref: 'A', n: 1 } }, { payload: { ref: 'B;x', n: 2 } }];

function config(dir, overrides = {}) {
  return { outputDir: dir, baseName: 'stock', formats: ['csv', 'json'], delimiter: ';', retention: 'keep_all',
    headers: ['ref', 'n'], jobName: 'j', jobId: 'id1', ...overrides };
}

test('file.output: escribe CSV con BOM y escape, y JSON', async () => {
  const dir = makeTempDir();
  const r = await fileOutput.write({ items, config: config(dir) });
  assert.equal(r.status, 'success');
  assert.equal(r.filePaths.length, 2);
  assert.equal(r.written, 2);
  const csv = fs.readFileSync(r.filePaths.find(p => p.endsWith('.csv')), 'utf8');
  assert.equal(csv, '﻿ref;n\r\nA;1\r\n"B;x";2\r\n');
  const json = JSON.parse(fs.readFileSync(r.filePaths.find(p => p.endsWith('.json')), 'utf8'));
  assert.deepEqual(json, [{ ref: 'A', n: 1 }, { ref: 'B;x', n: 2 }]);
});

test('file.output: keep_last borra exportaciones anteriores del mismo nombre', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'stock_2000-01-01_0000.csv'), 'viejo');
  fs.writeFileSync(path.join(dir, 'otro_2000-01-01_0000.csv'), 'ajeno');
  await fileOutput.write({ items, config: config(dir, { formats: ['csv'], retention: 'keep_last' }) });
  const left = fs.readdirSync(dir);
  assert.ok(!left.includes('stock_2000-01-01_0000.csv'));
  assert.ok(left.includes('otro_2000-01-01_0000.csv'));
});

test('file.output: sin carpeta ⇒ error', async () => {
  await assert.rejects(() => fileOutput.write({ items, config: config(null) }), /output_dir no configurado/);
});

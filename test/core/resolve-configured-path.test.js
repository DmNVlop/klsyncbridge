'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveConfiguredPath } = require('../../src/core/files/paths');
const csvSource = require('../../src/services/sources/csv.source');

test('acepta absolutas locales y UNC, normalizadas', () => {
  assert.equal(resolveConfiguredPath('C:\\a\\b'), 'C:\\a\\b');
  assert.equal(resolveConfiguredPath('C:/a/b'), 'C:\\a\\b');
  assert.equal(resolveConfiguredPath('\\\\srv\\rec\\x.csv'), '\\\\srv\\rec\\x.csv');
  assert.equal(resolveConfiguredPath('//srv/rec/x'), '\\\\srv\\rec\\x');
});

test('rechaza relativas, rutas de dispositivo, control, UNC sin recurso y vacías', () => {
  const invalid = ['datos\\x.csv', '..\\x', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', 'C:\\a\\\u0000b', '\\\\srv', '', '   ', null, undefined, 42];
  for (const value of invalid) {
    assert.throws(() => resolveConfiguredPath(value), (err) => err.code === 'INVALID_PATH' && err.statusCode === 400, String(value));
  }
});

test('csv.source.getRecords sigue funcionando sobre una carpeta local', async () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'datos.csv');
  fs.writeFileSync(file, 'id,nombre\n1,Ana\n2,Luis\n');
  const records = await csvSource.getRecords({ file_path: file }, {});
  assert.equal(records.length, 2);
});

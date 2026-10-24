'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { probeFolder } = require('../../src/core/files/folder-probe');

test('carpeta accesible: cuenta los archivos que cumplen el patrón', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.xml'), 'x');
  fs.writeFileSync(path.join(dir, 'B.XML'), 'x');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'sub.xml'));
  const res = await probeFolder({ path: dir, pattern: '*.xml' });
  assert.equal(res.accessible, true);
  assert.equal(res.readable, true);
  assert.equal(res.matchingFiles, 2);
  assert.equal(res.message, 'Carpeta accesible: 2 archivo(s) cumplen el patrón *.xml.');
});

test('carpeta inexistente ⇒ no accesible con mensaje en español', async () => {
  const res = await probeFolder({ path: path.join(makeTempDir(), 'no-existe'), pattern: '*.xml' });
  assert.equal(res.accessible, false);
  assert.equal(res.errorCode, 'ENOENT');
  assert.match(res.message, /^No se puede acceder a la carpeta/);
});

test('la ruta es un archivo ⇒ ENOTDIR', async () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'a.xml');
  fs.writeFileSync(file, 'x');
  const res = await probeFolder({ path: file, pattern: '*.xml' });
  assert.equal(res.accessible, false);
  assert.match(res.message, /la ruta no es una carpeta/);
});

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

function fakeFs(overrides = {}) {
  const calls = { readdir: 0, writeFile: [], unlink: [] };
  const fsApi = {
    stat: async () => ({ isDirectory: () => true }),
    readdir: async () => { calls.readdir += 1; return []; },
    access: async () => undefined,
    writeFile: async (p) => { calls.writeFile.push(p); },
    unlink: async (p) => { calls.unlink.push(p); },
    ...overrides,
  };
  return { fsApi, calls };
}

test('ensureAccess que lanza ⇒ paso connect en rojo y no se lista', async () => {
  const { NetworkAccessError } = require('../../src/core/network/net-errors');
  const { fsApi, calls } = fakeFs();
  const ensureAccess = async () => { throw new NetworkAccessError({ kind: 'credential', message: 'Usuario o contraseña incorrectos' }); };
  const res = await probeFolder({ path: '\\\\srv\\rec', pattern: '*.xml' }, { fsApi, ensureAccess });
  assert.equal(res.accessible, false);
  assert.equal(res.errorCode, 'credential');
  assert.equal(res.steps[0].name, 'connect');
  assert.equal(res.steps[0].ok, false);
  assert.equal(calls.readdir, 0);
});

test('con ensureAccess correcto añade el paso connect y list', async () => {
  const { fsApi } = fakeFs();
  const res = await probeFolder({ path: '\\\\srv\\rec', pattern: '*.xml' }, { fsApi, ensureAccess: async () => undefined });
  assert.deepEqual(res.steps.map((s) => [s.name, s.ok]), [['connect', true], ['list', true]]);
});

test('checkWrite crea y borra .klsync-probe-*.tmp', async () => {
  const { fsApi, calls } = fakeFs();
  const res = await probeFolder({ path: 'C:\\out', pattern: '*', checkWrite: true }, { fsApi });
  assert.equal(res.writable, true);
  assert.equal(calls.writeFile.length, 1);
  assert.match(calls.writeFile[0], /\.klsync-probe-[0-9a-f-]+\.tmp$/);
  assert.equal(calls.unlink[0], calls.writeFile[0]);
  assert.equal(res.steps[res.steps.length - 1].name, 'write');
});

test('fallo en write ⇒ reflejado en steps', async () => {
  const { fsApi } = fakeFs({ writeFile: async () => { const e = new Error('x'); e.code = 'EACCES'; throw e; } });
  const res = await probeFolder({ path: 'C:\\out', pattern: '*', checkWrite: true }, { fsApi });
  assert.equal(res.accessible, true);
  assert.equal(res.writable, false);
  assert.equal(res.steps.find((s) => s.name === 'write').ok, false);
  assert.equal(res.errorCode, 'EACCES');
});

test('sin checkWrite no hay paso write; unidad mapeada inexistente ⇒ mensaje propio', async () => {
  const { fsApi } = fakeFs();
  const res = await probeFolder({ path: 'C:\\out', pattern: '*' }, { fsApi });
  assert.equal(res.steps.some((s) => s.name === 'write'), false);
  const missing = fakeFs({ stat: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } });
  const bad = await probeFolder({ path: 'Z:\\datos', pattern: '*' }, { fsApi: missing.fsApi });
  assert.match(bad.message, /unidad mapeada no visible/);
});

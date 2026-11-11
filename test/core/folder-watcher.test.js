'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { watchFolder } = require('../../src/core/files/folder-watcher');
const silentLogger = require('../helpers/silent-logger');

const OPTIONS = { pattern: '*.xml', stableMs: 30, sweepMs: 3600000, debounceMs: 20 };

function collector({ shouldProcess = () => true } = {}) {
  const ready = [];
  const health = [];
  let notify = null;
  return {
    ready,
    health,
    handlers: {
      shouldProcess,
      onFileReady: (file) => { ready.push(file); if (notify) notify(); },
      onHealthChange: (state, message) => health.push({ state, message }),
    },
    nextReady: () => new Promise((resolve) => { notify = resolve; }),
  };
}

test('barrido: entrega los archivos estables que cumplen el patrón', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'A.XML'), '<a/>');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
  const c = collector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger });
  await watcher.sweepNow();
  watcher.stop();
  assert.equal(c.ready.length, 1);
  assert.equal(c.ready[0].name, 'A.XML');
  assert.equal(c.ready[0].path, path.join(dir, 'A.XML'));
  assert.match(c.ready[0].fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(c.ready[0].buffer.toString(), '<a/>');
  assert.deepEqual(c.health.map((h) => h.state), ['ok']);
});

test('shouldProcess false ⇒ no se lee ni se entrega', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.xml'), '<a/>');
  const c = collector({ shouldProcess: () => false });
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger });
  await watcher.sweepNow();
  watcher.stop();
  assert.equal(c.ready.length, 0);
});

test('carpeta inexistente ⇒ folder_unreachable; al aparecer ⇒ ok', async () => {
  const dir = path.join(makeTempDir(), 'tarde');
  const c = collector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger });
  await watcher.sweepNow();
  assert.equal(c.health.at(-1).state, 'folder_unreachable');
  assert.match(c.health.at(-1).message, /^No se puede acceder a la carpeta/);
  fs.mkdirSync(dir);
  await watcher.sweepNow();
  watcher.stop();
  assert.deepEqual(c.health.map((h) => h.state), ['folder_unreachable', 'ok']);
});

test('fs.watch detecta un archivo nuevo sin esperar al barrido', { timeout: 5000 }, async () => {
  const dir = makeTempDir();
  const c = collector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger });
  await watcher.sweepNow();
  const arrived = c.nextReady();
  fs.writeFileSync(path.join(dir, 'nuevo.xml'), '<n/>');
  await arrived;
  watcher.stop();
  assert.equal(c.ready[0].name, 'nuevo.xml');
});

// ── Hook ensureAccess (credenciales de red) ──────────────────────────────────

function denyingCollector() {
  const c = collector();
  c.denied = [];
  c.handlers.onAccessDenied = (message) => c.denied.push(message);
  return c;
}

test('ensureAccess: se invoca antes de cada barrido', async () => {
  const dir = makeTempDir();
  const calls = [];
  const c = denyingCollector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger, ensureAccess: (o) => { calls.push(o); } });
  await watcher.sweepNow();
  await watcher.sweepNow();
  watcher.stop();
  assert.equal(calls.length, 2);
  assert.deepEqual(c.health.map((h) => h.state), ['ok']);
});

test('ensureAccess: carpeta inexistente ⇒ una reconexión y un único reintento', async () => {
  const dir = path.join(makeTempDir(), 'no-existe');
  const calls = [];
  const c = denyingCollector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger, ensureAccess: (o) => { calls.push(o); } });
  await watcher.sweepNow();
  watcher.stop();
  assert.equal(calls.length, 2);
  assert.equal(calls[0] && calls[0].reconnect, undefined);
  assert.equal(calls[1].reconnect, true);
  assert.equal(c.health.at(-1).state, 'folder_unreachable');
});

test('ensureAccess: error credential ⇒ onAccessDenied una vez y sin más barridos', async () => {
  const dir = makeTempDir();
  let calls = 0;
  const hook = () => { calls += 1; const e = new Error('Credencial incorrecta'); e.kind = 'credential'; throw e; };
  const c = denyingCollector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger, ensureAccess: hook });
  await watcher.sweepNow();
  await watcher.sweepNow();
  watcher.stop();
  assert.deepEqual(c.denied, ['Credencial incorrecta']);
  assert.equal(calls, 1);
  assert.equal(c.health.length, 0);
});

test('ensureAccess: error network ⇒ unreachable y el siguiente barrido vuelve a llamarlo', async () => {
  const dir = makeTempDir();
  let calls = 0;
  const hook = () => { calls += 1; if (calls === 1) { const e = new Error('Sin red'); e.kind = 'network'; throw e; } };
  const c = denyingCollector();
  const watcher = watchFolder({ ...OPTIONS, path: dir }, c.handlers, { logger: silentLogger, ensureAccess: hook });
  await watcher.sweepNow();
  assert.equal(c.health.at(-1).state, 'folder_unreachable');
  assert.equal(c.health.at(-1).message, 'Sin red');
  await watcher.sweepNow();
  watcher.stop();
  assert.equal(calls, 2);
  assert.equal(c.health.at(-1).state, 'ok');
  assert.equal(c.denied.length, 0);
});

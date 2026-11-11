'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const axios = require('axios');
const { checkMigrationPreconditions } = require('../../src/modules/system/updaters/installer-migration.preconditions');
const operationLock = require('../../src/modules/system/updaters/operation-lock');
const updater = require('../../src/modules/system/updaters/installer.updater');

const ROOT = path.resolve('C:\\KLSyncBridge');
const DAEMON = path.join(ROOT, 'src', 'daemon');

// Dependencias «todo correcto»; cada test rompe una.
function okDeps(overrides = {}) {
  return {
    mode: 'legacy-zip',
    root: ROOT,
    readImagePath: async () => path.join(DAEMON, 'klsyncbridge.exe'),
    fileExists: () => true,
    isAdmin: async () => true,
    isBusy: () => false,
    ...overrides,
  };
}

test('precondiciones: todo correcto => disponible', async () => {
  assert.deepEqual(await checkMigrationPreconditions(okDeps()), { available: true, reasons: [] });
});

test('precondiciones: modo installer => ya usa el instalador', async () => {
  const r = await checkMigrationPreconditions(okDeps({ mode: 'installer' }));
  assert.equal(r.available, false);
  assert.deepEqual(r.reasons, ['Ya usa el instalador.']);
});

test('precondiciones: servicio no registrado', async () => {
  const r = await checkMigrationPreconditions(okDeps({ readImagePath: async () => null }));
  assert.equal(r.available, false);
  assert.match(r.reasons[0], /no se está ejecutando como servicio desde esta carpeta/);
});

test('precondiciones: servicio en otra carpeta', async () => {
  const r = await checkMigrationPreconditions(okDeps({ readImagePath: async () => 'C:\\Program Files\\KLSyncBridge\\src\\daemon\\klsyncbridge.exe' }));
  assert.equal(r.available, false);
  assert.match(r.reasons[0], /desde esta carpeta/);
});

test('precondiciones: la comparación de ruta ignora mayúsculas', async () => {
  const r = await checkMigrationPreconditions(okDeps({ readImagePath: async () => 'c:\\klsyncbridge\\SRC\\Daemon\\klsyncbridge.exe' }));
  assert.equal(r.available, true);
});

test('precondiciones: faltan exe o xml del envoltorio', async () => {
  const r = await checkMigrationPreconditions(okDeps({ fileExists: (p) => !p.endsWith('.xml') }));
  assert.equal(r.available, false);
  assert.match(r.reasons[0], /restaurarlo/);
});

test('precondiciones: sin privilegios de administrador', async () => {
  const r = await checkMigrationPreconditions(okDeps({ isAdmin: async () => false }));
  assert.equal(r.available, false);
  assert.match(r.reasons[0], /administrador/);
});

test('precondiciones: otra actualización en curso', async () => {
  const r = await checkMigrationPreconditions(okDeps({ isBusy: () => true }));
  assert.equal(r.available, false);
  assert.match(r.reasons[0], /otra actualización en curso/);
});

test('precondiciones: varios motivos a la vez', async () => {
  const r = await checkMigrationPreconditions(okDeps({ isAdmin: async () => false, isBusy: () => true }));
  assert.equal(r.reasons.length, 2);
});

test('cerrojo: solo uno a la vez y se puede liberar', () => {
  assert.equal(operationLock.tryAcquire(), true);
  assert.equal(operationLock.tryAcquire(), false);
  assert.equal(operationLock.isBusy(), true);
  operationLock.release();
  assert.equal(operationLock.tryAcquire(), true);
  operationLock.release();
});

test('política de versión de la migración: igual y mayor sí, menor no', () => {
  assert.doesNotThrow(() => updater.assertMigrationVersion('2.3.0', '2.3.0'));
  assert.doesNotThrow(() => updater.assertMigrationVersion('2.4.0', '2.3.0'));
  assert.throws(() => updater.assertMigrationVersion('2.2.0', '2.3.0'), /más antiguo/);
});

function fakeRes() {
  return { ended: false, end() { this.ended = true; } };
}

async function withManifest(manifest, fn) {
  const original = axios.get;
  axios.get = async () => ({ data: manifest });
  try {
    return await fn();
  } finally {
    axios.get = original;
  }
}

test('runInstallerUpdate: misma versión => «Ya estás en la última» y no lanza nada', async () => {
  const lines = [];
  const res = fakeRes();
  const manifest = { version: '2.3.0', setupUrl: 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.3.0/x.exe', sha256: 'a'.repeat(64) };
  const launched = await withManifest(manifest, () => updater.runInstallerUpdate({ res, log: (m) => lines.push(m), localVersion: () => '2.3.0' }));
  assert.equal(launched, false);
  assert.deepEqual(lines, ['ℹ️ Ya estás en la última versión (v2.3.0)']);
  assert.equal(res.ended, true);
});

test('runInstallerUpdate: manifiesto inválido => mismos textos de error de siempre', async () => {
  const lines = [];
  const res = fakeRes();
  await withManifest({ version: 'x' }, () => updater.runInstallerUpdate({ res, log: (m) => lines.push(m), localVersion: () => '2.3.0' }));
  assert.match(lines[0], /^❌ Error durante la actualización: Manifiesto de actualización inválido/);
  assert.equal(lines[1], 'ℹ️ No se ha cambiado nada: sigue la versión actual.');
  assert.equal(res.ended, true);
});

test('runInstallerMigration: Release más antiguo => error claro y no se hace nada', async () => {
  const lines = [];
  const res = fakeRes();
  const manifest = { version: '2.2.0', setupUrl: 'https://github.com/DmNVlop/klsyncbridge/releases/download/v2.2.0/x.exe', sha256: 'a'.repeat(64) };
  const launched = await withManifest(manifest, () => updater.runInstallerMigration({ res, log: (m) => lines.push(m), localVersion: () => '2.3.0', username: 'test' }));
  assert.equal(launched, false);
  assert.match(lines[0], /^❌ Error durante el paso al instalador: .*más antiguo/);
  assert.equal(lines[1], 'ℹ️ No se ha cambiado nada: sigue la instalación actual.');
  assert.equal(res.ended, true);
});

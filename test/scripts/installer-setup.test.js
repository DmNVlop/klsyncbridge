'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureEnvFile } = require('../../scripts/installer-setup');

test('ensureEnvFile crea el .env con rutas absolutas de ProgramData', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-pd-'));
  const envFile = ensureEnvFile(dataRoot);
  assert.equal(envFile, path.join(dataRoot, '.env'));
  const content = fs.readFileSync(envFile, 'utf8');
  assert.match(content, new RegExp(`DATA_DIR=${path.join(dataRoot, 'data').replace(/\\/g, '\\\\')}`));
  assert.match(content, new RegExp(`LOG_DIR=${path.join(dataRoot, 'logs').replace(/\\/g, '\\\\')}`));
});

test('ensureEnvFile nunca pisa un .env existente (datos migrados o editados)', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-pd-'));
  fs.writeFileSync(path.join(dataRoot, '.env'), 'PORT=4000\n');
  ensureEnvFile(dataRoot);
  assert.equal(fs.readFileSync(path.join(dataRoot, '.env'), 'utf8'), 'PORT=4000\n');
});

const { readPort, waitForHealth, cleanUpdatesDir } = require('../../scripts/installer-setup');

test('readPort usa el PORT del .env y, si no hay, el 3847', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-port-'));
  const withPort = path.join(dir, 'a.env');
  const without = path.join(dir, 'b.env');
  fs.writeFileSync(withPort, 'DATA_DIR=C:/data\nPORT=4000\n');
  fs.writeFileSync(without, 'DATA_DIR=C:/data\n');
  assert.equal(readPort(withPort), 4000);
  assert.equal(readPort(without), 3847);
});

test('waitForHealth termina en cuanto el servicio responde', async () => {
  let calls = 0;
  await waitForHealth(3847, { timeoutMs: 1000, pollMs: 5, check: async () => { calls += 1; return calls >= 3; } });
  assert.equal(calls, 3);
});

test('waitForHealth falla con mensaje claro si el servicio no responde a tiempo', async () => {
  await assert.rejects(
    waitForHealth(3847, { timeoutMs: 30, pollMs: 5, check: async () => false }),
    /no responde en http:\/\/127\.0\.0\.1:3847\/api\/health/,
  );
});

test('cleanUpdatesDir borra los Setup anteriores y no falla si la carpeta no existe', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-upd-')), 'updates');
  cleanUpdatesDir(dir);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'KLSyncBridge-Setup-2.3.0.exe'), 'x');
  cleanUpdatesDir(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
});

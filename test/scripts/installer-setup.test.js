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

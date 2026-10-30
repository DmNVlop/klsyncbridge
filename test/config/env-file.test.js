'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveEnvFilePath, loadEnvFile } = require('../../src/config/env-file');

test('resolveEnvFilePath usa KLSYNC_ENV_FILE si existe', () => {
  assert.equal(resolveEnvFilePath({ KLSYNC_ENV_FILE: 'C:\\x\\.env' }), 'C:\\x\\.env');
});

test('resolveEnvFilePath cae a la raíz del proyecto', () => {
  assert.equal(resolveEnvFilePath({}), path.join(__dirname, '../../.env'));
});

test('loadEnvFile carga claves sin pisar las existentes y omite comentarios', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '# comentario\nA=1\nB = dos\nSIN_IGUAL\nC=ya\n');
  const target = { C: 'original' };
  loadEnvFile(file, target);
  assert.deepEqual(target, { A: '1', B: 'dos', C: 'original' });
});

test('loadEnvFile no falla si el fichero no existe', () => {
  const target = {};
  loadEnvFile(path.join(os.tmpdir(), 'no-existe-klsb.env'), target);
  assert.deepEqual(target, {});
});

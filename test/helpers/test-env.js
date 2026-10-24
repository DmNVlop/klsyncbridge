'use strict';

// Entorno aislado para tests: BD, clave de cifrado y logs en una carpeta temporal.
// Debe requerirse ANTES que cualquier módulo de src/ (env.js lee process.env al cargarse).
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klsb-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = path.join(rootDir, 'data');
process.env.LOG_DIR = path.join(rootDir, 'logs');
process.env.LOG_LEVEL = 'error';

const { generateKey } = require('../../src/services/encryption.service');
const { initDatabase, getDb, closeDatabase } = require('../../src/config/database');

fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
generateKey();
initDatabase();

function makeTempDir(prefix = 'folder-') {
  return fs.mkdtempSync(path.join(rootDir, prefix));
}

module.exports = { rootDir, getDb, closeDatabase, makeTempDir };

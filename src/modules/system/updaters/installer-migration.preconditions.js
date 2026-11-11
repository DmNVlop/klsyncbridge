'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { getUpdateMode } = require('./update-mode');
const operationLock = require('./operation-lock');

const SERVICE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\klsyncbridge.exe';
const DEFAULT_ROOT = path.resolve(__dirname, '../../../../');

// Lee el ImagePath del servicio (sin comillas) o null si no está registrado.
function readServiceImagePath() {
  return new Promise((resolve) => {
    execFile('reg', ['query', SERVICE_KEY, '/v', 'ImagePath'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const match = String(stdout).match(/ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      return resolve(match ? match[1].trim().replace(/^"|"$/g, '') : null);
    });
  });
}

function checkIsAdmin() {
  return new Promise((resolve) => {
    execFile('net', ['session'], { timeout: 4000, windowsHide: true }, (err) => resolve(!err));
  });
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Comprueba si «Pasar al instalador» puede ejecutarse. Todo es inyectable para los tests.
 * Devuelve { available, reasons } con motivos en español comprensibles para un usuario no técnico.
 */
async function checkMigrationPreconditions(deps = {}) {
  const mode = deps.mode !== undefined ? deps.mode : getUpdateMode();
  const root = deps.root || DEFAULT_ROOT;
  const readImagePath = deps.readImagePath || readServiceImagePath;
  const fileExists = deps.fileExists || fs.existsSync;
  const isAdmin = deps.isAdmin || checkIsAdmin;
  const isBusy = deps.isBusy || operationLock.isBusy;

  if (mode !== 'legacy-zip') return { available: false, reasons: ['Ya usa el instalador.'] };

  const reasons = [];
  const daemonDir = path.join(root, 'src', 'daemon');

  const imagePath = await readImagePath();
  if (!imagePath || !isInside(imagePath, daemonDir)) {
    reasons.push('KLSyncBridge no se está ejecutando como servicio desde esta carpeta; instálalo como servicio antes.');
  }
  if (!fileExists(path.join(daemonDir, 'klsyncbridge.exe')) || !fileExists(path.join(daemonDir, 'klsyncbridge.xml'))) {
    reasons.push('Faltan los ficheros del servicio actual (src\\daemon), necesarios para poder restaurarlo si algo falla.');
  }
  if (!(await isAdmin())) {
    reasons.push('KLSyncBridge no tiene privilegios de administrador; ejecuta el servicio con una cuenta de administrador.');
  }
  if (isBusy()) {
    reasons.push('Hay otra actualización en curso; espera a que termine.');
  }
  return { available: reasons.length === 0, reasons };
}

module.exports = { checkMigrationPreconditions, readServiceImagePath, isInside };

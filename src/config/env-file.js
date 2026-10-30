'use strict';

const path = require('path');
const fs = require('fs');

// Ruta del .env: la instalación con Setup la fija en el servicio (KLSYNC_ENV_FILE, en ProgramData);
// desarrollo e instalaciones antiguas usan el .env de la raíz del proyecto.
function resolveEnvFilePath(source = process.env) {
  return source.KLSYNC_ENV_FILE || path.join(__dirname, '../../.env');
}

// Carga CLAVE=valor en target sin pisar lo ya definido (el entorno real manda sobre el fichero).
function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

module.exports = { resolveEnvFilePath, loadEnvFile };

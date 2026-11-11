'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { matchesPattern, describeFsError } = require('./paths');

const DRIVE_ROOT = /^([a-zA-Z]:)[\\/]/;

/** ¿La raíz de la unidad con letra no existe para el servicio? (I/O: lo calcula el llamador de describeFsError). */
async function isDriveMissing(folderPath, fsApi) {
  const match = DRIVE_ROOT.exec(folderPath || '');
  if (!match) return false;
  return fsApi.stat(`${match[1]}\\`).then(() => false, () => true);
}

function failure(message, errorCode, steps) {
  return { accessible: false, readable: false, writable: false, matchingFiles: 0, message, errorCode, steps };
}

/** Crea y borra un fichero temporal para comprobar el permiso de escritura. */
async function probeWrite(folderPath, fsApi) {
  const probePath = path.win32.join(folderPath, `.klsync-probe-${crypto.randomUUID()}.tmp`);
  await fsApi.writeFile(probePath, '');
  await fsApi.unlink(probePath);
}

/**
 * «Probar carpeta»: comprueba desde el propio servicio (con su cuenta) que la carpeta es accesible.
 * Devuelve además `steps` con el resultado por paso: `connect` (solo con `ensureAccess`), `list` y,
 * con `checkWrite`, `write`. Sin `checkWrite`, `writable` es el `access(W_OK)` informativo.
 * @param {{ path: string, pattern: string, checkWrite?: boolean }} target
 * @param {{ fsApi?: object, ensureAccess?: Function }} [deps] `ensureAccess` lo inyecta el llamador (credencial de red)
 * @returns {Promise<{ accessible, readable, writable, matchingFiles, message, errorCode, steps }>}
 */
async function probeFolder({ path: folderPath, pattern, checkWrite = false }, deps = {}) {
  const fsApi = deps.fsApi || fsp;
  const hasCredential = Boolean(deps.ensureAccess);
  const steps = [];

  if (deps.ensureAccess) {
    try {
      await deps.ensureAccess();
      steps.push({ name: 'connect', ok: true, message: 'Conexión con el recurso de red establecida.' });
    } catch (err) {
      steps.push({ name: 'connect', ok: false, message: err.message });
      return failure(err.message, err.kind || err.code || null, steps);
    }
  }

  let matchingFiles;
  try {
    const stat = await fsApi.stat(folderPath);
    if (!stat.isDirectory()) {
      const notDir = new Error('No es una carpeta');
      notDir.code = 'ENOTDIR';
      throw notDir;
    }
    const entries = await fsApi.readdir(folderPath, { withFileTypes: true });
    matchingFiles = entries.filter((e) => e.isFile() && matchesPattern(e.name, pattern)).length;
    steps.push({ name: 'list', ok: true, message: `${matchingFiles} archivo(s) cumplen el patrón ${pattern}.` });
  } catch (err) {
    const driveMissing = err.code === 'ENOENT' ? await isDriveMissing(folderPath, fsApi) : false;
    const message = describeFsError(err, folderPath, { hasCredential, driveMissing });
    steps.push({ name: 'list', ok: false, message });
    return failure(message, err.code || null, steps);
  }

  let writable;
  let writeError = null;
  if (checkWrite) {
    try {
      await probeWrite(folderPath, fsApi);
      writable = true;
      steps.push({ name: 'write', ok: true, message: 'Se puede crear y borrar archivos en la carpeta.' });
    } catch (err) {
      writable = false;
      writeError = err;
      steps.push({ name: 'write', ok: false, message: `No se puede escribir en la carpeta: ${describeFsError(err, folderPath, { hasCredential }).replace(/^No se puede acceder a la carpeta: /, '')}` });
    }
  } else {
    // Informativo: el motor solo necesita lectura
    writable = await fsApi.access(folderPath, fs.constants.W_OK).then(() => true, () => false);
  }

  return {
    accessible: true,
    readable: true,
    writable,
    matchingFiles,
    message: writeError
      ? steps[steps.length - 1].message
      : `Carpeta accesible: ${matchingFiles} archivo(s) cumplen el patrón ${pattern}.`,
    errorCode: writeError ? (writeError.code || null) : null,
    steps,
  };
}

module.exports = { probeFolder };

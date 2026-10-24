'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const { matchesPattern, describeFsError } = require('./paths');

/**
 * «Probar carpeta»: comprueba desde el propio servicio (con su cuenta) que la carpeta es accesible.
 * @returns {Promise<{ accessible, readable, writable, matchingFiles, message, errorCode }>}
 */
async function probeFolder({ path: folderPath, pattern }, deps = {}) {
  const fsApi = deps.fsApi || fsp;
  try {
    const stat = await fsApi.stat(folderPath);
    if (!stat.isDirectory()) {
      const notDir = new Error('No es una carpeta');
      notDir.code = 'ENOTDIR';
      throw notDir;
    }
    const entries = await fsApi.readdir(folderPath, { withFileTypes: true });
    const matchingFiles = entries.filter((e) => e.isFile() && matchesPattern(e.name, pattern)).length;
    // Informativo: el motor solo necesita lectura
    const writable = await fsApi.access(folderPath, fs.constants.W_OK).then(() => true, () => false);
    return {
      accessible: true,
      readable: true,
      writable,
      matchingFiles,
      message: `Carpeta accesible: ${matchingFiles} archivo(s) cumplen el patrón ${pattern}.`,
      errorCode: null,
    };
  } catch (err) {
    return {
      accessible: false,
      readable: false,
      writable: false,
      matchingFiles: 0,
      message: describeFsError(err, folderPath),
      errorCode: err.code || null,
    };
  }
}

module.exports = { probeFolder };

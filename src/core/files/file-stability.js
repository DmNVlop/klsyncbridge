'use strict';

const fsp = require('fs/promises');

// EBUSY = violación de compartición en Windows: otro proceso tiene el archivo abierto para escribir.
const LOCKED_CODES = new Set(['EBUSY']);
// EACCES/EPERM al abrir en r+ = la cuenta del servicio solo tiene permiso de lectura (habitual en
// carpetas de red). No indica bloqueo: se confía en que tamaño y fecha no hayan cambiado.
const READ_ONLY_CODES = new Set(['EACCES', 'EPERM']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Comprueba que un archivo ha terminado de copiarse y lo lee entero.
 * 1) dos stat separados stableMs con mismo tamaño y mtime (y tamaño > 0);
 * 2) apertura r+ y cierre inmediato (EBUSY ⇒ alguien escribe);
 * 3) lectura completa, que debe medir lo mismo que el último stat.
 * @returns {Promise<{ ready: true, buffer: Buffer, size: number, mtimeMs: number } | { ready: false, reason: 'empty'|'growing'|'locked' }>}
 */
async function readWhenComplete(filePath, { stableMs }, deps = {}) {
  const fsApi = deps.fsApi || fsp;
  const sleep = deps.sleep || defaultSleep;

  const first = await fsApi.stat(filePath);
  if (first.size === 0) return { ready: false, reason: 'empty' };

  await sleep(stableMs);
  const second = await fsApi.stat(filePath);
  if (second.size !== first.size || second.mtimeMs !== first.mtimeMs) return { ready: false, reason: 'growing' };

  try {
    const handle = await fsApi.open(filePath, 'r+');
    await handle.close();
  } catch (err) {
    if (LOCKED_CODES.has(err.code)) return { ready: false, reason: 'locked' };
    if (!READ_ONLY_CODES.has(err.code)) throw err;
  }

  const buffer = await fsApi.readFile(filePath);
  if (buffer.length !== second.size) return { ready: false, reason: 'growing' };
  return { ready: true, buffer, size: second.size, mtimeMs: second.mtimeMs };
}

module.exports = { readWhenComplete };

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AppError } = require('../../../utils/errors');
const logger = require('../../../services/logger.service');

const RETRY_DELAY_MS = 5000;
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** Hash del contenido sin BOM, con LF y sin la línea DATUM (para no reescribir solo por la fecha). */
function hashStdContent(content) {
  const normalized = String(content)
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^DATUM=.*\n/m, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function defaultSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function removeQuietly(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    logger.warn('No se pudo borrar el temporal del almacén .STD', { path: file, error: err.message });
  }
}

/**
 * Escribe <dir>\<storeName>.STD de forma atómica (temporal en la misma carpeta + renombrar).
 * Si el contenido (sin DATUM) es igual al existente, no lo toca.
 */
async function writeStdFile({ dir, storeName, content, rename = fs.renameSync, sleep = defaultSleep }) {
  const finalPath = path.join(dir, `${storeName}.STD`);
  if (fs.existsSync(finalPath) && hashStdContent(fs.readFileSync(finalPath, 'utf8')) === hashStdContent(content)) {
    return { filePath: finalPath, changed: false };
  }
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    try {
      rename(tmpPath, finalPath);
    } catch (err) {
      if (!BUSY_CODES.has(err.code)) throw err;
      logger.warn('Almacén .STD ocupado; se reintenta en 5 s', { path: finalPath, code: err.code });
      await sleep(RETRY_DELAY_MS);
      rename(tmpPath, finalPath);
    }
  } catch (err) {
    removeQuietly(tmpPath);
    throw new AppError(
      `No se pudo sustituir el almacén «${storeName}.STD» (${err.code || err.message}). Comprueba que no esté bloqueado y que la cuenta tenga permiso de escritura.`,
      'STD_WRITE_FAILED', 500,
    );
  }
  return { filePath: finalPath, changed: true };
}

module.exports = { hashStdContent, writeStdFile };

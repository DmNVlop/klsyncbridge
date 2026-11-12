'use strict';

const path = require('path');
const { AppError } = require('../../utils/errors');
const csvReader = require('./csv.reader');
const excelReader = require('./excel.reader');

const READERS = [csvReader, excelReader];

function listReaders() {
  return READERS.map((r) => ({ format: r.format, extensions: r.extensions }));
}

/**
 * Elige el lector por formato forzado (`csv`, `excel`) o, si es `auto`/vacío, por la extensión del fichero.
 * @throws {AppError} 400 con mensaje legible si no hay lector para el formato o la extensión.
 */
function findReader({ format, fileName } = {}) {
  if (format && format !== 'auto') {
    const byFormat = READERS.find((r) => r.format === format);
    if (!byFormat) {
      throw new AppError(`Formato de lectura no admitido: «${format}». Admitidos: ${READERS.map((r) => r.format).join(', ')}`, 'READER_UNSUPPORTED', 400);
    }
    return byFormat;
  }
  const ext = fileName ? path.extname(fileName).toLowerCase() : '';
  const byExt = READERS.find((r) => r.extensions.includes(ext));
  if (!byExt) {
    const shown = ext ? `«${ext}»` : 'sin extensión';
    throw new AppError(`No se pueden leer ficheros ${shown}. Usa CSV (.csv, .txt) o Excel (.xlsx, .xls)`, 'READER_UNSUPPORTED', 400);
  }
  return byExt;
}

module.exports = { findReader, listReaders };

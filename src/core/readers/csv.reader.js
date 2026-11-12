'use strict';

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { AppError } = require('../../utils/errors');

const CANDIDATE_DELIMITERS = [';', ',', '\t'];
const ENCODINGS = ['utf8', 'latin1'];

/** Obtiene el contenido como Buffer, desde memoria o desde una ruta ya resuelta. */
function loadBuffer({ buffer, path }) {
  if (buffer) return buffer;
  if (!path) throw new AppError('Indica un fichero o una ruta que leer', 'READER_NO_INPUT', 400);
  if (!fs.existsSync(path)) throw new AppError(`Archivo no encontrado: ${path}`, 'FILE_NOT_FOUND', 404);
  return fs.readFileSync(path);
}

/** Decodifica y quita el BOM inicial si lo hay. */
function decode(buffer, encoding) {
  const enc = ENCODINGS.includes(encoding) ? encoding : 'utf8';
  const text = buffer.toString(enc);
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/** Elige el delimitador que más aparece en la primera línea no vacía (`;` gana los empates). */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) { best = candidate; bestCount = count; }
  }
  return best;
}

function parseCsv({ buffer, path, options = {}, limit }) {
  const text = decode(loadBuffer({ buffer, path }), options.encoding);
  const delimiter = options.delimiter || detectDelimiter(text);
  const hasHeader = options.has_header !== false;
  const base = { delimiter, skip_empty_lines: true, relax_quotes: true, cast: true, bom: true };
  if (limit) base.to = hasHeader ? limit + 1 : limit;

  try {
    if (hasHeader) return parse(text, { ...base, columns: true });
    // Sin cabecera: se parsea como matriz y se nombran col1..colN
    const matrix = parse(text, base);
    return matrix.map((row) => Object.fromEntries(row.map((value, i) => [`col${i + 1}`, value])));
  } catch (err) {
    throw new AppError(`No se pudo leer el CSV: ${err.message}`, 'READER_PARSE_ERROR', 400);
  }
}

/** Lee solo las primeras filas para detectar campos y mostrar una muestra. */
function readSample({ buffer, path, options = {}, limit = 10 }) {
  const rows = parseCsv({ buffer, path, options, limit }).slice(0, limit);
  const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { fields, rows };
}

/** Lee todas las filas como objetos. */
function readAll({ buffer, path, options = {} }) {
  return parseCsv({ buffer, path, options });
}

module.exports = {
  format: 'csv',
  extensions: ['.csv', '.txt', '.tsv'],
  readSample,
  readAll,
  loadBuffer,
};

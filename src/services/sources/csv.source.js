'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { AppError } = require('../../utils/errors');

function resolveSafePath(filePath) {
  const resolved = path.resolve(filePath);
  // Block UNC paths on Windows
  if (resolved.startsWith('\\\\') || resolved.startsWith('//')) {
    throw new AppError('Rutas UNC no permitidas', 'INVALID_PATH', 400);
  }
  return resolved;
}

async function test(config) {
  try {
    const safePath = resolveSafePath(config.file_path);
    if (!fs.existsSync(safePath)) {
      return { ok: false, message: `Archivo no encontrado: ${safePath}` };
    }
    // Try to parse first few bytes to validate format
    const content = fs.readFileSync(safePath, { encoding: config.encoding || 'utf8' });
    const rows = parse(content, {
      delimiter: config.delimiter || ',',
      columns: config.has_header !== false,
      to: 3,
      relax_quotes: true,
    });
    return { ok: true, message: `Archivo CSV válido (${Array.isArray(rows) ? rows.length : 0} filas de muestra)` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function getTables(config) {
  const safePath = resolveSafePath(config.file_path);
  const filename = path.basename(safePath);
  return [{ name: filename, type: 'CSV' }];
}

async function getFields(config, _tableName) {
  const safePath = resolveSafePath(config.file_path);
  const content = fs.readFileSync(safePath, { encoding: config.encoding || 'utf8' });

  if (config.has_header === false) {
    // No header: parse first row to count columns
    const rows = parse(content, { delimiter: config.delimiter || ',', to: 1 });
    return rows[0].map((_, i) => ({ name: `col_${i + 1}`, type: 'text', nullable: 'YES' }));
  }

  const rows = parse(content, {
    delimiter: config.delimiter || ',',
    columns: true,
    to: 1,
    relax_quotes: true,
  });

  if (!rows.length) return [];
  return Object.keys(rows[0]).map(name => ({ name, type: 'text', nullable: 'YES' }));
}

async function getRecords(config, _jobContext) {
  const safePath = resolveSafePath(config.file_path);
  const content = fs.readFileSync(safePath, { encoding: config.encoding || 'utf8' });

  return parse(content, {
    delimiter: config.delimiter || ',',
    columns: config.has_header !== false,
    skip_empty_lines: true,
    relax_quotes: true,
    cast: true,
  });
}

module.exports = { test, getTables, getFields, getRecords };

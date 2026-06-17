'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { AppError } = require('../../utils/errors');

function resolveSafePath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith('\\\\') || resolved.startsWith('//')) {
    throw new AppError('Rutas UNC no permitidas', 'INVALID_PATH', 400);
  }
  return resolved;
}

function getSheet(config) {
  const safePath = resolveSafePath(config.file_path);
  if (!fs.existsSync(safePath)) {
    throw new AppError(`Archivo no encontrado: ${safePath}`, 'FILE_NOT_FOUND', 404);
  }
  const workbook = XLSX.readFile(safePath);
  const sheetName = config.sheet_name || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new AppError(`Hoja "${sheetName}" no encontrada en el archivo`, 'SHEET_NOT_FOUND', 404);
  }
  return { workbook, sheet, sheetName };
}

async function test(config) {
  try {
    getSheet(config);
    return { ok: true, message: 'Archivo Excel válido' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function getTables(config) {
  const safePath = resolveSafePath(config.file_path);
  if (!fs.existsSync(safePath)) {
    throw new AppError(`Archivo no encontrado: ${safePath}`, 'FILE_NOT_FOUND', 404);
  }
  const workbook = XLSX.readFile(safePath, { bookSheets: true });
  return workbook.SheetNames.map(name => ({ name, type: 'SHEET' }));
}

async function getFields(config, sheetName) {
  const effectiveConfig = sheetName ? { ...config, sheet_name: sheetName } : config;
  const { sheet } = getSheet(effectiveConfig);
  const headerRow = effectiveConfig.header_row || 1;

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: headerRow - 1,
  });

  if (!rows.length || !rows[0]) return [];
  return rows[0].map(col => ({
    name: String(col ?? ''),
    type: 'text',
    nullable: 'YES',
  }));
}

async function getRecords(config, jobContext) {
  const sheetName = jobContext?.table_or_view || config.sheet_name;
  const effectiveConfig = sheetName ? { ...config, sheet_name: sheetName } : config;
  const { sheet } = getSheet(effectiveConfig);
  const headerRow = effectiveConfig.header_row || 1;

  return XLSX.utils.sheet_to_json(sheet, {
    range: headerRow - 1,
    defval: null,
    raw: false,
  });
}

module.exports = { test, getTables, getFields, getRecords };

'use strict';

const XLSX = require('xlsx');
const { AppError } = require('../../utils/errors');
const { loadBuffer } = require('./csv.reader');

function openWorkbook({ buffer, path }) {
  const data = loadBuffer({ buffer, path });
  try {
    return XLSX.read(data, { type: 'buffer' });
  } catch (err) {
    throw new AppError(`No se pudo leer el Excel: ${err.message}`, 'READER_PARSE_ERROR', 400);
  }
}

function pickSheet(workbook, sheetName) {
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new AppError(`Hoja "${name}" no encontrada en el archivo`, 'SHEET_NOT_FOUND', 404);
  return sheet;
}

function sheetRecords(sheet, headerRow) {
  return XLSX.utils.sheet_to_json(sheet, { range: (headerRow || 1) - 1, defval: null, raw: false });
}

/** Lee solo las primeras filas para detectar campos y mostrar una muestra; incluye la lista de hojas. */
function readSample({ buffer, path, options = {}, limit = 10 }) {
  const workbook = openWorkbook({ buffer, path });
  const sheet = pickSheet(workbook, options.sheet_name);
  const rows = sheetRecords(sheet, options.header_row).slice(0, limit);
  let fields;
  if (rows.length > 0) {
    fields = Object.keys(rows[0]);
  } else {
    const headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: (options.header_row || 1) - 1 });
    fields = (headerRows[0] || []).map((c) => String(c ?? ''));
  }
  return { fields, rows, sheets: workbook.SheetNames };
}

/** Lee todas las filas de la hoja indicada (o la primera). */
function readAll({ buffer, path, options = {} }) {
  const workbook = openWorkbook({ buffer, path });
  return sheetRecords(pickSheet(workbook, options.sheet_name), options.header_row);
}

module.exports = {
  format: 'excel',
  extensions: ['.xlsx', '.xls', '.xlsm'],
  readSample,
  readAll,
};

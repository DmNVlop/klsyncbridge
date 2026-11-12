'use strict';

const fsp = require('fs/promises');
const { ValidationError } = require('../../utils/errors');
const { resolveConfiguredPath } = require('../../core/files/paths');
const { findReader } = require('../../core/readers');
const { runPipeline } = require('../../core/data-pipeline');
const { buildStdContent } = require('../../core/outputs/ardis-std/std-content');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SAMPLE_ROWS = 10;
const SAMPLE_VALUES = 5;
const PREVIEW_ITEMS = 10;
const PREVIEW_DISCARDED = 20;
const STD_PREVIEW_LINES = 40;

const TOO_BIG_MESSAGE = 'El fichero de ejemplo supera los 5 MB; usa uno más pequeño';

function defaultCredentialAccess() {
  // Carga perezosa: evita arrastrar la sesión de red en los tests que no usan rutas UNC
  return require('../credentials/credential-access.service').credentialAccess;
}

/** Obtiene el contenido del fichero de ejemplo: ruta (con credencial opcional) o JSON en base64. */
async function loadInput(input, deps = {}) {
  if (input.path) {
    const resolved = resolveConfiguredPath(input.path);
    const access = deps.credentialAccess || defaultCredentialAccess();
    const buffer = await access.withFolderAccess({ path: resolved, credentialId: input.credentialId }, async () => {
      const stat = await fsp.stat(resolved);
      if (stat.size > MAX_FILE_BYTES) throw new ValidationError(TOO_BIG_MESSAGE);
      return fsp.readFile(resolved);
    });
    return { buffer, fileName: resolved };
  }
  if (input.fileName && input.contentBase64) {
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.length > MAX_FILE_BYTES) throw new ValidationError(TOO_BIG_MESSAGE);
    return { buffer, fileName: input.fileName };
  }
  throw new ValidationError('Indica la ruta del fichero de ejemplo o sube uno');
}

function pickReader(input, fileName) {
  const reader = findReader({ format: input.reader && input.reader.format, fileName });
  return { reader, options: (input.reader && input.reader.options) || {} };
}

function distinctSampleValues(rows, field) {
  const values = [];
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    if (!values.includes(value)) values.push(value);
    if (values.length >= SAMPLE_VALUES) break;
  }
  return values;
}

/** Campos detectados (con valores de ejemplo) y primeras filas de un fichero. */
async function sampleFile(input, deps = {}) {
  const { buffer, fileName } = await loadInput(input, deps);
  const { reader, options } = pickReader(input, fileName);
  const sample = reader.readSample({ buffer, options, limit: SAMPLE_ROWS });
  const result = {
    format: reader.format,
    fields: sample.fields.map((name) => ({ name, sampleValues: distinctSampleValues(sample.rows, name) })),
    rows: sample.rows,
  };
  if (sample.sheets) result.sheets = sample.sheets;
  return result;
}

/**
 * Vista previa del mapeo sobre un fichero de ejemplo. No escribe nada.
 * `discarded` lista las filas que el destino .STD descartaría; `filteredOut` cuenta las que quita el filtro.
 */
async function previewMapping({ fields, filterExpression = null, targetKind, sample }, deps = {}) {
  const { buffer, fileName } = await loadInput(sample, deps);
  const { reader, options } = pickReader(sample, fileName);
  const records = reader.readAll({ buffer, options });
  const { items, filteredOut } = runPipeline({ records, filterExpression, fields });

  const result = { items: items.slice(0, PREVIEW_ITEMS).map((i) => i.payload), discarded: [], filteredOut, total: records.length };
  if (targetKind === 'ardis_std') {
    const std = buildStdContent({ header: {}, records: items.map((i) => i.payload), date: new Date() });
    result.discarded = std.discarded.slice(0, PREVIEW_DISCARDED).map((d) => ({ row: d.row, reason: d.reason }));
    result.discardedCount = std.discarded.length;
    result.written = std.written;
    result.stdPreview = std.content.replace(/^﻿/, '').split(/\r\n/).slice(0, STD_PREVIEW_LINES).join('\n');
  }
  return result;
}

module.exports = { loadInput, sampleFile, previewMapping, MAX_FILE_BYTES };

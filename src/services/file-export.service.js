'use strict';

const fs = require('fs');
const path = require('path');
const { resolveSafePath } = require('./sources/csv.source');
const { AppError } = require('../utils/errors');
const { FILE_FORMATS } = require('../config/constants');
const logger = require('./logger.service');

const CSV_BOM = '﻿';

function sanitizeBaseName(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]/g, '_');
}

function buildTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function parseFormats(fileFormatsStr) {
  const raw = String(fileFormatsStr || FILE_FORMATS.CSV)
    .split(',')
    .map(f => f.trim().toLowerCase())
    .filter(Boolean);
  const formats = raw.filter(f => f === FILE_FORMATS.CSV || f === FILE_FORMATS.JSON);
  return formats.length > 0 ? formats : [FILE_FORMATS.CSV];
}

function getNestedValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), obj);
}

function csvEscapeCell(value, delimiter) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const needsQuoting = str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function writeStreamAsync(stream, chunk) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (err) => { if (err) reject(err); });
    if (ok) {
      resolve();
    } else {
      stream.once('drain', resolve);
      stream.once('error', reject);
    }
  });
}

function closeStreamAsync(stream) {
  return new Promise((resolve, reject) => {
    stream.end((err) => { if (err) reject(err); else resolve(); });
    stream.once('error', reject);
  });
}

function cleanupTmpSafe(tmpPath) {
  try {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch (err) {
    logger.warn('No se pudo limpiar archivo temporal de exportación', { path: tmpPath, error: err.message });
  }
}

async function writeCsvFile({ finalPath, items, headers, delimiter }) {
  const tmpPath = `${finalPath}.tmp`;
  const stream = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
  try {
    await writeStreamAsync(stream, CSV_BOM);
    await writeStreamAsync(stream, headers.map(h => csvEscapeCell(h, delimiter)).join(delimiter) + '\r\n');
    for (const item of items) {
      const source = item.payload ?? item;
      const row = headers.map(h => csvEscapeCell(getNestedValue(source, h), delimiter));
      await writeStreamAsync(stream, row.join(delimiter) + '\r\n');
    }
    await closeStreamAsync(stream);
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    cleanupTmpSafe(tmpPath);
    throw err;
  }
}

async function writeJsonFile({ finalPath, items }) {
  const tmpPath = `${finalPath}.tmp`;
  const stream = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
  try {
    await writeStreamAsync(stream, '[');
    for (let i = 0; i < items.length; i++) {
      const prefix = i === 0 ? '' : ',';
      await writeStreamAsync(stream, prefix + JSON.stringify(items[i].payload ?? items[i]));
    }
    await writeStreamAsync(stream, ']');
    await closeStreamAsync(stream);
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    cleanupTmpSafe(tmpPath);
    throw err;
  }
}

function cleanupOldFiles(outputDir, baseName, keepPaths) {
  const keepSet = new Set(keepPaths.map(p => path.basename(p)));
  let entries;
  try {
    entries = fs.readdirSync(outputDir);
  } catch (err) {
    logger.warn('No se pudo listar carpeta destino para retención', { outputDir, error: err.message });
    return;
  }
  const prefix = `${baseName}_`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    if (keepSet.has(entry)) continue;
    if (!entry.endsWith('.csv') && !entry.endsWith('.json')) continue;
    try {
      fs.unlinkSync(path.join(outputDir, entry));
    } catch (err) {
      logger.warn('No se pudo borrar archivo antiguo de exportación', { path: entry, error: err.message });
    }
  }
}

/**
 * Exporta items ya mapeados (mismo shape que usa el bloque HTTP del executor) a CSV/JSON en disco.
 * items: array de { payload, ... } — se usa item.payload, mismo dato ya construido por buildPayload/diffWithSnapshot.
 */
async function exportItemsToFiles({ items, fieldMaps, job }) {
  if (!job.output_dir) {
    throw new AppError('output_dir no configurado para exportación a archivo', 'INVALID_PATH', 400);
  }

  const outputDir = resolveSafePath(job.output_dir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const baseName = sanitizeBaseName(job.table_or_view);
  const timestamp = buildTimestamp();
  const formats = parseFormats(job.file_formats);
  const delimiter = job.csv_delimiter || ';';
  const headers = fieldMaps.map(f => f.api_field);

  const filePaths = [];

  if (formats.includes(FILE_FORMATS.CSV)) {
    const csvPath = path.join(outputDir, `${baseName}_${timestamp}.csv`);
    await writeCsvFile({ finalPath: csvPath, items, headers, delimiter });
    filePaths.push(csvPath);
  }

  if (formats.includes(FILE_FORMATS.JSON)) {
    const jsonPath = path.join(outputDir, `${baseName}_${timestamp}.json`);
    await writeJsonFile({ finalPath: jsonPath, items });
    filePaths.push(jsonPath);
  }

  if (job.file_retention === 'keep_last') {
    cleanupOldFiles(outputDir, baseName, filePaths);
  }

  logger.info(`Exportación a archivo completada para job "${job.name}"`, { job_id: job.id, filePaths });

  return { status: 'success', filePaths };
}

module.exports = { exportItemsToFiles };

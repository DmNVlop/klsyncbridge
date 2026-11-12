'use strict';

const fs = require('fs');
const path = require('path');
const { resolveConfiguredPath } = require('../files/paths');
const { AppError } = require('../../utils/errors');
const { FILE_FORMATS } = require('../../config/constants');
const logger = require('../../services/logger.service');

const CSV_BOM = '﻿';

function sanitizeBaseName(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]/g, '_');
}

function buildTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
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

/** Salida CSV/JSON a carpeta. config.formats llega ya como array (lo normaliza el registro de salidas). */
async function write({ items, config }) {
  if (!config.outputDir) {
    throw new AppError('output_dir no configurado para exportación a archivo', 'INVALID_PATH', 400);
  }
  const outputDir = resolveConfiguredPath(config.outputDir);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const baseName = sanitizeBaseName(config.baseName);
  const timestamp = buildTimestamp();
  const formats = config.formats;
  const filePaths = [];

  if (formats.includes(FILE_FORMATS.CSV)) {
    const csvPath = path.join(outputDir, `${baseName}_${timestamp}.csv`);
    await writeCsvFile({ finalPath: csvPath, items, headers: config.headers, delimiter: config.delimiter || ';' });
    filePaths.push(csvPath);
  }
  if (formats.includes(FILE_FORMATS.JSON)) {
    const jsonPath = path.join(outputDir, `${baseName}_${timestamp}.json`);
    await writeJsonFile({ finalPath: jsonPath, items });
    filePaths.push(jsonPath);
  }
  if (config.retention === 'keep_last') cleanupOldFiles(outputDir, baseName, filePaths);

  logger.info(`Exportación a archivo completada para job "${config.jobName}"`, { job_id: config.jobId, filePaths });
  return { status: 'success', filePaths, written: items.length, discardedCount: 0, unchanged: false, message: null };
}

module.exports = { type: 'file', formats: [FILE_FORMATS.CSV, FILE_FORMATS.JSON], fullSet: false, write };

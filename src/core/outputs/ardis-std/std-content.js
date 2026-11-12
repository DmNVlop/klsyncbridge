'use strict';

const { AppError } = require('../../../utils/errors');
const {
  STD_DEFAULTS, STD_IGNORED_KEYS, STD_KEY_PATTERN, REQUIRED_KEYS, NUMERIC_KEYS,
} = require('./std-keys');

const BOM = '﻿';
const EOL = '\r\n';
const MEASURE_KEYS = ['LENGTE', 'BREEDTE', 'DIKTE'];
const IGNORED = new Set(STD_IGNORED_KEYS.map(k => k.toUpperCase()));

function pad2(n) { return String(n).padStart(2, '0'); }

/** Fecha DDMMYY de 6 cifras (Ardis escribe a veces 5 y luego la lee mal). */
function formatDatum(date) {
  return `${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${pad2(date.getFullYear() % 100)}`;
}

/** Valor como texto de una línea; null si no hay valor. Coma decimal ⇒ punto en claves numéricas conocidas. */
function normalizeValue(key, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !(value instanceof Date)) {
    throw new AppError(`La clave «${key}» tiene un valor compuesto; las claves del almacén .STD no admiten «.»`, 'INVALID_STD_KEY', 400);
  }
  let str;
  if (typeof value === 'number') str = Number.isFinite(value) ? String(value) : null;
  else if (typeof value === 'boolean') str = value ? '1' : '0';
  else if (value instanceof Date) str = value.toISOString();
  else str = String(value);
  if (str === null) return null;
  str = str.replace(/[\r\n]+/g, ' ').trim();
  if (str === '') return null;
  if (NUMERIC_KEYS.has(key.toUpperCase()) && /^-?\d+,\d+$/.test(str)) str = str.replace(',', '.');
  return str;
}

function assertKey(key) {
  if (!STD_KEY_PATTERN.test(key)) {
    throw new AppError(`Clave no válida para el almacén .STD: «${key}». Solo letras, números, «_» y «$».`, 'INVALID_STD_KEY', 400);
  }
}

/** Líneas CLAVE=valor de un registro, o el motivo de descarte. */
function buildRecordLines(payload) {
  const values = new Map();
  for (const [key, raw] of Object.entries(payload)) {
    assertKey(key);
    if (IGNORED.has(key.toUpperCase())) continue;
    const value = normalizeValue(key, raw);
    if (value !== null) values.set(key, value);
  }
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) return { reason: `falta ${key}` };
  }
  for (const key of MEASURE_KEYS) {
    const value = values.get(key);
    if (!/^-?\d+(\.\d+)?$/.test(value) || parseFloat(value) <= 0) {
      return { reason: `${key} no es una medida válida («${value}»)` };
    }
  }
  const present = new Set([...values.keys()].map(k => k.toUpperCase()));
  for (const [key, value] of Object.entries(STD_DEFAULTS)) {
    if (!present.has(key)) values.set(key, value);
  }
  return { lines: [...values].map(([k, v]) => `${k}=${v}`) };
}

function section(tag, lines) {
  return `[${tag}]${EOL}${lines.map(l => l + EOL).join('')}[${tag}]${EOL}`;
}

function describeRecord(payload) {
  const material = payload.MATERIAAL ?? payload.REFER;
  return material === undefined || material === null ? '' : `MATERIAAL=${String(material).trim()}`;
}

/**
 * Contenido completo de un almacén .STD (UTF-8 con BOM, CRLF), formato verificado con las muestras de producción.
 * @param {{ header: { REST?: string, ALGMACH?: string }, records: object[], date: Date }} input
 * @returns {{ content: string, written: number, discarded: Array<{ row: number, label: string, reason: string }> }}
 */
function buildStdContent({ header = {}, records, date }) {
  const headerLines = [`DATUM=${formatDatum(date)}`];
  for (const key of ['REST', 'ALGMACH']) {
    const value = normalizeValue(key, header[key]);
    if (value !== null) headerLines.push(`${key}=${value}`);
  }
  const sections = [section('ISTDALG', headerLines), section('ISTDALG$FORM', [])];
  const discarded = [];
  let written = 0;
  records.forEach((payload, index) => {
    const { lines, reason } = buildRecordLines(payload);
    if (reason) {
      discarded.push({ row: index + 1, label: describeRecord(payload), reason });
      return;
    }
    written++;
    sections.push(section(`ISTD-${written}`, lines), section(`ISTD$FORM-${written}`, []));
  });
  return { content: BOM + EOL + sections.join(EOL), written, discarded };
}

module.exports = { buildStdContent, formatDatum };

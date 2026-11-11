'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const env = require('../config/env');

const logDir = path.resolve(env.LOG_DIR);

const { combine, timestamp, printf, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' | ' + Object.entries(meta)
    .filter(([k]) => k !== 'stack')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' | ') : '';
  const stack = meta.stack ? `\n${meta.stack}` : '';
  return `${ts} [${level.toUpperCase()}] ${message}${metaStr}${stack}`;
});

const transports = [];

// Console siempre activo: colorize en dev, plain stderr en production (visible en daemon logs)
transports.push(new winston.transports.Console({
  format: env.NODE_ENV !== 'production'
    ? combine(winston.format.colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    : combine(timestamp({ format: 'HH:mm:ss' }), logFormat),
  stderrLevels: ['error', 'warn'],
}));

transports.push(
  new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${env.LOG_RETENTION_DAYS}d`,
    maxSize: '50m',
    level: 'info',
    format: combine(timestamp(), errors({ stack: true }), logFormat),
  })
);

transports.push(
  new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'executions-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${env.LOG_RETENTION_DAYS}d`,
    maxSize: '50m',
    level: 'info',
    format: combine(timestamp(), winston.format.json()),
  })
);

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports,
  exitOnError: false,
});

// Claves cuyo valor nunca debe llegar al log. `token` queda fuera a propósito: enmascararlo rompería logs útiles
// (p. ej. «token renovado»); los tokens de Authorization se enmascaran por su cabecera.
const MASKED_KEYS = new Set(['password', 'pass', 'pwd', 'secret']);
const MAX_DEPTH = 4;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Copia recursiva (sin mutar) que enmascara claves sensibles. Solo recorre objetos planos y arrays:
// Error, Date, Buffer… pasan tal cual. Más allá de MAX_DEPTH se trunca para no dejar pasar una clave profunda.
function maskDeep(value, depth, ancestors) {
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return value;
  if (ancestors.has(value)) return '[circular]';
  if (depth > MAX_DEPTH) return '[truncado]';
  ancestors.add(value);
  let result;
  if (isArray) {
    result = value.map((item) => maskDeep(item, depth + 1, ancestors));
  } else {
    result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = MASKED_KEYS.has(key.toLowerCase()) ? '****' : maskDeep(item, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
  return result;
}

// Sanea el meta de log: enmascara Authorization y las claves sensibles (también anidadas)
function sanitizeMeta(meta) {
  if (!isPlainObject(meta)) return meta;
  const safe = { ...meta };
  if (safe.headers && safe.headers.Authorization) {
    safe.headers = { ...safe.headers, Authorization: 'Bearer ****' };
  }
  if (safe.headers && safe.headers.authorization) {
    safe.headers = { ...safe.headers, authorization: 'Bearer ****' };
  }
  return maskDeep(safe, 0, new Set());
}

const secureLogger = {
  error: (message, meta) => logger.error(message, sanitizeMeta(meta)),
  warn: (message, meta) => logger.warn(message, sanitizeMeta(meta)),
  info: (message, meta) => logger.info(message, sanitizeMeta(meta)),
  debug: (message, meta) => logger.debug(message, sanitizeMeta(meta)),
  logExecution: (data) => logger.info('job_execution', sanitizeMeta(data)),
};

// `sanitizeMeta` se expone para poder probarlo
secureLogger.sanitizeMeta = sanitizeMeta;

module.exports = secureLogger;

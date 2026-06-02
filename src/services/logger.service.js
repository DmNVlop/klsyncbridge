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

// Sanitiza headers de Authorization para no loguear tokens
function sanitizeHttpMeta(meta) {
  if (!meta) return meta;
  const safe = { ...meta };
  if (safe.headers && safe.headers.Authorization) {
    safe.headers = { ...safe.headers, Authorization: 'Bearer ****' };
  }
  if (safe.headers && safe.headers.authorization) {
    safe.headers = { ...safe.headers, authorization: 'Bearer ****' };
  }
  return safe;
}

const secureLogger = {
  error: (message, meta) => logger.error(message, sanitizeHttpMeta(meta)),
  warn: (message, meta) => logger.warn(message, sanitizeHttpMeta(meta)),
  info: (message, meta) => logger.info(message, sanitizeHttpMeta(meta)),
  debug: (message, meta) => logger.debug(message, sanitizeHttpMeta(meta)),
  logExecution: (data) => logger.info('job_execution', sanitizeHttpMeta(data)),
};

module.exports = secureLogger;

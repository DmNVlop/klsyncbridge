'use strict';

const SYNC_MODES = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
};

const SCHEDULE_TYPES = {
  CRON: 'cron',
  INTERVAL: 'interval',
};

const AUTH_TYPES = {
  NONE: 'none',
  BEARER: 'bearer',
  API_KEY: 'api_key',
  BASIC: 'basic',
  LOGIN: 'login',
};

const JOB_STATUSES = {
  RUNNING: 'running',
  SUCCESS: 'success',
  ERROR: 'error',
  PARTIAL: 'partial',
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const TRANSFORMS = {
  NONE: 'none',
  UPPERCASE: 'uppercase',
  LOWERCASE: 'lowercase',
  TRIM: 'trim',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE_ISO: 'date_iso',
  STRING: 'string',
};

const OP_MODES = {
  SNAPSHOT: 'snapshot',
  PASSTHROUGH: 'passthrough',
};

const ITEM_TYPES = {
  MATERIAL: 'material',
  EDGE: 'edge',
  HANDLE: 'handle',
  KITCHEN_DOOR: 'kitchenDoor',
};

const ROLES = {
  ADMIN: 'admin',
};

const ERROR_CATEGORIES = {
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  CLIENT_ERROR: 'CLIENT_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
};

const RETRY = {
  CONNECTION_MAX_DURATION_MS: 2 * 60 * 60 * 1000, // 2 horas
  DELAYS_MS: {
    CONNECTION_ERROR: [60000, 120000, 240000, 600000], // luego cada 600000
    CLIENT_ERROR: [60000, 120000, 240000],
    SERVER_ERROR: [60000, 120000, 240000],
  },
  MAX_ATTEMPTS: {
    CLIENT_ERROR: 4,
    SERVER_ERROR: 4,
  },
};

const BATCH_DEFAULTS = {
  SIZE: 500,
  CONCURRENCY: 2,
};

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY_SECONDS = 8 * 60 * 60; // 8 horas
const ENCRYPTION_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;

const DEFAULT_PORT = 3847;
const DEFAULT_APP_NAME = 'KLSyncBridge';

module.exports = {
  SYNC_MODES,
  SCHEDULE_TYPES,
  AUTH_TYPES,
  JOB_STATUSES,
  HTTP_METHODS,
  TRANSFORMS,
  OP_MODES,
  ITEM_TYPES,
  ROLES,
  ERROR_CATEGORIES,
  RETRY,
  BATCH_DEFAULTS,
  BCRYPT_ROUNDS,
  JWT_EXPIRY_SECONDS,
  ENCRYPTION_KEY_BYTES,
  GCM_IV_BYTES,
  GCM_AUTH_TAG_BYTES,
  DEFAULT_PORT,
  DEFAULT_APP_NAME,
};

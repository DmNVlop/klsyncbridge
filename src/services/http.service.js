'use strict';

const axios = require('axios');
const { ERROR_CATEGORIES, RETRY } = require('../config/constants');
const { KLSyncBridgeError } = require('../utils/errors');
const logger = require('./logger.service');

function categorizeError(error) {
  if (!error.response) {
    // Sin respuesta: timeout, ECONNREFUSED, ENOTFOUND, etc.
    return ERROR_CATEGORIES.CONNECTION_ERROR;
  }
  const status = error.response.status;
  if (status === 401) return ERROR_CATEGORIES.AUTH_ERROR;
  if (status === 429) return ERROR_CATEGORIES.RATE_LIMIT;
  if (status >= 400 && status < 500) return ERROR_CATEGORIES.CLIENT_ERROR;
  if (status >= 500) return ERROR_CATEGORIES.SERVER_ERROR;
  return ERROR_CATEGORIES.SERVER_ERROR;
}

function shouldGiveUp(category, attempt, startTime) {
  if (category === ERROR_CATEGORIES.CONNECTION_ERROR) {
    const elapsed = Date.now() - startTime;
    return elapsed > RETRY.CONNECTION_MAX_DURATION_MS;
  }
  const max = RETRY.MAX_ATTEMPTS[category];
  if (!max) return true; // AUTH_ERROR, RATE_LIMIT → categoría especial
  return attempt >= max;
}

function getDelay(category, attempt) {
  if (category === ERROR_CATEGORIES.RATE_LIMIT) {
    return 60000; // 1 min por defecto
  }
  const delays = RETRY.DELAYS_MS[category] || RETRY.DELAYS_MS.SERVER_ERROR;
  const idx = Math.min(attempt - 1, delays.length - 1);
  return delays[idx];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function summarizeBody(data) {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return { _type: 'array', count: data.length, sample: data.slice(0, 2) };
  if (typeof data === 'object') return data;
  return String(data).slice(0, 500);
}

function byteSize(data) {
  if (!data) return 0;
  try { return Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data)); } catch { return -1; }
}

async function requestWithRetry(config, { onTokenExpired } = {}) {
  let attempt = 0;
  const startTime = Date.now();

  while (true) {
    attempt++;
    const attemptStart = Date.now();

    logger.info('API request enviado', {
      method: config.method?.toUpperCase(),
      url: config.url,
      attempt,
      payload_bytes: byteSize(config.data),
      payload: summarizeBody(config.data),
    });

    try {
      const response = await axios({ ...config, timeout: config.timeout || 30000 });
      const duration_ms = Date.now() - attemptStart;

      logger.info('API response recibida', {
        method: config.method?.toUpperCase(),
        url: config.url,
        http_status: response.status,
        duration_ms,
        response_bytes: byteSize(response.data),
        response: summarizeBody(response.data),
      });

      return response;
    } catch (error) {
      const category = categorizeError(error);
      const status = error.response?.status;
      const duration_ms = Date.now() - attemptStart;

      logger.warn('Request fallido', {
        attempt,
        category,
        http_status: status,
        url: config.url,
        duration_ms,
        error: error.message,
        response_body: error.response?.data ? summarizeBody(error.response.data) : undefined,
      });

      // 401 con auth tipo login: renovar token una vez
      if (category === ERROR_CATEGORIES.AUTH_ERROR && onTokenExpired) {
        logger.info('Token expirado. Renovando...');
        const newHeaders = await onTokenExpired();
        config.headers = { ...config.headers, ...newHeaders };
        continue;
      }

      // 429: respetar Retry-After si existe
      if (category === ERROR_CATEGORIES.RATE_LIMIT) {
        const retryAfter = error.response?.headers?.['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
        logger.info(`Rate limit. Esperando ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }

      if (shouldGiveUp(category, attempt, startTime)) {
        throw new KLSyncBridgeError(category, error, attempt);
      }

      const delay = getDelay(category, attempt);
      logger.info(`Reintento ${attempt} en ${delay / 1000}s...`, { category });
      await sleep(delay);
    }
  }
}

module.exports = { requestWithRetry, categorizeError };

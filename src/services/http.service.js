'use strict';

const { ERROR_CATEGORIES, RETRY } = require('../config/constants');
const { KLSyncBridgeError } = require('../utils/errors');
const { sendOnce, summarizeBody } = require('../core/http/send-once');
const { classifyHttpError } = require('../core/http/classify');
const logger = require('./logger.service');

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

async function requestWithRetry(config, { onTokenExpired } = {}) {
  let attempt = 0;
  const startTime = Date.now();

  while (true) {
    attempt++;
    try {
      return await sendOnce(config, { attempt });
    } catch (error) {
      const category = classifyHttpError(error);
      const status = error.response?.status;

      logger.warn('Request fallido', {
        attempt,
        category,
        http_status: status,
        url: config.url,
        duration_ms: error.durationMs,
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

module.exports = { requestWithRetry, categorizeError: classifyHttpError };

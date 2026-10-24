'use strict';

const axios = require('axios');
const logger = require('../../services/logger.service');

const DEFAULT_TIMEOUT_MS = 30000;

function summarizeBody(data) {
  if (data === null || data === undefined) return null;
  if (data instanceof FormData) return { _type: 'multipart', fields: [...new Set(data.keys())] };
  if (Array.isArray(data)) return { _type: 'array', count: data.length, sample: data.slice(0, 2) };
  if (typeof data === 'object') return data;
  return String(data).slice(0, 500);
}

function byteSize(data) {
  if (!data) return 0;
  if (data instanceof FormData) return -1; // el tamaño real lo calcula axios al serializar
  try { return Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data)); } catch { return -1; }
}

/**
 * Un único intento HTTP con el log común de petición/respuesta (sin reintentos: los decide quien llama).
 * Lanza el error de axios tal cual, con `durationMs` añadido.
 */
async function sendOnce(config, { attempt = 1 } = {}) {
  const started = Date.now();
  logger.info('API request enviado', {
    method: config.method?.toUpperCase(),
    url: config.url,
    attempt,
    payload_bytes: byteSize(config.data),
    payload: summarizeBody(config.data),
  });
  try {
    const response = await axios({ ...config, timeout: config.timeout || DEFAULT_TIMEOUT_MS });
    logger.info('API response recibida', {
      method: config.method?.toUpperCase(),
      url: config.url,
      http_status: response.status,
      duration_ms: Date.now() - started,
      response_bytes: byteSize(response.data),
      response: summarizeBody(response.data),
    });
    return response;
  } catch (err) {
    err.durationMs = Date.now() - started;
    throw err;
  }
}

module.exports = { sendOnce, summarizeBody, byteSize };

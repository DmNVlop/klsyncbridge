'use strict';

const { AppError } = require('../../utils/errors');
const { BATCH_DEFAULTS } = require('../../config/constants');
const { sendOnce } = require('../http/send-once');

/**
 * Error de la salida endpoint. `retryable` = el motor puede reintentar más tarde (sin respuesta, 429, 5xx);
 * si no, hace falta que una persona revise la configuración (400/401/403/404...).
 */
class EndpointOutputError extends AppError {
  constructor(message, { retryable, httpStatus = null } = {}) {
    super(message, 'ENDPOINT_OUTPUT_FAILED', 502);
    this.name = 'EndpointOutputError';
    this.retryable = Boolean(retryable);
    this.httpStatus = httpStatus;
  }
}

function chunk(list, size) {
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}

function toEndpointError(err) {
  const status = err.response && err.response.status;
  if (!status) return new EndpointOutputError(`Sin respuesta de la API: ${err.message}`, { retryable: true });
  const retryable = status >= 500 || status === 429;
  return new EndpointOutputError(`La API respondió ${status}`, { retryable, httpStatus: status });
}

/**
 * Un intento por lote (los reintentos los decide el motor, nunca duerme aquí).
 * Con 401 y `onTokenExpired` renueva las cabeceras UNA vez por lote.
 */
async function sendBatch(send, requestConfig, onTokenExpired) {
  try {
    return await send(requestConfig);
  } catch (err) {
    if (err.response && err.response.status === 401 && onTokenExpired) {
      let renewed;
      try { renewed = await onTokenExpired(); } catch (renewError) { throw toEndpointError(renewError); }
      try {
        return await send({ ...requestConfig, headers: { ...requestConfig.headers, ...renewed } });
      } catch (retryError) { throw toEndpointError(retryError); }
    }
    throw toEndpointError(err);
  }
}

/**
 * Salida a un endpoint de API: conjunto completo en lotes de `batchSize` como array JSON de payloads.
 * config: { apiConfig, headers, params, onTokenExpired, itemType?, batchSize?, send? (inyectable, por defecto sendOnce) }
 */
async function write({ items, config }) {
  const { apiConfig } = config;
  if (!apiConfig || !apiConfig.base_url) throw new AppError('Falta la configuración de API de destino', 'INVALID_API_CONFIG', 400);

  const send = config.send || sendOnce;
  const batchSize = Number.isInteger(config.batchSize) && config.batchSize > 0 ? config.batchSize : BATCH_DEFAULTS.SIZE;
  const payloads = items.map((item) => {
    const payload = item.payload ?? item;
    return config.itemType ? { ...payload, type: config.itemType } : payload;
  });

  let written = 0;
  for (const batch of chunk(payloads, batchSize)) {
    await sendBatch(send, {
      method: apiConfig.method || 'post',
      url: `${apiConfig.base_url}${apiConfig.endpoint_path || ''}`,
      headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
      params: config.params,
      data: batch,
    }, config.onTokenExpired);
    written += batch.length;
  }
  return { status: 'success', filePaths: [], written, discardedCount: 0, unchanged: false, message: null };
}

module.exports = { type: 'endpoint', formats: [], fullSet: true, write, EndpointOutputError };

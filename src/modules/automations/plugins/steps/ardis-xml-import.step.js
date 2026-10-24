'use strict';

const fsp = require('fs/promises');
const { z } = require('zod/v4');
const { sha256 } = require('../../../../core/files/fingerprint');
const { buildMultipart } = require('../../../../core/http/multipart');
const { sendOnce, summarizeBody } = require('../../../../core/http/send-once');
const { AUTH_TYPES, AUTOMATION_OUTCOMES: O } = require('../../../../config/constants');

// Contrato: docs/integrations/KLSYNCBRIDGE_ARDIS_XML_ORDERS_V2_INTEGRATION.md (ArdisApp)
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60000;
const DEFAULT_ENDPOINT_PATH = '/orders-v2/external/ardis-xml-imports';

const DONE_STATUSES = new Set(['CREATED', 'UPDATED', 'UNCHANGED']);
const REJECTED_STATUSES = new Set(['REJECTED_STARTED', 'REJECTED_CLOSED']);
const HALT_MESSAGES = {
  400: 'La plataforma rechazó la petición (400): revisa la configuración del paso',
  401: 'Token sin permiso o inválido: revisa la configuración de API',
  403: 'Token sin permiso o inválido: revisa la configuración de API',
  404: 'Ruta no encontrada (404): revisa la URL base de la configuración de API y la ruta del endpoint',
};

const configSchema = z.object({
  api_config_id: z.string().min(1, 'Elige la configuración de API')
    .meta({ title: 'Configuración de API', description: 'Debe usar API key (cabecera X-API-Key) con el scope orders-v2:import-xml.', resource: 'api_config' }),
  endpointPath: z.string().trim().startsWith('/', 'Debe empezar por /').default(DEFAULT_ENDPOINT_PATH)
    .meta({ title: 'Ruta del endpoint' }),
});

function joinUrl(baseUrl, endpointPath) {
  return `${String(baseUrl).replace(/\/+$/, '')}${endpointPath}`;
}

// El multipart lleva su propio Content-Type con boundary: se quita cualquiera heredado (p. ej. JSON).
function withoutContentType(headers) {
  return Object.fromEntries(Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== 'content-type'));
}

/** Respuesta de la plataforma ⇒ resultado del paso. Se decide por HTTP y `status`, nunca por `message`. */
function mapImportResponse(httpStatus, body) {
  const data = body && typeof body === 'object' ? body : {};
  const status = typeof data.status === 'string' ? data.status : null;
  const result = {
    http_status: httpStatus,
    status,
    message: typeof data.message === 'string' ? data.message : null,
    external_ref: typeof data.orderNumber === 'string' ? data.orderNumber : null,
    external_version: Number.isInteger(data.version) ? data.version : null,
    sent_to_production: typeof data.sentToProduction === 'boolean' ? data.sentToProduction : null,
  };

  if ((httpStatus === 200 || httpStatus === 201) && DONE_STATUSES.has(status)) return { outcome: O.DONE, result };
  if (httpStatus === 409 && REJECTED_STATUSES.has(status)) return { outcome: O.REJECTED, result };
  if (httpStatus === 422 && status === 'INVALID_XML') return { outcome: O.INVALID, result };
  if (httpStatus === 413) return { outcome: O.INVALID, result: { ...result, message: result.message || 'El archivo supera 5 MB' } };
  if (HALT_MESSAGES[httpStatus]) {
    const detail = result.message ? ` (${result.message})` : '';
    return { outcome: O.HALT, result: { ...result, message: `${HALT_MESSAGES[httpStatus]}${detail}` } };
  }
  if (httpStatus >= 500) return { outcome: O.RETRY, result: { ...result, message: result.message || `Error del servidor (${httpStatus})` } };
  return { outcome: O.RETRY, unexpected: true, result: { ...result, message: result.message || `Respuesta no reconocida (${httpStatus})` } };
}

/**
 * Sube un XML de Ardis a Órdenes V2. Un único intento por llamada: los reintentos los decide el motor.
 * ctx.resources.api_config_id = { apiConfig, headers, params } (resuelto por el motor)
 */
async function run(ctx, item) {
  const { apiConfig, headers, params } = ctx.resources.api_config_id;
  if (apiConfig.auth_type !== AUTH_TYPES.API_KEY) {
    return { outcome: O.HALT, result: { message: 'La configuración de API debe usar autenticación API key (X-API-Key)' } };
  }

  let buffer;
  try {
    buffer = await fsp.readFile(item.meta.path);
  } catch (err) {
    if (err.code === 'ENOENT') return { outcome: O.INVALID, result: { message: 'El archivo ya no está en la carpeta' } };
    return { outcome: O.RETRY, result: { message: `No se pudo leer el archivo: ${err.message}` } };
  }

  const fingerprint = sha256(buffer);
  if (buffer.length > MAX_FILE_BYTES) return { outcome: O.INVALID, result: { fingerprint, message: 'El archivo supera 5 MB' } };

  const url = joinUrl(apiConfig.base_url, ctx.config.endpointPath);
  let response;
  try {
    response = await sendOnce({
      method: 'post',
      url,
      headers: withoutContentType(headers),
      params,
      data: buildMultipart({ fieldName: 'file', buffer, fileName: item.display_name, contentType: 'application/xml' }),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (err) {
    ctx.logger.warn('Subida de XML sin respuesta de la plataforma', { file: item.display_name, url, error: err.message });
    return { outcome: O.RETRY, result: { fingerprint, message: `Sin respuesta de la plataforma: ${err.message}` } };
  }

  const mapped = mapImportResponse(response.status, response.data);
  if (mapped.unexpected) {
    ctx.logger.warn('Respuesta no reconocida al subir XML', {
      file: item.display_name, http_status: response.status, body: summarizeBody(response.data),
    });
  }
  return { outcome: mapped.outcome, result: { ...mapped.result, fingerprint } };
}

module.exports = {
  type: 'ardis_xml_import',
  version: 1,
  title: 'Importar XML de Ardis a Órdenes V2',
  description: 'Sube el archivo a ArdisApp (un archivo por llamada) y guarda el nº de pedido y la versión devueltos.',
  configSchema,
  concurrency: 1,
  run,
  mapImportResponse,
};

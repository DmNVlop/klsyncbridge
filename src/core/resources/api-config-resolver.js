'use strict';

const { getDb } = require('../../config/database');
const { AUTH_TYPES } = require('../../config/constants');
const { decryptObject } = require('../../services/encryption.service');
const { resolveAuth } = require('../../services/auth-resolver.service');
const { NotFoundError } = require('../../utils/errors');

/** api_config con auth_config descifrado y campos JSON parseados (para enviar, nunca para la UI). */
function loadApiConfig(id) {
  const row = getDb().prepare('SELECT * FROM api_configs WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Configuración de API');
  row.auth_config = row.auth_config ? decryptObject(row.auth_config) : null;
  row.headers_json = row.headers_json ? JSON.parse(row.headers_json) : null;
  row.payload_schema = row.payload_schema ? JSON.parse(row.payload_schema) : null;
  return row;
}

/**
 * Cabeceras de autenticación + cabeceras fijas de la configuración, params de auth y,
 * con auth tipo login, la función para renovar el token tras un 401.
 */
async function buildRequestAuth(apiConfig) {
  const auth = await resolveAuth(apiConfig);
  const onTokenExpired = apiConfig.auth_type === AUTH_TYPES.LOGIN
    ? async () => (await resolveAuth(apiConfig)).headers
    : null;
  return {
    headers: { ...auth.headers, ...(apiConfig.headers_json || {}) },
    params: auth.params,
    onTokenExpired,
  };
}

/** Carga y prepara una api_config lista para usar: { apiConfig, headers, params, onTokenExpired }. */
async function resolveApiConfig(id) {
  const apiConfig = loadApiConfig(id);
  return { apiConfig, ...(await buildRequestAuth(apiConfig)) };
}

module.exports = { loadApiConfig, buildRequestAuth, resolveApiConfig };

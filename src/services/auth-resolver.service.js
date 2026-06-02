'use strict';

const axios = require('axios');
const { AUTH_TYPES } = require('../config/constants');
const { AppError } = require('../utils/errors');
const logger = require('./logger.service');

/**
 * Dado un api_config con auth_type y auth_config descifrado,
 * retorna los headers y params adicionales para la request.
 */
async function resolveAuth(apiConfig) {
  const { auth_type, auth_config } = apiConfig;

  switch (auth_type) {
    case AUTH_TYPES.NONE:
      return { headers: {}, params: {} };

    case AUTH_TYPES.BEARER:
      return {
        headers: { Authorization: `Bearer ${auth_config.token}` },
        params: {},
      };

    case AUTH_TYPES.BASIC: {
      const encoded = Buffer.from(`${auth_config.username}:${auth_config.password}`).toString('base64');
      return {
        headers: { Authorization: `Basic ${encoded}` },
        params: {},
      };
    }

    case AUTH_TYPES.API_KEY: {
      const { key_name, key_value, in: location } = auth_config;
      if (location === 'query') {
        return { headers: {}, params: { [key_name]: key_value } };
      }
      return { headers: { [key_name]: key_value }, params: {} };
    }

    case AUTH_TYPES.LOGIN: {
      const token = await fetchLoginToken(auth_config);
      return {
        headers: { Authorization: `Bearer ${token}` },
        params: {},
      };
    }

    default:
      throw new AppError(`Tipo de autenticación desconocido: ${auth_type}`, 'AUTH_CONFIG_ERROR', 500);
  }
}

async function fetchLoginToken(authConfig) {
  const { login_url, method = 'POST', body, token_path, username, password } = authConfig;

  // Sustituir username/password en el body si se usan placeholders
  const requestBody = JSON.parse(
    JSON.stringify(body || {})
      .replace('{{username}}', username || '')
      .replace('{{password}}', password || '')
  );

  try {
    const response = await axios({
      method,
      url: login_url,
      data: requestBody,
      timeout: 15000,
    });

    const token = getNestedValue(response.data, token_path);
    if (!token) {
      throw new AppError(`Token no encontrado en ruta "${token_path}" de la respuesta de login`, 'AUTH_TOKEN_ERROR', 500);
    }
    return token;
  } catch (err) {
    if (err.code === 'AUTH_TOKEN_ERROR') throw err;
    logger.error('Error obteniendo token de login', { url: login_url, error: err.message });
    throw new AppError(`Error de autenticación login: ${err.message}`, 'AUTH_LOGIN_ERROR', 500);
  }
}

function getNestedValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

module.exports = { resolveAuth };

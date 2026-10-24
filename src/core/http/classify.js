'use strict';

const { ERROR_CATEGORIES } = require('../../config/constants');

/** Categoría de un error de axios: sin respuesta, auth, límite, cliente o servidor. */
function classifyHttpError(error) {
  if (!error.response) {
    // Sin respuesta: timeout, ECONNREFUSED, ENOTFOUND, etc.
    return ERROR_CATEGORIES.CONNECTION_ERROR;
  }
  const status = error.response.status;
  if (status === 401) return ERROR_CATEGORIES.AUTH_ERROR;
  if (status === 429) return ERROR_CATEGORIES.RATE_LIMIT;
  if (status >= 400 && status < 500) return ERROR_CATEGORIES.CLIENT_ERROR;
  return ERROR_CATEGORIES.SERVER_ERROR;
}

module.exports = { classifyHttpError };

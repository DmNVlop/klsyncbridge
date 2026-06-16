'use strict';

const { verifyToken } = require('./auth.service');
const { fromError } = require('../../utils/response');
const { AuthenticationError } = require('../../utils/errors');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  // EventSource no soporta headers — acepta ?token= como fallback para SSE
  const queryToken = req.query && req.query.token;
  if (!authHeader && !queryToken) {
    return fromError(res, new AuthenticationError('Token requerido'));
  }
  const token = authHeader ? authHeader.slice(7) : queryToken;
  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    return fromError(res, err);
  }
}

module.exports = { requireAuth };

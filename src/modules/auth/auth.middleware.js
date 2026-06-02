'use strict';

const { verifyToken } = require('./auth.service');
const { fromError } = require('../../utils/response');
const { AuthenticationError } = require('../../utils/errors');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fromError(res, new AuthenticationError('Token requerido'));
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    return fromError(res, err);
  }
}

module.exports = { requireAuth };

'use strict';

function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({ ok: true, data });
}

function list(res, data, total, page = 1, perPage = 25) {
  return res.status(200).json({ ok: true, data, total, page, per_page: perPage });
}

function created(res, data) {
  return success(res, data, 201);
}

function noContent(res) {
  return res.status(204).end();
}

function error(res, message, code = 'APP_ERROR', statusCode = 500) {
  return res.status(statusCode).json({ ok: false, error: message, code });
}

function fromError(res, err) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'APP_ERROR';
  const message = err.message || 'Error interno del servidor';
  const body = { ok: false, error: message, code };
  if (err.details) body.details = err.details;
  return res.status(statusCode).json(body);
}

module.exports = { success, list, created, noContent, error, fromError };

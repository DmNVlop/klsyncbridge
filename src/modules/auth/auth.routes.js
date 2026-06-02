'use strict';

const express = require('express');
const { login, getMe } = require('./auth.service');
const { requireAuth } = require('./auth.middleware');
const { success, fromError } = require('../../utils/response');
const { validate, loginSchema } = require('../../utils/validators');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = validate(loginSchema, req.body);
    const result = await login(username, password);
    return success(res, result);
  } catch (err) {
    return fromError(res, err);
  }
});

router.post('/logout', requireAuth, (req, res) => {
  // JWT stateless — el cliente descarta el token
  return success(res, { ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  try {
    const user = getMe(req.user.sub);
    return success(res, user);
  } catch (err) {
    return fromError(res, err);
  }
});

module.exports = router;

'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, noContent, fromError } = require('../../utils/response');
const { validate, createUserSchema, updateUserSchema } = require('../../utils/validators');
const svc = require('./users.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    return success(res, svc.listUsers());
  } catch (err) {
    return fromError(res, err);
  }
});

router.get('/:id', (req, res) => {
  try {
    return success(res, svc.getUserById(req.params.id));
  } catch (err) {
    return fromError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const data = validate(createUserSchema, req.body);
    const user = await svc.createUser(data);
    return created(res, user);
  } catch (err) {
    return fromError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const data = validate(updateUserSchema, req.body);
    const user = await svc.updateUser(req.params.id, data, req.user.sub);
    return success(res, user);
  } catch (err) {
    return fromError(res, err);
  }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return fromError(res, { message: 'Contraseña mínimo 8 caracteres', code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    const user = await svc.resetPassword(req.params.id, password);
    return success(res, user);
  } catch (err) {
    return fromError(res, err);
  }
});

router.delete('/:id', (req, res) => {
  try {
    svc.deleteUser(req.params.id);
    return noContent(res);
  } catch (err) {
    return fromError(res, err);
  }
});

module.exports = router;

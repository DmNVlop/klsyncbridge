'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, noContent, fromError } = require('../../utils/response');
const { validate, createApiConfigSchema, updateApiConfigSchema } = require('../../utils/validators');
const svc = require('./api-configs.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try { return success(res, svc.listApiConfigs()); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getApiConfig(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/', (req, res) => {
  try {
    const data = validate(createApiConfigSchema, req.body);
    return created(res, svc.createApiConfig(data));
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', (req, res) => {
  try {
    const data = validate(updateApiConfigSchema, req.body);
    return success(res, svc.updateApiConfig(req.params.id, data));
  } catch (err) { return fromError(res, err); }
});

router.delete('/:id', (req, res) => {
  try { svc.deleteApiConfig(req.params.id); return noContent(res); }
  catch (err) { return fromError(res, err); }
});

router.post('/:id/test', async (req, res) => {
  try {
    const result = await svc.testApiConfig(req.params.id);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

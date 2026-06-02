'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, noContent, fromError } = require('../../utils/response');
const { validate, createConnectionSchema, updateConnectionSchema } = require('../../utils/validators');
const svc = require('./connections.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try { return success(res, svc.listConnections()); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getConnection(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const data = validate(createConnectionSchema, req.body);
    return created(res, svc.createConnection(data));
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', (req, res) => {
  try {
    const data = validate(updateConnectionSchema, req.body);
    return success(res, svc.updateConnection(req.params.id, data));
  } catch (err) { return fromError(res, err); }
});

router.delete('/:id', (req, res) => {
  try { svc.deleteConnection(req.params.id); return noContent(res); }
  catch (err) { return fromError(res, err); }
});

router.post('/:id/test', async (req, res) => {
  try {
    const result = await svc.testConnection(req.params.id);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/tables', async (req, res) => {
  try {
    const tables = await svc.getTables(req.params.id);
    return success(res, tables);
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/fields', async (req, res) => {
  try {
    const { table } = req.query;
    const fields = await svc.getFields(req.params.id, table);
    return success(res, fields);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

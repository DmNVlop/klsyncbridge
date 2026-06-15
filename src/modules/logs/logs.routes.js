'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, list, fromError } = require('../../utils/response');
const { validate, logsFilterSchema } = require('../../utils/validators');
const svc = require('./logs.service');

const router = express.Router();
router.use(requireAuth);

// --- Execution logs ---

router.get('/', (req, res) => {
  try {
    const filters = validate(logsFilterSchema, req.query);
    const { data, total } = svc.getLogs(filters);
    return list(res, data, total, filters.page, filters.per_page);
  } catch (err) { return fromError(res, err); }
});

router.delete('/cleanup', (req, res) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const result = svc.cleanupLogs(days);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getLog(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

// --- Integration logs ---

router.get('/integrations/list', (req, res) => {
  try {
    const { job_id, outcome, api_config_id, date_from, date_to, search } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const per_page = Math.min(parseInt(req.query.per_page || '25', 10), 100);
    const { data, total } = svc.getIntegrationLogs({ job_id, outcome, api_config_id, date_from, date_to, search, page, per_page });
    return list(res, data, total, page, per_page);
  } catch (err) { return fromError(res, err); }
});

router.get('/integrations/:id', (req, res) => {
  try { return success(res, svc.getIntegrationLog(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.delete('/integrations/cleanup', (req, res) => {
  try {
    const days = parseInt(req.query.days || '90', 10);
    const result = svc.cleanupIntegrationLogs(days);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

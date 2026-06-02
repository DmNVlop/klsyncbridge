'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, noContent, list, fromError } = require('../../utils/response');
const { validate, createJobSchema, updateJobSchema, logsFilterSchema } = require('../../utils/validators');
const jobsSvc = require('./jobs.service');
const { executeJob } = require('./jobs.executor');
const { registerJob, unregisterJob, reloadJob, getSchedulerStatus } = require('./jobs.scheduler');
const logsSvc = require('../logs/logs.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try { return success(res, jobsSvc.listJobs()); }
  catch (err) { return fromError(res, err); }
});

router.get('/scheduler/status', (req, res) => {
  try { return success(res, getSchedulerStatus()); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, jobsSvc.getJob(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const data = validate(createJobSchema, req.body);
    const job = jobsSvc.createJob(data);
    if (job.is_active) registerJob(job);
    return created(res, job);
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', (req, res) => {
  try {
    const data = validate(updateJobSchema, req.body);
    const job = jobsSvc.updateJob(req.params.id, data);
    reloadJob(job);
    return success(res, job);
  } catch (err) { return fromError(res, err); }
});

router.delete('/:id', (req, res) => {
  try {
    unregisterJob(req.params.id);
    jobsSvc.deleteJob(req.params.id);
    return noContent(res);
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/activate', (req, res) => {
  try {
    const job = jobsSvc.activateJob(req.params.id);
    registerJob(job);
    return success(res, job);
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/deactivate', (req, res) => {
  try {
    const job = jobsSvc.deactivateJob(req.params.id);
    unregisterJob(req.params.id);
    return success(res, job);
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/reset-snapshot', (req, res) => {
  try {
    const result = jobsSvc.resetSnapshot(req.params.id);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/run-now', async (req, res) => {
  try {
    const result = await executeJob(req.params.id);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/logs', (req, res) => {
  try {
    const filters = validate(logsFilterSchema, { ...req.query, job_id: req.params.id });
    const { data, total } = logsSvc.getLogs(filters);
    return list(res, data, total, filters.page, filters.per_page);
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/field-maps', (req, res) => {
  try { return success(res, jobsSvc.getFieldMaps(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/:id/field-maps', (req, res) => {
  try {
    const maps = Array.isArray(req.body) ? req.body : [];
    const result = jobsSvc.saveFieldMaps(req.params.id, maps);
    return success(res, result);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

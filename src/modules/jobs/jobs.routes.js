'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, noContent, list, fromError } = require('../../utils/response');
const { validate, createJobSchema, updateJobSchema, logsFilterSchema } = require('../../utils/validators');
const jobsSvc = require('./jobs.service');
const { executeJob } = require('./jobs.executor');
const { registerJob, unregisterJob, reloadJob, getSchedulerStatus } = require('./jobs.scheduler');
const logsSvc = require('../logs/logs.service');
const eventsService = require('../../services/events.service');
const {
  STD_RECORD_KEYS, STD_DEFAULTS, STD_IGNORED_KEYS, STD_HEADER_KEYS, STD_KEY_PATTERN,
} = require('../../core/outputs/ardis-std/std-keys');

const { ValidationError } = require('../../utils/errors');

const router = express.Router();
router.use(requireAuth);

function actorOf(req) {
  return { id: req.user.sub, username: req.user.username };
}

router.get('/', (req, res) => {
  try { return success(res, jobsSvc.listJobs()); }
  catch (err) { return fromError(res, err); }
});

router.get('/scheduler/status', (req, res) => {
  try { return success(res, getSchedulerStatus()); }
  catch (err) { return fromError(res, err); }
});

// Catálogo de claves del almacén Ardis (.STD) para el editor de mapeo (única fuente: core/outputs/ardis-std/std-keys)
router.get('/std-keys', (req, res) => {
  try {
    return success(res, {
      recordKeys: STD_RECORD_KEYS,
      defaults: STD_DEFAULTS,
      ignoredKeys: STD_IGNORED_KEYS,
      headerKeys: STD_HEADER_KEYS,
      keyPattern: STD_KEY_PATTERN.source,
    });
  } catch (err) { return fromError(res, err); }
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
    eventsService.emitJobStatusChanged(job);
    return success(res, job);
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/deactivate', (req, res) => {
  try {
    const job = jobsSvc.deactivateJob(req.params.id);
    unregisterJob(req.params.id);
    eventsService.emitJobStatusChanged(job);
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

router.post('/:id/apply-template', (req, res) => {
  try {
    const templateId = req.body && req.body.templateId;
    if (typeof templateId !== 'string' || templateId === '') throw new ValidationError('Indica la plantilla que quieres aplicar');
    return success(res, jobsSvc.applyTemplate(req.params.id, templateId, actorOf(req)));
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/duplicate', (req, res) => {
  try { return created(res, jobsSvc.duplicateJob(req.params.id, actorOf(req))); }
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

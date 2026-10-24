'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, list, fromError } = require('../../utils/response');
const { validate } = require('../../utils/validators');
const { probeFolder } = require('../../core/files/folder-probe');
const queue = require('../../core/queue/work-queue');
const { automationBodySchema, testFolderSchema, workItemsFilterSchema } = require('./automations.validators');
const svc = require('./automations.service');
const engine = require('./automations.engine');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try { return success(res, svc.listAutomations()); }
  catch (err) { return fromError(res, err); }
});

// Antes de '/:id' para que no se interprete como id
router.post('/test-folder', async (req, res) => {
  try {
    const data = validate(testFolderSchema, req.body);
    return success(res, await probeFolder(data));
  } catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getAutomation(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/', (req, res) => {
  try {
    const automation = svc.createAutomation(validate(automationBodySchema, req.body));
    engine.reloadAutomation(automation.id);
    return created(res, automation);
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', (req, res) => {
  try {
    const automation = svc.updateAutomation(req.params.id, validate(automationBodySchema, req.body));
    engine.reloadAutomation(automation.id);
    return success(res, svc.getAutomation(automation.id));
  } catch (err) { return fromError(res, err); }
});

// 200 con cuerpo (no 204): el cliente API.request de la UI siempre hace res.json()
router.delete('/:id', (req, res) => {
  try {
    svc.getAutomation(req.params.id);
    engine.stopAutomation(req.params.id);
    svc.deleteAutomation(req.params.id);
    return success(res, { deleted: true });
  } catch (err) { return fromError(res, err); }
});

router.post('/:id/resume', (req, res) => {
  try {
    svc.getAutomation(req.params.id);
    engine.resume(req.params.id);
    return success(res, svc.getAutomation(req.params.id));
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/work-items', (req, res) => {
  try {
    svc.getAutomation(req.params.id);
    const filter = validate(workItemsFilterSchema, req.query);
    const { rows, total } = queue.listItems(req.params.id, {
      status: filter.status, search: filter.search, page: filter.page, perPage: filter.per_page,
    });
    return list(res, rows, total, filter.page, filter.per_page);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

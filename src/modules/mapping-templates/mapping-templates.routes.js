'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, fromError } = require('../../utils/response');
const { validate } = require('../../utils/validators');
const svc = require('./mapping-templates.service');
const { validateMappingJson } = require('./mapping-json.schema');
const { buildAiInstructions } = require('./ai-instructions');
const { sampleFile, previewMapping } = require('./sample.service');

const router = express.Router();
router.use(requireAuth);

function actorOf(req) {
  return { id: req.user.sub, username: req.user.username };
}

const readerSchema = z.object({
  format: z.enum(['auto', 'csv', 'excel']).optional(),
  options: z.record(z.any()).optional(),
}).optional();

const sampleInputSchema = z.object({
  path: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional().nullable(),
  fileName: z.string().min(1).max(260).optional(),
  contentBase64: z.string().min(1).optional(),
  reader: readerSchema,
});

const aiInstructionsSchema = z.object({
  targetKind: z.enum(['api', 'ardis_std']).optional(),
  sampleFields: z.array(z.object({ name: z.string(), sampleValues: z.array(z.any()).optional() })).max(1000).optional(),
});

const previewSchema = z.object({
  targetKind: z.enum(['api', 'ardis_std']),
  filterExpression: z.string().nullable().optional(),
  fields: z.array(z.object({
    api_field: z.string(),
    source_type: z.enum(['field', 'static', 'expression']).optional(),
    sql_field: z.string().nullable().optional(),
    transform: z.string().nullable().optional(),
    default_value: z.union([z.string(), z.number()]).nullable().optional(),
    expression: z.string().nullable().optional(),
  })),
  sample: sampleInputSchema,
});

function sendText(res, text) {
  return res.status(200).type('text/plain; charset=utf-8').send(text);
}

router.get('/', (req, res) => {
  try { return success(res, svc.listTemplates()); }
  catch (err) { return fromError(res, err); }
});

// Rutas literales antes de '/:id' para que no se interpreten como id
router.get('/ai-instructions', (req, res) => {
  try {
    const targetKind = req.query.targetKind === 'ardis_std' ? 'ardis_std' : 'api';
    return sendText(res, buildAiInstructions({ targetKind }));
  } catch (err) { return fromError(res, err); }
});

router.post('/ai-instructions', (req, res) => {
  try {
    const data = validate(aiInstructionsSchema, req.body || {});
    return sendText(res, buildAiInstructions(data));
  } catch (err) { return fromError(res, err); }
});

router.post('/validate', (req, res) => {
  try { return success(res, validateMappingJson(req.body)); }
  catch (err) { return fromError(res, err); }
});

router.post('/sample', async (req, res) => {
  try {
    const input = validate(sampleInputSchema, req.body);
    return success(res, await sampleFile(input));
  } catch (err) { return fromError(res, err); }
});

router.post('/preview', async (req, res) => {
  try {
    const data = validate(previewSchema, req.body);
    return success(res, await previewMapping(data));
  } catch (err) { return fromError(res, err); }
});

router.post('/', (req, res) => {
  try { return created(res, svc.createTemplate(req.body, actorOf(req))); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getTemplate(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id/export', (req, res) => {
  try {
    const { json, fileName } = svc.exportTemplate(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).type('application/json; charset=utf-8').send(JSON.stringify(json, null, 2));
  } catch (err) { return fromError(res, err); }
});

router.get('/:id/usages', (req, res) => {
  try {
    svc.getTemplate(req.params.id);
    return success(res, svc.findUsages(req.params.id));
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', (req, res) => {
  try { return success(res, svc.updateTemplate(req.params.id, req.body, actorOf(req))); }
  catch (err) { return fromError(res, err); }
});

router.post('/:id/duplicate', (req, res) => {
  try { return created(res, svc.duplicateTemplate(req.params.id, actorOf(req))); }
  catch (err) { return fromError(res, err); }
});

// 200 con cuerpo: el cliente `API.request` hace `res.json()`
router.delete('/:id', (req, res) => {
  try {
    svc.deleteTemplate(req.params.id, actorOf(req));
    return success(res, { deleted: true });
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

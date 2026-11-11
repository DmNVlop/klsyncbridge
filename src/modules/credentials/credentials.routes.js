'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, created, fromError } = require('../../utils/response');
const {
  validate, createNetworkCredentialSchema, updateNetworkCredentialSchema, testNetworkCredentialSchema,
} = require('../../utils/validators');
const logger = require('../../services/logger.service');
const svc = require('./credentials.service');
const { credentialAccess } = require('./credential-access.service');
const { testFolderAccess } = require('./credentials-test.service');

const router = express.Router();
router.use(requireAuth);

function actorOf(req) {
  return { id: req.user.sub, username: req.user.username };
}

/**
 * Tras editar una credencial: cancela sus conexiones y reanuda las automatizaciones detenidas por ella.
 * Es un efecto secundario: un fallo aquí nunca debe romper lo ya persistido.
 */
async function applyCredentialChange(id) {
  try {
    await credentialAccess.disconnectCredential(id);
  } catch (err) {
    logger.warn('No se pudieron cancelar las conexiones de la credencial editada', { credentialId: id, message: err.message });
  }
  try {
    const engine = require('../automations/automations.engine');
    if (typeof engine.resumeByCredential === 'function') engine.resumeByCredential(id);
  } catch (err) {
    logger.warn('No se pudieron reanudar las automatizaciones de la credencial editada', { credentialId: id, message: err.message });
  }
}

router.get('/', (req, res) => {
  try { return success(res, svc.listCredentials()); }
  catch (err) { return fromError(res, err); }
});

// Antes de '/:id' para que no se interprete como id
router.post('/test', async (req, res) => {
  try {
    const data = validate(testNetworkCredentialSchema, req.body);
    return success(res, await testFolderAccess(data, actorOf(req)));
  } catch (err) { return fromError(res, err); }
});

router.get('/:id', (req, res) => {
  try { return success(res, svc.getCredential(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.get('/:id/usages', (req, res) => {
  try {
    svc.getCredential(req.params.id);
    return success(res, svc.findUsages(req.params.id));
  } catch (err) { return fromError(res, err); }
});

router.post('/', (req, res) => {
  try {
    const data = validate(createNetworkCredentialSchema, req.body);
    return created(res, svc.createCredential(data, actorOf(req)));
  } catch (err) { return fromError(res, err); }
});

router.put('/:id', async (req, res) => {
  try {
    const data = validate(updateNetworkCredentialSchema, req.body);
    const updated = svc.updateCredential(req.params.id, data, actorOf(req));
    await applyCredentialChange(req.params.id);
    return success(res, updated);
  } catch (err) { return fromError(res, err); }
});

// 200 con cuerpo: el cliente `API.request` hace `res.json()`
router.delete('/:id', (req, res) => {
  try {
    svc.deleteCredential(req.params.id, actorOf(req));
    return success(res, { deleted: true });
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

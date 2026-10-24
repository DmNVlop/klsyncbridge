'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, fromError } = require('../../utils/response');
const { triggers, steps } = require('./plugins/registry');

const router = express.Router();
router.use(requireAuth);

// Tipos registrados con su JSON Schema: la UI genera los formularios a partir de aquí
router.get('/', (req, res) => {
  try { return success(res, { triggers: triggers.list(), steps: steps.list() }); }
  catch (err) { return fromError(res, err); }
});

module.exports = router;

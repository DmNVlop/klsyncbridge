'use strict';

const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { success, fromError } = require('../../utils/response');
const queue = require('../../core/queue/work-queue');
const events = require('../../services/events.service');
const engine = require('./automations.engine');

const router = express.Router();
router.use(requireAuth);

router.get('/:id/attempts', (req, res) => {
  try { return success(res, queue.listAttempts(req.params.id)); }
  catch (err) { return fromError(res, err); }
});

router.post('/:id/retry', (req, res) => {
  try {
    const item = queue.requestManualRetry(req.params.id, req.user.username);
    events.emitWorkItemChanged(item);
    engine.wakeAutomation(item.automation_id);
    return success(res, item);
  } catch (err) { return fromError(res, err); }
});

module.exports = router;

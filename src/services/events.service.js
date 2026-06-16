'use strict';

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// Conjunto de clientes SSE activos: Set<res>
const _clients = new Set();

function addClient(res) {
  _clients.add(res);
}

function removeClient(res) {
  _clients.delete(res);
}

function broadcast(eventName, data) {
  if (_clients.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of _clients) {
    try {
      res.write(payload);
    } catch {
      _clients.delete(res);
    }
  }
}

// Eventos disponibles — llamar desde executor/routes/scheduler
function emitJobStatusChanged(job) {
  broadcast('job.status_changed', {
    id: job.id,
    name: job.name,
    is_active: job.is_active,
    last_run_status: job.last_run_status,
    last_run_at: job.last_run_at,
  });
}

function emitJobExecutionStarted(jobId, jobName) {
  broadcast('job.execution_started', { id: jobId, name: jobName });
}

function emitJobExecutionFinished(jobId, jobName, result) {
  broadcast('job.execution_finished', {
    id: jobId,
    name: jobName,
    status: result.status,
    records_read: result.recordsRead,
    records_created: result.recordsCreated,
    records_updated: result.recordsUpdated,
    records_deleted: result.recordsDeleted,
    records_failed: result.recordsFailed,
  });
}

function emitLogNew(log) {
  broadcast('log.new_entry', log);
}

module.exports = {
  emitter,
  addClient,
  removeClient,
  emitJobStatusChanged,
  emitJobExecutionStarted,
  emitJobExecutionFinished,
  emitLogNew,
};

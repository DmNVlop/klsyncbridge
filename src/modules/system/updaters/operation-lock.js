'use strict';

// Cerrojo en memoria: solo una actualización o migración a la vez (compartido por /update y la migración).
let busy = false;

function tryAcquire() {
  if (busy) return false;
  busy = true;
  return true;
}

function release() {
  busy = false;
}

function isBusy() {
  return busy;
}

module.exports = { tryAcquire, release, isBusy };

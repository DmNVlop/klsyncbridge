'use strict';

const { makeTempDir, getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validate, createJobSchema, updateJobSchema } = require('../../src/utils/validators');
const { ValidationError, NotFoundError } = require('../../src/utils/errors');
const { NetworkAccessError } = require('../../src/core/network/net-errors');
const credentialsService = require('../../src/modules/credentials/credentials.service');
const { credentialAccess } = require('../../src/modules/credentials/credential-access.service');
const connectionsService = require('../../src/modules/connections/connections.service');
const jobsService = require('../../src/modules/jobs/jobs.service');
const { executeJob } = require('../../src/modules/jobs/jobs.executor');

const SECRET = 'clave-de-prueba-jobs';
const UNC_DIR = '\\\\servidor\\recurso\\salida';
const actor = { id: 'u1', username: 'tester' };

function makeCredential(name = 'NAS jobs') {
  return credentialsService.createCredential({ name, domain: 'EMP', username: 'svc', password: SECRET }, actor);
}

function makeConnection() {
  const file = path.join(makeTempDir(), 'datos.csv');
  fs.writeFileSync(file, 'id,name\n1,Uno\n2,Dos\n');
  return connectionsService.createConnection({
    name: `csv-${Math.random().toString(36).slice(2, 8)}`,
    source_type: 'csv',
    config: { file_path: file, delimiter: ',', encoding: 'utf8', has_header: true, header_row: 1 },
  });
}

function jobBody(connectionId, overrides = {}) {
  return {
    name: `job-${Math.random().toString(36).slice(2, 8)}`,
    connection_id: connectionId,
    table_or_view: 'datos',
    key_field: 'id',
    schedule_type: 'interval',
    schedule_value: '3600',
    item_type: 'material',
    destination_mode: 'file',
    file_formats: 'csv',
    output_dir: UNC_DIR,
    ...overrides,
  };
}

test('crear job con credencial y ruta local ⇒ 400', () => {
  const credential = makeCredential('NAS local');
  const connection = makeConnection();
  assert.throws(
    () => validate(createJobSchema, jobBody(connection.id, { output_dir: 'C:\\salida', output_credential_id: credential.id })),
    (err) => err instanceof ValidationError && /solo aplican a rutas/.test(JSON.stringify(err.details || err.message)),
  );
  // Misma regla en el servicio, que ve el estado efectivo (también al actualizar solo la credencial)
  const plain = jobsService.createJob(validate(createJobSchema, jobBody(connection.id, { output_dir: 'C:\\salida' })));
  assert.throws(() => jobsService.updateJob(plain.id, { output_credential_id: credential.id }), ValidationError);
});

test('crear con UNC persiste output_credential_id; actualizar a null vuelve a la cuenta del servicio', () => {
  const credential = makeCredential('NAS persistida');
  const connection = makeConnection();
  const job = jobsService.createJob(validate(createJobSchema, jobBody(connection.id, { output_credential_id: credential.id })));
  assert.equal(job.output_credential_id, credential.id);
  assert.equal(jobsService.getJob(job.id).output_credential_id, credential.id);

  const updated = jobsService.updateJob(job.id, validate(updateJobSchema, { output_credential_id: null }));
  assert.equal(updated.output_credential_id, null);
});

test('credencial inexistente ⇒ NotFoundError', () => {
  const connection = makeConnection();
  assert.throws(
    () => jobsService.createJob(validate(createJobSchema, jobBody(connection.id, { output_credential_id: '9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }))),
    NotFoundError,
  );
});

function readLog(jobId) {
  return getDb().prepare('SELECT * FROM execution_logs WHERE job_id = ? ORDER BY started_at DESC').get(jobId);
}

async function runWithStub(stub) {
  const credential = makeCredential(`NAS ejecución ${Math.random().toString(36).slice(2, 6)}`);
  const connection = makeConnection();
  const job = jobsService.createJob(validate(createJobSchema, jobBody(connection.id, { output_credential_id: credential.id })));
  jobsService.saveFieldMaps(job.id, [{ sql_field: 'id', api_field: 'id', transform: 'none', sort_order: 0 }]);
  const original = credentialAccess.withFolderAccess;
  const calls = [];
  // La lectura del origen (conexión sin credencial) pasa a la función real; solo se simula la salida con credencial
  credentialAccess.withFolderAccess = async (target, fn) => {
    if (!target.credentialId) return fn();
    calls.push(target);
    return stub(target, fn);
  };
  try {
    await executeJob(job.id);
  } finally {
    credentialAccess.withFolderAccess = original;
  }
  return { job, credential, calls, log: readLog(job.id) };
}

test('el executor exporta a través de withFolderAccess con la credencial del job', async () => {
  const { credential, calls, log } = await runWithStub(async () => ({ status: 'success', filePaths: ['x.csv'] }));
  assert.deepEqual(calls, [{ path: UNC_DIR, credentialId: credential.id }]);
  assert.equal(log.status, 'success');
  assert.equal(log.file_export_status, 'success');
});

test('error credential en la exportación ⇒ ejecución en error con el mensaje clasificado, sin contraseña', async () => {
  const message = 'Usuario o contraseña incorrectos para el recurso de red.';
  const { job, log } = await runWithStub(async () => { throw new NetworkAccessError({ kind: 'credential', message }); });
  assert.equal(log.status, 'error');
  assert.equal(log.file_export_status, 'error');
  assert.equal(log.error_message, message);
  assert.equal(JSON.stringify(log).includes(SECRET), false);
  // La programación sigue: el job no se desactiva
  assert.equal(jobsService.getJob(job.id).is_active, false);
});

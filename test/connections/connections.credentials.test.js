'use strict';

const { makeTempDir, getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, createConnectionSchema, updateConnectionSchema, createJobSchema } = require('../../src/utils/validators');
const { ValidationError, NotFoundError } = require('../../src/utils/errors');
const credentialsService = require('../../src/modules/credentials/credentials.service');
const { credentialAccess } = require('../../src/modules/credentials/credential-access.service');
const connectionsService = require('../../src/modules/connections/connections.service');
const jobsService = require('../../src/modules/jobs/jobs.service');
const { executeJob } = require('../../src/modules/jobs/jobs.executor');

const SECRET = 'clave-de-prueba-conexiones';
const UNC_FILE = '\\\\servidor\\recurso\\datos.csv';
const actor = { id: 'u1', username: 'tester' };

function makeCredential(name = 'NAS conexiones') {
  return credentialsService.createCredential({ name, domain: 'EMP', username: 'svc', password: SECRET }, actor);
}

function csvBody(overrides = {}) {
  return {
    name: `csv-${Math.random().toString(36).slice(2, 8)}`,
    source_type: 'csv',
    config: { file_path: UNC_FILE, delimiter: ',' },
    ...overrides,
  };
}

/** Sustituye `withFolderAccess` (sin tocar la red) y devuelve las llamadas recibidas. */
function stubFolderAccess(t, result) {
  const original = credentialAccess.withFolderAccess;
  const calls = [];
  credentialAccess.withFolderAccess = async (target) => { calls.push(target); return result; };
  t.after(() => { credentialAccess.withFolderAccess = original; });
  return calls;
}

test('alta CSV con UNC + credencial: se persiste fuera del config cifrado y nunca sale la contraseña', () => {
  const credential = makeCredential('NAS alta');
  const created = connectionsService.createConnection(validate(createConnectionSchema, csvBody({ network_credential_id: credential.id })));
  assert.equal(created.network_credential_id, credential.id);
  assert.equal(JSON.stringify(created).includes(SECRET), false);
  assert.equal(connectionsService.getConnectionConfig(created.id).config.network_credential_id, undefined);
  assert.equal(connectionsService.getConnection(created.id).network_credential_id, credential.id);
  assert.equal(connectionsService.getConnectionConfig(created.id).network_credential_id, credential.id);
});

test('SQL Server con credencial ⇒ 400; ruta local con credencial ⇒ 400; credencial inexistente ⇒ 404', () => {
  const credential = makeCredential('NAS reglas');
  const sqlserver = {
    name: 'sql', source_type: 'sqlserver', network_credential_id: credential.id,
    config: { host: 'h', database_name: 'd', username: 'u', password: 'p' },
  };
  assert.throws(() => connectionsService.createConnection(validate(createConnectionSchema, sqlserver)), ValidationError);

  const local = csvBody({ network_credential_id: credential.id, config: { file_path: 'C:\\datos\\a.csv', delimiter: ',' } });
  assert.throws(() => connectionsService.createConnection(validate(createConnectionSchema, local)), ValidationError);

  const missing = csvBody({ network_credential_id: '9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' });
  assert.throws(() => connectionsService.createConnection(validate(createConnectionSchema, missing)), NotFoundError);
});

test('actualizar: asignar y quitar la credencial; cambiar a ruta local con credencial ⇒ 400', () => {
  const credential = makeCredential('NAS update');
  const created = connectionsService.createConnection(validate(createConnectionSchema, csvBody()));
  assert.equal(created.network_credential_id, null);

  const assigned = connectionsService.updateConnection(created.id, validate(updateConnectionSchema, { network_credential_id: credential.id }));
  assert.equal(assigned.network_credential_id, credential.id);

  assert.throws(
    () => connectionsService.updateConnection(created.id, validate(updateConnectionSchema, { config: { file_path: 'C:\\x\\a.csv' } })),
    ValidationError,
  );

  const cleared = connectionsService.updateConnection(created.id, validate(updateConnectionSchema, { network_credential_id: null }));
  assert.equal(cleared.network_credential_id, null);
});

test('test, tablas y campos pasan por withFolderAccess con la ruta y la credencial de la conexión', async (t) => {
  const credential = makeCredential('NAS acceso');
  const created = connectionsService.createConnection(validate(createConnectionSchema, csvBody({ network_credential_id: credential.id })));
  const calls = stubFolderAccess(t, { ok: true, message: 'simulado' });
  await connectionsService.testConnection(created.id);
  await connectionsService.getTables(created.id);
  await connectionsService.getFields(created.id, 'datos');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call, { path: UNC_FILE, credentialId: credential.id });
});

test('el executor lee el origen vía withFolderAccess con la credencial de la conexión', async (t) => {
  const credential = makeCredential('NAS executor');
  const connection = connectionsService.createConnection(validate(createConnectionSchema, csvBody({ network_credential_id: credential.id })));
  const job = jobsService.createJob(validate(createJobSchema, {
    name: 'job-origen-unc', connection_id: connection.id, table_or_view: 'datos', key_field: 'id',
    schedule_type: 'interval', schedule_value: '3600', item_type: 'material',
    destination_mode: 'file', file_formats: 'csv', output_dir: makeTempDir(),
  }));
  jobsService.saveFieldMaps(job.id, [{ sql_field: 'id', api_field: 'id', transform: 'none', sort_order: 0 }]);
  // Origen (UNC + credencial) ⇒ registros simulados; salida local sin credencial ⇒ pasa a la función real
  const original = credentialAccess.withFolderAccess;
  const calls = [];
  credentialAccess.withFolderAccess = async (target, fn) => {
    calls.push(target);
    return target.credentialId ? [{ id: 1 }, { id: 2 }] : fn();
  };
  t.after(() => { credentialAccess.withFolderAccess = original; });
  await executeJob(job.id);
  assert.deepEqual(calls[0], { path: UNC_FILE, credentialId: credential.id });
  const log = getDb().prepare('SELECT * FROM execution_logs WHERE job_id = ?').get(job.id);
  assert.equal(log.status, 'success');
  assert.equal(log.records_read, 2);
});

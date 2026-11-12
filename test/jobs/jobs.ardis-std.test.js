'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validate, createJobSchema, updateJobSchema } = require('../../src/utils/validators');
const { ValidationError } = require('../../src/utils/errors');
const connectionsService = require('../../src/modules/connections/connections.service');
const jobsService = require('../../src/modules/jobs/jobs.service');

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
    output_dir: makeTempDir(),
    ...overrides,
  };
}

test('validador: ardis_std exige nombre de almacén válido y no se mezcla con csv', () => {
  const base = { ...jobBody('00000000-0000-4000-8000-000000000000'), file_formats: 'ardis_std' };
  assert.throws(() => validate(createJobSchema, base), ValidationError);                               // sin nombre
  assert.throws(() => validate(createJobSchema, { ...base, std_store_name: 'Mal:nombre' }), ValidationError);
  assert.throws(() => validate(createJobSchema, { ...base, std_store_name: 'CON' }), ValidationError);
  assert.throws(() => validate(createJobSchema, { ...base, std_store_name: 'A', file_formats: 'csv,ardis_std' }), ValidationError);
  assert.throws(() => validate(createJobSchema, { ...base, file_formats: 'xml' }), ValidationError);
  const ok = validate(createJobSchema, { ...base, std_store_name: 'Almacen Caroball', std_header: { REST: 'Retales' } });
  assert.equal(ok.std_store_name, 'Almacen Caroball');
});

test('validador: item_type solo obligatorio con endpoint', () => {
  const body = { ...jobBody('00000000-0000-4000-8000-000000000000'), file_formats: 'ardis_std', std_store_name: 'A' };
  delete body.item_type;
  assert.doesNotThrow(() => validate(createJobSchema, body));
  assert.throws(() => validate(createJobSchema, { ...body, destination_mode: 'both', api_config_id: '00000000-0000-4000-8000-000000000001' }), ValidationError);
});

test('servicio: guarda y devuelve std_header como objeto; update a ardis_std sin nombre ⇒ 400', () => {
  const conn = makeConnection();
  const job = jobsService.createJob(validate(createJobSchema, { ...jobBody(conn.id), file_formats: 'ardis_std', std_store_name: 'Almacen', std_header: { REST: 'Retales' } }));
  assert.deepEqual(jobsService.getJob(job.id).std_header, { REST: 'Retales' });
  const csvJob = jobsService.createJob(validate(createJobSchema, { ...jobBody(conn.id), file_formats: 'csv' }));
  assert.throws(() => jobsService.updateJob(csvJob.id, validate(updateJobSchema, { file_formats: 'ardis_std' })), /nombre del almacén/);
});

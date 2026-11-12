'use strict';

const { makeTempDir, getDb } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validate, createJobSchema, updateJobSchema } = require('../../src/utils/validators');
const { ValidationError } = require('../../src/utils/errors');
const connectionsService = require('../../src/modules/connections/connections.service');
const jobsService = require('../../src/modules/jobs/jobs.service');
const { executeJob } = require('../../src/modules/jobs/jobs.executor');
const jobsRouter = require('../../src/modules/jobs/jobs.routes');

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

test('executeJob: escribe el .STD completo, no lo reescribe sin cambios y conserva el anterior con 0 válidos', async () => {
  const csvFile = path.join(makeTempDir(), 'stock.csv');
  fs.writeFileSync(csvFile, 'COD,LARGO,ANCHO,ESP\nF186,2800,2070,19\nW980,2800,2070,\n');
  const conn = connectionsService.createConnection({
    name: `csv-${Date.now()}`,
    source_type: 'csv',
    config: { file_path: csvFile, delimiter: ',', encoding: 'utf8', has_header: true, header_row: 1 },
  });
  const outDir = makeTempDir();
  const job = jobsService.createJob(validate(createJobSchema, {
    ...jobBody(conn.id), key_field: 'COD', output_dir: outDir, file_formats: 'ardis_std', std_store_name: 'Almacen Caroball',
  }));
  jobsService.saveFieldMaps(job.id, [
    { api_field: 'MATERIAAL', sql_field: 'COD' }, { api_field: 'LENGTE', sql_field: 'LARGO' },
    { api_field: 'BREEDTE', sql_field: 'ANCHO' }, { api_field: 'DIKTE', sql_field: 'ESP' },
  ]);
  const stdPath = path.join(outDir, 'Almacen Caroball.STD');

  const r1 = await executeJob(job.id);
  assert.equal(r1.status, 'partial');            // W980 sin espesor ⇒ descartado
  assert.equal(r1.recordsFailed, 1);
  const first = fs.readFileSync(stdPath, 'utf8');
  assert.match(first, /MATERIAAL=F186/);
  assert.doesNotMatch(first, /W980/);

  const mtime = fs.statSync(stdPath).mtimeMs;
  const r2 = await executeJob(job.id);           // sin cambios en el origen
  assert.equal(r2.status, 'partial');
  assert.equal(fs.statSync(stdPath).mtimeMs, mtime);

  fs.writeFileSync(csvFile, 'COD,LARGO,ANCHO,ESP\nX,,,\n');
  const r3 = await executeJob(job.id);           // 0 válidos ⇒ no se toca
  assert.equal(r3.status, 'partial');
  assert.equal(fs.readFileSync(stdPath, 'utf8'), first);
  const log = getDb().prepare('SELECT error_message, file_export_status FROM execution_logs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1').get(job.id);
  assert.equal(log.file_export_status, 'warning');
  assert.match(log.error_message, /0 registros válidos/);
});

test('GET /api/jobs/std-keys: ruta registrada antes de /:id y protegida por requireAuth', () => {
  const routes = jobsRouter.stack.filter(layer => layer.route && layer.route.methods.get).map(layer => layer.route.path);
  assert.ok(routes.includes('/std-keys'));
  assert.ok(routes.indexOf('/std-keys') < routes.indexOf('/:id'));
  assert.equal(jobsRouter.stack[0].name, 'requireAuth');
});

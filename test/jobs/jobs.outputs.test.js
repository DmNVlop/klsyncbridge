'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFileOutputConfig, combineOutcome } = require('../../src/modules/jobs/jobs.outputs');

test('buildFileOutputConfig: mapea columnas del job', () => {
  const job = { id: 'j1', name: 'Stock', output_dir: 'C:\out', table_or_view: 'V_STOCK', file_formats: 'csv',
    csv_delimiter: ',', file_retention: 'keep_last', std_store_name: 'Almacen', std_header: { REST: 'Retales' } };
  assert.deepEqual(buildFileOutputConfig(job, [{ api_field: 'A' }, { api_field: 'B' }]), {
    outputDir: 'C:\out', baseName: 'V_STOCK', formats: ['csv'], delimiter: ',', retention: 'keep_last',
    headers: ['A', 'B'], storeName: 'Almacen', header: { REST: 'Retales' }, jobName: 'Stock', jobId: 'j1',
  });
});

test('combineOutcome: equivale a la lógica histórica y añade warning ⇒ partial', () => {
  const c = (wantsEndpoint, wantsFile, httpOutcome, fileStatus) => combineOutcome({ wantsEndpoint, wantsFile, httpOutcome, fileStatus });
  assert.equal(c(true, false, 'success', null), 'success');
  assert.equal(c(true, false, 'partial', null), 'partial');
  assert.equal(c(true, false, 'error', null), 'error');
  assert.equal(c(true, false, 'skipped', null), 'success');
  assert.equal(c(false, true, 'skipped', 'success'), 'success');
  assert.equal(c(false, true, 'skipped', 'error'), 'error');
  assert.equal(c(false, true, 'skipped', 'warning'), 'partial');
  assert.equal(c(false, true, 'skipped', null), 'success');
  assert.equal(c(true, true, 'success', 'success'), 'success');
  assert.equal(c(true, true, 'error', 'error'), 'error');
  assert.equal(c(true, true, 'success', 'error'), 'partial');
  assert.equal(c(true, true, 'error', 'success'), 'partial');
});

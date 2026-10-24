'use strict';

const { makeTempDir } = require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startFakeServer } = require('../helpers/fake-http-server');
const { seedApiConfig, waitFor } = require('../helpers/seed');
const svc = require('../../src/modules/automations/automations.service');
const engine = require('../../src/modules/automations/automations.engine');
const queue = require('../../src/core/queue/work-queue');

const itemByName = (automationId, name) => queue.listItems(automationId, { search: name, page: 1, perPage: 5 }).rows[0];

test('carpeta ⇒ subida ⇒ done; 403 ⇒ needs_attention; reanudar ⇒ done', { timeout: 30000 }, async (t) => {
  let reply = { status: 201, json: { status: 'CREATED', orderNumber: 'ARD-1', version: 1, message: 'Creado' } };
  const server = await startFakeServer(() => reply);
  t.after(async () => { engine.stopAll(); await server.close(); });

  const api = seedApiConfig(server.baseUrl);
  const dir = makeTempDir();
  const automation = svc.createAutomation({
    name: 'XML',
    is_active: true,
    trigger: { type: 'folder_watch', config: { path: dir, stableSeconds: 2, sweepSeconds: 3600 } },
    steps: [{ type: 'ardis_xml_import', config: { api_config_id: api.id } }],
  });
  await engine.start();

  fs.writeFileSync(path.join(dir, 'P1.xml'), '<Ardis1/>');
  await engine.getRuntime(automation.id).trigger.sweepNow();
  await waitFor(() => itemByName(automation.id, 'P1.xml')?.status === 'done');
  assert.equal(itemByName(automation.id, 'P1.xml').external_ref, 'ARD-1');
  assert.ok(svc.getAutomation(automation.id).last_success_at);
  assert.equal(server.requests[0].headers['x-api-key'], 'k');

  reply = { status: 403, json: { statusCode: 403, message: 'Forbidden' } };
  fs.writeFileSync(path.join(dir, 'P2.xml'), '<Ardis2/>');
  await engine.getRuntime(automation.id).trigger.sweepNow();
  await waitFor(() => svc.getAutomation(automation.id).health_state === 'needs_attention');
  assert.equal(itemByName(automation.id, 'P2.xml').status, 'pending');

  reply = { status: 201, json: { status: 'CREATED', orderNumber: 'ARD-2', version: 1 } };
  engine.resume(automation.id);
  await waitFor(() => itemByName(automation.id, 'P2.xml')?.status === 'done');
  assert.equal(svc.getAutomation(automation.id).health_state, 'ok');
  assert.equal(server.requests.filter((r) => r.url.endsWith('ardis-xml-imports')).length, 3, 'P1 no se re-sube');
});

test('arranque: lo que quedó en proceso vuelve a pendiente', async () => {
  engine.stopAll();
  const api = seedApiConfig('http://127.0.0.1:1');
  const automation = svc.createAutomation({
    name: 'Inactiva',
    is_active: false,
    trigger: { type: 'folder_watch', config: { path: makeTempDir() } },
    steps: [{ type: 'ardis_xml_import', config: { api_config_id: api.id } }],
  });
  queue.enqueue({ automationId: automation.id, itemKey: 'c:\\z.xml', displayName: 'z.xml', fingerprint: 'f', meta: {} });
  queue.claimDue(automation.id, 1);
  await engine.start();
  engine.stopAll();
  assert.equal(itemByName(automation.id, 'z.xml').status, 'pending');
});

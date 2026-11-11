'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialAccess } = require('../../src/modules/credentials/credential-access.service');
const { ValidationError } = require('../../src/utils/errors');

const SECRET = 'clave-ultra-secreta';
const PATH = '\\\\srv\\rec\\in';

function build({ domain = null } = {}) {
  const calls = [];
  const session = {
    ensureConnected: async (target, options) => { calls.push({ target, options }); },
    disconnectCredential: async (id) => { calls.push({ disconnect: id }); },
  };
  const getSecret = async (id) => ({ id, domain, username: 'svc', password: SECRET });
  const logger = { warn() {}, info() {}, error() {} };
  return { calls, access: createCredentialAccess({ getSecret, session, logger }) };
}

function fsError(code) {
  const err = new Error(`fallo ${code}`);
  err.code = code;
  return err;
}

test('sin credencial no toca la sesión y ejecuta fn directo', async () => {
  const { calls, access } = build();
  assert.equal(await access.withFolderAccess({ path: PATH }, async () => 'ok'), 'ok');
  await access.ensureAccess({ path: PATH });
  assert.equal(calls.length, 0);
});

test('compone DOMINIO\\usuario', async () => {
  const { calls, access } = build({ domain: 'EMP' });
  await access.ensureAccess({ path: PATH, credentialId: 'c1' });
  assert.equal(calls[0].target.username, 'EMP\\svc');
  assert.equal(calls[0].target.root, '\\\\srv\\rec');
  assert.equal(calls[0].target.credentialId, 'c1');
});

test('fn falla ENOENT una vez y luego OK ⇒ una reconexión', async () => {
  const { calls, access } = build();
  let attempts = 0;
  const result = await access.withFolderAccess({ path: PATH, credentialId: 'c1' }, async () => {
    attempts += 1;
    if (attempts === 1) throw fsError('ENOENT');
    return 'listo';
  });
  assert.equal(result, 'listo');
  assert.equal(attempts, 2);
  assert.equal(calls.filter((c) => c.options && c.options.reconnect).length, 1);
});

test('falla dos veces ⇒ error clasificado y exactamente una reconexión', async () => {
  const { calls, access } = build();
  let attempts = 0;
  await assert.rejects(
    access.withFolderAccess({ path: PATH, credentialId: 'c1' }, async () => { attempts += 1; throw fsError('EACCES'); }),
    (err) => {
      assert.equal(err.name, 'NetworkAccessError');
      assert.equal(err.kind, 'credential');
      assert.equal(err.retryable, false);
      assert.equal(err.fsCode, 'EACCES');
      assert.equal(err.message.includes(SECRET), false);
      return true;
    },
  );
  assert.equal(attempts, 2);
  assert.equal(calls.filter((c) => c.options && c.options.reconnect).length, 1);
});

test('error EISDIR ⇒ no reintenta', async () => {
  const { calls, access } = build();
  let attempts = 0;
  await assert.rejects(
    access.withFolderAccess({ path: PATH, credentialId: 'c1' }, async () => { attempts += 1; throw fsError('EISDIR'); }),
    (err) => err.code === 'EISDIR',
  );
  assert.equal(attempts, 1);
  assert.equal(calls.filter((c) => c.options && c.options.reconnect).length, 0);
});

test('ruta local con credencial ⇒ ValidationError', async () => {
  const { access } = build();
  await assert.rejects(access.ensureAccess({ path: 'C:\\datos', credentialId: 'c1' }), ValidationError);
});

test('makeEnsureAccess propaga reconnect y disconnectCredential delega', async () => {
  const { calls, access } = build();
  const hook = access.makeEnsureAccess({ path: PATH, credentialId: 'c1' });
  await hook({ reconnect: true });
  assert.equal(calls[0].options.reconnect, true);
  await access.disconnectCredential('c1');
  assert.deepEqual(calls[1], { disconnect: 'c1' });
});

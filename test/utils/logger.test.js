'use strict';

require('../helpers/test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../../src/services/logger.service');

const { sanitizeMeta } = logger;

test('password en la raíz ⇒ enmascarada', () => {
  assert.deepEqual(sanitizeMeta({ password: 'x', user: 'ana' }), { password: '****', user: 'ana' });
});

test('password anidada (objetos y arrays) ⇒ enmascarada', () => {
  const meta = { a: { password: 'x', b: { Password: 'y' } }, list: [{ pwd: 'z' }, { ok: 1 }] };
  assert.deepEqual(sanitizeMeta(meta), {
    a: { password: '****', b: { Password: '****' } },
    list: [{ pwd: '****' }, { ok: 1 }],
  });
});

test('defensa en profundidad: pass, pwd y secret, sin distinguir mayúsculas; token queda fuera', () => {
  assert.deepEqual(
    sanitizeMeta({ pass: 'a', PWD: 'b', Secret: 'c', token: 'visible' }),
    { pass: '****', PWD: '****', Secret: '****', token: 'visible' },
  );
});

test('no muta el objeto original', () => {
  const original = { password: 'x', nested: { password: 'y' } };
  sanitizeMeta(original);
  assert.deepEqual(original, { password: 'x', nested: { password: 'y' } });
});

test('Authorization sigue enmascarado', () => {
  assert.deepEqual(
    sanitizeMeta({ headers: { Authorization: 'Bearer abc', Accept: 'json' } }),
    { headers: { Authorization: 'Bearer ****', Accept: 'json' } },
  );
  assert.deepEqual(sanitizeMeta({ headers: { authorization: 'Bearer abc' } }), { headers: { authorization: 'Bearer ****' } });
});

test('valores no objeto, Error y Date quedan intactos', () => {
  const error = new Error('boom');
  const date = new Date(0);
  const out = sanitizeMeta({ n: 1, s: 'texto', nil: null, error, date });
  assert.equal(out.n, 1);
  assert.equal(out.s, 'texto');
  assert.equal(out.nil, null);
  assert.equal(out.error, error);
  assert.equal(out.date, date);
  assert.equal(sanitizeMeta(undefined), undefined);
  assert.equal(sanitizeMeta('texto'), 'texto');
});

test('ciclos y profundidad > 4 no desbordan ni dejan pasar la contraseña', () => {
  const cyclic = { name: 'a' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => sanitizeMeta(cyclic));
  assert.match(JSON.stringify(sanitizeMeta(cyclic)), /\[circular\]/);

  const deep = { l1: { l2: { l3: { l4: { l5: { password: 'secreto-profundo' } } } } } };
  assert.equal(JSON.stringify(sanitizeMeta(deep)).includes('secreto-profundo'), false);
});

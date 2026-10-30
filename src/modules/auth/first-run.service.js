'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { NotFoundError } = require('../../utils/errors');
const { BCRYPT_ROUNDS } = require('../../config/constants');
const { generateToken, getMe } = require('./auth.service');
const logger = require('../../services/logger.service');

const MASTER_USERNAME = 'admin';

function hasMasterUser() {
  return Boolean(getDb().prepare('SELECT id FROM users WHERE is_master = 1').get());
}

function isFirstRunRequired() {
  return { required: !hasMasterUser(), username: MASTER_USERNAME };
}

// Crea el admin maestro con la contraseña elegida en la UI. Solo mientras no exista:
// después responde 404 (el recurso «primer acceso» deja de existir).
function completeFirstRun(password) {
  const db = getDb();
  const hashed = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const create = db.transaction(() => {
    if (hasMasterUser()) throw new NotFoundError('Primer acceso');
    db.prepare(`
      INSERT INTO users (id, username, password, role, is_master, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, 1, ?, ?)
    `).run(id, MASTER_USERNAME, hashed, now, now);
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('master_user_id', ?)").run(id);
  });
  create();

  logger.info('Primer acceso: usuario maestro creado', { userId: id });
  const user = getMe(id);
  return { token: generateToken({ id, username: MASTER_USERNAME, role: 'admin' }), user };
}

module.exports = { isFirstRunRequired, completeFirstRun };

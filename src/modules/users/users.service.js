'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../../config/database');
const { NotFoundError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { BCRYPT_ROUNDS } = require('../../config/constants');

function now() { return new Date().toISOString(); }

function sanitize(user) {
  if (!user) return null;
  const { password: _, ...safe } = user;
  safe.is_master = Boolean(safe.is_master);
  safe.is_active = Boolean(safe.is_active);
  return safe;
}

function listUsers() {
  const db = getDb();
  return db.prepare('SELECT * FROM users ORDER BY is_master DESC, username ASC').all().map(sanitize);
}

function getUserById(id) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('Usuario');
  return sanitize(user);
}

async function createUser({ username, password }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new ConflictError(`El usuario "${username}" ya existe`);

  const id = crypto.randomUUID();
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const n = now();

  db.prepare(`
    INSERT INTO users (id, username, password, role, is_master, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 0, 1, ?, ?)
  `).run(id, username, hashed, n, n);

  return getUserById(id);
}

async function updateUser(id, data, callerId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('Usuario');

  if (user.is_master && callerId !== id) {
    throw new ForbiddenError('Solo el propio administrador master puede modificar su cuenta');
  }

  if (user.is_master && data.is_active === false) {
    throw new ForbiddenError('No se puede desactivar al usuario master');
  }

  const updates = {};
  if (data.username !== undefined) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(data.username, id);
    if (existing) throw new ConflictError(`El usuario "${data.username}" ya existe`);
    updates.username = data.username;
  }
  if (data.password !== undefined && data.password !== '') {
    updates.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  }
  if (data.is_active !== undefined && !user.is_master) {
    updates.is_active = data.is_active ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) return sanitize(user);

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), now(), id];
  db.prepare(`UPDATE users SET ${setClauses}, updated_at = ? WHERE id = ?`).run(...values);

  return getUserById(id);
}

async function resetPassword(id, newPassword) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('Usuario');

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hashed, now(), id);
  return getUserById(id);
}

function deleteUser(id) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('Usuario');
  if (user.is_master) throw new ForbiddenError('No se puede eliminar al usuario master');

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = { listUsers, getUserById, createUser, updateUser, resetPassword, deleteUser };

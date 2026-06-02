'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../../config/database');
const { AuthenticationError } = require('../../utils/errors');
const { JWT_EXPIRY_SECONDS } = require('../../config/constants');
const logger = require('../../services/logger.service');

function getJwtSecret() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'jwt_secret'").get();
  if (!row) throw new AuthenticationError('JWT secret no configurado. Ejecutar setup.');
  return row.value;
}

async function login(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user) {
    // Tiempo constante para evitar timing attacks
    await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000');
    throw new AuthenticationError('Usuario o contraseña incorrectos');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new AuthenticationError('Usuario o contraseña incorrectos');
  }

  const token = generateToken(user);
  logger.info('Login exitoso', { username: user.username, userId: user.id });

  return {
    token,
    user: sanitizeUser(user),
  };
}

function generateToken(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    secret,
    { expiresIn: JWT_EXPIRY_SECONDS }
  );
}

function verifyToken(token) {
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    throw new AuthenticationError('Token inválido o expirado');
  }
}

function getMe(userId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId);
  if (!user) throw new AuthenticationError('Usuario no encontrado');
  return sanitizeUser(user);
}

function sanitizeUser(user) {
  const { password: _, ...safe } = user;
  safe.is_master = Boolean(safe.is_master);
  safe.is_active = Boolean(safe.is_active);
  return safe;
}

module.exports = { login, verifyToken, getMe, generateToken };

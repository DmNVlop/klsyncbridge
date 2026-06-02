'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { EncryptionError } = require('../utils/errors');
const { ENCRYPTION_KEY_BYTES, GCM_IV_BYTES, GCM_AUTH_TAG_BYTES } = require('../config/constants');

let _key = null;

function getKeyPath() {
  const env = require('../config/env');
  return path.resolve(env.DATA_DIR, 'encryption.key');
}

function loadKey() {
  if (_key) return _key;
  const keyPath = getKeyPath();
  if (!fs.existsSync(keyPath)) {
    throw new EncryptionError('Clave de cifrado no encontrada. Ejecutar: node scripts/setup.js');
  }
  const hex = fs.readFileSync(keyPath, 'utf8').trim();
  if (hex.length !== ENCRYPTION_KEY_BYTES * 2) {
    throw new EncryptionError('Clave de cifrado inválida');
  }
  _key = Buffer.from(hex, 'hex');
  return _key;
}

function generateKey() {
  const keyPath = getKeyPath();
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(keyPath)) {
    return false; // ya existe, no sobreescribir
  }
  const key = crypto.randomBytes(ENCRYPTION_KEY_BYTES);
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  _key = key;
  return true;
}

/**
 * Cifra un string con AES-256-GCM.
 * Formato salida base64: [IV:12bytes][AuthTag:16bytes][Ciphertext]
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  try {
    const key = loadKey();
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  } catch (err) {
    throw new EncryptionError(`Error cifrando: ${err.message}`);
  }
}

/**
 * Descifra un valor previamente cifrado con encrypt().
 */
function decrypt(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) return null;
  try {
    const key = loadKey();
    const combined = Buffer.from(ciphertext, 'base64');
    const iv = combined.subarray(0, GCM_IV_BYTES);
    const authTag = combined.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_AUTH_TAG_BYTES);
    const encrypted = combined.subarray(GCM_IV_BYTES + GCM_AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new EncryptionError(`Error descifrando: ${err.message}`);
  }
}

function encryptObject(obj) {
  if (!obj) return null;
  return encrypt(JSON.stringify(obj));
}

function decryptObject(ciphertext) {
  if (!ciphertext) return null;
  const str = decrypt(ciphertext);
  return JSON.parse(str);
}

module.exports = { generateKey, encrypt, decrypt, encryptObject, decryptObject };

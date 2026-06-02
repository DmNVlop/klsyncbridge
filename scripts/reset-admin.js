'use strict';

/**
 * Resetea la contraseña del usuario master (admin).
 * Ejecutar: node scripts/reset-admin.js
 * Requiere acceso directo al servidor (no necesita login).
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { initDatabase } = require('../src/config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { BCRYPT_ROUNDS } = require('../src/config/constants');

function resetAdmin() {
  const db = initDatabase();

  const master = db.prepare("SELECT id, username FROM users WHERE is_master = 1").get();
  if (!master) {
    console.error('ERROR: No se encontro un usuario master en la base de datos.');
    console.error('Ejecuta primero: node scripts/setup.js');
    process.exit(1);
  }

  const newPassword = crypto.randomBytes(8).toString('hex');
  const hashed = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  const now = new Date().toISOString();

  db.prepare("UPDATE users SET password = ?, updated_at = ? WHERE is_master = 1")
    .run(hashed, now);

  console.log('\n========================================');
  console.log('  NUEVA CONTRASENA DEL ADMINISTRADOR');
  console.log('========================================');
  console.log(`  Usuario:    ${master.username}`);
  console.log(`  Contrasena: ${newPassword}`);
  console.log('========================================');
  console.log('\nCAMBIA LA CONTRASENA DESPUES DE ENTRAR.\n');

  process.exit(0);
}

try {
  resetAdmin();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

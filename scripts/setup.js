'use strict';

/**
 * Script de setup inicial de KLSyncBridge.
 * Genera clave de cifrado, inicializa DB, crea usuario master.
 * Ejecutar: node scripts/setup.js
 */

const path = require('path');

// Asegurar rutas correctas desde raíz del proyecto
process.chdir(path.join(__dirname, '..'));

const { generateKey } = require('../src/services/encryption.service');
const { initDatabase, getDb } = require('../src/config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { BCRYPT_ROUNDS } = require('../src/config/constants');

async function setup() {
  console.log('🚀 Iniciando setup de KLSyncBridge...\n');

  // 1. Generar clave de cifrado
  const keyCreated = generateKey();
  if (keyCreated) {
    console.log('✅ Clave de cifrado generada en data/encryption.key');
  } else {
    console.log('ℹ️  Clave de cifrado ya existe, se mantiene.');
  }

  // 2. Inicializar base de datos
  const db = initDatabase();
  console.log('✅ Base de datos SQLite inicializada');

  // 3. Generar JWT secret si no existe
  const jwtRow = db.prepare("SELECT value FROM app_settings WHERE key = 'jwt_secret'").get();
  if (!jwtRow) {
    const jwtSecret = crypto.randomBytes(64).toString('hex');
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('jwt_secret', ?)").run(jwtSecret);
    console.log('✅ JWT secret generado');
  } else {
    console.log('ℹ️  JWT secret ya existe, se mantiene.');
  }

  // 4. Crear usuario master si no existe
  const masterRow = db.prepare("SELECT id FROM users WHERE is_master = 1").get();
  if (!masterRow) {
    const masterUsername = 'admin';
    const masterPassword = crypto.randomBytes(8).toString('hex'); // contraseña aleatoria
    const hashedPassword = bcrypt.hashSync(masterPassword, BCRYPT_ROUNDS);
    const masterId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, password, role, is_master, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, 1, ?, ?)
    `).run(masterId, masterUsername, hashedPassword, now, now);

    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('master_user_id', ?)")
      .run(masterId);

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║         CREDENCIALES INICIALES           ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Usuario:    ${masterUsername.padEnd(28)}║`);
    console.log(`║  Contraseña: ${masterPassword.padEnd(28)}║`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  ⚠️  CAMBIA LA CONTRASEÑA INMEDIATAMENTE  ║');
    console.log('╚══════════════════════════════════════════╝\n');
  } else {
    console.log('ℹ️  Usuario master ya existe, se mantiene.');
  }

  // 5. Marcar setup como completo
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_complete', 'true')").run();
  console.log('✅ Setup completado correctamente');

  const env = require('../src/config/env');
  console.log(`\n🌐 Accede a la UI en: http://localhost:${env.PORT}`);
  console.log('   Ejecuta el servicio con: npm start\n');

  process.exit(0);
}

setup().catch((err) => {
  console.error('❌ Error durante setup:', err.message);
  process.exit(1);
});

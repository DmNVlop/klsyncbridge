'use strict';

/**
 * Script de setup inicial de KLSyncBridge.
 * Genera clave de cifrado, inicializa DB y JWT secret (el usuario master se crea en la UI).
 * Ejecutar: node scripts/setup.js
 */

const path = require('path');

// Asegurar rutas correctas desde raíz del proyecto
process.chdir(path.join(__dirname, '..'));

const { generateKey } = require('../src/services/encryption.service');
const { initDatabase, getDb } = require('../src/config/database');
const crypto = require('crypto');

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

  // 4. Usuario master: se crea en la UI en el primer acceso (contraseña elegida por el técnico)
  const masterRow = db.prepare("SELECT id FROM users WHERE is_master = 1").get();
  if (!masterRow) {
    console.log('ℹ️  Sin usuario master: créalo en la primera visita a la UI.');
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

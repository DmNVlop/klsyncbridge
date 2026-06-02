'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
process.chdir(path.join(__dirname, '..'));

const { Service } = require('node-windows');
const { execSync } = require('child_process');

function createShortcuts() {
  const url = 'http://localhost:3847';
  const shortcutName = 'KLSyncBridge.url';
  const urlFileContent = `[InternetShortcut]\nURL=${url}\nIconFile=${path.join(__dirname, '../public/favicon.ico')}\nIconIndex=0\n`;

  const desktopPath = path.join(os.homedir(), 'Desktop', shortcutName);
  const startMenuDir = path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'KLSyncBridge'
  );
  const startMenuPath = path.join(startMenuDir, shortcutName);

  try {
    fs.writeFileSync(desktopPath, urlFileContent, 'utf8');
    console.log(`✅ Acceso directo creado en Escritorio: ${desktopPath}`);
  } catch (err) {
    console.warn('⚠️  No se pudo crear acceso directo en Escritorio:', err.message);
  }

  try {
    fs.mkdirSync(startMenuDir, { recursive: true });
    fs.writeFileSync(startMenuPath, urlFileContent, 'utf8');
    console.log(`✅ Acceso directo creado en Menú Inicio: ${startMenuPath}`);
  } catch (err) {
    console.warn('⚠️  No se pudo crear acceso directo en Menú Inicio:', err.message);
  }
}

const svc = new Service({
  name: 'KLSyncBridge',
  description: 'KLSyncBridge - Servicio de integración de datos',
  script: path.join(__dirname, '../src/app.js'),
  nodeOptions: [],
  env: { name: 'NODE_ENV', value: 'production' },
});

svc.on('install', () => {
  console.log('✅ Servicio KLSyncBridge instalado');

  svc.start();
  console.log('✅ Servicio iniciado');

  // sc failure necesita que SCM registre el servicio — esperar 3s
  // El nombre en sc.exe es el campo 'name' del Service tal como queda en el registro
  setTimeout(() => {
    try {
      execSync('sc failure KLSyncBridge reset= 86400 actions= restart/5000/restart/10000/restart/30000', { stdio: 'inherit' });
      console.log('✅ Configuración de recovery aplicada');
    } catch (err) {
      console.warn('⚠️  No se pudo configurar recovery automáticamente:', err.message);
    }

    createShortcuts();
    console.log('\n🌐 Accede a KLSyncBridge en: http://localhost:3847');

    // Mantener proceso vivo hasta que todo termine, luego salir limpiamente
    setTimeout(() => process.exit(0), 500);
  }, 3000);
});

svc.on('error', (err) => {
  console.error('❌ Error:', err);
});

svc.install();

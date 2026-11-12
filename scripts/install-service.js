'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
process.chdir(path.join(__dirname, '..'));

const { Service } = require('node-windows');
const { execSync } = require('child_process');
const { ensureServiceRunning } = require('../src/utils/windows-service');

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
  // El Setup pasa la ubicación de los datos (ProgramData); las instalaciones antiguas no la tienen.
  env: [
    { name: 'NODE_ENV', value: 'production' },
    ...['KLSYNC_ENV_FILE', 'DATA_DIR', 'LOG_DIR']
      .filter((name) => process.env[name])
      .map((name) => ({ name, value: process.env[name] })),
  ],
});

svc.on('install', async () => {
  console.log('✅ Servicio KLSyncBridge instalado');

  // svc.start() de node-windows no avisa si el arranque falla: se arranca y se comprueba con sc.exe.
  // En SCM el servicio se llama como su ejecutable de node-windows (svc._exe = 'klsyncbridge.exe'),
  // no como el nombre visible 'KLSyncBridge'.
  try {
    await ensureServiceRunning(svc._exe);
    console.log('✅ Servicio iniciado (RUNNING)');
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
    return;
  }

  // Con el servicio ya en RUNNING, el SCM lo tiene registrado y sc failure funciona.
  try {
    execSync(`sc.exe failure "${svc._exe}" reset= 86400 actions= restart/5000/restart/10000/restart/30000`, { stdio: 'inherit' });
    console.log('✅ Configuración de recovery aplicada');
  } catch (err) {
    console.warn(`⚠️  No se pudo configurar el reinicio automático del servicio ${svc._exe}:`, err.message);
  }

  createShortcuts();
  console.log('\n🌐 Accede a KLSyncBridge en: http://localhost:3847');

  // Margen para que se vacíen las salidas antes de terminar
  setTimeout(() => process.exit(0), 500);
});

// Código de salida distinto de 0: el Setup (installer-setup.js) lo detecta y avisa.
svc.on('error', (err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});

// node-windows solo avisa de estos casos en el Visor de eventos y no instala nada: sin esto el script
// acabaría con código 0 y el servicio sin crear.
svc.on('alreadyinstalled', () => {
  console.error(`❌ El servicio ${svc._exe} ya tiene ficheros en ${svc.root}: desinstálalo antes de volver a instalarlo`);
  process.exit(1);
});
svc.on('invalidinstallation', () => {
  console.error(`❌ Instalación del servicio incompleta en ${svc.root} (faltan ${svc._exe} o su .xml)`);
  process.exit(1);
});

svc.install();

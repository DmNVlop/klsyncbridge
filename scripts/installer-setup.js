'use strict';

/**
 * Post-instalación del Setup: .env en ProgramData, migraciones y registro del servicio.
 * Uso: node.exe scripts\installer-setup.js "<ProgramData>\KLSyncBridge"
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFileSync } = require('child_process');
const { SERVICE_ID, queryServiceState } = require('../src/utils/windows-service');

const DEFAULT_PORT = 3847;
const HEALTH_TIMEOUT_MS = 60 * 1000;
const HEALTH_POLL_MS = 2000;

function ensureEnvFile(dataRoot) {
  const envFile = path.join(dataRoot, '.env');
  if (!fs.existsSync(envFile)) {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(envFile, [
      '# KLSyncBridge — generado por el instalador',
      `DATA_DIR=${path.join(dataRoot, 'data')}`,
      `LOG_DIR=${path.join(dataRoot, 'logs')}`,
      '',
    ].join('\n'));
  }
  return envFile;
}

/**
 * Borra los Setup descargados por actualizaciones anteriores. En una actualización el Setup que se está
 * ejecutando vive aquí y Windows lo bloquea: se borra lo que se pueda y nunca se falla por ello.
 */
function cleanUpdatesDir(updatesDir) {
  if (!fs.existsSync(updatesDir)) return;
  for (const name of fs.readdirSync(updatesDir)) {
    try {
      fs.rmSync(path.join(updatesDir, name), { recursive: true, force: true });
    } catch (err) {
      console.warn(`⚠️  No se pudo borrar ${name} (en uso; se borrará en la próxima actualización): ${err.code || err.message}`);
    }
  }
}

/** PORT del .env (si se cambió); si no, el de por defecto. */
function readPort(envFile) {
  const match = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : DEFAULT_PORT;
}

function healthOnce(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** Espera a que el servicio responda en /api/health; si no lo hace a tiempo, el Setup avisa (código de salida 1). */
async function waitForHealth(port, { timeoutMs = HEALTH_TIMEOUT_MS, pollMs = HEALTH_POLL_MS, check = healthOnce } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check(port)) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`El servicio no responde en http://127.0.0.1:${port}/api/health tras ${Math.round(timeoutMs / 1000)} s`);
}

/** true si Windows tiene registrado el servicio (sc.exe query sale con 1060 cuando no existe). */
function isServiceRegistered(serviceId = SERVICE_ID) {
  return queryServiceState(serviceId).installed;
}

/**
 * Borra el marcador de migración (legacy-migration.json) que deja la migración desde v2.2.0. Con el servicio nuevo
 * ya sano, un Setup posterior fallido nunca debe volver a la versión antigua por culpa de un marcador sobrante.
 */
function removeMigrationMarker(dataRoot) {
  const markerPath = path.join(dataRoot, 'legacy-migration.json');
  if (!fs.existsSync(markerPath)) return false;
  fs.rmSync(markerPath, { force: true });
  console.log(`🧹 Marcador de migración eliminado: ${markerPath}`);
  return true;
}

/**
 * Borra los ficheros del servicio (src\daemon) que deja una instalación anterior. node-windows decide si el
 * servicio "ya existe" mirando esos ficheros, no Windows: si quedan, no lo vuelve a crear y la instalación
 * acaba sin servicio. prepare.ps1 ya ha eliminado el servicio previo, así que aquí no debe seguir registrado;
 * si lo está, no se toca nada y se falla con un mensaje claro.
 */
function removeStaleDaemon(appRoot, { isRegistered = isServiceRegistered } = {}) {
  const daemonDir = path.join(appRoot, 'src', 'daemon');
  if (!fs.existsSync(daemonDir)) return false;
  if (isRegistered()) {
    throw new Error(`El servicio ${SERVICE_ID} sigue registrado en Windows: ciérralo (services.msc), reinicia el equipo y vuelve a ejecutar el instalador`);
  }
  fs.rmSync(daemonDir, { recursive: true, force: true });
  console.log(`🧹 Ficheros de servicio anteriores eliminados: ${daemonDir}`);
  return true;
}

function run(script, env) {
  execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', env });
}

async function main() {
  const dataRoot = process.argv[2];
  if (!dataRoot) {
    console.error('❌ Falta la carpeta de datos (argumento 1)');
    process.exit(1);
  }
  const envFile = ensureEnvFile(dataRoot);
  // DATA_DIR/LOG_DIR absolutos también como entorno: un .env migrado de v2.2.0 puede no tenerlos o tenerlos relativos.
  const env = {
    ...process.env,
    KLSYNC_ENV_FILE: envFile,
    DATA_DIR: path.join(dataRoot, 'data'),
    LOG_DIR: path.join(dataRoot, 'logs'),
  };
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.mkdirSync(env.LOG_DIR, { recursive: true });
  cleanUpdatesDir(path.join(dataRoot, 'updates'));

  run('setup.js', env);
  removeStaleDaemon(path.join(__dirname, '..'));
  run('install-service.js', env);

  const port = readPort(envFile);
  console.log(`▶ Esperando a que el servicio responda en el puerto ${port}...`);
  await waitForHealth(port);
  console.log('✅ Servicio en marcha y respondiendo');
  removeMigrationMarker(dataRoot);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Error en la post-instalación:', err.message);
    process.exit(1);
  });
}

module.exports = { ensureEnvFile, readPort, waitForHealth, cleanUpdatesDir, removeStaleDaemon, removeMigrationMarker };

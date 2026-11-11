'use strict';

const express = require('express');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../auth/auth.middleware');
const { success, fromError } = require('../../utils/response');
const { ForbiddenError, AppError } = require('../../utils/errors');
const { getDb } = require('../../config/database');
const logger = require('../../services/logger.service');
const { getUpdateMode } = require('./updaters/update-mode');
const { execSc } = require('../../utils/windows-console');
const { updateChecker, localVersion } = require('./update-check.service');
const { runLegacyZipUpdate } = require('./updaters/legacy-zip.updater');
const { runInstallerUpdate, runInstallerMigration } = require('./updaters/installer.updater');
const { checkMigrationPreconditions } = require('./updaters/installer-migration.preconditions');
const operationLock = require('./updaters/operation-lock');

const router = express.Router();
router.use(requireAuth);

function requireMaster(req, res, next) {
  const db = getDb();
  const user = db.prepare('SELECT is_master FROM users WHERE id = ?').get(req.user.sub);
  if (!user || !user.is_master) {
    return fromError(res, new ForbiddenError('Solo el administrador master puede ejecutar operaciones del sistema'));
  }
  return next();
}
router.use(requireMaster);

const ROOT = path.join(__dirname, '../../../');

// GET /api/system/privilege
// Verifica si el proceso corre con privilegios de Administrador de Windows
router.get('/privilege', (req, res) => {
  execFile('net', ['session'], { timeout: 4000 }, (err) => {
    const isAdmin = !err;
    const username = process.env.USERNAME || process.env.USER || 'desconocido';
    return success(res, { isAdmin, username });
  });
});

// GET /api/system/status
// Estado del servicio Windows via sc.exe
router.get('/status', (req, res) => {
  execSc(['query', 'klsyncbridge.exe'], { timeout: 8000 }, (err, stdout) => {
    if (err) {
      // sc devuelve exit 1060 si el servicio no existe
      const notInstalled = err.code === 1060 || (stdout && stdout.includes('1060'));
      if (notInstalled || (err.message && err.message.includes('1060'))) {
        return success(res, { installed: false, state: null, raw: null });
      }
      // sc devuelve texto aunque haya error en algunos casos — parsear igualmente
    }

    const text = stdout || '';
    const stateMatch = text.match(/(?:STATE|ESTADO|STATUS|ETAT|ÉTAT|STATO)\s*:\s*\d+\s+(\w+)/i);
    const state = stateMatch ? stateMatch[1] : 'UNKNOWN';
    return success(res, { installed: true, state, raw: text.trim() });
  });
});

// POST /api/system/start
// Inicia el servicio Windows (sc start)
router.post('/start', (req, res) => {
  logger.info('System: iniciando servicio Windows', { user: req.user.username });
  execSc(['start', 'klsyncbridge.exe'], { timeout: 15000 }, (err, stdout, stderr) => {
    const text = (stdout || '') + (stderr || '');
    if (err) {
      const alreadyRunning = err.code === 1056 || text.includes('1056');
      if (alreadyRunning) {
        return success(res, { message: 'El servicio ya estaba en ejecución', raw: text.trim() });
      }
      logger.error('System: error iniciando servicio', { error: err.message, code: err.code });
      return fromError(res, new AppError(`No se pudo iniciar el servicio: ${text.trim() || err.message}`, 'SERVICE_START_ERROR', 500));
    }
    logger.info('System: servicio iniciado correctamente');
    return success(res, { message: 'Servicio iniciado correctamente', raw: text.trim() });
  });
});

// POST /api/system/stop
// Detiene el servicio Windows (sc stop)
router.post('/stop', (req, res) => {
  logger.info('System: deteniendo servicio Windows', { user: req.user.username });
  execSc(['stop', 'klsyncbridge.exe'], { timeout: 15000 }, (err, stdout, stderr) => {
    const text = (stdout || '') + (stderr || '');
    if (err) {
      const alreadyStopped = err.code === 1062 || text.includes('1062');
      if (alreadyStopped) {
        return success(res, { message: 'El servicio ya estaba detenido', raw: text.trim() });
      }
      logger.error('System: error deteniendo servicio', { error: err.message, code: err.code });
      return fromError(res, new AppError(`No se pudo detener el servicio: ${text.trim() || err.message}`, 'SERVICE_STOP_ERROR', 500));
    }
    logger.info('System: servicio detenido correctamente');
    return success(res, { message: 'Servicio detenido correctamente', raw: text.trim() });
  });
});

// Ejecuta un script node y devuelve stdout+stderr como string
function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ROOT, 'scripts', scriptName);
    const node = process.execPath;
    let output = '';
    const child = spawn(node, [scriptPath], { cwd: ROOT });

    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        const err = new AppError(`Script ${scriptName} terminó con código ${code}. Output: ${output}`, 'SYSTEM_SCRIPT_ERROR', 500);
        return reject(err);
      }
      resolve(output);
    });

    child.on('error', err => reject(err));
  });
}

// Espera hasta que sc query devuelva el estado esperado (o timeout)
function waitForState(targetState, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      execSc(['query', 'klsyncbridge.exe'], { timeout: 5000 }, (err, stdout) => {
        const text = stdout || '';
        if (targetState === 'STOPPED' && (err || text.includes('1060'))) {
          return resolve(); // servicio no existe = parado/desinstalado
        }
        const stateMatch = text.match(/(?:STATE|ESTADO|STATUS|ETAT|ÉTAT|STATO)\s*:\s*\d+\s+(\w+)/i);
        const state = stateMatch ? stateMatch[1] : '';
        if (state === targetState) return resolve();
        if (Date.now() > deadline) return reject(new AppError(`Timeout esperando estado ${targetState}`, 'TIMEOUT', 500));
        setTimeout(check, 1500);
      });
    }
    check();
  });
}

// POST /api/system/install
router.post('/install', async (req, res) => {
  try {
    logger.info('System: instalando servicio Windows', { user: req.user.username });
    const output = await runScript('install-service.js');
    return success(res, { output });
  } catch (err) {
    logger.error('System: error instalando servicio', { error: err.message });
    return fromError(res, err);
  }
});

// POST /api/system/uninstall
router.post('/uninstall', async (req, res) => {
  try {
    logger.info('System: desinstalando servicio Windows', { user: req.user.username });
    const output = await runScript('uninstall-service.js');
    return success(res, { output });
  } catch (err) {
    logger.error('System: error desinstalando servicio', { error: err.message });
    return fromError(res, err);
  }
});

// POST /api/system/reinstall
// Uninstall + espera que desaparezca + install
router.post('/reinstall', async (req, res) => {
  try {
    logger.info('System: reinstalando servicio Windows', { user: req.user.username });
    let output = '';
    output += await runScript('uninstall-service.js');
    output += '\n--- Esperando desinstalación completa ---\n';
    await waitForState('STOPPED', 20000);
    output += await runScript('install-service.js');
    return success(res, { output });
  } catch (err) {
    logger.error('System: error reinstalando servicio', { error: err.message });
    return fromError(res, err);
  }
});

// POST /api/system/setup
// Ejecuta el setup (genera key si falta, inicializa DB, mantiene master existente)
router.post('/setup', async (req, res) => {
  try {
    logger.info('System: ejecutando setup', { user: req.user.username });
    const output = await runScript('setup.js');
    return success(res, { output });
  } catch (err) {
    logger.error('System: error en setup', { error: err.message });
    return fromError(res, err);
  }
});

// POST /api/system/create-shortcuts
// Recrea los accesos directos en Escritorio y Menú Inicio
router.post('/create-shortcuts', (req, res) => {
  const fs = require('fs');
  const os = require('os');

  const url = 'http://localhost:3847';
  const shortcutName = 'KLSyncBridge.url';
  const iconFile = path.join(ROOT, 'public', 'favicon.ico');
  const urlFileContent = `[InternetShortcut]\nURL=${url}\nIconFile=${iconFile}\nIconIndex=0\n`;

  const results = [];

  const desktopPath = path.join(os.homedir(), 'Desktop', shortcutName);
  try {
    fs.writeFileSync(desktopPath, urlFileContent, 'utf8');
    results.push(`✅ Acceso directo creado en Escritorio: ${desktopPath}`);
  } catch (err) {
    results.push(`⚠️  No se pudo crear en Escritorio: ${err.message}`);
  }

  const startMenuDir = path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'KLSyncBridge'
  );
  const startMenuPath = path.join(startMenuDir, shortcutName);
  try {
    fs.mkdirSync(startMenuDir, { recursive: true });
    fs.writeFileSync(startMenuPath, urlFileContent, 'utf8');
    results.push(`✅ Acceso directo creado en Menú Inicio: ${startMenuPath}`);
  } catch (err) {
    results.push(`⚠️  No se pudo crear en Menú Inicio: ${err.message}`);
  }

  const output = results.join('\n') + '\n';
  logger.info('System: accesos directos recreados', { user: req.user.username });
  return success(res, { output });
});

// ── Update system ─────────────────────────────────────────────────────────────

// GET /api/system/check-update
// Comprobación manual (botón «Buscar actualización»); nunca falla: el estado va en `status`
router.get('/check-update', async (req, res) => {
  const result = await updateChecker.checkNow();
  return success(res, result);
});

// POST /api/system/update
// Texto plano en streaming (res.write); la estrategia depende del tipo de instalación
router.post('/update', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  function log(msg) {
    res.write(msg + '\n');
    logger.info('System update: ' + msg);
  }

  if (!operationLock.tryAcquire()) {
    log('❌ Ya hay una actualización en curso; espera a que termine.');
    return res.end();
  }
  let launched = false;
  try {
    const mode = getUpdateMode();
    log(`▶ Modo de actualización: ${mode}`);
    if (mode === 'installer') {
      launched = await runInstallerUpdate({ res, log, localVersion });
      return undefined;
    }
    return await runLegacyZipUpdate({ res, log, localVersion, runScript });
  } finally {
    // Con el Setup lanzado el cerrojo se queda tomado: el proceso morirá al parar el servicio.
    if (!launched) operationLock.release();
  }
});

// GET /api/system/installer-migration
// ¿Puede esta instalación antigua pasar al instalador? Si no, devuelve los motivos.
router.get('/installer-migration', async (req, res) => {
  try {
    const result = await checkMigrationPreconditions();
    return success(res, { ...result, mode: getUpdateMode() });
  } catch (err) {
    logger.error('System: error comprobando el paso al instalador', { error: err.message });
    return fromError(res, err);
  }
});

// POST /api/system/migrate-to-installer
// Texto plano en streaming, igual que /update: descarga el Setup del Release y lo lanza en silencio.
router.post('/migrate-to-installer', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  function log(msg) {
    res.write(msg + '\n');
    logger.info('System migration: ' + msg);
  }

  if (!operationLock.tryAcquire()) {
    log('❌ Ya hay una actualización en curso; espera a que termine.');
    return res.end();
  }
  let launched = false;
  try {
    // El cerrojo ya es nuestro: no cuenta como «otra operación en curso».
    const check = await checkMigrationPreconditions({ isBusy: () => false });
    if (!check.available) {
      log('❌ No se puede pasar al instalador:');
      check.reasons.forEach((reason) => log(`   - ${reason}`));
      log('ℹ️ No se ha cambiado nada: sigue la instalación actual.');
      return res.end();
    }
    logger.info('System: paso al instalador solicitado', { user: req.user.username, version: localVersion() });
    launched = await runInstallerMigration({ res, log, localVersion, username: req.user.username });
    return undefined;
  } catch (err) {
    logger.error('System: error en el paso al instalador', { error: err.message });
    log(`❌ Error inesperado: ${err.message}`);
    return res.end();
  } finally {
    if (!launched) operationLock.release();
  }
});

module.exports = router;

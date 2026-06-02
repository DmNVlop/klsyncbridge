'use strict';

const express = require('express');
const { execFile, spawn } = require('child_process');
const path = require('path');
const { requireAuth } = require('../auth/auth.middleware');
const { success, fromError } = require('../../utils/response');
const { ForbiddenError, AppError } = require('../../utils/errors');
const { getDb } = require('../../config/database');
const logger = require('../../services/logger.service');

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

// GET /api/system/status
// Estado del servicio Windows via sc.exe
router.get('/status', (req, res) => {
  execFile('sc', ['query', 'klsyncbridge.exe'], { timeout: 8000 }, (err, stdout) => {
    if (err) {
      // sc devuelve exit 1060 si el servicio no existe
      const notInstalled = err.code === 1060 || (stdout && stdout.includes('1060'));
      if (notInstalled || (err.message && err.message.includes('1060'))) {
        return success(res, { installed: false, state: null, raw: null });
      }
      // sc devuelve texto aunque haya error en algunos casos — parsear igualmente
    }

    const text = stdout || '';
    const stateMatch = text.match(/STATE\s*:\s*\d+\s+(\w+)/);
    const state = stateMatch ? stateMatch[1] : 'UNKNOWN';
    return success(res, { installed: true, state, raw: text.trim() });
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
      execFile('sc', ['query', 'klsyncbridge.exe'], { timeout: 5000 }, (err, stdout) => {
        const text = stdout || '';
        if (targetState === 'STOPPED' && (err || text.includes('1060'))) {
          return resolve(); // servicio no existe = parado/desinstalado
        }
        const stateMatch = text.match(/STATE\s*:\s*\d+\s+(\w+)/);
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

module.exports = router;

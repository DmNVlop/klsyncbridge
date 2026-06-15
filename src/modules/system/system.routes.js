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
const axios = require('axios');

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
    const stateMatch = text.match(/(?:STATE|ESTADO|STATUS|ETAT|ÉTAT|STATO)\s*:\s*\d+\s+(\w+)/i);
    const state = stateMatch ? stateMatch[1] : 'UNKNOWN';
    return success(res, { installed: true, state, raw: text.trim() });
  });
});

// POST /api/system/start
// Inicia el servicio Windows (sc start)
router.post('/start', (req, res) => {
  logger.info('System: iniciando servicio Windows', { user: req.user.username });
  execFile('sc', ['start', 'klsyncbridge.exe'], { timeout: 15000 }, (err, stdout, stderr) => {
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
  execFile('sc', ['stop', 'klsyncbridge.exe'], { timeout: 15000 }, (err, stdout, stderr) => {
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
      execFile('sc', ['query', 'klsyncbridge.exe'], { timeout: 5000 }, (err, stdout) => {
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

const GITHUB_USER    = 'DmNVlop';
const GITHUB_REPO    = 'klsyncbridge';
const MANIFEST_URL   = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/master/version.json`;
const RELEASES_URL   = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/archive/refs/heads/master.zip`;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

// GET /api/system/check-update
router.get('/check-update', async (req, res) => {
  try {
    const current = localVersion();
    const { data: manifest } = await axios.get(MANIFEST_URL, { timeout: 8000 });
    const latest = manifest.version;
    const hasUpdate = compareVersions(latest, current) > 0;
    return success(res, { current, latest, hasUpdate, changelog: manifest.changelog || '', release_date: manifest.release_date || '' });
  } catch (err) {
    logger.warn('System: check-update falló', { error: err.message });
    return fromError(res, new AppError('No se pudo consultar el servidor de actualizaciones: ' + err.message, 'UPDATE_CHECK_FAILED', 502));
  }
});

// Limpia un directorio recursivamente pero preserva los archivos del wrapper del servicio Windows (klsyncbridge.*)
function cleanDirectoryExceptServiceFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      cleanDirectoryExceptServiceFiles(fullPath);
      try {
        fs.rmdirSync(fullPath);
      } catch (err) {
        // Ignorar si el directorio no quedó vacío (por contener archivos de servicio preservados)
      }
    } else {
      const isServiceFile = entry.name.toLowerCase().startsWith('klsyncbridge.');
      if (!isServiceFile) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          // Ignorar si el archivo está bloqueado o no se puede borrar
        }
      }
    }
  }
}

// Restaura la versión anterior desde el directorio de respaldo
async function restoreBackup(backupDir, ROOT, log) {
  log('\n⚠️ Iniciando restauración (rollback) de la versión anterior...');
  try {
    const COPY_DIRS  = ['src', 'public', 'scripts', 'docs'];
    const COPY_FILES = ['package.json', 'package-lock.json', 'version.json', '.env.example', '.gitignore', '.gitattributes'];

    // 1. Restaurar directorios
    for (const dir of COPY_DIRS) {
      const srcDir = path.join(backupDir, dir);
      const dstDir = path.join(ROOT, dir);
      if (fs.existsSync(srcDir)) {
        log(`   Restaurando carpeta ${dir}/...`);
        if (dir === 'src') {
          cleanDirectoryExceptServiceFiles(dstDir);
        } else if (fs.existsSync(dstDir)) {
          fs.rmSync(dstDir, { recursive: true, force: true });
        }
        fs.cpSync(srcDir, dstDir, { recursive: true, force: true });
      }
    }

    // 2. Restaurar archivos raíz
    for (const file of COPY_FILES) {
      const srcFile = path.join(backupDir, file);
      const dstFile = path.join(ROOT, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, dstFile);
      }
    }

    // 3. npm install
    log('   Restaurando dependencias (npm install)...');
    await new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install', '--omit=dev'], { cwd: ROOT, shell: true });
      npm.on('close', code => code === 0 ? resolve() : reject(new Error(`npm exit ${code}`)));
      npm.on('error', reject);
    });

    // 4. Migraciones
    log('   Re-aplicando configuraciones...');
    await runScript('setup.js');

    log('✅ Restauración completada con éxito. El sistema ha vuelto a su estado original.');
  } catch (err) {
    log(`❌ ERROR CRÍTICO DURANTE EL ROLLBACK: ${err.message}. El sistema puede estar en un estado inconsistente.`);
    logger.error('System update: critical rollback error', { error: err.message, stack: err.stack });
  }
}

// POST /api/system/update
// Descarga main.zip de GitHub, extrae sobre ROOT preservando data/ y logs/, corre npm install + setup, reinicia
router.post('/update', async (req, res) => {
  // Responde inmediatamente con SSE-like: headers flushed, luego el cliente hace polling de /check-update
  // En realidad usamos streaming de texto plano via res.write
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  function log(msg) {
    const line = msg + '\n';
    res.write(line);
    logger.info('System update: ' + msg);
  }

  const tmpDir = path.join(ROOT, 'temp');
  const backupDir = path.join(tmpDir, 'backup');
  const zipPath = path.join(tmpDir, 'update.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  let backupCreated = false;

  try {
    const current = localVersion();
    log(`▶ Iniciando actualización desde v${current}`);

    // Limpiar restos anteriores de temp
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // Ignorar si temp está bloqueado temporalmente
      }
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    log(`▶ Descargando desde ${RELEASES_URL} ...`);
    const writer = fs.createWriteStream(zipPath);
    const response = await axios.get(RELEASES_URL, { responseType: 'stream', timeout: 60000 });
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    log('✅ ZIP descargado');

    log('▶ Extrayendo archivos...');
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ], { cwd: ROOT });
      ps.on('close', code => code === 0 ? resolve() : reject(new Error(`PowerShell exit ${code}`)));
      ps.on('error', reject);
    });
    log('✅ ZIP extraído');

    // Validar contenido del ZIP extraído antes de modificar nada
    const entries = fs.readdirSync(extractDir);
    const innerDir = entries.length === 1 ? path.join(extractDir, entries[0]) : extractDir;
    if (!fs.existsSync(path.join(innerDir, 'src')) || !fs.existsSync(path.join(innerDir, 'package.json'))) {
      throw new Error('El paquete descargado no contiene una estructura válida de KLSyncBridge.');
    }

    // --- PASO DE RESPALDO (BACKUP) ---
    log('▶ Creando respaldo de seguridad del sistema actual...');
    fs.mkdirSync(backupDir, { recursive: true });
    
    const COPY_DIRS  = ['src', 'public', 'scripts', 'docs'];
    const COPY_FILES = ['package.json', 'package-lock.json', 'version.json', '.env.example', '.gitignore', '.gitattributes'];

    for (const dir of COPY_DIRS) {
      const dstDir = path.join(ROOT, dir);
      const backupDstDir = path.join(backupDir, dir);
      if (fs.existsSync(dstDir)) {
        fs.mkdirSync(backupDstDir, { recursive: true });
        fs.cpSync(dstDir, backupDstDir, { recursive: true });
      }
    }
    for (const file of COPY_FILES) {
      const dstFile = path.join(ROOT, file);
      const backupDstFile = path.join(backupDir, file);
      if (fs.existsSync(dstFile)) {
        fs.copyFileSync(dstFile, backupDstFile);
      }
    }
    backupCreated = true;
    log('✅ Respaldo creado correctamente');

    // --- PASO DE INSTALACIÓN ---
    log('▶ Aplicando archivos nuevos...');
    for (const dir of COPY_DIRS) {
      const src = path.join(innerDir, dir);
      const dst = path.join(ROOT, dir);
      if (!fs.existsSync(src)) continue;

      // Respaldar archivos del servicio (klsyncbridge.* o KLSyncBridge.*) de node-windows si es 'src'
      const serviceFiles = [];
      if (dir === 'src' && fs.existsSync(dst)) {
        try {
          const files = fs.readdirSync(dst);
          for (const file of files) {
            if (file.toLowerCase().startsWith('klsyncbridge.')) {
              const content = fs.readFileSync(path.join(dst, file));
              serviceFiles.push({ file, content });
            }
          }
        } catch (err) {
          log(`⚠️ Advertencia al respaldar archivos de servicio: ${err.message}`);
        }
      }

      if (dir === 'src' && fs.existsSync(dst)) {
        cleanDirectoryExceptServiceFiles(dst);
      } else if (fs.existsSync(dst)) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      fs.cpSync(src, dst, { recursive: true });

      // Restaurar archivos del servicio (solo si no existen, para evitar sobrescribir el ejecutable bloqueado)
      if (dir === 'src' && serviceFiles.length > 0) {
        try {
          let restoredCount = 0;
          for (const sFile of serviceFiles) {
            const destFilePath = path.join(dst, sFile.file);
            if (!fs.existsSync(destFilePath)) {
              fs.writeFileSync(destFilePath, sFile.content);
              restoredCount++;
            }
          }
          if (restoredCount > 0) {
            log(`✅ Restaurados ${restoredCount} archivos del wrapper de servicio`);
          }
        } catch (err) {
          log(`⚠️ Error al restaurar archivos de servicio: ${err.message}`);
        }
      }
      log(`✅ Copiado ${dir}/`);
    }

    for (const file of COPY_FILES) {
      const src = path.join(innerDir, file);
      const dst = path.join(ROOT, file);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, dst);
    }
    log('✅ Archivos copiados');

    // npm install
    log('▶ Instalando dependencias (npm install)...');
    await new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install', '--omit=dev'], { cwd: ROOT, shell: true });
      npm.stdout.on('data', d => res.write(d.toString()));
      npm.stderr.on('data', d => res.write(d.toString()));
      npm.on('close', code => code === 0 ? resolve() : reject(new Error(`npm exit ${code}`)));
      npm.on('error', reject);
    });
    log('✅ Dependencias instaladas');

    // Migraciones DB
    log('▶ Aplicando migraciones de base de datos...');
    await runScript('setup.js');
    log('✅ Migraciones aplicadas');

    // Limpiar temp (incluyendo el backup exitoso)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignorar si algún archivo está temporalmente bloqueado
    }

    const newVersion = localVersion();
    log(`\n✅ Actualización completada — v${newVersion}`);
    log('▶ Reiniciando servicio...');
    res.end();

    // Reiniciar después de responder
    setTimeout(() => {
      try {
        // Generamos un proceso cmd.exe desacoplado (detached) que esperará 5 segundos
        // (dando tiempo a que este servicio se detenga por completo) y luego lo iniciará.
        const { spawn } = require('child_process');
        const child = spawn('cmd.exe', [
          '/c',
          'ping 127.0.0.1 -n 6 >nul && sc start klsyncbridge.exe'
        ], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        // Ordenamos al Service Control Manager de Windows detener el servicio actual.
        // Al detenerse, este proceso Node.js y el wrapper finalizarán, pero el cmd.exe
        // desacoplado continuará corriendo en background para iniciarlo de nuevo.
        execFile('sc', ['stop', 'klsyncbridge.exe'], () => {
          process.exit(0);
        });
      } catch (err) {
        process.exit(0);
      }
    }, 500);

  } catch (err) {
    logger.error('System update: error during update', { error: err.message, stack: err.stack });
    log(`\n❌ Error durante la actualización: ${err.message}`);

    if (backupCreated) {
      await restoreBackup(backupDir, ROOT, log);
    } else {
      log('ℹ️ No se realizaron cambios en el sistema, no es necesario hacer rollback.');
    }

    // Limpiar temp/extracted y update.zip para no dejar basura
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (e) {}

    res.end();
  }
});

module.exports = router;

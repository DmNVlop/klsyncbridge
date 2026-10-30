'use strict';

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const logger = require('../../../services/logger.service');
const { LEGACY_ZIP_URL } = require('./manifest');

// Actualización de instalaciones antiguas (carpeta propia): ZIP de master + npm install + setup.js.
// Movido tal cual desde system.routes.js; se retirará cuando no quede ninguna fábrica en este modo.
const ROOT = path.join(__dirname, '../../../../');
const RELEASES_URL = LEGACY_ZIP_URL;

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
async function restoreBackup(backupDir, ROOT, log, runScript) {
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

// Descarga el ZIP de master, extrae sobre ROOT preservando data/ y logs/, corre npm install + setup, reinicia
async function runLegacyZipUpdate({ res, log, localVersion, runScript }) {
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
      await restoreBackup(backupDir, ROOT, log, runScript);
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
}

module.exports = { runLegacyZipUpdate };

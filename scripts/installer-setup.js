'use strict';

/**
 * Post-instalación del Setup: .env en ProgramData, migraciones y registro del servicio.
 * Uso: node.exe scripts\installer-setup.js "<ProgramData>\KLSyncBridge"
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

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

function run(script, env) {
  execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', env });
}

function main() {
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
  fs.rmSync(path.join(dataRoot, 'updates'), { recursive: true, force: true });

  run('setup.js', env);
  run('install-service.js', env);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('❌ Error en la post-instalación:', err.message);
    process.exit(1);
  }
}

module.exports = { ensureEnvFile };

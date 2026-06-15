'use strict';

/**
 * Script de automatización de releases para KLSyncBridge.
 * 
 * Este script realiza las siguientes acciones:
 * 1. Valida que el entorno git sea adecuado (estado limpio, rama correcta).
 * 2. Calcula la siguiente versión (major, minor, patch o versión personalizada).
 * 3. Solicita o genera el changelog correspondiente.
 * 4. Actualiza version.json y package.json de forma atómica y segura.
 * 5. Realiza el commit de release y crea el tag de git correspondiente.
 * 
 * Uso:
 *   node scripts/release.js [patch|minor|major|version_custom]
 *   npm run release -- [patch|minor|major]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Asegurar que estamos trabajando en la raíz del proyecto
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

// Configuración por defecto
const GITHUB_USER = 'DmNVlop';
const GITHUB_REPO = 'klsyncbridge';
const DEFAULT_BRANCH = 'master';

// Colores para consola
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Utilidad para formatear la consola
function logInfo(msg) { console.log(`${COLORS.cyan}ℹ️  ${msg}${COLORS.reset}`); }
function logSuccess(msg) { console.log(`${COLORS.green}✅ ${msg}${COLORS.reset}`); }
function logWarn(msg) { console.log(`${COLORS.yellow}⚠️  ${msg}${COLORS.reset}`); }
function logError(msg) { console.error(`${COLORS.red}❌ Error: ${msg}${COLORS.reset}`); }
function logStep(step, msg) { console.log(`\n${COLORS.bright}${COLORS.magenta}[${step}] ${msg}${COLORS.reset}`); }

// Parsear argumentos de la línea de comandos
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  return (index !== -1 && index + 1 < args.length) ? args[index + 1] : null;
};

const IS_DRY_RUN = hasFlag('--dry-run');
const ALLOW_DIRTY = hasFlag('--allow-dirty');
const ALLOW_ANY_BRANCH = hasFlag('--allow-any-branch');
const NO_TAG = hasFlag('--no-tag');
const NO_COMMIT = hasFlag('--no-commit');
const YES_MODE = hasFlag('--yes') || hasFlag('-y');

// Obtener argumento posicional para la versión o incremento
let versionArg = args.find(arg => !arg.startsWith('-'));

/**
 * Pregunta al usuario por consola de forma interactiva.
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

/**
 * Pregunta multilínea para el changelog.
 */
async function askChangelog() {
  console.log(`${COLORS.cyan}Escribe el changelog (presiona Enter en una línea vacía para finalizar):${COLORS.reset}`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    let lines = [];
    rl.on('line', (line) => {
      if (line.trim() === '') {
        rl.close();
        resolve(lines.map(l => `- ${l.trim().replace(/^-\s*/, '')}`).join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
}

/**
 * Ejecuta un comando y devuelve su output
 */
function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (err) {
    throw new Error(`El comando "${command}" falló: ${err.message}`);
  }
}

/**
 * Valida la sintaxis de la versión.
 */
function isValidVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

/**
 * Incrementa la versión según el tipo.
 */
function semverIncrement(current, type) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3) return null;

  switch (type.toLowerCase()) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      return null;
  }
}

/**
 * Compara dos versiones semver.
 * Devuelve > 0 si a > b, 0 si a == b, < 0 si a < b.
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function main() {
  console.log(`${COLORS.bright}${COLORS.magenta}====================================================`);
  console.log('       KLSyncBridge — Release Automation Script');
  console.log(`====================================================${COLORS.reset}`);
  
  if (IS_DRY_RUN) {
    logWarn('MODO DRY-RUN ACTIVO. No se realizarán cambios reales.');
  }

  // --- PASO 1: Validar entorno Git ---
  logStep('1/6', 'Validando entorno Git...');
  
  try {
    runCommand('git rev-parse --is-inside-work-tree');
  } catch {
    logError('Este directorio no parece ser un repositorio Git.');
    process.exit(1);
  }

  // Validar si la rama actual es la por defecto (main)
  const currentBranch = runCommand('git branch --show-current');
  logInfo(`Rama actual: ${currentBranch}`);
  
  if (currentBranch !== DEFAULT_BRANCH && !ALLOW_ANY_BRANCH) {
    logError(`No estás en la rama "${DEFAULT_BRANCH}" (rama actual: "${currentBranch}").`);
    logInfo('Los releases deben hacerse preferiblemente desde la rama principal.');
    logInfo('Usa el flag --allow-any-branch para saltar esta validación.');
    process.exit(1);
  }

  // Validar estado limpio de Git
  const gitStatus = runCommand('git status --porcelain');
  if (gitStatus && !ALLOW_DIRTY) {
    logError('El repositorio tiene cambios sin confirmar. Por favor haz commit o descarta los cambios.');
    console.log(gitStatus);
    logInfo('Usa el flag --allow-dirty si deseas continuar de todas formas (no recomendado).');
    process.exit(1);
  } else if (gitStatus) {
    logWarn('El repositorio no está limpio, pero --allow-dirty está activo.');
  } else {
    logSuccess('El estado de Git está limpio.');
  }

  // --- PASO 2: Leer versiones actuales ---
  logStep('2/6', 'Leyendo versiones actuales...');
  
  const packageJsonPath = path.join(ROOT, 'package.json');
  const versionJsonPath = path.join(ROOT, 'version.json');

  if (!fs.existsSync(packageJsonPath)) {
    logError('No se encontró el archivo package.json.');
    process.exit(1);
  }
  if (!fs.existsSync(versionJsonPath)) {
    logError('No se encontró el archivo version.json.');
    process.exit(1);
  }

  const pkgContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const verContent = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));

  const currentPkgVersion = pkgContent.version || '0.0.0';
  const currentVerVersion = verContent.version || '0.0.0';

  logInfo(`Versión actual en package.json: ${currentPkgVersion}`);
  logInfo(`Versión actual en version.json: ${currentVerVersion}`);

  if (currentPkgVersion !== currentVerVersion) {
    logWarn(`Discrepancia detectada: package.json (${currentPkgVersion}) y version.json (${currentVerVersion}) no coinciden.`);
  }

  const baseVersion = compareVersions(currentPkgVersion, currentVerVersion) >= 0 ? currentPkgVersion : currentVerVersion;
  logInfo(`Versión base para el incremento: ${baseVersion}`);

  // --- PASO 3: Calcular nueva versión ---
  logStep('3/6', 'Determinando la nueva versión...');
  
  let nextVersion = '';

  if (versionArg) {
    if (['major', 'minor', 'patch'].includes(versionArg.toLowerCase())) {
      nextVersion = semverIncrement(baseVersion, versionArg);
    } else if (isValidVersion(versionArg)) {
      nextVersion = versionArg;
    } else {
      logError(`Tipo de versión o incremento no válido: "${versionArg}". Debe ser "major", "minor", "patch" o una versión "X.Y.Z".`);
      process.exit(1);
    }
  }

  // Si no se pasó argumento o no es válido, preguntar interactivamente si no estamos en YES_MODE
  if (!nextVersion) {
    if (YES_MODE) {
      // Por defecto en YES_MODE, si no hay argumentos, incrementamos patch
      nextVersion = semverIncrement(baseVersion, 'patch');
      logInfo(`Usando incremento por defecto (patch) debido a --yes: ${nextVersion}`);
    } else {
      console.log('\nSelecciona cómo deseas incrementar la versión:');
      console.log(`  1) patch (${semverIncrement(baseVersion, 'patch')})`);
      console.log(`  2) minor (${semverIncrement(baseVersion, 'minor')})`);
      console.log(`  3) major (${semverIncrement(baseVersion, 'major')})`);
      console.log('  4) Personalizada');
      
      const option = await askQuestion('\nElige una opción (1-4) o escribe la versión directamente: ');
      
      if (option === '1' || option.toLowerCase() === 'patch') {
        nextVersion = semverIncrement(baseVersion, 'patch');
      } else if (option === '2' || option.toLowerCase() === 'minor') {
        nextVersion = semverIncrement(baseVersion, 'minor');
      } else if (option === '3' || option.toLowerCase() === 'major') {
        nextVersion = semverIncrement(baseVersion, 'major');
      } else if (option === '4' || option.toLowerCase() === 'personalizada') {
        const custom = await askQuestion('Escribe la nueva versión (ej: 1.1.0): ');
        nextVersion = custom.trim();
      } else if (isValidVersion(option.trim())) {
        nextVersion = option.trim();
      } else {
        logError('Opción inválida.');
        process.exit(1);
      }
    }
  }

  if (!isValidVersion(nextVersion)) {
    logError(`La versión final calculada no tiene un formato semver válido: "${nextVersion}"`);
    process.exit(1);
  }

  if (compareVersions(nextVersion, baseVersion) <= 0) {
    logWarn(`La nueva versión (${nextVersion}) es menor o igual a la versión base (${baseVersion}).`);
    if (!YES_MODE) {
      const confirm = await askQuestion('¿Estás seguro de que deseas continuar con esta versión? (s/n): ');
      if (confirm.toLowerCase() !== 's' && confirm.toLowerCase() !== 'si' && confirm.toLowerCase() !== 'y') {
        logInfo('Cancelado por el usuario.');
        process.exit(0);
      }
    }
  }

  logSuccess(`Nueva versión objetivo: ${nextVersion}`);

  // --- PASO 4: Obtener changelog ---
  logStep('4/6', 'Recopilando notas de la versión (changelog)...');
  
  let changelog = getFlagValue('--changelog');
  
  if (!changelog) {
    if (YES_MODE) {
      changelog = `- Actualización a la versión ${nextVersion}`;
      logInfo(`Usando changelog por defecto: ${changelog}`);
    } else {
      changelog = await askChangelog();
      if (!changelog.trim()) {
        changelog = `- Actualización de mantenimiento v${nextVersion}`;
        logInfo(`Changelog vacío, usando por defecto: ${changelog}`);
      }
    }
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const releaseDate = `${year}-${month}-${day}`;

  logInfo(`Fecha de lanzamiento calculada: ${releaseDate}`);
  console.log(`${COLORS.cyan}Changelog a registrar:${COLORS.reset}\n${changelog}\n`);

  // --- PASO 5: Actualizar archivos en disco ---
  logStep('5/6', 'Actualizando archivos de configuración...');

  pkgContent.version = nextVersion;
  
  verContent.version = nextVersion;
  verContent.release_date = releaseDate;
  verContent.changelog = changelog;

  if (IS_DRY_RUN) {
    console.log(`\n--- package.json (SIMULADO) ---`);
    console.log(JSON.stringify(pkgContent, null, 2));
    console.log(`\n--- version.json (SIMULADO) ---`);
    console.log(JSON.stringify(verContent, null, 2));
  } else {
    try {
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkgContent, null, 2) + '\n', 'utf8');
      logSuccess('package.json actualizado correctamente.');
      
      fs.writeFileSync(versionJsonPath, JSON.stringify(verContent, null, 2) + '\n', 'utf8');
      logSuccess('version.json actualizado correctamente.');
    } catch (err) {
      logError(`Error al escribir los archivos: ${err.message}`);
      process.exit(1);
    }
  }

  // --- PASO 6: Git Commit y Tag ---
  logStep('6/6', 'Realizando operaciones en Git...');
  
  const commitMessage = `chore(release): v${nextVersion}`;
  const tagName = `v${nextVersion}`;

  if (IS_DRY_RUN) {
    logInfo(`[Dry Run] Se habría ejecutado: git add package.json version.json`);
    logInfo(`[Dry Run] Se habría ejecutado: git commit -m "${commitMessage}"`);
    logInfo(`[Dry Run] Se habría ejecutado: git tag -a ${tagName} -m "Release ${tagName}"`);
  } else {
    try {
      if (!NO_COMMIT) {
        logInfo('Agregando archivos a Git...');
        runCommand('git add package.json version.json');
        
        logInfo('Creando commit de release...');
        runCommand(`git commit -m "${commitMessage}"`);
        logSuccess(`Commit creado: "${commitMessage}"`);
        
        if (!NO_TAG) {
          logInfo(`Creando tag ${tagName}...`);
          runCommand(`git tag -a ${tagName} -m "Release ${tagName}"`);
          logSuccess(`Tag creado: ${tagName}`);
        } else {
          logWarn('Omitiendo la creación del tag (--no-tag activo).');
        }
      } else {
        logWarn('Omitiendo commit y tag (--no-commit activo).');
      }
    } catch (err) {
      logError(`Fallo en operaciones de Git: ${err.message}`);
      logWarn('Los archivos en disco ya fueron modificados, pero git no pudo completarse.');
      process.exit(1);
    }
  }

  console.log(`\n${COLORS.bright}${COLORS.green}====================================================`);
  console.log(`🎉 RELEASE v${nextVersion} PREPARADO CON ÉXITO!`);
  console.log(`====================================================${COLORS.reset}\n`);

  if (!IS_DRY_RUN && !NO_COMMIT) {
    console.log(`${COLORS.bright}Para publicar esta versión y que esté disponible para auto-update, ejecuta:${COLORS.reset}`);
    console.log(`\n  ${COLORS.cyan}git push origin ${currentBranch} --tags${COLORS.reset}\n`);
    logWarn(`Recuerda que el repositorio de GitHub (${GITHUB_USER}/${GITHUB_REPO}) DEBE ser público.`);
  }
}

main().catch((err) => {
  logError(`Excepción no controlada: ${err.message}`);
  process.exit(1);
});

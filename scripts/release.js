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
 *   node scripts/release.js [patch|minor|major|rc|version_custom]
 *   npm run release -- [patch|minor|major|rc]
 *   npm run release -- 2.4.0-rc.1 --allow-any-branch   (prerelease explícito)
 *
 * Prereleases: solo el identificador "rc" (X.Y.Z-rc.N, N >= 1). El tag vX.Y.Z-rc.N
 * lo publica el workflow release.yml como prerelease de GitHub (cualquier tag con "-").
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Raíz del proyecto (el chdir se hace en main para poder importar el módulo en tests)
const ROOT = path.join(__dirname, '..');

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

const VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]\d*))?$/;

/**
 * Descompone una versión "X.Y.Z" o "X.Y.Z-rc.N".
 * Devuelve { major, minor, patch, rc } (rc = null si es estable) o null si no es válida.
 */
function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = VERSION_REGEX.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: m[4] === undefined ? null : Number(m[4]),
  };
}

/**
 * Valida la sintaxis de la versión (estable X.Y.Z o prerelease X.Y.Z-rc.N con N >= 1).
 */
function isValidVersion(v) {
  return parseVersion(v) !== null;
}

/**
 * Mensaje claro de por qué una versión no es válida.
 */
function describeInvalidVersion(v) {
  if (/^\d+\.\d+\.\d+-/.test(v)) {
    return `Prerelease no soportado: "${v}". Solo se admite el identificador "rc" con número >= 1 (ej: 2.4.0-rc.1).`;
  }
  return `Versión no válida: "${v}". Usa "X.Y.Z" o "X.Y.Z-rc.N".`;
}

/**
 * Incrementa la versión según el tipo (major, minor, patch, rc).
 * Reglas semver desde una base rc (X.Y.Z-rc.N):
 *   - patch => X.Y.Z (finaliza el prerelease)
 *   - minor => X.Y.0 si Z es 0 (finaliza), si no X.(Y+1).0
 *   - major => X.0.0 si Y y Z son 0 (finaliza), si no (X+1).0.0
 *   - rc    => X.Y.Z-rc.(N+1)
 * Desde una base estable, "rc" no se puede calcular (la siguiente base es decisión
 * humana): devuelve null y el llamador pide una versión explícita.
 * Devuelve null si la versión actual o el tipo no son válidos.
 */
function semverIncrement(current, type) {
  const v = parseVersion(current);
  if (!v || typeof type !== 'string') return null;
  const { major, minor, patch, rc } = v;
  const isPre = rc !== null;

  switch (type.toLowerCase()) {
    case 'major':
      if (isPre && minor === 0 && patch === 0) return `${major}.0.0`;
      return `${major + 1}.0.0`;
    case 'minor':
      if (isPre && patch === 0) return `${major}.${minor}.0`;
      return `${major}.${minor + 1}.0`;
    case 'patch':
      if (isPre) return `${major}.${minor}.${patch}`;
      return `${major}.${minor}.${patch + 1}`;
    case 'rc':
      if (!isPre) return null;
      return `${major}.${minor}.${patch}-rc.${rc + 1}`;
    default:
      return null;
  }
}

/**
 * Compara dos versiones semver (con soporte de -rc.N).
 * Devuelve > 0 si a > b, 0 si a == b, < 0 si a < b.
 * Un rc es menor que la estable de la misma base; los rc se comparan numéricamente.
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    throw new Error(`No se pueden comparar versiones no válidas: "${a}" y "${b}"`);
  }
  for (const key of ['major', 'minor', 'patch']) {
    const diff = va[key] - vb[key];
    if (diff !== 0) return diff;
  }
  if (va.rc === vb.rc) return 0;
  if (va.rc === null) return 1;
  if (vb.rc === null) return -1;
  return va.rc - vb.rc;
}

async function main() {
  // Asegurar que estamos trabajando en la raíz del proyecto
  process.chdir(ROOT);

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
    if (['major', 'minor', 'patch', 'rc'].includes(versionArg.toLowerCase())) {
      nextVersion = semverIncrement(baseVersion, versionArg);
      if (!nextVersion) {
        // Solo ocurre con "rc" desde una versión estable
        logError(`La versión actual (${baseVersion}) es estable: no se puede calcular el siguiente rc, porque la próxima versión base (minor/patch) es una decisión tuya.`);
        logInfo('Indica la versión explícita, por ejemplo: npm run release -- 2.4.0-rc.1');
        process.exit(1);
      }
    } else if (isValidVersion(versionArg)) {
      nextVersion = versionArg;
    } else if (/^\d+\.\d+\.\d+-/.test(versionArg)) {
      logError(describeInvalidVersion(versionArg));
      process.exit(1);
    } else {
      logError(`Tipo de versión o incremento no válido: "${versionArg}". Debe ser "major", "minor", "patch", "rc" o una versión "X.Y.Z" / "X.Y.Z-rc.N".`);
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
      const baseIsRc = parseVersion(baseVersion).rc !== null;
      console.log('\nSelecciona cómo deseas incrementar la versión:');
      if (baseIsRc) {
        // Base rc: el siguiente rc es la opción 1; patch finaliza el prerelease
        console.log(`  1) rc (${semverIncrement(baseVersion, 'rc')})`);
        console.log(`  2) patch / finalizar (${semverIncrement(baseVersion, 'patch')})`);
        console.log(`  3) minor (${semverIncrement(baseVersion, 'minor')})`);
        console.log(`  4) major (${semverIncrement(baseVersion, 'major')})`);
        console.log('  5) Personalizada');
      } else {
        console.log(`  1) patch (${semverIncrement(baseVersion, 'patch')})`);
        console.log(`  2) minor (${semverIncrement(baseVersion, 'minor')})`);
        console.log(`  3) major (${semverIncrement(baseVersion, 'major')})`);
        console.log('  4) Personalizada');
      }

      const customOption = baseIsRc ? '5' : '4';
      const optionsByNumber = baseIsRc
        ? { '1': 'rc', '2': 'patch', '3': 'minor', '4': 'major' }
        : { '1': 'patch', '2': 'minor', '3': 'major' };
      const option = (await askQuestion(`\nElige una opción (1-${customOption}) o escribe la versión directamente: `)).trim();
      const incrementType = optionsByNumber[option]
        || (['patch', 'minor', 'major', 'rc'].includes(option.toLowerCase()) ? option.toLowerCase() : null);

      if (incrementType) {
        nextVersion = semverIncrement(baseVersion, incrementType);
        if (!nextVersion) {
          logError(`La versión actual (${baseVersion}) es estable: para un rc indica la versión explícita, por ejemplo: npm run release -- 2.4.0-rc.1`);
          process.exit(1);
        }
      } else if (option === customOption || option.toLowerCase() === 'personalizada') {
        const custom = await askQuestion('Escribe la nueva versión (ej: 1.1.0 o 2.4.0-rc.1): ');
        nextVersion = custom.trim();
      } else if (isValidVersion(option)) {
        nextVersion = option;
      } else {
        logError('Opción inválida.');
        process.exit(1);
      }
    }
  }

  if (!isValidVersion(nextVersion)) {
    logError(`La versión final calculada no es válida. ${describeInvalidVersion(nextVersion)}`);
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

module.exports = { parseVersion, isValidVersion, describeInvalidVersion, semverIncrement, compareVersions };

if (require.main === module) {
  main().catch((err) => {
    logError(`Excepción no controlada: ${err.message}`);
    process.exit(1);
  });
}

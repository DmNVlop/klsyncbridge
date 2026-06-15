'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const env = require('./config/env');
const logger = require('./services/logger.service');
const { initDatabase, closeDatabase } = require('./config/database');
const { createServer } = require('./server');

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
});

async function main() {
  logger.info('Iniciando KLSyncBridge...', { env: env.NODE_ENV, port: env.PORT });

  // Verificar setup completo
  const { generateKey } = require('./services/encryption.service');
  generateKey(); // no-op si ya existe

  // Inicializar DB
  const db = initDatabase();
  const setupRow = db.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get();
  if (!setupRow || setupRow.value !== 'true') {
    logger.warn('Setup no completado. Ejecutar: node scripts/setup.js');
  }

  // Crear y arrancar Express
  const app = createServer();

  const server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info(`KLSyncBridge escuchando en http://localhost:${env.PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Puerto ${env.PORT} ya está en uso. ¿Hay otra instancia corriendo?`, { error: err.message });
    } else {
      logger.error('Error en servidor HTTP', { error: err.message });
    }
    process.exit(1);
  });

  // Iniciar scheduler
  const { initScheduler, stopScheduler } = require('./modules/jobs/jobs.scheduler');
  await initScheduler();
  logger.info('Scheduler iniciado');

  // Cleanup automático de integration_logs al arrancar (TTL 90 días por defecto)
  try {
    const { runScheduledCleanup } = require('./modules/logs/logs.service');
    const cleanupResult = runScheduledCleanup();
    if (cleanupResult.deleted > 0) {
      logger.info('Cleanup integration_logs completado', { deleted: cleanupResult.deleted });
    }
  } catch (cleanupErr) {
    logger.warn('Error en cleanup de integration_logs', { error: cleanupErr.message });
  }

  // Graceful shutdown — idempotente, una sola ejecución por proceso
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Señal ${signal} recibida. Cerrando...`);

    stopScheduler();

    server.close(() => {
      logger.info('Servidor HTTP cerrado');
      closeDatabase();
      logger.info('Apagado completado');
      process.exit(0);
    });

    // Forzar cierre tras 10 segundos
    setTimeout(() => {
      logger.warn('Cierre forzado tras 10 segundos');
      process.exit(1);
    }, 10000).unref();
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Error fatal al iniciar', { error: err.message, stack: err.stack });
  process.exit(1);
});

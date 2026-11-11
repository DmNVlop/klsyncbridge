'use strict';

const express = require('express');
const path = require('path');
const { fromError, success } = require('./utils/response');
const logger = require('./services/logger.service');
const { ForbiddenError, AppError } = require('./utils/errors');
const { requireAuth } = require('./modules/auth/auth.middleware');
const { getDb } = require('./config/database');
const { updateChecker, localVersion } = require('./modules/system/update-check.service');
const { getUpdateMode } = require('./modules/system/updaters/update-mode');
const eventsService = require('./services/events.service');

function createServer() {
  const app = express();

  // Middleware: solo localhost
  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowed.some(a => ip.includes(a))) {
      return fromError(res, new ForbiddenError('Acceso solo desde localhost'));
    }
    return next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Archivos estáticos
  app.use(express.static(path.join(__dirname, '../public')));

  // Versión pública (sin auth — usada por login.html)
  app.get('/api/version', (_req, res) => {
    try {
      const pkg = require('../package.json');
      return res.json({ ok: true, data: { version: pkg.version } });
    } catch {
      return res.json({ ok: true, data: { version: '0.0.0' } });
    }
  });

  // Salud (sin auth): la usan el Setup y la UI para saber que el servicio ha vuelto tras instalar o actualizar
  app.get('/api/health', (_req, res) => {
    try {
      getDb().prepare('SELECT 1').get();
      return success(res, { status: 'up', version: localVersion(), uptimeSeconds: Math.round(process.uptime()), updateMode: getUpdateMode() });
    } catch (err) {
      return fromError(res, new AppError('Base de datos no disponible: ' + err.message, 'HEALTH_DB_DOWN', 503));
    }
  });

  // Último resultado de la comprobación periódica de actualizaciones (sin salir a internet); lo pinta el aviso de la UI
  app.get('/api/update-status', requireAuth, (_req, res) => success(res, updateChecker.getLastResult()));

  // SSE — eventos en tiempo real
  app.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Heartbeat cada 25s para mantener la conexión viva
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);

    eventsService.addClient(res);

    req.on('close', () => {
      clearInterval(heartbeat);
      eventsService.removeClient(res);
    });
  });

  // Rutas de la API
  app.use('/api/auth', require('./modules/auth/auth.routes'));
  app.use('/api/users', require('./modules/users/users.routes'));
  app.use('/api/connections', require('./modules/connections/connections.routes'));
  app.use('/api/api-configs', require('./modules/api-configs/api-configs.routes'));
  app.use('/api/network-credentials', require('./modules/credentials/credentials.routes'));
  app.use('/api/jobs',require('./modules/jobs/jobs.routes'));
  app.use('/api/automations', require('./modules/automations/automations.routes'));
  app.use('/api/automation-types', require('./modules/automations/automation-types.routes'));
  app.use('/api/work-items', require('./modules/automations/work-items.routes'));
  app.use('/api/logs', require('./modules/logs/logs.routes'));
  app.use('/api/system', require('./modules/system/system.routes'));

  // Rutas UI → HTML correspondiente
  const pages = {
    '/login': 'login.html',
    '/dashboard': 'dashboard.html',
    '/jobs': 'jobs.html',
    '/connections': 'connections.html',
    '/api-configs': 'api-configs.html',
    '/logs': 'logs.html',
    '/users': 'users.html',
    '/settings': 'settings.html',
    '/system': 'system.html',
    '/job-editor': 'job-editor.html',
    '/automations': 'automations.html',
    '/automation-editor': 'automation-editor.html',
  };
  for (const [route, file] of Object.entries(pages)) {
    app.get(route, (req, res) => {
      res.sendFile(path.join(__dirname, '../public', file));
    });
  }

  app.get('/', (req, res) => {
    res.redirect('/dashboard');
  });

  // Error handler global
  app.use((err, req, res, _next) => {
    logger.error('Error no manejado en request', {
      method: req.method,
      url: req.url,
      error: err.message,
    });
    return fromError(res, err);
  });

  return app;
}

module.exports = { createServer };

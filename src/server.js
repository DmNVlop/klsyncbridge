'use strict';

const express = require('express');
const path = require('path');
const { fromError } = require('./utils/response');
const logger = require('./services/logger.service');
const { ForbiddenError } = require('./utils/errors');

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

  // Rutas de la API
  app.use('/api/auth', require('./modules/auth/auth.routes'));
  app.use('/api/users', require('./modules/users/users.routes'));
  app.use('/api/connections', require('./modules/connections/connections.routes'));
  app.use('/api/api-configs', require('./modules/api-configs/api-configs.routes'));
  app.use('/api/jobs', require('./modules/jobs/jobs.routes'));
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

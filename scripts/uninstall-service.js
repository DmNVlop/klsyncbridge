'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { Service } = require('node-windows');

const svc = new Service({
  name: 'KLSyncBridge',
  script: path.join(__dirname, '../src/app.js'),
});

svc.on('uninstall', () => {
  console.log('✅ Servicio KLSyncBridge desinstalado');
});

svc.on('error', (err) => {
  console.error('❌ Error:', err);
});

svc.uninstall();

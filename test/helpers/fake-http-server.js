'use strict';

const http = require('http');

/**
 * Servidor HTTP local que registra cada petición y responde lo que diga el handler.
 * handler(req, bodyBuffer) ⇒ { status, json }
 */
async function startFakeServer(handler) {
  let current = handler;
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const { status = 200, json = {} } = current(req, body) || {};
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setHandler(fn) { current = fn; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeServer };

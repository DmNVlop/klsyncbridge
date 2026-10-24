'use strict';

// Logger mudo para inyectar en plugins/worker durante los tests.
const noop = () => undefined;

module.exports = { info: noop, warn: noop, error: noop, debug: noop };

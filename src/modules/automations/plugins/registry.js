'use strict';

const { createRegistry } = require('../../../core/plugins/registry');

// Añadir un tipo = crear su fichero en triggers/ o steps/ y registrarlo aquí.
const triggers = createRegistry('disparador');
triggers.register(require('./triggers/folder-watch.trigger'));

const steps = createRegistry('paso');
steps.register(require('./steps/ardis-xml-import.step'));

module.exports = { triggers, steps };

'use strict';

const { z } = require('zod/v4');
const { ValidationError } = require('../../utils/errors');

/**
 * Registro de plugins por `type`. Cada plugin declara su `configSchema` (zod/v4); el registro
 * valida configuraciones, expone el JSON Schema a la UI y detecta los campos que referencian
 * recursos (`.meta({ resource: 'api_config' })`). Añadir un tipo = registrarlo; nada más cambia.
 */
function createRegistry(kind) {
  const plugins = new Map();

  function get(type) {
    const plugin = plugins.get(type);
    if (!plugin) throw new ValidationError(`Tipo de ${kind} desconocido: ${type}`);
    return plugin;
  }

  function jsonSchemaOf(type) {
    return z.toJSONSchema(get(type).configSchema, { io: 'input' });
  }

  return {
    register(plugin) {
      if (!plugin || !plugin.type || !plugin.configSchema) throw new Error(`Plugin de ${kind} sin type o configSchema`);
      if (plugins.has(plugin.type)) throw new Error(`Tipo de ${kind} duplicado: ${plugin.type}`);
      plugins.set(plugin.type, plugin);
    },

    has: (type) => plugins.has(type),

    get,

    /** Valida y completa con valores por defecto; error ⇒ ValidationError con fieldErrors. */
    parseConfig(type, config) {
      const result = get(type).configSchema.safeParse(config ?? {});
      if (!result.success) {
        throw new ValidationError(`Configuración de ${kind} «${type}» no válida`, z.flattenError(result.error).fieldErrors);
      }
      return result.data;
    },

    resourceFields(type) {
      const properties = jsonSchemaOf(type).properties || {};
      return Object.entries(properties)
        .filter(([, prop]) => prop.resource)
        .map(([field, prop]) => ({ field, resource: prop.resource }));
    },

    list() {
      return [...plugins.values()].map((plugin) => ({
        type: plugin.type,
        version: plugin.version,
        title: plugin.title,
        description: plugin.description,
        configSchema: jsonSchemaOf(plugin.type),
      }));
    },
  };
}

module.exports = { createRegistry };

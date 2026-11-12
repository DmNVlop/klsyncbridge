'use strict';

const { TRANSFORMS } = require('../../config/constants');
const { STD_RECORD_KEYS, STD_DEFAULTS } = require('../../core/outputs/ardis-std/std-keys');
const { KIND, SCHEMA_VERSION } = require('./mapping-json.schema');

function exampleFor(targetKind) {
  if (targetKind === 'ardis_std') {
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      name: 'Stock ERP a Ardis',
      description: 'Almacén de tableros desde el listado de stock del ERP',
      targetKind: 'ardis_std',
      filterExpression: 'STOCK > 0',
      reader: { format: 'csv', options: { delimiter: ';', encoding: 'utf8', has_header: true } },
      fields: [
        { target: 'MATERIAAL', source: 'field', sourceField: 'CODIGO', transform: 'trim' },
        { target: 'LENGTE', source: 'field', sourceField: 'LARGO' },
        { target: 'BREEDTE', source: 'field', sourceField: 'ANCHO' },
        { target: 'DIKTE', source: 'field', sourceField: 'ESPESOR' },
        { target: 'AANT', source: 'expression', expression: 'Math.max(0, STOCK)', default: '0' },
        { target: 'NOLIMIT', source: 'static', value: '0' },
      ],
    };
  }
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    name: 'Artículos a la API',
    targetKind: 'api',
    filterExpression: null,
    reader: { format: 'excel', options: { sheet_name: 'Hoja1', header_row: 1 } },
    fields: [
      { target: 'reference', source: 'field', sourceField: 'CODIGO', transform: 'trim' },
      { target: 'price', source: 'field', sourceField: 'PRECIO', transform: 'number', default: '0' },
      { target: 'supplier.name', source: 'static', value: 'Proveedor SA' },
    ],
  };
}

function describeStdKeys() {
  const lines = STD_RECORD_KEYS.map((k) => `- ${k.key}${k.required ? ' (OBLIGATORIA)' : ''}: ${k.label}`);
  const defaults = Object.entries(STD_DEFAULTS).map(([key, value]) => `${key}=${value}`).join(', ');
  return [
    'Claves del almacén de tableros de Ardis (.STD). Se escriben tal cual (en neerlandés):',
    ...lines,
    `- Si no mapeas estas claves se escriben por defecto: ${defaults}.`,
    '- LENGTE, BREEDTE y DIKTE deben ser números mayores que 0; una fila sin alguna obligatoria se descarta.',
    '- Los decimales con coma se convierten a punto automáticamente en las claves numéricas.',
    '- Puedes añadir claves propias de la fábrica (solo letras, números, "_" y "$").',
  ];
}

function describeSampleFields(sampleFields) {
  if (!Array.isArray(sampleFields) || sampleFields.length === 0) return [];
  return [
    '',
    'CAMPOS DETECTADOS EN EL FICHERO DE EJEMPLO (nombre: valores de ejemplo):',
    ...sampleFields.map((f) => `- ${f.name}: ${(f.sampleValues || []).map((v) => JSON.stringify(v)).join(', ')}`),
  ];
}

/**
 * Instrucciones en texto plano para que una IA genere el JSON de mapeo.
 * @param {{ targetKind?: 'api'|'ardis_std', sampleFields?: Array<{ name: string, sampleValues?: any[] }> }} input
 * @returns {string}
 */
function buildAiInstructions({ targetKind = 'api', sampleFields = [] } = {}) {
  const kind = targetKind === 'ardis_std' ? 'ardis_std' : 'api';
  const lines = [
    'Eres un asistente que prepara mapeos para KLSyncBridge.',
    'Un mapeo describe cómo convertir cada fila de un fichero de origen (CSV o Excel) en un registro de destino.',
    `Destino de este mapeo (targetKind): ${kind === 'ardis_std' ? 'ardis_std (almacén de tableros de Ardis, fichero .STD)' : 'api (cuerpo JSON de una API)'}.`,
    '',
    'FORMATO DE RESPUESTA: devuelve SOLO el JSON, sin explicaciones ni bloques de texto alrededor. Estructura:',
    JSON.stringify(exampleFor(kind), null, 2),
    '',
    'REGLAS DEL JSON:',
    `- "kind" siempre "${KIND}" y "schemaVersion" siempre ${SCHEMA_VERSION}.`,
    '- "name" obligatorio. "description", "filterExpression" y "reader" son opcionales. Ningún texto supera 500 caracteres.',
    '- "reader": { "format": "auto" | "csv" | "excel", "options": { "delimiter", "encoding": "utf8" | "latin1", "has_header", "sheet_name", "header_row" } }.',
    '- Cada elemento de "fields" lleva "target" (nombre del campo de destino, sin repetir) y "source":',
    '  - "field": copia una columna del fichero; exige "sourceField" (nombre exacto de la columna).',
    '  - "static": valor fijo; exige "value" (texto).',
    '  - "expression": calcula el valor; exige "expression".',
    `- "transform" opcional, uno de: ${Object.values(TRANSFORMS).join(', ')} (por defecto none). "default" opcional: valor si la celda viene vacía.`,
    '- Máximo 500 campos.',
    ...(kind === 'api' ? ['- En "target" un punto crea objetos anidados (por ejemplo "supplier.name").'] : []),
    '',
    'LENGUAJE DE EXPRESIONES (en "expression" y en "filterExpression"):',
    '- Es UNA expresión de JavaScript (sin punto y coma ni return). Cada columna del fichero es una variable con su nombre exacto.',
    '- Solo se pueden usar columnas cuyo nombre sea un identificador válido (letras, números y "_", sin empezar por número); para las demás usa source "field".',
    '- "filterExpression" devuelve verdadero/falso: solo pasan las filas que lo cumplen. Sin filtro pasan todas.',
    '- Si una expresión falla, el valor de ese campo queda vacío. No uses funciones externas ni asíncronas.',
    '- Ejemplos: STOCK > 0 ? 1 : 0   |   String(CODIGO).padStart(6, "0")   |   COLOR === "BL" ? "Blanco" : COLOR   |   Number(PRECIO) * 1.21',
  ];
  if (kind === 'ardis_std') lines.push('', ...describeStdKeys());
  lines.push(...describeSampleFields(sampleFields));
  lines.push('', 'Recuerda: devuelve SOLO el JSON.');
  return lines.join('\n');
}

module.exports = { buildAiInstructions };

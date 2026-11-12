'use strict';

/** Claves de un registro [ISTD-n] del almacén de Ardis. Se escriben tal cual (neerlandés). */
const STD_RECORD_KEYS = [
  { key: 'MATERIAAL', label: 'Material', required: true, numeric: false },
  { key: 'LENGTE', label: 'Largo (mm)', required: true, numeric: true },
  { key: 'BREEDTE', label: 'Ancho (mm)', required: true, numeric: true },
  { key: 'DIKTE', label: 'Espesor (mm)', required: true, numeric: true },
  { key: 'RICHTING', label: 'Veta: 0 sin, 1 a lo largo, 2 a lo ancho', required: false, numeric: true },
  { key: 'NOLIMIT', label: 'Disponibilidad: 0 stock, 1 ilimitado, 2 retal, 3 deshabilitado', required: false, numeric: true },
  { key: 'AANT', label: 'Cantidad en stock', required: false, numeric: true },
  { key: 'PRIJS', label: 'Precio', required: false, numeric: true },
  { key: 'REFER', label: 'Referencia (p. ej. código ERP)', required: false, numeric: false },
  { key: 'BEM', label: 'Observaciones / descripción', required: false, numeric: false },
  { key: 'MINBRDBOVEN', label: 'Saneado mínimo superior (mm)', required: false, numeric: true },
  { key: 'MINBRDRECHTS', label: 'Saneado mínimo derecho (mm)', required: false, numeric: true },
  { key: 'MINBRDONDER', label: 'Saneado mínimo inferior (mm)', required: false, numeric: true },
  { key: 'MINBRDLINKS', label: 'Saneado mínimo izquierdo (mm)', required: false, numeric: true },
  { key: 'NOMBRDBOVEN', label: 'Saneado nominal superior (mm)', required: false, numeric: true },
  { key: 'NOMBRDRECHTS', label: 'Saneado nominal derecho (mm)', required: false, numeric: true },
  { key: 'NOMBRDONDER', label: 'Saneado nominal inferior (mm)', required: false, numeric: true },
  { key: 'NOMBRDLINKS', label: 'Saneado nominal izquierdo (mm)', required: false, numeric: true },
  { key: 'MINRESTO', label: 'Retal mínimo (superficie)', required: false, numeric: true },
  { key: 'MINRESTL', label: 'Retal mínimo largo (mm)', required: false, numeric: true },
  { key: 'MINRESTB', label: 'Retal mínimo ancho (mm)', required: false, numeric: true },
  { key: 'MACH', label: 'Máquina de Ardis', required: false, numeric: false },
  { key: 'PREF', label: 'Preferencia', required: false, numeric: false },
  { key: 'OPTTYPE', label: 'Tipo de optimización', required: false, numeric: false },
  { key: 'SheetDrawing', label: 'Dibujo de tablero', required: false, numeric: false },
  { key: 'Sheet1LevelStrips', label: 'Tiras de 1.er nivel', required: false, numeric: true },
  { key: 'LOCID', label: 'Ubicación', required: false, numeric: false },
  ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ key: `EXT0${n}`, label: `Campo extra ${n}`, required: false, numeric: false })),
];

/** Valores que se escriben aunque no se mapeen (si se mapean, manda el mapeo). */
const STD_DEFAULTS = { NOLIMIT: '1', AANT: '0' };

/** Claves que gestiona Ardis y nunca se escriben. */
const STD_IGNORED_KEYS = ['ID'];

/** Claves de la cabecera [ISTDALG] configurables (DATUM es automática). */
const STD_HEADER_KEYS = [
  { key: 'REST', label: 'Almacén de retales asociado' },
  { key: 'ALGMACH', label: 'Máquina por defecto' },
];

/** Nombre de clave válido (también para claves personalizadas de la fábrica). */
const STD_KEY_PATTERN = /^[A-Za-z0-9_$]+$/;

const REQUIRED_KEYS = STD_RECORD_KEYS.filter(k => k.required).map(k => k.key);
const NUMERIC_KEYS = new Set(STD_RECORD_KEYS.filter(k => k.numeric).map(k => k.key.toUpperCase()));

module.exports = {
  STD_RECORD_KEYS, STD_DEFAULTS, STD_IGNORED_KEYS, STD_HEADER_KEYS, STD_KEY_PATTERN, REQUIRED_KEYS, NUMERIC_KEYS,
};

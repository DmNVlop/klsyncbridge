'use strict';

// Genera un formulario a partir de un JSON Schema plano (propiedades de primer nivel).
// Tipos soportados: string, integer, number. Un campo con `resource: 'api_config'`
// se pinta como <select> con las configuraciones de API recibidas en options.resources.
// Requiere ui.js cargado antes (usa UI.escapeHtml).
//
// Uso:
//   const form = SchemaForm.render(container, schema, values, { resources: { api_config: [{ id, name }] } });
//   form.getValues();                          // objeto listo para enviar (números como Number, vacíos omitidos)
//   form.showErrors({ campo: ['mensaje'] });   // devuelve los mensajes de campos que no están en el esquema
(function () {
  const INPUT_CLS = 'w-full bg-base border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent';
  const INPUT_ERROR_CLS = 'border-red-500/60';
  let instanceCounter = 0;

  function isSet(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function buildControl(esc, controlId, name, def, value, resources) {
    const common = `id="${controlId}" data-field="${esc(name)}" class="${INPUT_CLS}"`;

    if (def.resource) {
      const list = resources[def.resource] || [];
      const known = list.some((item) => String(item.id) === String(value));
      let options = '<option value="">— Selecciona —</option>';
      options += list.map((item) => {
        const selected = String(item.id) === String(value) ? ' selected' : '';
        return `<option value="${esc(item.id)}"${selected}>${esc(item.name)}</option>`;
      }).join('');
      if (isSet(value) && !known) {
        options += `<option value="${esc(value)}" selected>(configuración no encontrada)</option>`;
      }
      return `<select ${common} data-kind="resource">${options}</select>`;
    }

    if (def.type === 'integer' || def.type === 'number') {
      const step = def.type === 'integer' ? '1' : 'any';
      const min = typeof def.minimum === 'number' ? ` min="${def.minimum}"` : '';
      const max = typeof def.maximum === 'number' ? ` max="${def.maximum}"` : '';
      return `<input type="number" step="${step}"${min}${max} ${common} data-kind="${esc(def.type)}" value="${esc(isSet(value) ? value : '')}">`;
    }

    return `<input type="text" ${common} data-kind="string" value="${esc(isSet(value) ? value : '')}">`;
  }

  function render(container, schema, values, options) {
    const esc = window.UI.escapeHtml;
    const properties = (schema && schema.properties) || {};
    const required = new Set((schema && schema.required) || []);
    const resources = (options && options.resources) || {};
    const current = values || {};
    const uid = `sf${++instanceCounter}`;
    const entries = Object.entries(properties);

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-sm text-slate-500">Este tipo no tiene opciones de configuración.</p>';
      return { getValues: () => ({}), showErrors: () => [] };
    }

    container.innerHTML = entries.map(([name, def]) => {
      const controlId = `${uid}_${name}`;
      const value = current[name] !== undefined ? current[name] : def.default;
      const marker = required.has(name) ? ' <span class="text-red-400">*</span>' : '';
      const hint = def.description ? `<p class="text-xs text-slate-500 mt-1">${esc(def.description)}</p>` : '';
      return `
        <div class="mb-4">
          <label for="${esc(controlId)}" class="block text-xs font-medium text-slate-400 mb-1">${esc(def.title || name)}${marker}</label>
          ${buildControl(esc, esc(controlId), name, def, value, resources)}
          ${hint}
          <p data-error-for="${esc(name)}" class="hidden text-xs text-red-400 mt-1"></p>
        </div>`;
    }).join('');

    function getValues() {
      const result = {};
      container.querySelectorAll('[data-field]').forEach((el) => {
        const name = el.dataset.field;
        const raw = el.value.trim();
        if (raw === '') return;
        if (el.dataset.kind === 'integer' || el.dataset.kind === 'number') {
          const parsed = Number(raw);
          // Si no es un número válido se envía el texto tal cual para que el servidor lo rechace con su mensaje.
          result[name] = Number.isFinite(parsed) ? parsed : raw;
          return;
        }
        result[name] = raw;
      });
      return result;
    }

    function clearErrors() {
      container.querySelectorAll('[data-error-for]').forEach((el) => {
        el.textContent = '';
        el.classList.add('hidden');
      });
      container.querySelectorAll('[data-field]').forEach((el) => el.classList.remove(INPUT_ERROR_CLS));
    }

    function showErrors(fields) {
      clearErrors();
      const leftovers = [];
      const controls = {};
      container.querySelectorAll('[data-field]').forEach((el) => { controls[el.dataset.field] = el; });
      const messageEls = {};
      container.querySelectorAll('[data-error-for]').forEach((el) => { messageEls[el.dataset.errorFor] = el; });

      Object.entries(fields || {}).forEach(([name, messages]) => {
        const text = [].concat(messages).join(' ');
        if (!controls[name]) {
          leftovers.push(`${name}: ${text}`);
          return;
        }
        controls[name].classList.add(INPUT_ERROR_CLS);
        messageEls[name].textContent = text;
        messageEls[name].classList.remove('hidden');
      });
      return leftovers;
    }

    return { getValues, showErrors };
  }

  window.SchemaForm = { render };
})();

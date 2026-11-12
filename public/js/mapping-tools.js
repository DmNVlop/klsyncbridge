'use strict';

// Utilidades de interfaz compartidas por el editor de jobs y el de plantillas de mapeo:
// diálogo modal genérico, importar JSON (pegar o abrir fichero ⇒ validar en el servidor), exportar JSON
// (generado en cliente, formato klsyncbridge.mapping v1) y lista legible de errores de validación.
// Requiere auth.js (API) y ui.js (UI.toast, UI.escapeHtml) cargados antes.
(function () {
  const esc = (value) => window.UI.escapeHtml(String(value === null || value === undefined ? '' : value));
  const BTN_PRIMARY = 'px-4 py-2 bg-accent hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors';
  const BTN_GHOST = 'px-4 py-2 rounded-lg border border-white/10 text-slate-300 text-sm hover:bg-white/5';

  /**
   * Diálogo modal. `body`: HTML. `actions`: [{ label, title, cls, onClick(ctx) }] (onClick puede devolver false para no cerrar).
   * Devuelve { root, close }.
   */
  function modal({ title, body, actions, wide }) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9997] p-4';
    overlay.innerHTML = `
      <div class="bg-[#1a1d27] rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} border border-white/10 shadow-2xl max-h-[90vh] flex flex-col">
        <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <h3 class="font-medium text-white">${esc(title)}</h3>
          <button type="button" data-close title="Cerrar sin hacer nada" class="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <div class="px-6 py-5 overflow-y-auto" data-body>${body}</div>
        <div class="px-6 py-4 border-t border-white/5 flex gap-3 justify-end flex-shrink-0" data-actions></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const ctx = { root: overlay, close };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    const bar = overlay.querySelector('[data-actions]');
    (actions || []).forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.cls || BTN_PRIMARY;
      btn.textContent = action.label;
      if (action.title) btn.title = action.title;
      btn.addEventListener('click', async () => {
        const result = await action.onClick(ctx);
        if (result !== false) close();
      });
      bar.appendChild(btn);
    });
    return ctx;
  }

  /** Lista legible de errores (el usuario puede pegarla de vuelta a la IA). */
  function issuesHtml(issues) {
    return `<ul class="list-disc pl-5 space-y-1 text-sm text-red-300">${(issues || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }

  /** Issues de un error de la API (details.issues) o, si no los hay, su mensaje. */
  function issuesOf(err) {
    const issues = err && err.details && err.details.issues;
    return Array.isArray(issues) && issues.length ? issues : [err && err.message ? err.message : 'Error desconocido'];
  }

  /** Muestra un error de validación en un modal con la lista de problemas. */
  function showIssues(title, err) {
    const issues = issuesOf(err);
    const text = issues.join('\n');
    modal({
      title,
      body: `<p class="text-sm text-slate-400 mb-3">Corrige estos puntos (puedes copiarlos y pegarlos a la IA para que regenere el JSON):</p>${issuesHtml(issues)}`,
      actions: [
        {
          label: 'Copiar errores', cls: BTN_GHOST, title: 'Copiar la lista de errores al portapapeles',
          onClick: async () => { await copyText(text); UI.toast('Errores copiados', 'success'); return false; },
        },
        { label: 'Cerrar', title: 'Cerrar este aviso', onClick: () => true },
      ],
      wide: true,
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Sin permiso de portapapeles (p. ej. contexto no seguro): alternativa con un textarea temporal
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  /** Descarga un objeto como fichero .json. */
  function downloadJson(fileName, doc) {
    downloadBlob(fileName, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  }

  function downloadBlob(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFileName(name) {
    return String(name || 'mapeo').trim().replace(/[^\w.-]+/g, '_').slice(0, 80) || 'mapeo';
  }

  /** Documento JSON v1 a partir de filas del editor (getRows()). */
  function buildDoc({ name, description, targetKind, filterExpression, reader, rows }) {
    const doc = {
      kind: 'klsyncbridge.mapping',
      schemaVersion: 1,
      name: name || 'Mapeo sin nombre',
      targetKind,
    };
    if (description) doc.description = description;
    if (filterExpression) doc.filterExpression = filterExpression;
    if (reader) doc.reader = reader;
    doc.fields = window.MappingEditor.toMappingJsonFields(rows);
    return doc;
  }

  /**
   * «Importar JSON»: pegar texto o abrir fichero ⇒ POST /mapping-templates/validate.
   * Si es válido llama a onLoad(template) (forma interna) y cierra; si no, lista los errores sin cerrar.
   */
  function importJsonDialog({ onLoad }) {
    const ctx = modal({
      title: 'Importar mapeo desde JSON',
      wide: true,
      body: `
        <p class="text-sm text-slate-400 mb-3">Pega aquí el JSON (por ejemplo, el que te devuelva una IA) o abre un fichero. Se valida antes de cargarlo y <strong>no se guarda nada</strong>: rellena el editor y puedes retocarlo a mano.</p>
        <textarea data-json rows="12" class="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-accent" placeholder='{ "kind": "klsyncbridge.mapping", "schemaVersion": 1, ... }'></textarea>
        <div data-issues class="mt-3 hidden"></div>
        <input type="file" data-file accept=".json,application/json,text/plain" class="hidden">`,
      actions: [
        { label: 'Abrir fichero…', cls: BTN_GHOST, title: 'Elegir un fichero .json de tu equipo y cargar su contenido en el cuadro', onClick: () => { ctx.root.querySelector('[data-file]').click(); return false; } },
        { label: 'Cancelar', cls: BTN_GHOST, title: 'Cerrar sin cargar nada', onClick: () => true },
        {
          label: 'Validar y cargar', title: 'Comprobar el JSON en el servidor y, si es válido, cargarlo en el editor sin guardar',
          onClick: async () => {
            const issuesEl = ctx.root.querySelector('[data-issues]');
            issuesEl.classList.add('hidden');
            let parsed;
            try {
              parsed = JSON.parse(ctx.root.querySelector('[data-json]').value);
            } catch (err) {
              issuesEl.innerHTML = issuesHtml([`El texto no es un JSON válido: ${err.message}`]);
              issuesEl.classList.remove('hidden');
              return false;
            }
            try {
              const res = await API.post('/mapping-templates/validate', parsed);
              const result = res.data;
              if (!result.valid) {
                issuesEl.innerHTML = issuesHtml(result.issues);
                issuesEl.classList.remove('hidden');
                return false;
              }
              onLoad(result.template);
              return true;
            } catch (err) {
              issuesEl.innerHTML = issuesHtml(issuesOf(err));
              issuesEl.classList.remove('hidden');
              return false;
            }
          },
        },
      ],
    });
    ctx.root.querySelector('[data-file]').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { ctx.root.querySelector('[data-json]').value = String(reader.result || ''); };
      reader.onerror = () => UI.toast('No se ha podido leer el fichero', 'error');
      reader.readAsText(file);
    });
  }

  /** GET con Bearer que devuelve texto o blob (endpoints que no responden con el envoltorio JSON). */
  async function fetchRaw(method, path, body) {
    const headers = { Authorization: `Bearer ${AUTH.getToken()}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      let message = `Error ${res.status}`;
      try { const data = await res.json(); message = data.error || message; } catch (err) { /* cuerpo no JSON */ }
      throw new Error(message);
    }
    return res;
  }

  window.MappingTools = {
    modal, issuesHtml, issuesOf, showIssues, copyText, downloadJson, downloadBlob, safeFileName,
    buildDoc, importJsonDialog, fetchRaw, BTN_PRIMARY, BTN_GHOST,
  };
})();

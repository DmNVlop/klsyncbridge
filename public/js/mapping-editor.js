'use strict';

// Editor de filas de mapeo (campo destino ⇐ campo del origen / valor fijo / expresión), compartido por
// el editor de jobs y el de plantillas de mapeo. Es una factoría: cada instancia pinta sus filas en un <tbody>.
//
// Uso:
//   const editor = MappingEditor.create({
//     tbody,                                  // <tbody> donde se pintan las filas
//     getSourceFields: () => [{ name }],      // campos del origen (columnas SQL o campos detectados del fichero)
//     getTargetListId: () => 'datalist-id',   // datalist de sugerencias para el campo destino
//     freeSource: false,                      // true: el origen es un <input> con sugerencias (admite escribir a mano)
//     preserveDefaults: false,                // true: conserva el valor por defecto de los campos de origen
//     onChange: () => {},                     // cualquier cambio en las filas
//     onTargetChange: () => {},               // cambia el nombre de un campo destino
//     onRowRemoved: () => {},                 // se elimina una fila
//   });
//   editor.addRow(map, prefilledTarget);      // fila vacía o con datos (forma del editor, ver fromBackend)
//   editor.setRows(maps);                     // sustituye todas las filas
//   editor.getRows();                         // filas en forma del backend (api_field, source_type, sql_field…)
//
// Forma del editor de una fila: { sql, api, transform, def, source_type, expression, static_val,
//   expr_cond_field, expr_cond_op, expr_cond_val, expr_then, expr_else }.
(function () {
  const TRANSFORMS = ['none', 'uppercase', 'lowercase', 'trim', 'number', 'boolean', 'date_iso', 'string'];
  const OPERATORS = ['>=', '<=', '>', '<', '===', '!==', 'includes'];
  const STATIC_MARKER = '__static__';
  const EXPRESSION_MARKER = '__expr__';
  let instanceCounter = 0;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function transformOptions(selected) {
    return TRANSFORMS.map((t) => `<option value="${t}" ${t === selected ? 'selected' : ''}>${t}</option>`).join('');
  }

  function operatorOptions(selected) {
    return OPERATORS.map((o) => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('');
  }

  /** Fila del backend (field_maps o campo de plantilla) ⇒ forma del editor. */
  function fromBackend(m) {
    let meta = m.expression_meta;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch (err) { meta = {}; }
    }
    meta = meta || {};
    const type = m.source_type || 'field';
    return {
      sql: m.sql_field,
      api: m.api_field,
      transform: m.transform || 'none',
      def: m.default_value || '',
      source_type: type,
      expression: m.expression || '',
      static_val: type === 'static' ? (m.default_value || '') : '',
      expr_cond_field: meta.expr_cond_field || m.expr_cond_field || '',
      expr_cond_op: meta.expr_cond_op || m.expr_cond_op || '>=',
      expr_cond_val: meta.expr_cond_val || m.expr_cond_val || '',
      expr_then: meta.expr_then || m.expr_then || '',
      expr_else: meta.expr_else || m.expr_else || '',
    };
  }

  /** Filas de getRows() (expr_* aplanados) ⇒ campos de plantilla (expression_meta como objeto). */
  function toTemplateFields(rows) {
    return rows.map((row, index) => {
      const hasMeta = row.source_type === 'expression' && (row.expr_cond_field || row.expr_cond_op);
      return {
        api_field: row.api_field,
        source_type: row.source_type,
        sql_field: row.sql_field,
        transform: row.transform || 'none',
        default_value: row.default_value === undefined ? null : row.default_value,
        expression: row.expression || null,
        expression_meta: hasMeta ? {
          expr_cond_field: row.expr_cond_field || null,
          expr_cond_op: row.expr_cond_op || null,
          expr_cond_val: row.expr_cond_val || null,
          expr_then: row.expr_then || null,
          expr_else: row.expr_else || null,
        } : null,
        sort_order: index,
      };
    });
  }

  /** Filas de getRows() ⇒ campos del JSON de intercambio v1 (klsyncbridge.mapping). */
  function toMappingJsonFields(rows) {
    return rows.map((row) => {
      if (row.source_type === 'static') {
        return { target: row.api_field, source: 'static', value: row.default_value === null || row.default_value === undefined ? '' : String(row.default_value) };
      }
      const field = { target: row.api_field, source: row.source_type };
      if (row.source_type === 'expression') field.expression = row.expression;
      else field.sourceField = row.sql_field;
      if (row.transform && row.transform !== 'none') field.transform = row.transform;
      if (row.default_value !== null && row.default_value !== undefined && row.default_value !== '') field.default = String(row.default_value);
      return field;
    });
  }

  function create(options) {
    const tbody = options.tbody;
    const uid = `mapeditor${++instanceCounter}`;
    const noop = () => {};
    const onChange = options.onChange || noop;
    const onTargetChange = options.onTargetChange || noop;
    const onRowRemoved = options.onRowRemoved || noop;
    const freeSource = Boolean(options.freeSource);
    const preserveDefaults = Boolean(options.preserveDefaults);
    const sourceListId = `${uid}-sources`;
    let sourceList = null;

    function sourceFields() {
      return (options.getSourceFields ? options.getSourceFields() : []) || [];
    }

    function sourceNames() {
      return sourceFields().map((f) => f.name);
    }

    // Origen como <select> (jobs: solo columnas conocidas) o como <input> con sugerencias (plantillas)
    function sourceControl(cls, selected, extraStyle) {
      const style = extraStyle ? ` style="${extraStyle}"` : '';
      if (freeSource) {
        return `<input type="text" class="inp ${cls}" list="${sourceListId}" placeholder="campo del fichero" value="${esc(selected)}"${style}>`;
      }
      return `<select class="inp ${cls}"${style}>${sourceOptions(selected)}</select>`;
    }

    function sourceOptions(selected) {
      return '<option value="">— ninguno —</option>' + sourceNames()
        .map((n) => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
    }

    function ensureSourceList() {
      if (!freeSource) return;
      if (!sourceList) {
        sourceList = document.createElement('datalist');
        sourceList.id = sourceListId;
        tbody.parentNode.insertBefore(sourceList, tbody);
      }
      sourceList.innerHTML = sourceNames().map((n) => `<option value="${esc(n)}">`).join('');
    }

    function variablesText() {
      return sourceNames().join(', ') || '(carga primero el origen de datos)';
    }

    function setRowMode(row, mode, silent) {
      row.querySelectorAll('.map-mode-btn').forEach((b) => b.classList.remove('active-field', 'active-static', 'active-expr'));
      const active = row.querySelector(`.map-mode-btn[data-mode="${mode}"]`);
      if (active) active.classList.add(`active-${mode}`);

      row.querySelector('.cell-field').style.display = mode === 'field' ? '' : 'none';
      row.querySelector('.cell-static').style.display = mode === 'static' ? '' : 'none';
      row.querySelector('.cell-expr').style.display = mode === 'expression' ? '' : 'none';
      row.querySelector('.cell-transform').style.display = mode !== 'static' ? '' : 'none';

      row.dataset.mode = mode;
      if (!silent) onChange();
    }

    function buildSimpleExpression(row) {
      const condField = row.querySelector('.expr-cond-field').value;
      const condOp = row.querySelector('.expr-cond-op').value;
      const condVal = row.querySelector('.expr-cond-val').value;
      const thenVal = row.querySelector('.expr-then').value;
      const elseVal = row.querySelector('.expr-else').value;
      if (!condField) return '';
      const rhs = isNaN(condVal) || condVal === '' ? `"${condVal}"` : condVal;
      const thenOut = (thenVal && isNaN(thenVal)) ? `"${thenVal}"` : (thenVal || 'null');
      const elseOut = (elseVal && isNaN(elseVal)) ? `"${elseVal}"` : (elseVal || 'null');
      return `${condField} ${condOp} ${rhs} ? ${thenOut} : ${elseOut}`;
    }

    function toggleExprAdvanced(row) {
      const builder = row.querySelector('.expr-builder-simple');
      const adv = row.querySelector('.expr-builder-adv');
      const isAdv = adv.style.display !== 'none';
      builder.style.display = isAdv ? '' : 'none';
      adv.style.display = isAdv ? 'none' : '';
      if (!isAdv) {
        const expr = buildSimpleExpression(row);
        if (expr) row.querySelector('.expr-adv-input').value = expr;
      }
      onChange();
    }

    function addRow(map, prefilledTarget, rowOptions) {
      const data = map || null;
      const mode = data && data.source_type ? data.source_type : 'field';
      const listId = options.getTargetListId ? options.getTargetListId() : '';

      const row = document.createElement('tr');
      row.className = 'border-b border-white/5 align-top';
      row.dataset.mode = mode;
      if (preserveDefaults && data && data.def) row.dataset.def = data.def;

      row.innerHTML = `
        <td class="py-2 px-2" style="min-width:140px">
          <input type="text" class="inp map-api" placeholder="campo o padre.hijo" list="${esc(listId)}" value="${esc(prefilledTarget || (data && data.api) || '')}">
          <p class="map-std-error hidden text-xs text-red-400 mt-1"></p>
          <p class="text-xs text-slate-600 mt-1">Nombre del campo en el JSON de salida. Usa <span class="font-mono">.</span> para anidado: <span class="font-mono">datos.color</span>.</p>
        </td>
        <td class="py-2 px-2" style="min-width:90px">
          <div class="flex gap-1 flex-wrap">
            <button type="button" class="map-mode-btn" data-mode="field" title="El valor sale de un campo del origen de datos">Campo Fuente</button>
            <button type="button" class="map-mode-btn" data-mode="static" title="El valor es siempre el mismo (texto, número o booleano fijo)">Fijo</button>
            <button type="button" class="map-mode-btn" data-mode="expression" title="El valor se calcula con una expresión a partir de los campos del origen">Expr.</button>
          </div>
        </td>
        <td class="py-2 px-2 cell-field" style="min-width:130px">
          ${sourceControl('map-sql', (data && data.sql) || '')}
        </td>
        <td class="py-2 px-2 cell-static" style="min-width:130px;display:none">
          <input type="text" class="inp map-static-val" placeholder="ej: 10 o &quot;activo&quot;" value="${esc(data && data.static_val)}">
          <p class="text-xs text-slate-600 mt-1">Texto libre: <span class="font-mono">Activo</span>. Número: <span class="font-mono">10</span>. Booleano: <span class="font-mono">true</span>.</p>
        </td>
        <td class="py-2 px-2 cell-expr" style="min-width:260px;display:none">
          <div class="expr-builder-simple space-y-1">
            <div class="expr-builder">
              <span class="text-xs text-slate-500">si</span>
              ${sourceControl('expr-cond-field', (data && data.expr_cond_field) || '', 'max-width:110px')}
              <select class="expr-cond-op inp" style="max-width:70px">${operatorOptions('>=')}</select>
              <input type="text" class="expr-cond-val inp" style="max-width:70px" placeholder="250" value="${esc(data && data.expr_cond_val)}">
            </div>
            <div class="expr-builder">
              <span class="text-xs text-slate-500">entonces</span>
              <input type="text" class="expr-then inp" style="max-width:100px" placeholder="texto o CAMPO" value="${esc(data && data.expr_then)}">
              <span class="text-xs text-slate-500">sino</span>
              <input type="text" class="expr-else inp" style="max-width:100px" placeholder="texto o CAMPO" value="${esc(data && data.expr_else)}">
            </div>
            <p class="text-xs text-slate-600 mt-1">Valores literales con comillas: <span class="font-mono">"Grueso"</span>. Números sin comillas: <span class="font-mono">18</span>. Para usar el valor de otra columna escribe su nombre exacto: <span class="font-mono">NOMBRE_COLUMNA</span>.</p>
            <span class="expr-adv-toggle expr-toggle-adv" title="Escribir la expresión a mano">Expresión avanzada ↗</span>
          </div>
          <div class="expr-builder-adv" style="display:none">
            <textarea class="expr-adv-input inp font-mono text-xs" rows="2" placeholder="ESPESOR >= 18 ? &quot;Grueso&quot; : DESCRIPCION" style="resize:vertical">${esc(data && data.expression)}</textarea>
            <div class="mt-1.5 space-y-1">
              <p class="text-xs text-slate-500">Escribe cualquier expresión JavaScript. Todas las columnas del origen están disponibles como variables con su nombre exacto.</p>
              <p class="text-xs text-slate-600">Operadores: <span class="font-mono">== != &gt;= &lt;= &gt; &lt; && || !</span> — Ternario: <span class="font-mono">condición ? valorSi : valorNo</span></p>
              <p class="text-xs text-slate-600">Ejemplos:<br>
                <span class="font-mono">ESPESOR >= 18 ? "Grueso" : "Fino"</span><br>
                <span class="font-mono">ACTIVO == 1 ? true : false</span><br>
                <span class="font-mono">PRECIO > 1000 ? PRECIO * 0.9 : PRECIO</span>
              </p>
              <p class="text-xs text-slate-600 mt-1">Variables disponibles: <span class="expr-vars font-mono text-slate-400">${esc(variablesText())}</span></p>
            </div>
            <span class="expr-adv-toggle expr-toggle-simple mt-2 inline-block" title="Volver al constructor visual de la condición">Builder visual ↙</span>
          </div>
        </td>
        <td class="py-2 px-2 cell-transform" style="min-width:100px">
          <select class="inp map-transform">${transformOptions((data && data.transform) || 'none')}</select>
        </td>
        <td class="py-2 px-2"><button type="button" title="Quitar esta fila del mapeo" class="map-remove text-red-400 hover:text-red-300 px-2 mt-1">✕</button></td>
      `;

      // Expresión libre guardada (sin constructor visual): se muestra en modo avanzado
      if (mode === 'expression' && data && data.expression && !data.expr_cond_field) {
        row.querySelector('.expr-builder-adv').style.display = '';
        row.querySelector('.expr-builder-simple').style.display = 'none';
        row.querySelector('.expr-adv-input').value = data.expression;
      }
      if (data && data.expr_cond_op) row.querySelector('.expr-cond-op').value = data.expr_cond_op;

      row.querySelectorAll('.map-mode-btn').forEach((b) => b.addEventListener('click', () => setRowMode(row, b.dataset.mode)));
      row.querySelector('.expr-toggle-adv').addEventListener('click', () => toggleExprAdvanced(row));
      row.querySelector('.expr-toggle-simple').addEventListener('click', () => toggleExprAdvanced(row));
      row.querySelector('.map-remove').addEventListener('click', () => { row.remove(); onChange(); onRowRemoved(); });

      setRowMode(row, mode, true);

      row.querySelectorAll('select,input,textarea').forEach((el) => el.addEventListener('input', onChange));
      row.querySelector('.map-api').addEventListener('input', onTargetChange);
      tbody.appendChild(row);
      ensureSourceList();
      onChange();
      const focus = rowOptions && rowOptions.focus !== undefined ? rowOptions.focus : !data;
      if (focus) row.querySelector('.map-api').focus();
      return row;
    }

    function setRows(maps) {
      tbody.innerHTML = '';
      (maps || []).forEach((m) => addRow(m, null, { focus: false }));
      onChange();
      onTargetChange();
    }

    function getRows() {
      return Array.from(tbody.querySelectorAll('tr')).map((r, i) => {
        const mode = r.dataset.mode || 'field';
        const apiField = r.querySelector('.map-api').value.trim();
        if (!apiField) return null;

        const base = {
          api_field: apiField,
          transform: (r.querySelector('.map-transform') || {}).value || 'none',
          sort_order: i,
          source_type: mode,
        };

        if (mode === 'static') {
          return { ...base, sql_field: STATIC_MARKER, default_value: r.querySelector('.map-static-val').value, expression: null };
        }

        if (mode === 'expression') {
          const isAdv = r.querySelector('.expr-builder-adv').style.display !== 'none';
          let expression;
          let condField; let condOp; let condVal; let thenVal; let elseVal;
          if (isAdv) {
            expression = r.querySelector('.expr-adv-input').value.trim();
          } else {
            condField = r.querySelector('.expr-cond-field').value.trim();
            condOp = r.querySelector('.expr-cond-op').value;
            condVal = r.querySelector('.expr-cond-val').value;
            thenVal = r.querySelector('.expr-then').value;
            elseVal = r.querySelector('.expr-else').value;
            expression = buildSimpleExpression(r);
          }
          return {
            ...base,
            sql_field: condField || EXPRESSION_MARKER,
            default_value: null,
            expression,
            expr_cond_field: condField || null,
            expr_cond_op: condOp || null,
            expr_cond_val: condVal || null,
            expr_then: thenVal || null,
            expr_else: elseVal || null,
          };
        }

        const sqlField = r.querySelector('.map-sql').value.trim();
        if (!sqlField) return null;
        return { ...base, sql_field: sqlField, default_value: r.dataset.def || null, expression: null };
      }).filter(Boolean);
    }

    /** Reconstruye los desplegables de origen (y la lista de variables) cuando cambian los campos del origen. */
    function refreshSources() {
      ensureSourceList();
      const vars = variablesText();
      tbody.querySelectorAll('tr').forEach((row) => {
        row.querySelectorAll('.expr-vars').forEach((el) => { el.textContent = vars; });
        if (freeSource) return;
        row.querySelectorAll('select.map-sql, select.expr-cond-field').forEach((sel) => {
          const current = sel.value;
          sel.innerHTML = sourceOptions(current);
        });
      });
    }

    /** Cambia el datalist de sugerencias de todos los campos destino. */
    function setTargetList(listId) {
      tbody.querySelectorAll('.map-api').forEach((input) => input.setAttribute('list', listId));
    }

    function getTargetNames() {
      return Array.from(tbody.querySelectorAll('.map-api')).map((i) => i.value.trim()).filter(Boolean);
    }

    /**
     * Marca las claves destino no válidas por fila y pinta las obligatorias que faltan.
     * `std`: si el destino es .STD; `pattern`: RegExp de claves; `requiredEl`: contenedor con `.std-req[data-key]`.
     */
    function applyStdHints({ std, pattern, requiredEl }) {
      const mapped = new Set();
      tbody.querySelectorAll('tr').forEach((r) => {
        const input = r.querySelector('.map-api');
        const errorEl = r.querySelector('.map-std-error');
        if (!input || !errorEl) return;
        const value = input.value.trim();
        if (value) mapped.add(value.toUpperCase());
        const invalid = std && pattern && value && !pattern.test(value);
        errorEl.textContent = invalid ? 'Clave no válida: solo letras, números, _ y $' : '';
        errorEl.classList.toggle('hidden', !invalid);
      });
      if (requiredEl) {
        requiredEl.querySelectorAll('.std-req').forEach((el) => {
          const missing = !mapped.has(el.dataset.key);
          el.classList.toggle('text-red-400', missing);
          el.classList.toggle('font-semibold', missing);
          el.classList.toggle('text-emerald-400', !missing);
        });
      }
    }

    return { addRow, setRows, getRows, refreshSources, setTargetList, getTargetNames, applyStdHints, setRowMode };
  }

  window.MappingEditor = { create, fromBackend, toTemplateFields, toMappingJsonFields, TRANSFORMS };
})();

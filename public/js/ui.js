'use strict';

// ─── Navbar ────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '/dashboard',   label: 'Dashboard' },
  { href: '/jobs',        label: 'Jobs' },
  { href: '/connections', label: 'Conexiones' },
  { href: '/api-configs', label: 'APIs' },
  { href: '/logs',        label: 'Logs' },
  { href: '/users',       label: 'Usuarios' },
  { href: '/system',      label: 'Sistema' },
];

const ACTIVE_CLS  = 'px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-sm font-medium';
const NORMAL_CLS  = 'px-3 py-1.5 rounded-lg text-slate-400 hover:text-white text-sm';

function buildNav({ showUsername = false } = {}) {
  const current = window.location.pathname;

  const links = NAV_LINKS.map(({ href, label }) => {
    const active = current === href || (href !== '/dashboard' && current.startsWith(href));
    return `<a href="${href}" class="${active ? ACTIVE_CLS : NORMAL_CLS}">${label}</a>`;
  }).join('');

  const right = showUsername
    ? `<div class="flex items-center gap-3">
        <span id="username-display" class="text-slate-400 text-sm font-mono"></span>
        <button onclick="AUTH.logout()" class="text-sm text-slate-400 hover:text-white transition-colors">Cerrar sesión</button>
       </div>`
    : `<button onclick="AUTH.logout()" class="text-sm text-slate-400 hover:text-white">Cerrar sesión</button>`;

  const nav = document.createElement('nav');
  nav.className = 'border-b border-white/5 bg-surface px-6 py-4 flex items-center justify-between';
  nav.innerHTML = `
    <div class="flex items-center gap-6">
      <a href="/dashboard" class="font-semibold text-white text-lg">KLSyncBridge</a>
      <div class="flex items-center gap-1">${links}</div>
    </div>
    ${right}
  `;
  document.body.prepend(nav);

  if (showUsername) {
    const user = AUTH.getUser();
    if (user) {
      const el = document.getElementById('username-display');
      if (el) el.textContent = user.username;
    }
  }

  // Check update en background — 2 veces al día, no bloquea
  setTimeout(checkUpdateBackground, 2000);
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function toast(message, type = 'success') {
  const colors = {
    success: 'bg-emerald-900/80 border-emerald-500/40 text-emerald-300',
    error:   'bg-red-900/80 border-red-500/40 text-red-300',
    info:    'bg-blue-900/80 border-blue-500/40 text-blue-300',
    warning: 'bg-amber-900/80 border-amber-500/40 text-amber-300',
  };
  const el = document.createElement('div');
  el.className = `fixed bottom-5 right-5 z-[9999] px-4 py-3 rounded-xl border text-sm font-medium shadow-xl transition-all duration-300 ${colors[type] || colors.info}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

function confirmDialog(title, body, okLabel = 'Confirmar', okClass = 'bg-accent hover:bg-blue-500 text-white') {
  return new Promise((resolve) => {
    const existing = document.getElementById('_ui_confirm');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = '_ui_confirm';
    modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9998] p-4';
    modal.innerHTML = `
      <div class="bg-[#1a1d27] rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl p-6">
        <h3 class="font-medium text-white mb-2">${title}</h3>
        <p class="text-sm text-slate-400 mb-6">${body}</p>
        <div class="flex gap-3 justify-end">
          <button id="_ui_cancel" class="px-4 py-2 rounded-lg border border-white/10 text-slate-300 text-sm">Cancelar</button>
          <button id="_ui_ok" class="px-4 py-2 rounded-lg text-sm font-medium ${okClass}">${okLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const cleanup = (val) => { modal.remove(); resolve(val); };
    document.getElementById('_ui_ok').onclick = () => cleanup(true);
    document.getElementById('_ui_cancel').onclick = () => cleanup(false);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(false); });
  });
}

// ─── Helpers compartidos ───────────────────────────────────────────────────────

function statusBadge(s) {
  const map    = { success: 'text-emerald-400', error: 'text-red-400', running: 'text-blue-400', partial: 'text-amber-400' };
  const labels = { success: 'Exitoso',          error: 'Error',        running: 'Ejecutando',    partial: 'Parcial' };
  return `<span class="${map[s] || 'text-slate-400'} font-mono text-xs">${labels[s] || s || '—'}</span>`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Update checker ───────────────────────────────────────────────────────────

const UPDATE_CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 horas
const LS_LAST_CHECK = 'sb_update_last_check';
const LS_PENDING_VER = 'sb_update_pending'; // versión pendiente de instalar

function _hasPendingUpdate() {
  return !!localStorage.getItem(LS_PENDING_VER);
}

function _getPendingVersion() {
  return localStorage.getItem(LS_PENDING_VER);
}

// Pone el punto amber en el link "Sistema" del navbar
function _applyNavBadge() {
  const navLinks = document.querySelectorAll('nav a[href="/system"]');
  navLinks.forEach(a => {
    if (a.querySelector('._upd_dot')) return;
    a.style.position = 'relative';
    const dot = document.createElement('span');
    dot.className = '_upd_dot';
    dot.style.cssText = 'position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;background:#f59e0b;border:1.5px solid #0f1117';
    a.appendChild(dot);
  });
}

function _removeNavBadge() {
  document.querySelectorAll('._upd_dot').forEach(d => d.remove());
}

function _showUpdateBanner(version) {
  if (document.getElementById('_ui_update_banner')) return;

  const banner = document.createElement('div');
  banner.id = '_ui_update_banner';
  banner.className = 'fixed top-4 right-4 z-[9997] max-w-sm w-full bg-amber-900/90 border border-amber-500/40 rounded-2xl shadow-2xl p-4';
  banner.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-2 h-2 rounded-full bg-amber-400 mt-1.5 flex-shrink-0 animate-pulse"></div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-amber-300">Nueva versión disponible</p>
        <p class="text-xs text-amber-400/80 mt-0.5 font-mono">v${version}</p>
        <a href="/system" class="inline-block mt-2 text-xs text-amber-300 underline underline-offset-2 hover:text-white">Ir a Sistema para actualizar →</a>
      </div>
      <button onclick="document.getElementById('_ui_update_banner').remove()" class="text-amber-500 hover:text-amber-300 text-lg leading-none flex-shrink-0">×</button>
    </div>`;
  document.body.appendChild(banner);
}

// Activa todos los indicadores visuales de update pendiente
function _activateUpdateIndicators(version) {
  localStorage.setItem(LS_PENDING_VER, version);
  _applyNavBadge();
  _showUpdateBanner(version);

  // Punto en la sección de Actualización dentro de system.html (si existe)
  const sectionDot = document.getElementById('_update_section_dot');
  if (sectionDot) sectionDot.classList.remove('hidden');
}

// Limpia todos los indicadores (llamar al actualizar o al entrar a /system)
function clearUpdateIndicators() {
  localStorage.removeItem(LS_PENDING_VER);
  localStorage.removeItem(LS_LAST_CHECK);
  _removeNavBadge();
  const banner = document.getElementById('_ui_update_banner');
  if (banner) banner.remove();
  const sectionDot = document.getElementById('_update_section_dot');
  if (sectionDot) sectionDot.classList.add('hidden');
}

async function checkUpdateBackground() {
  if (!AUTH.getToken()) return;

  // Si ya hay una pendiente guardada → restaurar indicadores sin llamar al API
  if (_hasPendingUpdate()) {
    _applyNavBadge();
    _showUpdateBanner(_getPendingVersion());
    return;
  }

  const now       = Date.now();
  const lastCheck = parseInt(localStorage.getItem(LS_LAST_CHECK) || '0', 10);
  if (now - lastCheck < UPDATE_CHECK_INTERVAL) return;

  localStorage.setItem(LS_LAST_CHECK, now);

  try {
    const res  = await API.get('/system/check-update');
    const data = res.data;
    if (!data.hasUpdate) return;
    _activateUpdateIndicators(data.latest);
  } catch {
    // silencioso — es background
  }
}

window.UI = { buildNav, toast, confirmDialog, statusBadge, formatDate, checkUpdateBackground, clearUpdateIndicators };

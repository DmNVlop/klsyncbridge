'use strict';

// Manejo de JWT en frontend
// Interceptor global: si cualquier API devuelve 401 → redirigir a login

const AUTH = {
  TOKEN_KEY: 'sb_token',
  USER_KEY: 'sb_user',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    const raw = localStorage.getItem(this.USER_KEY);
    try { return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    window.location.href = '/login';
  },

  requireAuth() {
    if (!this.getToken()) {
      window.location.href = '/login';
      return false;
    }
    return true;
  },
};

// API helper con auth automático
const API = {
  async request(method, path, body = null) {
    const token = AUTH.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);

    const res = await fetch(`/api${path}`, opts);

    if (res.status === 401) {
      AUTH.logout();
      throw new Error('Sesión expirada');
    }

    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.error || 'Error en la solicitud');
      err.details = data.details || null;
      throw err;
    }
    return data;
  },

  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body),
  put: (path, body) => API.request('PUT', path, body),
  delete: (path) => API.request('DELETE', path),
};

// Exponer globalmente
window.AUTH = AUTH;
window.API = API;

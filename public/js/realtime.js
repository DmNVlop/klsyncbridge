'use strict';

// Helper SSE — reconecta automáticamente, despacha callbacks por tipo de evento
const REALTIME = (() => {
  let _es = null;
  let _handlers = {}; // eventName → [fn, ...]
  let _reconnectTimer = null;

  function connect() {
    const token = AUTH.getToken();
    if (!token) return;

    // EventSource no soporta headers personalizados — pasamos token como query param
    _es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

    _es.onopen = () => {
      clearTimeout(_reconnectTimer);
    };

    _es.onerror = () => {
      _es.close();
      _es = null;
      // Reconectar en 5s
      _reconnectTimer = setTimeout(connect, 5000);
    };

    // Registrar todos los handlers conocidos en la nueva instancia
    for (const [name, fns] of Object.entries(_handlers)) {
      for (const fn of fns) {
        _es.addEventListener(name, _wrap(fn));
      }
    }
  }

  function _wrap(fn) {
    return (e) => {
      try {
        const data = JSON.parse(e.data);
        fn(data);
      } catch { /* ignorar mensajes mal formados */ }
    };
  }

  function on(eventName, fn) {
    if (!_handlers[eventName]) _handlers[eventName] = [];
    _handlers[eventName].push(fn);
    if (_es) _es.addEventListener(eventName, _wrap(fn));
  }

  function disconnect() {
    clearTimeout(_reconnectTimer);
    if (_es) { _es.close(); _es = null; }
    _handlers = {};
  }

  return { connect, on, disconnect };
})();

window.REALTIME = REALTIME;

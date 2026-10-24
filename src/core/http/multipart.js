'use strict';

/**
 * Cuerpo multipart con FormData/Blob nativos de Node 24 (axios 1.16 los serializa con su boundary).
 * No fijar 'Content-Type' a mano en la petición: lo pone axios.
 */
function buildMultipart({ fieldName = 'file', buffer, fileName, contentType = 'application/octet-stream', fields = {} }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append(fieldName, new Blob([buffer], { type: contentType }), fileName);
  return form;
}

module.exports = { buildMultipart };

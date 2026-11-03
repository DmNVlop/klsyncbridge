'use strict';

/**
 * sc.exe escribe en la página de códigos OEM de la consola (850 en Windows en español), no en UTF-8:
 * leído como UTF-8, «CÓD_SALIDA» sale como «C�D_SALIDA». Node no trae decodificador cp850, así que va la tabla.
 * Los caracteres ASCII (todo el texto en inglés) son idénticos en cualquier página OEM.
 */

const { execFile } = require('child_process');

// Caracteres 0x80-0xFF de la página de códigos 850.
const CP850_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

function decodeCp850(buffer) {
  let out = '';
  for (const byte of buffer) out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
  return out;
}

/** Como execFile('sc', args, options, cb), pero con stdout/stderr ya decodificados. */
function execSc(args, options, callback) {
  return execFile('sc', args, { ...options, encoding: 'buffer' }, (err, stdout, stderr) => {
    callback(err, decodeCp850(stdout || Buffer.alloc(0)), decodeCp850(stderr || Buffer.alloc(0)));
  });
}

module.exports = { decodeCp850, execSc };

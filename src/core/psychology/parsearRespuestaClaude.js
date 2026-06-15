/**
 * parsearRespuestaClaude.js — Extracción de JSON del texto crudo de Claude.
 *
 * Estrategia 1: parse directo del texto (Claude devolvió JSON puro).
 * Estrategia 2: extraer bloque {...} del texto (Claude añadió texto antes/después).
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 */

/**
 * @param {string} texto — texto crudo devuelto por Claude
 * @returns {{ ok: true, json: object } | { ok: false, razon: string, textoRaw?: string }}
 */
export function parsearRespuestaClaude(texto) {
  if (typeof texto !== 'string' || !texto.trim()) {
    return { ok: false, razon: 'Texto vacío o inválido' };
  }

  // Estrategia 1: parse directo
  try {
    return { ok: true, json: JSON.parse(texto.trim()) };
  } catch {}

  // Estrategia 2: extraer bloque JSON del texto
  const match = texto.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return { ok: true, json: JSON.parse(match[0]) };
    } catch (e) {
      return { ok: false, razon: `JSON malformado en respuesta: ${e.message}`, textoRaw: texto.slice(0, 500) };
    }
  }

  return { ok: false, razon: 'No se encontró JSON en la respuesta de Claude', textoRaw: texto.slice(0, 500) };
}

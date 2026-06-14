// Caché en memoria para schedules diarios — dentro de la misma ejecución,
// múltiples equipos consultan las mismas fechas; esto evita llamadas duplicadas.
const _scheduleCache = new Map();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/json,text/plain,*/*',
  'Referer':    'https://www.fotmob.com/'
};
const BASE = 'https://www.fotmob.com/api/data';

async function fetchFotmob(url) {
  const res  = await fetch(url, { headers: HEADERS });
  const text = await res.text();

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    // 200 pero no JSON → típicamente un challenge de Cloudflare
    const err = new Error('respuesta no es JSON — posible bloqueo de Cloudflare');
    err.status = 200;
    err.body   = text;
    throw err;
  }
}

/**
 * Partidos de FotMob para una fecha dada.
 * @param {string} fechaYYYYMMDD — ej. '20260611'
 */
export async function obtenerPartidosFotmobPorFecha(fechaYYYYMMDD) {
  if (_scheduleCache.has(fechaYYYYMMDD)) return _scheduleCache.get(fechaYYYYMMDD);
  const data = await fetchFotmob(`${BASE}/matches?date=${fechaYYYYMMDD}`);
  _scheduleCache.set(fechaYYYYMMDD, data);
  return data;
}

/**
 * Detalle completo de un partido (incluye xG por tiro, stats avanzadas).
 * @param {string|number} matchIdFotmob — ID interno de FotMob
 */
export async function obtenerDetallePartido(matchIdFotmob) {
  return fetchFotmob(`${BASE}/matchDetails?matchId=${matchIdFotmob}`);
}

/**
 * Datos de equipo de FotMob, incluyendo fixtures.allFixtures.fixtures
 * con el historial de partidos jugados.
 * @param {number} fotmobTeamId — ID interno de FotMob para el equipo
 */
export async function obtenerEquipoFotmob(fotmobTeamId) {
  return fetchFotmob(`${BASE}/teams?id=${fotmobTeamId}`);
}

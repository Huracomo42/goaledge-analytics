import 'dotenv/config';

const BASE_URL   = 'https://api.football-data.org/v4';
const TOKEN      = process.env.FOOTBALL_DATA_TOKEN;
const MUNDIAL_ID = 2000; // FIFA World Cup en football-data.org

function headers() {
  return { 'X-Auth-Token': TOKEN };
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data.org ${res.status} en ${path}: ${body}`);
  }
  return res.json();
}

// Cache de proceso: el fixture de 104 partidos no cambia durante una ejecución
let _mundialCache = null;

/**
 * Devuelve los fixtures del Mundial 2026 (competition id 2000).
 * Retorna el array crudo de matches tal como llega de la API,
 * para que el llamador decida qué campos necesita.
 */
export async function obtenerPartidosMundial() {
  if (_mundialCache) return _mundialCache;
  const data = await get(`/competitions/${MUNDIAL_ID}/matches`);
  _mundialCache = data.matches ?? [];
  return _mundialCache;
}

/**
 * Devuelve los últimos partidos FINISHED de un equipo.
 * No normaliza goles a escala 1-10 — devuelve los datos crudos
 * para que el Data Pipeline de E001/E002 aplique su propia ponderación.
 *
 * @param {number} equipoId  — ID numérico de football-data.org
 * @param {number} limite    — cuántos partidos recientes pedir (default 15, suficiente para K=10 + buffer)
 */
export async function obtenerPartidosRecientesEquipo(equipoId, limite = 15) {
  const data = await get(`/teams/${equipoId}/matches?status=FINISHED&limit=${limite}`);
  return (data.matches ?? []).map(m => ({
    id:              m.id,
    fecha:           m.utcDate,
    competicion:     m.competition?.name ?? null,
    equipo_local_id: m.homeTeam?.id ?? null,
    equipo_local:    m.homeTeam?.name ?? null,
    equipo_visit_id: m.awayTeam?.id ?? null,
    equipo_visit:    m.awayTeam?.name ?? null,
    goles_local:     m.score?.fullTime?.home ?? null,
    goles_visit:     m.score?.fullTime?.away ?? null,
    estado:          m.status
  }));
}

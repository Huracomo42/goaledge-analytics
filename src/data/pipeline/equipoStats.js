import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { obtenerPartidosFotmobPorFecha, obtenerDetallePartido, obtenerEquipoFotmob } from './fotmob.js';
import { MU_LIGA } from '../../core/prediction/poisson.js';

const DECAY          = 0.1;
const K              = 5;
const MUNDIAL_INICIO = '2026-06-11';
const CACHE_PATH     = resolve('data/cache/xg_partidos.json');
const DELAY_MS       = 400;

// ── Caché de xG ─────────────────────────────────────────────────────────────
// { [matchId]: { xg_local, xg_visitante, home_team_id } }   ← partido con xG
// { [matchId]: { sin_xg: true } }                           ← partido sin xG (no re-llamar)
//
// home_team_id permite derivar la perspectiva de cualquier equipo sin re-llamar.

function leerCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); }
  catch { return {}; }
}

function guardarCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

// ── Utilidades ───────────────────────────────────────────────────────────────

function generarFechasEnRango(desdeISO, hastaISO) {
  const fechas  = [];
  const current = new Date(desdeISO + 'T00:00:00Z');
  const fin     = new Date(hastaISO + 'T00:00:00Z');
  while (current < fin) {
    fechas.push(current.toISOString().slice(0, 10).replace(/-/g, ''));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return fechas;
}

function pesosExponenciales(n) {
  const brutos = Array.from({ length: n }, (_, i) => Math.exp(-DECAY * (i + 1)));
  const suma   = brutos.reduce((a, w) => a + w, 0);
  return brutos.map(w => w / suma);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── xG con caché ─────────────────────────────────────────────────────────────
//
// Usa general.homeTeam.id del matchDetails para determinar local/visitante,
// ya que allFixtures.home/away no es fiable en partidos a sede neutral.
// Cachea también los partidos sin xG (sin_xg: true) para no volver a llamarlos.

async function obtenerXgConCache(matchId, equipoIdFotmob, cache, conDelay = false) {
  const key = String(matchId);

  if (cache[key] !== undefined) {
    if (cache[key].sin_xg) return null;
    const c = cache[key];
    const esLocal = c.home_team_id === equipoIdFotmob;
    return {
      ataque:  esLocal ? Number(c.xg_local) : Number(c.xg_visitante),
      defensa: esLocal ? Number(c.xg_visitante) : Number(c.xg_local),
    };
  }

  if (conDelay) await delay(DELAY_MS);

  let detalle;
  try { detalle = await obtenerDetallePartido(matchId); }
  catch { return null; }

  // Partido no terminado: no cachear nada — el xG será diferente al final
  if (!detalle?.general?.status?.finished) return null;

  const homeTeamId = Number(detalle?.general?.homeTeam?.id ?? 0);
  const statsArr   = detalle?.content?.stats?.Periods?.All?.stats;

  if (!statsArr) {
    if (conDelay) { cache[key] = { sin_xg: true }; guardarCache(cache); }
    return null;
  }

  const xgBloque = statsArr.find(s => s.key === 'expected_goals');
  const dblBlock = xgBloque?.stats?.find(s => s.format === 'double');
  const rawL     = dblBlock?.stats?.[0];
  const rawV     = dblBlock?.stats?.[1];

  if (rawL == null || rawV == null) {
    if (conDelay) { cache[key] = { sin_xg: true }; guardarCache(cache); }
    return null;
  }

  const xgL = Number(rawL);
  const xgV = Number(rawV);

  cache[key] = { xg_local: xgL, xg_visitante: xgV, home_team_id: homeTeamId };
  guardarCache(cache);

  const esLocal = homeTeamId === equipoIdFotmob;
  return {
    ataque:  esLocal ? xgL : xgV,
    defensa: esLocal ? xgV : xgL,
  };
}

// ── Historial pre-Mundial ────────────────────────────────────────────────────
//
// Devuelve TODOS los partidos terminados antes de MUNDIAL_INICIO (no antes de
// fechaCorte, para evitar solapamiento con los partidos del Mundial).
// No limitamos a `necesarios` aquí porque algunos partidos no tendrán xG (ej.
// amistosos): el bucle principal itera hasta acumular K con xG.

async function obtenerPartidosPreMundial(equipoIdFotmob) {
  await delay(DELAY_MS); // evitar rate-limit después del loop de schedule WC

  let teamData;
  try { teamData = await obtenerEquipoFotmob(equipoIdFotmob); }
  catch (e) {
    console.warn(`[equipoStats] obtenerEquipoFotmob(${equipoIdFotmob}) falló: ${e.message}`);
    return [];
  }

  const fixtures = teamData?.fixtures?.allFixtures?.fixtures;
  if (!fixtures || typeof fixtures !== 'object') return [];

  const corteMs = new Date(MUNDIAL_INICIO + 'T00:00:00Z').getTime();

  return Object.values(fixtures)
    .filter(f => {
      if (!f?.status?.finished) return false;
      const t = new Date(f.status.utcTime).getTime();
      return !isNaN(t) && t < corteMs;
    })
    .sort((a, b) => new Date(b.status.utcTime) - new Date(a.status.utcTime))
    .map(f => ({
      matchId:    f.id,
      fecha:      f.status.utcTime.slice(0, 10),
      tournament: f.tournament?.name ?? '',
    }));
}

// ── Función principal ────────────────────────────────────────────────────────

/**
 * Calcula ataque (E001) y defensa (E002) de un equipo.
 *
 * Fuentes (en orden de recencia):
 *   1. Partidos del Mundial 2026 antes de fechaCorte  →  "mundial"
 *   2. Partidos pre-Mundial de allFixtures            →  "historial"
 *      (itera hasta completar K partidos con xG; amistosos sin xG se saltan)
 *
 * xG se cachea en data/cache/xg_partidos.json:
 *   - partidos con xG: { xg_local, xg_visitante, home_team_id }
 *   - partidos sin xG: { sin_xg: true }  ← para no re-llamar a FotMob
 *
 * @param {number} equipoIdFotmob — ID FotMob del equipo
 * @param {string} fechaCorte     — 'YYYY-MM-DD'; excluye partidos de ese día en adelante
 * @returns {{ ataque, defensa, n_partidos, muestra_pequena, fuente, partidos_usados }}
 */
export async function calcularAtaqueDefensa(equipoIdFotmob, fechaCorte) {
  const cache = leerCache();

  // — 1. Partidos del Mundial en [MUNDIAL_INICIO, fechaCorte) —
  const wcPartidos = [];
  for (const fechaStr of generarFechasEnRango(MUNDIAL_INICIO, fechaCorte)) {
    let dia;
    try { dia = await obtenerPartidosFotmobPorFecha(fechaStr); }
    catch { continue; }

    for (const liga of (dia.leagues ?? [])) {
      for (const match of (liga.matches ?? [])) {
        const homeId = Number(match.home?.id);
        const awayId = Number(match.away?.id);
        if (homeId === equipoIdFotmob || awayId === equipoIdFotmob) {
          const f = fechaStr;
          wcPartidos.push({
            matchId: match.id,
            fecha:   `${f.slice(0,4)}-${f.slice(4,6)}-${f.slice(6)}`,
          });
        }
      }
    }
  }
  wcPartidos.sort((a, b) => b.fecha.localeCompare(a.fecha));

  // — 2. xG de partidos del Mundial —
  const wcMuestras = [];
  for (const { matchId, fecha } of wcPartidos.slice(0, K)) {
    const xg = await obtenerXgConCache(matchId, equipoIdFotmob, cache, false);
    if (xg) wcMuestras.push({ ...xg, matchId, fecha, tipo: 'mundial' });
  }

  // — 3. Completar con historial pre-Mundial si n < K —
  const preMuestras = [];
  const target = K - wcMuestras.length;

  if (target > 0) {
    const prePartidos = await obtenerPartidosPreMundial(equipoIdFotmob);
    for (const { matchId, fecha, tournament } of prePartidos) {
      if (preMuestras.length >= target) break;
      const xg = await obtenerXgConCache(matchId, equipoIdFotmob, cache, true);
      if (xg) preMuestras.push({ ...xg, matchId, fecha, tournament, tipo: 'historial' });
    }
  }

  // — 4. Combinar, asignar pesos, calcular medias —
  const muestras = [...wcMuestras, ...preMuestras];

  if (muestras.length === 0) {
    return {
      ataque: MU_LIGA, defensa: MU_LIGA,
      n_partidos: 0, muestra_pequena: true,
      fuente: 'default_mu_liga', partidos_usados: [],
    };
  }

  const pesos    = pesosExponenciales(muestras.length);
  const sumaPesos = pesos.reduce((a, w) => a + w, 0); // = 1.0 (ya normalizados)
  const ataque   = muestras.reduce((acc, m, i) => acc + pesos[i] * m.ataque,  0) / sumaPesos;
  const defensa  = muestras.reduce((acc, m, i) => acc + pesos[i] * m.defensa, 0) / sumaPesos;

  const usaHistorial = preMuestras.length > 0;
  const fuente = usaHistorial ? 'fotmob_mundial_2026+historial' : 'fotmob_mundial_2026';

  return {
    ataque,
    defensa,
    n_partidos:      muestras.length,
    muestra_pequena: muestras.length < K,
    fuente,
    partidos_usados: muestras.map((m, i) => ({
      matchId:        m.matchId,
      fecha:          m.fecha,
      tournament:     m.tournament ?? null,
      xg_ataque:      m.ataque,
      xg_defensa:     m.defensa,
      peso_pct:       +(pesos[i] * 100).toFixed(1),
      fuente_partido: m.tipo,
    })),
  };
}

/**
 * oddsApi.js — Transformación de respuestas de The Odds API v4.
 *
 * Sin efectos secundarios: sin Firestore, sin I/O, sin llamadas HTTP aquí.
 * La llamada HTTP real a The Odds API se hará en un módulo separado
 * (pendiente Fase 2c).
 *
 * Formato de entrada documentado en data/ejemplos/odds_api_ejemplo.json.
 * Ver comentarios de confianza en ese archivo sobre qué partes de la
 * estructura de la API están verificadas vs. inferidas.
 */

import { impliedProbability }      from '../../core/betting/bettingMath.js';
import { normalizar as norm }       from '../../core/utils/teamNames.js';

// ── Utilidades internas ──────────────────────────────────────────────────────

function mediana(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Overround como porcentaje: (suma de implied probs - 1) * 100
function calcularOverroundPct(oddsArray) {
  const suma = oddsArray.reduce((acc, o) => acc + impliedProbability(o), 0);
  return +(((suma - 1) * 100).toFixed(2));
}

// Encuentra el evento correcto en la respuesta de la API (array de eventos).
// Usa normalizar() de teamNames.js — incluye alias "Czech Republic"→"Czechia",
// "USA"→"United States", etc.
export function encontrarEvento(eventos, homeTeam, awayTeam) {
  const nh = norm(homeTeam);
  const na = norm(awayTeam);
  return eventos.find(ev => {
    const eh = norm(ev.home_team ?? '');
    const ea = norm(ev.away_team ?? '');
    // Coincidencia exacta normalizada, o subconjunto (cubre "South Korea" vs "Korea")
    return (eh.includes(nh) || nh.includes(eh)) &&
           (ea.includes(na) || na.includes(ea));
  });
}

// ── Procesadores de mercados ─────────────────────────────────────────────────

function procesarH2h(bookmakers, homeTeam, awayTeam) {
  const nh = norm(homeTeam);
  const na = norm(awayTeam);

  const preciosLocal  = [];
  const preciosEmpate = [];
  const preciosVisit  = [];

  for (const bk of bookmakers) {
    const mkt = (bk.markets ?? []).find(m => m.key === 'h2h');
    if (!mkt) continue;

    for (const oc of (mkt.outcomes ?? [])) {
      const n = norm(oc.name ?? '');
      // El nombre en la API es el nombre del equipo (local/visita) o "draw"
      if (n === 'draw') {
        preciosEmpate.push(oc.price);
      } else if (n.includes(nh) || nh.includes(n)) {
        preciosLocal.push(oc.price);
      } else if (n.includes(na) || na.includes(n)) {
        preciosVisit.push(oc.price);
      }
    }
  }

  if (preciosLocal.length === 0 || preciosVisit.length === 0) return null;

  const oddsL = mediana(preciosLocal);
  const oddsX = preciosEmpate.length > 0 ? mediana(preciosEmpate) : null;
  const oddsV = mediana(preciosVisit);

  const oddsParaRound = [oddsL, oddsX, oddsV].filter(Boolean);

  return {
    criterio_agregacion: 'mediana',
    n_bookmakers:        preciosLocal.length,
    odds_local:          oddsL,
    odds_empate:         oddsX,
    odds_visitante:      oddsV,
    overround_pct:       calcularOverroundPct(oddsParaRound),
  };
}

function procesarTotals(bookmakers) {
  // Agrupa por línea (point) y toma la línea con más bookmakers
  const porLinea = new Map(); // point → { over: [], under: [] }

  for (const bk of bookmakers) {
    const mkt = (bk.markets ?? []).find(m => m.key === 'totals');
    if (!mkt) continue;

    for (const oc of (mkt.outcomes ?? [])) {
      const punto = oc.point;
      if (punto == null) continue;
      if (!porLinea.has(punto)) porLinea.set(punto, { over: [], under: [] });
      const grupo = porLinea.get(punto);
      const n = (oc.name ?? '').toLowerCase();
      if (n === 'over')  grupo.over.push(oc.price);
      if (n === 'under') grupo.under.push(oc.price);
    }
  }

  if (porLinea.size === 0) return null;

  // Elegir la línea con mayor cobertura de bookmakers
  let lineaPrincipal = null, maxN = 0;
  for (const [punto, g] of porLinea) {
    const n = Math.min(g.over.length, g.under.length);
    if (n > maxN) { maxN = n; lineaPrincipal = punto; }
  }

  const { over, under } = porLinea.get(lineaPrincipal);
  if (over.length === 0 || under.length === 0) return null;

  const oddsOver  = mediana(over);
  const oddsUnder = mediana(under);

  return {
    criterio_agregacion: 'mediana',
    n_bookmakers:        Math.min(over.length, under.length),
    linea:               lineaPrincipal,
    odds_over:           oddsOver,
    odds_under:          oddsUnder,
    overround_pct:       calcularOverroundPct([oddsOver, oddsUnder]),
  };
}

// ── Spreads (Asian Handicap) ─────────────────────────────────────────────────

// Quarter lines: ±0.25, ±0.75, ±1.25 — (abs × 4) is odd
function esLineaCuarto(line) {
  return Math.round(Math.abs(line) * 4) % 2 !== 0;
}

/**
 * Procesa el market "spreads" (Asian Handicap) de la respuesta de The Odds API.
 *
 * - Clasifica cada línea como 'oficial' (±0.5, ±1.0, ±1.5) o
 *   'linea_cuarto_informativa' (±0.25, ±0.75, ±1.25).
 * - Las líneas oficiales se indexan con 1 decimal: AH_local_-0.5, AH_visitante_+1.0.
 * - Las líneas cuarto se indexan con 2 decimales: AH_local_-0.75.
 * - La cuota agregada es la mediana entre bookmakers.
 *
 * @returns {object|null}  null si ningún bookmaker tiene el market "spreads".
 */
function procesarSpreads(bookmakers, homeTeam, awayTeam) {
  const nh = norm(homeTeam);
  const na = norm(awayTeam);

  const porLinea = new Map(); // `${side}|${line}` → { side, line, prices[], tipo }
  let nBksSpreads = 0;

  for (const bk of bookmakers) {
    const mkt = (bk.markets ?? []).find(m => m.key === 'spreads');
    if (!mkt) continue;
    nBksSpreads++;

    for (const oc of (mkt.outcomes ?? [])) {
      if (oc.point == null || oc.price == null) continue;

      const n = norm(oc.name ?? '');
      let side;
      if (n.includes(nh) || nh.includes(n))      side = 'local';
      else if (n.includes(na) || na.includes(n))  side = 'visitante';
      else continue;

      const line   = oc.point;
      const mapKey = `${side}|${line}`;
      if (!porLinea.has(mapKey)) {
        porLinea.set(mapKey, {
          side, line, prices: [],
          tipo: esLineaCuarto(line) ? 'linea_cuarto_informativa' : 'oficial',
        });
      }
      porLinea.get(mapKey).prices.push(oc.price);
    }
  }

  if (nBksSpreads === 0) return null;

  const lineas_oficiales = {};
  const lineas_cuarto    = {};

  for (const [, { side, line, prices, tipo }] of porLinea) {
    const med   = mediana(prices);
    const signo = line >= 0 ? '+' : '-';
    const entry = { side, line, mediana: med, n_bookmakers: prices.length, tipo };

    if (tipo === 'oficial') {
      const key = `AH_${side}_${signo}${Math.abs(line).toFixed(1)}`;
      lineas_oficiales[key] = { ...entry, key_ah: key };
    } else {
      const key = `AH_${side}_${signo}${Math.abs(line).toFixed(2)}`;
      lineas_cuarto[key]    = { ...entry, key_ah: key };
    }
  }

  return {
    criterio_agregacion:  'mediana',
    n_bookmakers_spreads: nBksSpreads,
    n_lineas_oficiales:   Object.keys(lineas_oficiales).length,
    n_lineas_cuarto:      Object.keys(lineas_cuarto).length,
    lineas_oficiales,
    lineas_cuarto,
  };
}

// ── Función principal exportada ──────────────────────────────────────────────

/**
 * Transforma la respuesta de The Odds API v4 al esquema interno odds_snapshots.
 *
 * La API devuelve un array de eventos; esta función localiza el evento correcto
 * por nombre de equipo (flexible, insensible a tildes/mayúsculas) y extrae
 * la mediana de cuotas entre todos los bookmakers por mercado.
 *
 * @param {object}   rawResponse            Respuesta de The Odds API (objeto con
 *                                          propiedad "eventos" — ver ejemplo en
 *                                          data/ejemplos/odds_api_ejemplo.json).
 *                                          En producción, la respuesta real de la
 *                                          API es un array directo; esta función
 *                                          acepta ambas formas.
 * @param {number}   matchId                ID del partido en football-data.org.
 * @param {string}   fechaPartido           'YYYY-MM-DD'.
 * @param {object}   [opciones]
 * @param {string}   [opciones.homeTeam]    Nombre del equipo local (FD). Si no se
 *                                          pasa, usa el primer evento de la respuesta.
 * @param {string}   [opciones.awayTeam]    Nombre del equipo visitante (FD).
 * @param {string}   [opciones.region]      Región de la llamada API ('eu','us','uk','au').
 * @param {string}   [opciones.tipoSnapshot]  'pre_partido' | 'apertura' | 'cierre'.
 *
 * @returns {object}  Esquema odds_snapshots.
 * @throws  {Error}   Si no se encuentra el evento o faltan mercados clave.
 */
export function transformarRespuestaOddsApi(rawResponse, matchId, fechaPartido, opciones = {}) {
  const {
    homeTeam    = null,
    awayTeam    = null,
    region      = 'eu',
    tipoSnapshot = 'pre_partido',
  } = opciones;

  // Normalizar: la API real devuelve un array directo; el ejemplo usa { eventos: [] }
  const eventos = Array.isArray(rawResponse)
    ? rawResponse
    : Array.isArray(rawResponse?.eventos)
      ? rawResponse.eventos
      : null;

  if (!eventos || eventos.length === 0) {
    throw new Error('transformarRespuestaOddsApi: respuesta vacía o formato inesperado.');
  }

  // Localizar el evento
  let evento;
  if (homeTeam && awayTeam) {
    evento = encontrarEvento(eventos, homeTeam, awayTeam);
    if (!evento) {
      throw new Error(
        `transformarRespuestaOddsApi: no se encontró el partido "${homeTeam}" vs "${awayTeam}" en la respuesta.`
      );
    }
  } else {
    // Sin nombres: tomar el único evento (útil si la llamada API fue por eventId)
    if (eventos.length > 1) {
      throw new Error(
        'transformarRespuestaOddsApi: la respuesta tiene múltiples eventos pero no se especificaron homeTeam/awayTeam para identificar el correcto.'
      );
    }
    evento = eventos[0];
  }

  const { bookmakers = [], home_team, away_team } = evento;

  if (bookmakers.length === 0) {
    throw new Error(
      `transformarRespuestaOddsApi: el evento "${home_team} vs ${away_team}" no tiene bookmakers en la respuesta.`
    );
  }

  // Procesar mercados
  const h2h     = procesarH2h(bookmakers, home_team, away_team);
  const totals  = procesarTotals(bookmakers);
  const spreads = procesarSpreads(bookmakers, home_team, away_team);

  if (!h2h) {
    throw new Error(
      `transformarRespuestaOddsApi: no se encontraron odds h2h válidas para "${home_team} vs ${away_team}".`
    );
  }

  return {
    matchId,
    fecha_partido:  fechaPartido,
    capturado_en:   new Date().toISOString(),
    tipo_snapshot:  tipoSnapshot,
    fuente_api:     'the-odds-api-v4',
    region,
    mercados: {
      ...(h2h     && { h2h }),
      ...(totals  && { totals }),
      ...(spreads && { spreads }),
    },
  };
}

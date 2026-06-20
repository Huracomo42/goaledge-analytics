/**
 * generarSeñalesProtegidaJ1Spreads.js — V2.2 Señales Protegidas con cuotas AH reales
 *
 * 1 llamada The Odds API (markets=h2h,totals,spreads) para los 12 partidos J1.
 * Cruza cuotas reales de spreads con mercados protegidos calculados desde Poisson.
 *
 * GARANTÍAS:
 *   - 0 escrituras Firestore (ni set, update, add, delete, batch ni transaction)
 *   - EXACTAMENTE 1 llamada a The Odds API
 *   - 0 llamadas Claude API
 *   - No modifica Prediction Engine V2.1
 *   - No sobreescribe señales_valor
 *   - Markets: h2h, totals, spreads — NO double_chance, draw_no_bet, alternate_*
 *
 * Salidas:
 *   reports/odds_j1_h2h_totals_spreads_raw.json
 *   reports/senales_protegidas_j1_spreads_dryrun.json
 *   reports/senales_protegidas_j1_spreads_dryrun.md
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';
import {
  deriveAllProtectedMarkets,
  mapBaseSignalToProtectedMarkets,
  classifyProtectedMarketRisk,
  evConPush,
  evSimple,
} from '../src/betting/protectionMarkets.js';

const db = getFirestore();

// ── Constantes ─────────────────────────────────────────────────────────────────

const J1_IDS = [
  '537369', '537363', '537370', '537364',
  '537391', '537392', '537397', '537398',
  '537403', '537409', '537410', '537404',
];

const API_KEY   = process.env.THE_ODDS_API_KEY;
const BASE_URL  = 'https://api.the-odds-api.com';
const SPORT     = 'soccer_fifa_world_cup';
const MARKETS   = 'h2h,totals,spreads';
const EXCLUIDOS = ['double_chance', 'draw_no_bet', 'alternate_spreads', 'alternate_totals'];
const HOY       = new Date().toISOString().slice(0, 10);

if (!API_KEY) { console.error('ERROR: THE_ODDS_API_KEY no definida'); process.exit(1); }

// ── Encabezado ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  V2.2 — SEÑALES PROTEGIDAS J1 — SPREADS REALES');
console.log('═'.repeat(70));
console.log(`  Fecha: ${HOY}  |  0 escrituras Firestore  |  1 llamada API\n`);

// ── Paso 1: Leer predicciones desde Firestore ─────────────────────────────────

console.log('[1/4] Leyendo predicciones J1 desde Firestore...');
const snaps = await Promise.all(
  J1_IDS.map(id => db.collection('predicciones').doc(id).get())
);

const predicciones = [];
for (const snap of snaps) {
  if (!snap.exists) { console.log(`  ✗ ${snap.id} — NO encontrado`); continue; }
  const d = snap.data();
  predicciones.push({ matchId: snap.id, ...d });
  console.log(`  ✓ ${snap.id} — ${d.nombreLocal} vs ${d.nombreVisitante}`);
}
console.log(`\n  ${predicciones.length}/12 cargadas\n`);

// ── Paso 2: Mostrar URL y ejecutar llamada ────────────────────────────────────

const url     = `${BASE_URL}/v4/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=eu&markets=${MARKETS}&oddsFormat=decimal`;
const urlSafe = url.replace(API_KEY, '***KEY***');

console.log('[2/4] Parámetros de la llamada:');
console.log(`  URL        : ${urlSafe}`);
console.log(`  Markets    : ${MARKETS}`);
console.log(`  Excluidos  : ${EXCLUIDOS.join(', ')}`);
console.log(`  Firestore  : 0 escrituras\n`);

const apiRes = await fetch(url);

const creditos = {
  last_call:  apiRes.headers.get('x-requests-last'),
  remaining:  apiRes.headers.get('x-requests-remaining'),
  used:       apiRes.headers.get('x-requests-used'),
};

console.log(`  HTTP ${apiRes.status}`);
console.log(`  x-requests-last     : ${creditos.last_call}`);
console.log(`  x-requests-remaining: ${creditos.remaining}`);
console.log(`  x-requests-used     : ${creditos.used}\n`);

if (!apiRes.ok) {
  console.error(`  ERROR HTTP ${apiRes.status}: ${await apiRes.text()}`);
  process.exit(1);
}

const eventos = await apiRes.json();
console.log(`  Eventos en respuesta: ${eventos.length}\n`);

// ── Helpers de resolución y EV ────────────────────────────────────────────────

function resolverMercadoProtegido(id, mercados, nL, nV) {
  const dc  = mercados.double_chance;
  const dnb = mercados.draw_no_bet;
  const ah  = mercados.asian_handicap;
  const tot = mercados.totales_protegidos;
  const tt  = mercados.team_totals;

  switch (id) {
    case 'DC_1X':  return { descripcion: `${nL} gana o empate`,    fuente: 'double_chance', prob_modelo: dc['1X'] };
    case 'DC_X2':  return { descripcion: `Empate o ${nV} gana`,    fuente: 'double_chance', prob_modelo: dc['X2'] };
    case 'DC_12':  return { descripcion: `${nL} o ${nV} gana`,     fuente: 'double_chance', prob_modelo: dc['12'] };

    case 'DNB_local':
      return { descripcion: `${nL} DNB`, fuente: 'draw_no_bet', tiene_push: true,
               prob_modelo: dnb.local_dnb.prob_win, prob_push: dnb.local_dnb.prob_push, prob_loss: dnb.local_dnb.prob_loss };
    case 'DNB_visitante':
      return { descripcion: `${nV} DNB`, fuente: 'draw_no_bet', tiene_push: true,
               prob_modelo: dnb.visitante_dnb.prob_win, prob_push: dnb.visitante_dnb.prob_push, prob_loss: dnb.visitante_dnb.prob_loss };

    case 'AH_local_+0.5':     return { descripcion: `${nL} +0.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_+0.5']?.prob_win,     prob_loss: ah['AH_local_+0.5']?.prob_loss };
    case 'AH_local_+1.0':     return { descripcion: `${nL} +1.0`,  fuente: 'asian_handicap', tiene_push: true,  prob_modelo: ah['AH_local_+1.0']?.prob_win,     prob_loss: ah['AH_local_+1.0']?.prob_loss,     prob_push: ah['AH_local_+1.0']?.prob_push };
    case 'AH_local_+1.5':     return { descripcion: `${nL} +1.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_+1.5']?.prob_win,     prob_loss: ah['AH_local_+1.5']?.prob_loss };
    case 'AH_local_-0.5':     return { descripcion: `${nL} -0.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_-0.5']?.prob_win,     prob_loss: ah['AH_local_-0.5']?.prob_loss };
    case 'AH_visitante_+0.5': return { descripcion: `${nV} +0.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_+0.5']?.prob_win, prob_loss: ah['AH_visitante_+0.5']?.prob_loss };
    case 'AH_visitante_+1.0': return { descripcion: `${nV} +1.0`,  fuente: 'asian_handicap', tiene_push: true,  prob_modelo: ah['AH_visitante_+1.0']?.prob_win, prob_loss: ah['AH_visitante_+1.0']?.prob_loss, prob_push: ah['AH_visitante_+1.0']?.prob_push };
    case 'AH_visitante_+1.5': return { descripcion: `${nV} +1.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_+1.5']?.prob_win, prob_loss: ah['AH_visitante_+1.5']?.prob_loss };
    case 'AH_visitante_-0.5': return { descripcion: `${nV} -0.5`,  fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_-0.5']?.prob_win, prob_loss: ah['AH_visitante_-0.5']?.prob_loss };

    case 'over_1.5':           return { descripcion: 'Over 1.5',          fuente: 'totales_protegidos', prob_modelo: tot.over_1_5  };
    case 'over_2.5':           return { descripcion: 'Over 2.5',          fuente: 'totales_protegidos', prob_modelo: tot.over_2_5  };
    case 'under_3.5':          return { descripcion: 'Under 3.5',         fuente: 'totales_protegidos', prob_modelo: tot.under_3_5 };
    case 'team_home_over_0_5': return { descripcion: `${nL} ≥1 gol`,     fuente: 'team_totals',        prob_modelo: tt.home_over_0_5 };
    case 'team_away_over_0_5': return { descripcion: `${nV} ≥1 gol`,     fuente: 'team_totals',        prob_modelo: tt.away_over_0_5 };
    default: return null;
  }
}

function calcularEV(prob_modelo, tiene_push, prob_loss, cuota_real) {
  if (!cuota_real || !prob_modelo || cuota_real <= 1) return { ev: null, edge: null };
  const ev   = (tiene_push && prob_loss != null)
    ? evConPush(prob_modelo, prob_loss, cuota_real)
    : evSimple(prob_modelo, cuota_real);
  const edge = +(prob_modelo - 1 / cuota_real).toFixed(4);
  return { ev, edge };
}

// ── Paso 3: Procesar partidos ─────────────────────────────────────────────────

console.log('[3/4] Calculando señales protegidas...\n');

const resultados = [];
const rawOdds    = {};

const qc = {
  partidos_procesados: 0, partidos_con_spreads: 0, partidos_sin_odds_api: 0,
  total_bks_spreads: 0, total_lineas_oficiales: 0, total_lineas_cuarto: 0,
  senales_activas: 0, mercados_protegidos_totales: 0,
  mercados_apostables: 0, mercados_calculable_no_apostable: 0, mercados_no_recomendados: 0,
  ev_positivo: 0, ev_negativo: 0, ev_cero: 0,
};

for (const pred of predicciones) {
  const {
    matchId, nombreLocal, nombreVisitante, fechaPartido,
    lambda_local, lambda_visitante, prob_1x2, prob_over_under, señales_valor,
  } = pred;

  qc.partidos_procesados++;
  const nombre = `${nombreLocal} vs ${nombreVisitante}`;

  // Todos los mercados protegidos matemáticos desde Poisson
  const mercados = deriveAllProtectedMarkets(
    lambda_local, lambda_visitante, prob_1x2, prob_over_under
  );

  if (!mercados.calculable) {
    console.log(`  ✗ ${matchId} ${nombre} — ${mercados.error}`);
    resultados.push({ matchId, nombre, error: mercados.error });
    continue;
  }

  // Buscar evento en respuesta API
  let oddsSnapshot = null, spreads_data = null;
  try {
    oddsSnapshot = transformarRespuestaOddsApi(eventos, matchId, fechaPartido ?? HOY, {
      homeTeam: nombreLocal,
      awayTeam: nombreVisitante,
    });
    spreads_data = oddsSnapshot?.mercados?.spreads ?? null;
    rawOdds[matchId] = { matchId, nombreLocal, nombreVisitante, fechaPartido, odds: oddsSnapshot };

    if (spreads_data) {
      qc.partidos_con_spreads++;
      qc.total_bks_spreads      += spreads_data.n_bookmakers_spreads ?? 0;
      qc.total_lineas_oficiales += spreads_data.n_lineas_oficiales   ?? 0;
      qc.total_lineas_cuarto    += spreads_data.n_lineas_cuarto      ?? 0;
    }
  } catch (err) {
    console.log(`  ⚠  ${matchId} ${nombre} — API: ${err.message}`);
    qc.partidos_sin_odds_api++;
    rawOdds[matchId] = { matchId, nombreLocal, nombreVisitante, fechaPartido, odds: null, error: err.message };
  }

  // Señales V2.1 activas
  const senalesActivas = (señales_valor ?? []).filter(s =>
    s.is_value_bet === true &&
    (s.recomendacion === 'apostar' || s.recomendacion === 'considerar')
  );
  qc.senales_activas += senalesActivas.length;

  // Mapear señales → mercados protegidos con EV
  const mapeo_señales = [];

  for (const señal of senalesActivas) {
    const contexto = {
      prob_1x2,
      prob_modelo:    señal.prob_modelo,
      bookmaker_odds: señal.bookmaker_odds,
    };

    const sugerencias = mapBaseSignalToProtectedMarkets(señal.mercado, señal.seleccion, contexto);
    const detalle     = [];

    for (const { id, razon_mapeo } of sugerencias) {

      if (id === 'proteccion_no_recomendada') {
        qc.mercados_no_recomendados++;
        qc.mercados_protegidos_totales++;
        detalle.push({ id, razon_mapeo, estado: 'no_recomendada', cuota_real: null, ev: null, edge: null });
        continue;
      }

      const resolved = resolverMercadoProtegido(id, mercados, nombreLocal, nombreVisitante);
      if (!resolved) continue;

      // Cuota real: solo AH desde spreads
      let cuota_real = null, n_bks_cuota = null, estado = 'calculable_no_apostable';
      if (id.startsWith('AH_') && spreads_data?.lineas_oficiales?.[id]) {
        const entry  = spreads_data.lineas_oficiales[id];
        cuota_real   = entry.mediana;
        n_bks_cuota  = entry.n_bookmakers;
        estado       = 'apostable';
        qc.mercados_apostables++;
      } else {
        qc.mercados_calculable_no_apostable++;
      }

      const { ev, edge } = calcularEV(
        resolved.prob_modelo, resolved.tiene_push ?? false, resolved.prob_loss, cuota_real
      );
      const tipo_proteccion = resolved.prob_modelo != null
        ? classifyProtectedMarketRisk(resolved.prob_modelo)
        : null;

      if (ev !== null) {
        if (ev > 0.001) qc.ev_positivo++;
        else if (ev < -0.001) qc.ev_negativo++;
        else qc.ev_cero++;
      }

      qc.mercados_protegidos_totales++;

      detalle.push({
        id,
        descripcion:    resolved.descripcion,
        razon_mapeo,
        tipo_proteccion,
        fuente_prob:    resolved.fuente,
        prob_modelo:    resolved.prob_modelo,
        tiene_push:     resolved.tiene_push  ?? false,
        prob_push:      resolved.prob_push   ?? null,
        prob_loss:      resolved.prob_loss   ?? null,
        cuota_real,
        n_bks_cuota,
        market_key_api: cuota_real ? 'spreads' : null,
        ev,
        edge,
        estado,
      });
    }

    mapeo_señales.push({
      señal_base: {
        mercado:        señal.mercado,
        seleccion:      señal.seleccion,
        prob_modelo:    señal.prob_modelo,
        bookmaker_odds: señal.bookmaker_odds,
      },
      n_protegidas:        detalle.length,
      mercados_protegidos: detalle,
    });
  }

  // Top 3 EV del partido
  const mejores_ev = mapeo_señales
    .flatMap(m => m.mercados_protegidos)
    .filter(p => p.ev !== null)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 3);

  const nApostable = mapeo_señales.flatMap(m => m.mercados_protegidos).filter(p => p.estado === 'apostable').length;
  const nEvPos     = mapeo_señales.flatMap(m => m.mercados_protegidos).filter(p => (p.ev ?? -1) > 0).length;

  console.log(`  ✓ ${String(matchId).padEnd(7)} ${nombre.padEnd(35)} señales=${senalesActivas.length}  AH=${nApostable}  ev+=${nEvPos}  bks=${spreads_data?.n_bookmakers_spreads ?? 0}`);

  resultados.push({
    matchId, nombre, fechaPartido,
    n_senales_activas:        senalesActivas.length,
    spreads_disponible:       spreads_data !== null,
    n_bks_spreads:            spreads_data?.n_bookmakers_spreads ?? 0,
    n_lineas_oficiales:       spreads_data?.n_lineas_oficiales   ?? 0,
    n_lineas_cuarto:          spreads_data?.n_lineas_cuarto      ?? 0,
    lineas_cuarto_info:       Object.keys(spreads_data?.lineas_cuarto ?? {}),
    mapeo_señales,
    mejores_ev,
  });
}

// ── Paso 4: Generar reportes ──────────────────────────────────────────────────

console.log('\n[4/4] Generando reportes...\n');

const OUT_DIR = resolve('reports');
mkdirSync(OUT_DIR, { recursive: true });

// Top 10 EV global
const top10EV = resultados
  .flatMap(r => (r.mapeo_señales ?? [])
    .flatMap(m => m.mercados_protegidos.map(p => ({ ...p, partido: r.nombre }))))
  .filter(p => p.ev !== null)
  .sort((a, b) => b.ev - a.ev)
  .slice(0, 10);

// ── raw JSON ──────────────────────────────────────────────────────────────────
writeFileSync(
  resolve(OUT_DIR, 'odds_j1_h2h_totals_spreads_raw.json'),
  JSON.stringify({
    meta: {
      generado_en: new Date().toISOString(),
      fecha_partidos: HOY,
      markets_usados: MARKETS.split(','),
      markets_excluidos: EXCLUIDOS,
      n_partidos_consultados: predicciones.length,
      n_partidos_con_odds: Object.values(rawOdds).filter(v => v.odds).length,
      escrituras_firestore: 0,
      url_safe: urlSafe,
      creditos,
    },
    partidos: rawOdds,
  }, null, 2),
  'utf8'
);
console.log('  ✓ reports/odds_j1_h2h_totals_spreads_raw.json');

// ── dryrun JSON ───────────────────────────────────────────────────────────────
writeFileSync(
  resolve(OUT_DIR, 'senales_protegidas_j1_spreads_dryrun.json'),
  JSON.stringify({
    meta: {
      version: 'V2.2-spreads-dryrun',
      generado_en: new Date().toISOString(),
      markets_usados: MARKETS.split(','),
      markets_excluidos: EXCLUIDOS,
      escrituras_firestore: 0,
      senales_valor_modificadas: false,
      llamadas_api: 1,
      creditos,
      control_calidad: qc,
      top_10_ev: top10EV.map(({ partido, id, descripcion, prob_modelo, cuota_real, ev, edge, tipo_proteccion, estado }) =>
        ({ partido, id, descripcion, prob_modelo, cuota_real, ev, edge, tipo_proteccion, estado })
      ),
    },
    partidos: resultados,
  }, null, 2),
  'utf8'
);
console.log('  ✓ reports/senales_protegidas_j1_spreads_dryrun.json');

// ── dryrun MD ─────────────────────────────────────────────────────────────────

const fmt_pct   = v  => v  != null ? `${(v * 100).toFixed(1)}%` : 'N/D';
const fmt_ev    = v  => v  != null ? (v > 0 ? `**+${(v*100).toFixed(2)}%**` : `${(v*100).toFixed(2)}%`) : 'N/D';
const fmt_cuota = v  => v  != null ? v.toFixed(3) : 'N/D';
const fmt_edge  = v  => v  != null ? (v > 0 ? `+${v.toFixed(3)}` : v.toFixed(3)) : 'N/D';

const md = [];
md.push(`# V2.2 Señales Protegidas J1 — Spreads Reales`);
md.push(`**${HOY}** | Markets: \`${MARKETS}\` | 0 escrituras Firestore | 1 llamada API`);
md.push('');

md.push(`## Resumen Ejecutivo`);
md.push('');
md.push(`| Métrica | Valor |`);
md.push(`|---------|-------|`);
md.push(`| Partidos procesados | ${qc.partidos_procesados}/12 |`);
md.push(`| Partidos con spreads | ${qc.partidos_con_spreads} |`);
md.push(`| Partidos sin odds API | ${qc.partidos_sin_odds_api} |`);
md.push(`| Señales V2.1 activas | ${qc.senales_activas} |`);
md.push(`| Mercados protegidos totales | ${qc.mercados_protegidos_totales} |`);
md.push(`| Mercados apostables (cuota AH real) | ${qc.mercados_apostables} |`);
md.push(`| Mercados calculable_no_apostable | ${qc.mercados_calculable_no_apostable} |`);
md.push(`| EV positivo | **${qc.ev_positivo}** |`);
md.push(`| EV negativo | ${qc.ev_negativo} |`);
md.push(`| Markets excluidos | \`${EXCLUIDOS.join('`, `')}\` |`);
md.push('');

md.push(`## Créditos The Odds API`);
md.push('');
md.push(`| Campo | Valor |`);
md.push(`|-------|-------|`);
md.push(`| x-requests-last | ${creditos.last_call} |`);
md.push(`| x-requests-remaining | ${creditos.remaining} |`);
md.push(`| x-requests-used (total) | ${creditos.used} |`);
md.push('');

md.push(`## Control de Calidad V2.2 Spreads`);
md.push('');
md.push(`| Check | Resultado |`);
md.push(`|-------|-----------|`);
md.push(`| Partidos procesados | ${qc.partidos_procesados}/12 |`);
md.push(`| Partidos con spreads | ${qc.partidos_con_spreads} |`);
md.push(`| Total bookmakers con spreads | ${qc.total_bks_spreads} |`);
md.push(`| Total líneas AH oficiales | ${qc.total_lineas_oficiales} |`);
md.push(`| Líneas cuarto informativas | ${qc.total_lineas_cuarto} |`);
md.push(`| Señales protegidas generadas | ${qc.mercados_protegidos_totales} |`);
md.push(`| Con EV positivo | **${qc.ev_positivo}** |`);
md.push(`| Con EV negativo | ${qc.ev_negativo} |`);
md.push(`| \`double_chance\` usado | ❌ No |`);
md.push(`| \`draw_no_bet\` usado | ❌ No |`);
md.push(`| Escrituras Firestore | ❌ 0 |`);
md.push(`| \`señales_valor\` modificadas | ❌ No |`);
md.push('');

md.push(`## Top 10 Señales Protegidas por EV`);
md.push('');
if (top10EV.length === 0) {
  md.push('_Ninguna señal protegida con cuota real y EV calculable._');
} else {
  md.push(`| # | Partido | Market | Prob modelo | Cuota | EV | Tipo |`);
  md.push(`|---|---------|--------|-------------|-------|----|------|`);
  top10EV.forEach((p, i) => {
    md.push(`| ${i+1} | ${p.partido} | \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${p.tipo_proteccion ?? ''} |`);
  });
}
md.push('');

md.push(`## Partidos Consultados`);
md.push('');
md.push(`| matchId | Partido | Fecha | Spreads | Bks | Líneas | EV+ |`);
md.push(`|---------|---------|-------|---------|-----|--------|-----|`);
for (const r of resultados) {
  if (r.error) {
    md.push(`| ${r.matchId} | ${r.nombre} | — | ❌ error | 0 | 0 | 0 |`);
    continue;
  }
  const nEvPos = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => (p.ev ?? -1) > 0).length;
  md.push(`| ${r.matchId} | ${r.nombre} | ${r.fechaPartido ?? '?'} | ${r.spreads_disponible ? '✅' : '❌'} | ${r.n_bks_spreads} | ${r.n_lineas_oficiales} | **${nEvPos}** |`);
}
md.push('');

md.push(`## Análisis por Partido`);
md.push('');

for (const r of resultados) {
  if (r.error) {
    md.push(`### ${r.matchId} — ${r.nombre} ⚠`);
    md.push(`> Error: \`${r.error}\``);
    md.push('');
    continue;
  }

  const nApost = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => p.estado === 'apostable').length;
  const nEvPos = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => (p.ev ?? -1) > 0).length;

  md.push(`### ${r.matchId} — ${r.nombre}`);
  md.push(`**Fecha:** ${r.fechaPartido ?? '?'} | **Señales activas:** ${r.n_senales_activas} | **AH apostables:** ${nApost} | **EV+:** ${nEvPos}`);
  md.push('');

  if (r.n_bks_spreads > 0) {
    md.push(`**Spreads:** ${r.n_bks_spreads} bookmakers | ${r.n_lineas_oficiales} líneas oficiales | ${r.n_lineas_cuarto} cuartos`);
    if (r.lineas_cuarto_info?.length > 0) {
      md.push(`- Líneas cuarto (informativas, no usadas como señal): \`${r.lineas_cuarto_info.join('`, `')}\``);
    }
    md.push('');
  } else {
    md.push(`> ⚠️ Sin datos de spreads para este partido.`);
    md.push('');
  }

  if (r.mejores_ev?.length > 0) {
    md.push(`**Mejores señales AH:**`);
    md.push('');
    md.push(`| Market | Prob | Cuota | EV | Edge | Tipo |`);
    md.push(`|--------|------|-------|----|------|------|`);
    for (const p of r.mejores_ev) {
      md.push(`| \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${fmt_edge(p.edge)} | ${p.tipo_proteccion ?? ''} |`);
    }
    md.push('');
  }

  for (const mapeo of (r.mapeo_señales ?? [])) {
    const s = mapeo.señal_base;
    md.push(`#### Señal base: \`${s.mercado}/${s.seleccion}\` | prob=${fmt_pct(s.prob_modelo)} | cuota=${fmt_cuota(s.bookmaker_odds)}`);
    md.push('');
    md.push(`| Mercado protegido | Prob | Cuota | EV | Edge | Estado |`);
    md.push(`|-------------------|------|-------|----|------|--------|`);
    for (const p of mapeo.mercados_protegidos) {
      md.push(`| \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${fmt_edge(p.edge)} | ${p.estado} |`);
    }
    md.push('');
  }
}

md.push(`## Advertencias Metodológicas`);
md.push('');
md.push(`1. **Cuotas AH = mediana de bookmakers.** No elimina el vig. EV puede estar subestimado vs best-line.`);
md.push(`2. **Líneas cuarto (${qc.total_lineas_cuarto} total)** disponibles en \`lineas_cuarto\` del JSON pero excluidas como señal oficial. Requieren modelo de cuarto-ball diferente.`);
md.push(`3. **DC y DNB sin cuota real.** Calculados matemáticamente pero endpoint rechazado. EV = null hasta disponer de endpoint alternativo.`);
md.push(`4. **TAU = 0 provisional.** Sin backtest histórico. Los EV son indicativos — no apostar cantidades significativas sin calibración.`);
md.push(`5. **V2.1 intacta.** Señales en \`señales_valor\` no modificadas. Las señales V2.2 irán a campo \`señales_protegidas\` (nuevo, nunca sobreescribe).`);
md.push('');
md.push(`---`);
md.push(`*Generado ${HOY} — 1 llamada API — 0 escrituras Firestore — V2.1 sin modificar*`);

writeFileSync(resolve(OUT_DIR, 'senales_protegidas_j1_spreads_dryrun.md'), md.join('\n'), 'utf8');
console.log('  ✓ reports/senales_protegidas_j1_spreads_dryrun.md\n');

// ── Reporte final en consola ──────────────────────────────────────────────────

console.log('═'.repeat(70));
console.log('  REPORTE FINAL');
console.log('─'.repeat(70));
console.log('');
console.log('  Archivos modificados:');
console.log('    src/data/pipeline/oddsApi.js        (procesarSpreads añadido)');
console.log('');
console.log('  Archivos generados:');
console.log('    reports/odds_j1_h2h_totals_spreads_raw.json');
console.log('    reports/senales_protegidas_j1_spreads_dryrun.json');
console.log('    reports/senales_protegidas_j1_spreads_dryrun.md');
console.log('');
console.log(`  Llamadas API         : 1`);
console.log(`  Créditos consumidos  : ${creditos.last_call}`);
console.log(`  Markets usados       : ${MARKETS}`);
console.log(`  Markets excluidos    : ${EXCLUIDOS.join(', ')}`);
console.log('');
console.log(`  Señales protegidas   : ${qc.mercados_protegidos_totales}`);
console.log(`  EV positivo          : ${qc.ev_positivo}`);
console.log(`  EV negativo          : ${qc.ev_negativo}`);
console.log(`  Sin cuota (calc)     : ${qc.mercados_calculable_no_apostable}`);
console.log('');

if (top10EV.length > 0) {
  console.log('  TOP 10 EV:');
  top10EV.forEach((p, i) => {
    const evStr = p.ev > 0 ? `+${(p.ev*100).toFixed(2)}%` : `${(p.ev*100).toFixed(2)}%`;
    console.log(`    ${String(i+1).padStart(2)}. ${p.partido.padEnd(32)} ${p.id.padEnd(22)} EV=${evStr.padStart(8)}  cuota=${p.cuota_real?.toFixed(3) ?? 'N/D'}`);
  });
  console.log('');
}

console.log(`  Escrituras Firestore : 0`);
console.log('');

if (qc.ev_positivo >= 3 && qc.partidos_con_spreads >= 8) {
  console.log(`  ✅ V2.2 con spreads lista para J2.`);
  console.log(`     ${qc.ev_positivo} señales AH con EV+ en ${qc.partidos_con_spreads} partidos.`);
  console.log(`     Próximo paso: añadir señales_protegidas a predicciones J2.`);
} else if (qc.partidos_con_spreads < 6) {
  console.log(`  ⚠️  Cobertura baja: solo ${qc.partidos_con_spreads}/12 partidos con spreads.`);
  console.log(`     Puede ser que algunos partidos J1 ya se jugaron o no estén en The Odds API.`);
} else {
  console.log(`  ⚠️  Funcional con ${qc.ev_positivo} señales EV+. Revisar calibración antes de J2.`);
}

console.log('\n' + '═'.repeat(70) + '\n');

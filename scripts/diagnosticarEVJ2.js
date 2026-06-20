/**
 * diagnosticarEVJ2.js — Diagnóstico de EV bruto J2.
 *
 * SOLO LECTURA. Zero escrituras. Zero llamadas API.
 *
 * Calcula EV directamente (probModelo × odds - 1) para todos los mercados
 * de los 24 partidos J2, independientemente de si el EV es negativo.
 *
 * Fuentes:
 *   - config/j2_ids.json
 *   - predicciones/{matchId} en Firestore (prob_1x2, prob_over_under, lambdas)
 *   - reports/odds_j2_h2h_totals_spreads_raw.json (caché transformado)
 *
 * Genera:
 *   - reports/diagnostico_ev_j2.json
 *   - reports/diagnostico_ev_j2.md
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve }       from 'path';
import { getFirestore }  from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { evaluateBet }              from '../src/core/betting/bettingMath.js';
import { deriveAllProtectedMarkets } from '../src/betting/protectionMarkets.js';

const db = getFirestore();

// ── Rutas ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH    = resolve('config', 'j2_ids.json');
const CACHE_PATH     = resolve('reports', 'odds_j2_h2h_totals_spreads_raw.json');
const CACHE_RAW_PATH = resolve('reports', 'odds_j2_raw.json');
const OUT_DIR        = resolve('reports');
const JSON_OUT       = resolve(OUT_DIR, 'diagnostico_ev_j2.json');
const MD_OUT         = resolve(OUT_DIR, 'diagnostico_ev_j2.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

const p2 = n  => (n != null && isFinite(n)) ? n.toFixed(2)                    : 'N/D';
const p4 = n  => (n != null && isFinite(n)) ? n.toFixed(4)                    : 'N/D';
const pp = n  => (n != null && isFinite(n)) ? `${(n * 100).toFixed(1)}%`      : 'N/D';
const pev = n => (n != null && isFinite(n)) ? `${(n * 100).toFixed(2)}%`      : 'N/D';
const evTag = n => {
  if (n == null || !isFinite(n)) return '';
  if (n > 0.05)  return ' ★★ VALOR ALTO';
  if (n > 0)     return ' ★ valor';
  if (n > -0.05) return ' ≈ break-even';
  return '';
};

function safeEvaluate(probModelo, odds, allOdds) {
  try {
    if (!probModelo || probModelo <= 0 || probModelo >= 1) return null;
    if (!odds || odds <= 1) return null;
    const validOdds = allOdds.filter(o => o != null && o > 1);
    if (validOdds.length === 0) return null;
    return evaluateBet(probModelo, odds, validOdds);
  } catch {
    return null;
  }
}

function clasificarRazon(ev, esV22Context) {
  if (esV22Context) {
    return 'V2.2 requiere señales_valor V2.1 como base — J2 no tiene odds_snapshots ni señales_valor';
  }
  if (ev == null)  return 'odds o probabilidad ausente';
  if (ev <= 0)     return `EV negativo (${pev(ev)}) — bookmaker cotiza mejor que el modelo`;
  return '—';
}

// ── Cargar datos ──────────────────────────────────────────────────────────────

const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const J2_IDS    = Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []);

if (!existsSync(CACHE_PATH)) {
  console.error(`ERROR: ${CACHE_PATH} no existe. Ejecuta primero node scripts/guardarSeñalesProtegidaJ2.js`);
  process.exit(1);
}

const cacheData   = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
const partidosCache = cacheData.partidos ?? {};   // matchId (string) → { odds: { mercados } }

console.log('\n' + '═'.repeat(76));
console.log('  diagnosticarEVJ2 — EV BRUTO TODOS LOS MERCADOS — SOLO LECTURA');
console.log('═'.repeat(76));
console.log(`\n  Caché: ${CACHE_PATH.split('\\').pop()}`);
console.log(`  Generado: ${cacheData.meta?.generado_en?.slice(0, 19) ?? '?'}`);
console.log(`  Partidos en caché: ${Object.keys(partidosCache).length}`);
console.log(`  Partidos en config: ${J2_IDS.length}\n`);

// ── Leer predicciones desde Firestore ────────────────────────────────────────

console.log('  Cargando predicciones desde Firestore...');
const snaps = await Promise.all(
  J2_IDS.map(e => db.collection('predicciones').doc(String(e.matchId)).get())
);

// ── Procesar cada partido ─────────────────────────────────────────────────────

const partidos_out = [];

// Contadores globales
let totalOutcomes   = 0;
let evPositivo      = 0;
let evBreakEven     = 0;  // entre -0.05 y 0
let evNearBreak     = 0;  // entre -0.10 y -0.05
let evNegativo      = 0;
let sinOdds         = 0;
let erroresParsing  = 0;
let sinMapeoAH      = 0;

const todosEVs = [];  // para ranking global

for (let i = 0; i < J2_IDS.length; i++) {
  const entrada = J2_IDS[i];
  const matchId = String(entrada.matchId);
  const partido = `${entrada.local} vs ${entrada.visitante}`;
  const snap    = snaps[i];

  if (!snap.exists) {
    console.log(`  WARN  ${matchId}: sin predicción en Firestore`);
    sinOdds++;
    partidos_out.push({ matchId, partido, error: 'sin_prediccion', outcomes: [] });
    continue;
  }

  const pred = snap.data();
  const { lambda_local, lambda_visitante, prob_1x2, prob_over_under } = pred;

  const cachePartido = partidosCache[matchId] ?? partidosCache[Number(matchId)];
  if (!cachePartido?.odds?.mercados) {
    console.log(`  WARN  ${matchId}: sin odds en caché`);
    sinOdds++;
    partidos_out.push({ matchId, partido, error: 'sin_odds_cache', outcomes: [] });
    continue;
  }

  const mercados = cachePartido.odds.mercados;
  const outcomes_partido = [];
  const errores_partido  = [];

  // ── H2H ────────────────────────────────────────────────────────────────────

  const h2h = mercados.h2h;
  if (h2h) {
    const allH2H = [h2h.odds_local, h2h.odds_empate, h2h.odds_visitante].filter(o => o != null && o > 1);

    const h2hDefs = [
      { seleccion: 'local',     prob: prob_1x2?.local,     odds: h2h.odds_local     },
      { seleccion: 'empate',    prob: prob_1x2?.empate,    odds: h2h.odds_empate    },
      { seleccion: 'visitante', prob: prob_1x2?.visitante, odds: h2h.odds_visitante },
    ];

    for (const o of h2hDefs) {
      const res = safeEvaluate(o.prob, o.odds, allH2H);
      if (!res) { errores_partido.push(`h2h/${o.seleccion}: prob=${o.prob} odds=${o.odds}`); erroresParsing++; continue; }
      const ev = res.expected_value;
      const item = {
        mercado:           'h2h',
        seleccion:         o.seleccion,
        prob_modelo:       +o.prob.toFixed(4),
        cuota:             o.odds,
        prob_implicita:    +res.implied_probability.toFixed(4),
        prob_no_vig:       +res.no_vig_probability.toFixed(4),
        edge:              +res.edge.toFixed(4),
        ev:                +ev.toFixed(4),
        is_value_bet:      res.is_value_bet,
        n_bookmakers:      h2h.n_bookmakers,
        overround_pct:     h2h.overround_pct,
        razon_no_senial:   clasificarRazon(ev, true),
      };
      outcomes_partido.push(item);
      todosEVs.push({ matchId, partido, ...item });
      totalOutcomes++;
      if (ev > 0)             evPositivo++;
      else if (ev > -0.05)    evBreakEven++;
      else if (ev > -0.10)    evNearBreak++;
      else                    evNegativo++;
    }
  } else {
    errores_partido.push('mercado h2h ausente');
  }

  // ── Totals ──────────────────────────────────────────────────────────────────

  const totals = mercados.totals;
  if (totals) {
    const linea    = totals.linea;
    const lineaKey = String(linea);
    const probOU   = prob_over_under?.[lineaKey];

    const allTot = [totals.odds_over, totals.odds_under].filter(o => o != null && o > 1);

    if (!probOU) {
      errores_partido.push(`totals: predicción sin prob_over_under["${lineaKey}"] (línea del bookmaker es ${linea})`);
      erroresParsing++;
    } else {
      const totDefs = [
        { seleccion: `over_${linea}`,  prob: probOU.over,  odds: totals.odds_over  },
        { seleccion: `under_${linea}`, prob: probOU.under, odds: totals.odds_under },
      ];
      for (const o of totDefs) {
        const res = safeEvaluate(o.prob, o.odds, allTot);
        if (!res) { errores_partido.push(`totals/${o.seleccion}: prob=${o.prob} odds=${o.odds}`); erroresParsing++; continue; }
        const ev = res.expected_value;
        const item = {
          mercado:           'totals',
          seleccion:         o.seleccion,
          linea,
          prob_modelo:       +o.prob.toFixed(4),
          cuota:             o.odds,
          prob_implicita:    +res.implied_probability.toFixed(4),
          prob_no_vig:       +res.no_vig_probability.toFixed(4),
          edge:              +res.edge.toFixed(4),
          ev:                +ev.toFixed(4),
          is_value_bet:      res.is_value_bet,
          n_bookmakers:      totals.n_bookmakers,
          overround_pct:     totals.overround_pct,
          razon_no_senial:   clasificarRazon(ev, true),
        };
        outcomes_partido.push(item);
        todosEVs.push({ matchId, partido, ...item });
        totalOutcomes++;
        if (ev > 0)             evPositivo++;
        else if (ev > -0.05)    evBreakEven++;
        else if (ev > -0.10)    evNearBreak++;
        else                    evNegativo++;
      }
    }
  } else {
    errores_partido.push('mercado totals ausente');
  }

  // ── Spreads (AH) ────────────────────────────────────────────────────────────

  const spreads = mercados.spreads;
  if (spreads?.lineas_oficiales && lambda_local != null && lambda_visitante != null) {
    // Calcular probabilidades AH desde Poisson
    let ahProbs = null;
    try {
      const derivados = deriveAllProtectedMarkets(
        lambda_local, lambda_visitante, prob_1x2, prob_over_under
      );
      ahProbs = derivados?.asian_handicap ?? null;
    } catch (err) {
      errores_partido.push(`spreads: error al derivar AH probs: ${err.message}`);
      erroresParsing++;
    }

    for (const [ahKey, lineaData] of Object.entries(spreads.lineas_oficiales)) {
      const cuotaAH   = lineaData.mediana;
      const nBks      = lineaData.n_bookmakers;
      const probEntry = ahProbs?.[ahKey];
      const probWin   = probEntry?.prob_win ?? null;

      if (probWin == null) {
        sinMapeoAH++;
        errores_partido.push(`spreads: ${ahKey} sin prob_win en deriveAllProtectedMarkets`);
        continue;
      }

      // Para AH sin push (±0.5, ±1.5): EV = prob_win * cuota - 1
      // Para AH con push (±1.0): EV con push = prob_win * cuota + prob_push * 0 + prob_loss * (-1) = prob_win * cuota - prob_loss
      const tienePush    = probEntry.prob_push != null;
      const probLoss     = probEntry.prob_loss ?? (1 - probWin);
      const ev = tienePush
        ? +(probWin * cuotaAH - probLoss).toFixed(4)
        : +(probWin * cuotaAH - 1).toFixed(4);

      // Para edge: usar prob implícita de cuotaAH
      const probImplicita = 1 / cuotaAH;
      const probNoVig     = probImplicita; // binario: solo over/under cada lado
      const edgeVal       = +(probWin - probNoVig).toFixed(4);

      const item = {
        mercado:           'spreads',
        seleccion:         ahKey,
        linea:             lineaData.line,
        prob_modelo:       +probWin.toFixed(4),
        prob_push:         tienePush ? +probEntry.prob_push.toFixed(4) : null,
        cuota:             cuotaAH,
        prob_implicita:    +probImplicita.toFixed(4),
        edge:              edgeVal,
        ev,
        is_value_bet:      ev > 0,
        n_bookmakers:      nBks,
        tipo_linea:        lineaData.tipo,
        razon_no_senial:   clasificarRazon(ev, true),
      };
      outcomes_partido.push(item);
      todosEVs.push({ matchId, partido, ...item });
      totalOutcomes++;
      if (ev > 0)             evPositivo++;
      else if (ev > -0.05)    evBreakEven++;
      else if (ev > -0.10)    evNearBreak++;
      else                    evNegativo++;
    }
  } else if (!spreads) {
    errores_partido.push('mercado spreads ausente');
  }

  // ── Ordenar y resumir por partido ───────────────────────────────────────────

  outcomes_partido.sort((a, b) => b.ev - a.ev);

  const top5    = outcomes_partido.slice(0, 5);
  const mejorH2H  = outcomes_partido.filter(o => o.mercado === 'h2h').sort((a, b) => b.ev - a.ev)[0] ?? null;
  const mejorTot  = outcomes_partido.filter(o => o.mercado === 'totals').sort((a, b) => b.ev - a.ev)[0] ?? null;
  const mejorAH   = outcomes_partido.filter(o => o.mercado === 'spreads').sort((a, b) => b.ev - a.ev)[0] ?? null;
  const evMax     = outcomes_partido[0]?.ev ?? null;

  // ── Imprimir resumen por partido ──────────────────────────────────────────

  const h2hStr = h2h
    ? `H2H: ${pp(prob_1x2?.local)}/${pp(prob_1x2?.empate)}/${pp(prob_1x2?.visitante)} | odds: ${p2(h2h.odds_local)}/${p2(h2h.odds_empate)}/${p2(h2h.odds_visitante)}`
    : 'H2H: sin odds';

  console.log(`\n  ── ${matchId}  ${partido}`);
  console.log(`     λ=${p2(lambda_local)}/${p2(lambda_visitante)}  ${h2hStr}`);
  console.log(`     EV máximo: ${pev(evMax)}${evTag(evMax)}  |  outcomes calculados: ${outcomes_partido.length}`);

  if (errores_partido.length > 0) {
    for (const e of errores_partido) console.log(`     ⚠ ${e}`);
  }

  console.log(`     Top 3 por EV:`);
  for (const o of top5.slice(0, 3)) {
    const pushStr = o.prob_push != null ? ` push=${pp(o.prob_push)}` : '';
    console.log(`       ${o.mercado.padEnd(8)} ${String(o.seleccion).padEnd(18)} prob=${pp(o.prob_modelo)} odds=${p2(o.cuota)} EV=${pev(o.ev)} edge=${p4(o.edge)}${pushStr}${evTag(o.ev)}`);
  }

  partidos_out.push({
    matchId,
    partido,
    version_modelo:   pred.version_modelo,
    lambda_local,
    lambda_visitante,
    outcomes_count:   outcomes_partido.length,
    ev_max:           evMax,
    top5,
    mejor_h2h:        mejorH2H,
    mejor_totals:     mejorTot,
    mejor_spreads:    mejorAH,
    errores:          errores_partido,
    todos_outcomes:   outcomes_partido,
  });
}

// ── Ranking global ────────────────────────────────────────────────────────────

todosEVs.sort((a, b) => b.ev - a.ev);
const top20Global = todosEVs.slice(0, 20);
const evMaxGlobal  = todosEVs[0]?.ev ?? null;

// ── Resumen en consola ────────────────────────────────────────────────────────

console.log('\n\n' + '═'.repeat(76));
console.log('  RESUMEN GLOBAL');
console.log('─'.repeat(76));
console.log(`  Total partidos J2         : ${J2_IDS.length}`);
console.log(`  Total outcomes calculados : ${totalOutcomes}`);
console.log(`  Mayor EV encontrado       : ${pev(evMaxGlobal)}${evTag(evMaxGlobal)}`);
console.log('─'.repeat(76));
console.log(`  EV > 0         (value)    : ${evPositivo}`);
console.log(`  EV entre -5% y 0          : ${evBreakEven}`);
console.log(`  EV entre -10% y -5%       : ${evNearBreak}`);
console.log(`  EV < -10%                 : ${evNegativo}`);
console.log('─'.repeat(76));
console.log(`  Sin odds en caché         : ${sinOdds}`);
console.log(`  Errores de parsing        : ${erroresParsing}`);
console.log(`  AH sin mapeo en Poisson   : ${sinMapeoAH}`);
console.log('─'.repeat(76));
console.log('  TOP 10 EV GLOBAL:');
for (const o of top20Global.slice(0, 10)) {
  console.log(`    ${String(o.matchId).padEnd(8)} ${o.partido.padEnd(32)} ${o.mercado.padEnd(8)} ${String(o.seleccion).padEnd(18)} EV=${pev(o.ev)}${evTag(o.ev)}`);
}
console.log('─'.repeat(76));
console.log('\n  CAUSA RAÍZ — Por qué V2.2 dio 0 señales:');
console.log('    V2.2 mapea señales_valor (V2.1) → mercados protegidos (AH/DC/DNB).');
console.log('    J2 no tiene señales_valor porque:');
console.log('      1. odds_snapshots/ está vacío para todos los matchIds J2.');
console.log('      2. actualizarSenalesConOdds.js nunca fue ejecutado para J2.');
console.log('    Fix: guardarOddsPorMatchIds.js --write (J2) → actualizarSenalesConOdds.js --write');
console.log('═'.repeat(76));

// ── Generar JSON ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const jsonOutput = {
  generado_en:     new Date().toISOString(),
  cache_usado:     CACHE_PATH.split('\\').pop(),
  resumen: {
    total_partidos:    J2_IDS.length,
    total_outcomes:    totalOutcomes,
    ev_max_global:     evMaxGlobal,
    ev_positivo:       evPositivo,
    ev_break_even:     evBreakEven,
    ev_near_break:     evNearBreak,
    ev_negativo:       evNegativo,
    sin_odds:          sinOdds,
    errores_parsing:   erroresParsing,
    ah_sin_mapeo:      sinMapeoAH,
  },
  causa_raiz_v22_cero_senales: [
    'V2.2 requiere señales_valor V2.1 como base para mapear mercados protegidos',
    'J2 no tiene señales_valor porque odds_snapshots/ está vacío para J2',
    'actualizarSenalesConOdds.js nunca fue ejecutado para J2',
    'Fix: guardarOddsPorMatchIds.js --write (J2) → actualizarSenalesConOdds.js --write',
  ],
  top20_ev_global:  top20Global,
  partidos:         partidos_out,
};

writeFileSync(JSON_OUT, JSON.stringify(jsonOutput, null, 2), 'utf-8');
console.log(`\n  JSON: reports/diagnostico_ev_j2.json`);

// ── Generar Markdown ──────────────────────────────────────────────────────────

const md = [];
const hoy = new Date().toISOString().slice(0, 10);

md.push(`# Diagnóstico EV J2 — ${hoy}`);
md.push('');
md.push('> **Modo:** solo lectura | **Caché:** ' + CACHE_PATH.split('\\').pop());
md.push('');
md.push('---');
md.push('');
md.push('## Resumen ejecutivo');
md.push('');
md.push('| Métrica | Valor |');
md.push('|---|---|');
md.push(`| Total outcomes calculados | ${totalOutcomes} |`);
md.push(`| Mayor EV encontrado | ${pev(evMaxGlobal)} |`);
md.push(`| EV > 0 (value bets V2.1) | ${evPositivo} |`);
md.push(`| EV entre −5% y 0 (break-even) | ${evBreakEven} |`);
md.push(`| EV entre −10% y −5% | ${evNearBreak} |`);
md.push(`| EV < −10% | ${evNegativo} |`);
md.push(`| Errores de parsing | ${erroresParsing} |`);
md.push(`| AH sin mapeo Poisson | ${sinMapeoAH} |`);
md.push('');
md.push('## Causa raíz: por qué V2.2 dio 0 señales');
md.push('');
md.push('V2.2 **mapea** señales V2.1 existentes → mercados protegidos (AH/DC/DNB).');
md.push('J2 no tiene `señales_valor` (V2.1) porque `odds_snapshots/` está vacío.');
md.push('Sin señal base → sin mapeo → sin mercado protegido → 0 EV.');
md.push('');
md.push('**Fix necesario:**');
md.push('```');
md.push('node scripts/guardarOddsPorMatchIds.js --write   # llena odds_snapshots/ + ultimo_odds_snapshot_id');
md.push('node scripts/actualizarSenalesConOdds.js --matchIds <J2_IDS> --write   # genera señales_valor');
md.push('node scripts/guardarSeñalesProtegidaJ2.js --write   # genera señales_protegidas V2.2');
md.push('```');
md.push('');
md.push('---');
md.push('');
md.push('## Top 20 EV global');
md.push('');
md.push('| # | matchId | Partido | Mercado | Selección | prob_modelo | cuota | EV | edge |');
md.push('|---|---|---|---|---|---|---|---|---|');
top20Global.forEach((o, idx) => {
  const evStr = o.ev > 0 ? `**${pev(o.ev)}**` : pev(o.ev);
  md.push(`| ${idx + 1} | ${o.matchId} | ${o.partido} | ${o.mercado} | ${o.seleccion} | ${pp(o.prob_modelo)} | ${p2(o.cuota)} | ${evStr} | ${p4(o.edge)} |`);
});
md.push('');
md.push('---');
md.push('');
md.push('## Detalle por partido');
md.push('');

for (const r of partidos_out) {
  if (r.error) {
    md.push(`### ${r.partido} \`${r.matchId}\` — ${r.error}`);
    md.push('');
    continue;
  }

  md.push(`### ${r.partido} \`${r.matchId}\``);
  md.push('');
  md.push(`**λ:** ${p2(r.lambda_local)}/${p2(r.lambda_visitante)} | **v:** ${r.version_modelo} | **EV max:** ${pev(r.ev_max)}${evTag(r.ev_max)}`);
  md.push('');

  if (r.errores.length > 0) {
    for (const e of r.errores) md.push(`> ⚠ ${e}`);
    md.push('');
  }

  // Mejor por categoría
  const cats = [
    { label: 'Mejor H2H',     o: r.mejor_h2h },
    { label: 'Mejor totals',  o: r.mejor_totals },
    { label: 'Mejor AH',      o: r.mejor_spreads },
  ].filter(c => c.o);

  if (cats.length > 0) {
    md.push('**Mejor por categoría:**');
    md.push('');
    md.push('| Categoría | Selección | prob_modelo | cuota | prob_no_vig | edge | EV |');
    md.push('|---|---|---|---|---|---|---|');
    for (const { label, o } of cats) {
      const novStr = o.prob_no_vig != null ? pp(o.prob_no_vig) : '—';
      const evStr  = o.ev > 0 ? `**${pev(o.ev)}**` : pev(o.ev);
      md.push(`| ${label} | ${o.seleccion} | ${pp(o.prob_modelo)} | ${p2(o.cuota)} | ${novStr} | ${p4(o.edge)} | ${evStr} |`);
    }
    md.push('');
  }

  // Top 5 outcomes
  md.push('**Top 5 outcomes por EV:**');
  md.push('');
  md.push('| mercado | selección | prob_modelo | cuota | prob_implicita | edge | EV | razón no señal |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const o of r.top5) {
    const evStr = o.ev > 0 ? `**${pev(o.ev)}**` : pev(o.ev);
    const razon = o.razon_no_senial?.slice(0, 60) ?? '—';
    md.push(`| ${o.mercado} | ${o.seleccion} | ${pp(o.prob_modelo)} | ${p2(o.cuota)} | ${pp(o.prob_implicita)} | ${p4(o.edge)} | ${evStr} | ${razon} |`);
  }
  md.push('');
  md.push('---');
  md.push('');
}

writeFileSync(MD_OUT, md.join('\n'), 'utf-8');
console.log(`  MD:   reports/diagnostico_ev_j2.md\n`);

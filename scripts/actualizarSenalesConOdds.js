/**
 * actualizarSenalesConOdds.js
 *
 * Calcula señales de valor para las predicciones de una fecha usando
 * odds_snapshots ya guardados. NO llama The Odds API.
 *
 * Uso:
 *   node scripts/actualizarSenalesConOdds.js YYYY-MM-DD [--dry-run] [--write]
 *   node scripts/actualizarSenalesConOdds.js --matchIds <id> [id...] [--dry-run] [--write]
 *
 * Modos:
 *   --dry-run (default)  — calcula y muestra señales, NO escribe Firestore
 *   --write              — actualiza predicciones/{matchId} via update()
 *                          (nunca sobreescribe lambdas ni probabilidades)
 *
 * Fuentes:
 *   - predicciones/{matchId}.prob_1x2          → probabilidades modelo
 *   - predicciones/{matchId}.prob_over_under    → O/U según la línea del snapshot
 *   - predicciones/{matchId}.ultimo_odds_snapshot_id → ID del snapshot
 *   - odds_snapshots/{snapshotId}.mercados.h2h  → cuotas H2H
 *   - odds_snapshots/{snapshotId}.mercados.totals → cuotas O/U
 *
 * Restricciones:
 *   - NO llama The Odds API.
 *   - NO llama Claude API.
 *   - NO modifica Prediction Engine ni pesos.
 *   - NO recalcula predicciones.
 *   - Solo update() — nunca set() — para preservar lambdas y probabilidades.
 */

import 'dotenv/config';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import '../src/firebase/init.js';
import {
  evaluateBet,
  kellyFraction,
  TAU,
} from '../src/core/betting/bettingMath.js';

// ── Argumentos ────────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
const fecha = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

// --matchIds 537404 537405  (espacio)  o  --matchIds 537404,537405  (coma)
const matchIdsFlagIdx = args.indexOf('--matchIds');
const matchIdsArg = matchIdsFlagIdx !== -1
  ? args.slice(matchIdsFlagIdx + 1)
      .filter(a => !a.startsWith('--'))
      .flatMap(a => a.split(','))
      .filter(a => /^\d+$/.test(a))
  : [];

if (!fecha && matchIdsArg.length === 0) {
  console.error('\n  ERROR: debes pasar una fecha YYYY-MM-DD o usar --matchIds <id...>.');
  console.error('  Ejemplos:');
  console.error('    node scripts/actualizarSenalesConOdds.js 2026-06-15 --dry-run');
  console.error('    node scripts/actualizarSenalesConOdds.js --matchIds 537404 --dry-run\n');
  process.exit(1);
}

const WRITE   = args.includes('--write');
const DRY_RUN = !WRITE;
const MODO    = matchIdsArg.length > 0 ? 'matchIds' : 'fecha';

// ── Clasificación de señales ──────────────────────────────────────────────────
//
// Umbrales provisionales (TAU=0, sin backtest aún).
// EV >= 0.10 → alto / apostar
// EV >= 0.05 → moderado / considerar
// EV >  0    → leve / observar
// EV <= 0    → sin_valor / pasar
//
function nivelValor(ev) {
  if (ev >= 0.10) return 'alto';
  if (ev >= 0.05) return 'moderado';
  if (ev >  0)    return 'leve';
  return 'sin_valor';
}

function recomendacion(ev) {
  if (ev >= 0.10) return 'apostar';
  if (ev >= 0.05) return 'considerar';
  if (ev >  0)    return 'observar';
  return 'pasar';
}

// ── Evaluación de mercados ────────────────────────────────────────────────────

function evaluarH2h(prob1x2, h2h, nombres) {
  const señales = [];
  const advertencias = [];

  const { odds_local, odds_empate, odds_visitante } = h2h;

  if (!odds_local || !odds_visitante) {
    advertencias.push('h2h: faltan odds_local u odds_visitante en el snapshot');
    return { señales, advertencias };
  }

  const todasOdds = [odds_local, odds_empate, odds_visitante].filter(o => o != null && o > 1);

  const outcomes = [
    { seleccion: 'local',     equipo: nombres.local,     probModelo: prob1x2?.local,     odds: odds_local     },
    { seleccion: 'empate',    equipo: 'empate',           probModelo: prob1x2?.empate,    odds: odds_empate    },
    { seleccion: 'visitante', equipo: nombres.visitante,  probModelo: prob1x2?.visitante, odds: odds_visitante },
  ];

  for (const o of outcomes) {
    if (o.probModelo == null) { advertencias.push(`h2h/${o.seleccion}: prob_modelo ausente`); continue; }
    if (!o.odds || o.odds <= 1) { advertencias.push(`h2h/${o.seleccion}: odds inválida (${o.odds})`); continue; }

    let ev_result;
    try {
      ev_result = evaluateBet(o.probModelo, o.odds, todasOdds);
    } catch (err) {
      advertencias.push(`h2h/${o.seleccion}: ${err.message}`);
      continue;
    }

    señales.push({
      mercado:            'h2h',
      seleccion:          o.seleccion,
      equipo:             o.equipo,
      prob_modelo:        +o.probModelo.toFixed(4),
      bookmaker_odds:     o.odds,
      implied_probability: +ev_result.implied_probability.toFixed(4),
      no_vig_probability: +ev_result.no_vig_probability.toFixed(4),
      fair_odds:          +ev_result.fair_odds.toFixed(3),
      edge:               +ev_result.edge.toFixed(4),
      expected_value:     +ev_result.expected_value.toFixed(4),
      is_value_bet:       ev_result.is_value_bet,
      kelly_fraction:     kellyFraction(o.probModelo, o.odds) != null
                            ? +kellyFraction(o.probModelo, o.odds).toFixed(4)
                            : null,
      nivel_valor:        nivelValor(ev_result.expected_value),
      recomendacion:      recomendacion(ev_result.expected_value),
      tau_usado:          TAU,
    });
  }

  return { señales, advertencias };
}

function evaluarTotals(probOu, totals) {
  const señales = [];
  const advertencias = [];

  if (!totals) { advertencias.push('totals: no hay mercado totals en el snapshot'); return { señales, advertencias }; }

  const { linea, odds_over, odds_under } = totals;
  if (linea == null) { advertencias.push('totals: campo linea ausente en el snapshot'); return { señales, advertencias }; }
  if (!odds_over || !odds_under || odds_over <= 1 || odds_under <= 1) {
    advertencias.push(`totals: odds_over/under inválidas (${odds_over}/${odds_under})`);
    return { señales, advertencias };
  }

  const lineaKey  = String(linea);       // "2.5", "1.5", etc.
  const ouModelo  = probOu?.[lineaKey];  // { over, under }

  if (!ouModelo) {
    advertencias.push(`totals: predicción no tiene prob_over_under["${lineaKey}"] — línea del snapshot es ${linea}`);
    return { señales, advertencias };
  }

  const todasOdds = [odds_over, odds_under];

  const outcomes = [
    { seleccion: `over_${lineaKey}`,  probModelo: ouModelo.over,  odds: odds_over  },
    { seleccion: `under_${lineaKey}`, probModelo: ouModelo.under, odds: odds_under },
  ];

  for (const o of outcomes) {
    if (o.probModelo == null) { advertencias.push(`totals/${o.seleccion}: prob_modelo ausente`); continue; }

    let ev_result;
    try {
      ev_result = evaluateBet(o.probModelo, o.odds, todasOdds);
    } catch (err) {
      advertencias.push(`totals/${o.seleccion}: ${err.message}`);
      continue;
    }

    señales.push({
      mercado:            'totals',
      seleccion:          o.seleccion,
      equipo:             null,
      linea:              linea,
      prob_modelo:        +o.probModelo.toFixed(4),
      bookmaker_odds:     o.odds,
      implied_probability: +ev_result.implied_probability.toFixed(4),
      no_vig_probability: +ev_result.no_vig_probability.toFixed(4),
      fair_odds:          +ev_result.fair_odds.toFixed(3),
      edge:               +ev_result.edge.toFixed(4),
      expected_value:     +ev_result.expected_value.toFixed(4),
      is_value_bet:       ev_result.is_value_bet,
      kelly_fraction:     kellyFraction(o.probModelo, o.odds) != null
                            ? +kellyFraction(o.probModelo, o.odds).toFixed(4)
                            : null,
      nivel_valor:        nivelValor(ev_result.expected_value),
      recomendacion:      recomendacion(ev_result.expected_value),
      tau_usado:          TAU,
    });
  }

  return { señales, advertencias };
}

// ── Formateo ──────────────────────────────────────────────────────────────────

const pct  = n => (n != null ? `${(n * 100).toFixed(1)}%` : '—');
const fix3 = n => (n != null ? n.toFixed(3) : '—');
const fix4 = n => (n != null ? n.toFixed(4) : '—');

function imprimirSenal(s) {
  const val = s.is_value_bet ? '★ VALOR' : '· sin valor';
  const label = s.mercado === 'totals'
    ? `${s.seleccion}`
    : `${s.mercado}/${s.seleccion} (${s.equipo})`;
  console.log(`\n    [${val}] ${label}`);
  console.log(`      prob_modelo       : ${pct(s.prob_modelo)}`);
  console.log(`      cuota             : ${s.bookmaker_odds}`);
  console.log(`      prob_implicita    : ${pct(s.implied_probability)}`);
  console.log(`      prob_no_vig       : ${pct(s.no_vig_probability)}`);
  console.log(`      fair_odds         : ${fix3(s.fair_odds)}`);
  console.log(`      edge              : ${pct(s.edge)}`);
  console.log(`      EV                : ${(s.expected_value * 100).toFixed(2)}%`);
  console.log(`      kelly_fraction    : ${s.kelly_fraction != null ? pct(s.kelly_fraction) : 'null (EV ≤ 0)'}`);
  console.log(`      nivel_valor       : ${s.nivel_valor}`);
  console.log(`      recomendacion     : ${s.recomendacion}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const db = getFirestore();

console.log('\n' + '═'.repeat(76));
console.log('  ACTUALIZAR SEÑALES CON ODDS — sin llamar The Odds API');
if (MODO === 'fecha') {
  console.log(`  Fecha    : ${fecha}`);
} else {
  console.log(`  MatchIds : ${matchIdsArg.join(', ')}`);
}
console.log(`  Modo     : ${DRY_RUN ? 'DRY-RUN (sin escrituras Firestore)' : 'WRITE'}`);
console.log('═'.repeat(76));

// ── 1. Leer predicciones ──────────────────────────────────────────────────────

let predicciones;

if (MODO === 'fecha') {
  console.log(`\n  [1/3] Leyendo predicciones para ${fecha}...`);
  const predSnap = await db.collection('predicciones')
    .where('fechaPartido', '==', fecha)
    .get();

  if (predSnap.empty) {
    console.log(`  0 predicciones en Firestore para ${fecha}. Saliendo.`);
    process.exit(0);
  }

  predicciones = predSnap.docs.map(doc => ({
    ...doc.data(),
    matchId: doc.id,   // siempre string — doc.data().matchId puede ser número
  }));
} else {
  console.log(`\n  [1/3] Leyendo ${matchIdsArg.length} predicción(es) por matchId...`);
  const docSnaps = await Promise.all(
    matchIdsArg.map(id => db.collection('predicciones').doc(String(id)).get())
  );

  predicciones = docSnaps
    .filter(snap => {
      if (!snap.exists) {
        console.log(`  WARN  ${snap.id}: no existe en predicciones/`);
        return false;
      }
      return true;
    })
    .map(snap => ({
      ...snap.data(),
      matchId: snap.id,
    }));

  if (predicciones.length === 0) {
    console.log('  Ninguna predicción encontrada para los matchIds dados. Saliendo.');
    process.exit(0);
  }
}

console.log(`  ${predicciones.length} predicción(es) encontradas:`);
for (const p of predicciones) {
  const snap = p.ultimo_odds_snapshot_id ?? '(sin snapshot)';
  console.log(`    ${p.matchId}  ${p.nombreLocal ?? '?'} vs ${p.nombreVisitante ?? '?'}  →  odds: ${snap}`);
}

// Separar las que tienen snapshot
const conSnapshot    = predicciones.filter(p => p.ultimo_odds_snapshot_id);
const sinSnapshot    = predicciones.filter(p => !p.ultimo_odds_snapshot_id);

if (sinSnapshot.length > 0) {
  console.log(`\n  AVISO — ${sinSnapshot.length} predicción(es) sin ultimo_odds_snapshot_id:`);
  for (const p of sinSnapshot) {
    console.log(`    ${p.matchId}  ${p.nombreLocal ?? '?'} vs ${p.nombreVisitante ?? '?'}`);
    console.log(`    → Ejecuta primero: node scripts/guardarOddsDelDia.js ${fecha}`);
  }
}

if (conSnapshot.length === 0) {
  console.log('\n  Ninguna predicción tiene odds snapshot. Saliendo.');
  console.log(`  Ejecuta: node scripts/guardarOddsDelDia.js ${fecha}`);
  process.exit(0);
}

// ── 2. Leer odds snapshots ────────────────────────────────────────────────────

console.log(`\n  [2/3] Leyendo ${conSnapshot.length} odds snapshot(s)...`);
const snapshotsMap = new Map(); // matchId → snapshotData

await Promise.all(conSnapshot.map(async (pred) => {
  const sid  = pred.ultimo_odds_snapshot_id;
  const snap = await db.collection('odds_snapshots').doc(sid).get();
  if (!snap.exists) {
    console.log(`  WARN  ${pred.matchId}: snapshot "${sid}" no encontrado en Firestore`);
    return;
  }
  snapshotsMap.set(pred.matchId, { id: sid, ...snap.data() });
  const h2h    = snap.data().mercados?.h2h;
  const totals = snap.data().mercados?.totals;
  console.log(`    ${pred.matchId}  snapshot: ${sid}`);
  if (h2h)    console.log(`      h2h    : L=${h2h.odds_local} X=${h2h.odds_empate} V=${h2h.odds_visitante}  (n_bk=${h2h.n_bookmakers} overround=${h2h.overround_pct}%)`);
  if (totals) console.log(`      totals : línea=${totals.linea} over=${totals.odds_over} under=${totals.odds_under}  (n_bk=${totals.n_bookmakers})`);
  if (!h2h)   console.log(`      AVISO : mercado h2h ausente en el snapshot`);
  if (!totals) console.log(`      INFO  : mercado totals ausente (BTTS también omitido — no está en la API call)`);
}));

// ── 3. Calcular señales ───────────────────────────────────────────────────────

console.log(`\n  [3/3] Calculando señales de valor...`);
console.log('─'.repeat(76));

const resultados = [];

for (const pred of conSnapshot) {
  const snapshot = snapshotsMap.get(pred.matchId);
  if (!snapshot) continue;

  const nombres = { local: pred.nombreLocal ?? '?', visitante: pred.nombreVisitante ?? '?' };
  const titulo  = `${nombres.local} vs ${nombres.visitante}`;

  console.log(`\n  ${pred.matchId}  ${titulo}`);
  console.log(`  snapshot: ${snapshot.id}  (${snapshot.tipo_snapshot ?? '?'}  ${snapshot.capturado_en?.slice(0, 16) ?? '?'})`);

  const todasSenales    = [];
  const todasAdvertencias = [];

  // H2H
  const h2h = snapshot.mercados?.h2h;
  if (h2h) {
    const { señales, advertencias } = evaluarH2h(pred.prob_1x2, h2h, nombres);
    todasSenales.push(...señales);
    todasAdvertencias.push(...advertencias);
  } else {
    todasAdvertencias.push('h2h: mercado no presente en el snapshot');
  }

  // Totals
  const totals = snapshot.mercados?.totals;
  {
    const { señales, advertencias } = evaluarTotals(pred.prob_over_under, totals ?? null);
    todasSenales.push(...señales);
    todasAdvertencias.push(...advertencias);
  }

  // BTTS — la API call usa markets=h2h,totals; BTTS no está disponible
  todasAdvertencias.push('btts: mercado no capturado en odds_snapshots (API call solo trae h2h,totals)');

  // Mostrar señales
  const conValor = todasSenales.filter(s => s.is_value_bet);
  console.log(`\n  Señales evaluadas: ${todasSenales.length}  |  Con valor (EV > ${TAU}): ${conValor.length}`);

  for (const s of todasSenales) imprimirSenal(s);

  if (todasAdvertencias.length > 0) {
    console.log('\n  Advertencias:');
    for (const a of todasAdvertencias) console.log(`    · ${a}`);
  }

  // Resumen rápido de señales con valor
  if (conValor.length > 0) {
    console.log('\n  ★ Resumen señales con valor:');
    for (const s of conValor) {
      const label = s.mercado === 'totals'
        ? s.seleccion
        : `${s.mercado}/${s.seleccion}`;
      console.log(`    ${label.padEnd(22)} EV=${( s.expected_value * 100).toFixed(2)}%  edge=${(s.edge * 100).toFixed(2)}%  ${s.nivel_valor.toUpperCase()}  → ${s.recomendacion}`);
    }
  } else {
    console.log('\n  (ninguna señal con valor positivo en este partido)');
  }

  const mercadosEvaluados = [...new Set(todasSenales.map(s => s.mercado))];

  resultados.push({
    matchId: pred.matchId,
    titulo,
    snapshotId: snapshot.id,
    señales:    todasSenales,
    conValor:   conValor.length,
    mercadosEvaluados,
    advertencias: todasAdvertencias,
  });
}

// ── Terminar si es dry-run ────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('\n' + '═'.repeat(76));
  console.log(`  DRY-RUN completado.`);
  console.log(`  Partidos evaluados : ${resultados.length}`);
  console.log(`  Señales con valor  : ${resultados.reduce((a, r) => a + r.conValor, 0)} total`);
  console.log('');
  console.log('  Para escribir en Firestore (update(), no reemplaza predicción):');
  const cmdWrite = MODO === 'matchIds'
    ? `node scripts/actualizarSenalesConOdds.js --matchIds ${matchIdsArg.join(' ')} --write`
    : `node scripts/actualizarSenalesConOdds.js ${fecha} --write`;
  console.log(`    ${cmdWrite}`);
  console.log('═'.repeat(76));
  process.exit(0);
}

// ── Write: update() en predicciones/{matchId} ─────────────────────────────────

console.log('\n' + '─'.repeat(76));
console.log('  ESCRIBIENDO en Firestore vía update() — no modifica lambdas ni probs');
console.log('─'.repeat(76));

let escritos = 0, errores = 0;

for (const r of resultados) {
  try {
    await db.collection('predicciones').doc(String(r.matchId)).update({
      odds_evaluadas:           true,
      ultimo_odds_snapshot_id:  r.snapshotId,
      señales_valor:            r.señales,
      evaluado_con_odds_en:     FieldValue.serverTimestamp(),
      mercados_evaluados:       r.mercadosEvaluados,
    });
    console.log(`  ✓  ${r.matchId}  ${r.titulo}  (${r.señales.length} señales, ${r.conValor} con valor)`);
    escritos++;
  } catch (err) {
    console.error(`  ✗  ${r.matchId}: ${err.message}`);
    errores++;
  }
}

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN ESCRITURA');
console.log(`    Actualizados : ${escritos}`);
console.log(`    Errores      : ${errores}`);
console.log('═'.repeat(76));

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
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import '../src/firebase/init.js';
import {
  evaluateBet,
  kellyFraction,
  TAU,
} from '../src/core/betting/bettingMath.js';

import {
  clasificarSenales,
  PREDICTION_STATUS,
} from '../src/core/betting/recommendationPolicy.js';

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

// --fromConfig config/j2_ids.json
const fromConfigFlagIdx = args.indexOf('--fromConfig');
const fromConfigPath    = fromConfigFlagIdx !== -1 ? args[fromConfigFlagIdx + 1] : null;

// Si --fromConfig se pasó, cargar matchIds desde el archivo
let fromConfigIds = [];
if (fromConfigPath) {
  const rawConfig = JSON.parse(readFileSync(resolve(fromConfigPath), 'utf-8'));
  fromConfigIds = (Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []))
    .map(e => String(e.matchId))
    .filter(id => /^\d+$/.test(id));
  if (fromConfigIds.length === 0) {
    console.error(`\n  ERROR: ${fromConfigPath} no contiene matchIds válidos.\n`);
    process.exit(1);
  }
}

if (!fecha && matchIdsArg.length === 0 && fromConfigIds.length === 0) {
  console.error('\n  ERROR: debes pasar una fecha YYYY-MM-DD, --matchIds <id...> o --fromConfig <path>.');
  console.error('  Ejemplos:');
  console.error('    node scripts/actualizarSenalesConOdds.js 2026-06-15 --dry-run');
  console.error('    node scripts/actualizarSenalesConOdds.js --matchIds 537404 --dry-run');
  console.error('    node scripts/actualizarSenalesConOdds.js --fromConfig config/j2_ids.json\n');
  process.exit(1);
}

const WRITE   = args.includes('--write');
const DRY_RUN = !WRITE;
const MODO    = fromConfigIds.length > 0 ? 'fromConfig'
              : matchIdsArg.length  > 0 ? 'matchIds'
              : 'fecha';

// Lista efectiva de matchIds para modos no-fecha
const efectivosIds = MODO === 'fromConfig' ? fromConfigIds : matchIdsArg;

// ── Caché de odds local ────────────────────────────────────────────────────────
//
// Cuando no existe odds_snapshots en Firestore (caso J2), usamos el caché local.
// Prioridad: odds_j2_h2h_totals_spreads_raw.json  →  odds_j2_raw.json (no procesado)
//
const CACHE_PATHS = [
  resolve('reports', 'odds_j2_h2h_totals_spreads_raw.json'),
];

let cacheOddsMap = null;   // Map<matchId string → { mercados, capturado_en, fuente_path }>

for (const cachePath of CACHE_PATHS) {
  if (!existsSync(cachePath)) continue;
  try {
    const cacheData = JSON.parse(readFileSync(cachePath, 'utf-8'));
    const partidos  = cacheData.partidos ?? {};
    cacheOddsMap    = new Map();
    for (const [id, entry] of Object.entries(partidos)) {
      cacheOddsMap.set(String(id), {
        mercados:    entry.odds?.mercados ?? {},
        capturado_en: cacheData.meta?.generado_en ?? new Date().toISOString(),
        fuente_path: cachePath.replace(/\\/g, '/').replace(/.*reports\//, 'reports/'),
      });
    }
    console.log(`\n  Caché odds: ${cachePath.split(/[\\/]/).pop()}  (${cacheOddsMap.size} partidos)`);
    break;
  } catch (err) {
    console.warn(`  WARN: no se pudo leer caché ${cachePath}: ${err.message}`);
  }
}

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
  console.log(`  Fecha      : ${fecha}`);
} else if (MODO === 'fromConfig') {
  console.log(`  Config     : ${fromConfigPath}  (${fromConfigIds.length} matchIds)`);
} else {
  console.log(`  MatchIds   : ${matchIdsArg.join(', ')}`);
}
console.log(`  Modo       : ${DRY_RUN ? 'DRY-RUN (sin escrituras Firestore)' : 'WRITE'}`);
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
    matchId: doc.id,
  }));
} else {
  // matchIds o fromConfig — misma lógica de carga
  const ids = efectivosIds;
  console.log(`\n  [1/3] Leyendo ${ids.length} predicción(es) por matchId...`);
  const docSnaps = await Promise.all(
    ids.map(id => db.collection('predicciones').doc(String(id)).get())
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

// Separar por fuente de odds:
//   - tienenSnapshot: tienen ultimo_odds_snapshot_id en Firestore
//   - sinSnapshotConCache: sin snapshot pero caché local disponible
//   - sinFuente: sin snapshot ni caché → se reportan pero no se procesan
const tienenSnapshot      = predicciones.filter(p => p.ultimo_odds_snapshot_id);
const sinSnapshotConCache = predicciones.filter(
  p => !p.ultimo_odds_snapshot_id && cacheOddsMap?.has(p.matchId)
);
const sinFuente = predicciones.filter(
  p => !p.ultimo_odds_snapshot_id && !cacheOddsMap?.has(p.matchId)
);

const conOdds = [...tienenSnapshot, ...sinSnapshotConCache];

if (sinFuente.length > 0) {
  console.log(`\n  AVISO — ${sinFuente.length} predicción(es) sin odds snapshot ni caché:`);
  for (const p of sinFuente) {
    console.log(`    ${p.matchId}  ${p.nombreLocal ?? '?'} vs ${p.nombreVisitante ?? '?'}`);
    if (fecha) console.log(`    → Ejecuta primero: node scripts/guardarOddsDelDia.js ${fecha}`);
  }
}

if (sinSnapshotConCache.length > 0) {
  console.log(`\n  INFO — ${sinSnapshotConCache.length} predicción(es) sin snapshot Firestore → usando caché local.`);
}

if (conOdds.length === 0) {
  console.log('\n  Ninguna predicción tiene odds (ni snapshot ni caché). Saliendo.');
  if (fecha) console.log(`  Ejecuta: node scripts/guardarOddsDelDia.js ${fecha}`);
  process.exit(0);
}

// Alias para compatibilidad con el código posterior
const conSnapshot = conOdds;

// ── 2. Leer odds snapshots ────────────────────────────────────────────────────

console.log(`\n  [2/3] Cargando odds para ${conSnapshot.length} partido(s)...`);
const snapshotsMap = new Map(); // matchId → snapshotData (real o virtual desde caché)

await Promise.all(conSnapshot.map(async (pred) => {
  const sid = pred.ultimo_odds_snapshot_id;

  // ── Fuente A: odds_snapshots de Firestore ────────────────────────────────
  if (sid) {
    const snap = await db.collection('odds_snapshots').doc(sid).get();
    if (!snap.exists) {
      console.log(`  WARN  ${pred.matchId}: snapshot "${sid}" no encontrado en Firestore`);
      // Intentar caché como fallback
    } else {
      snapshotsMap.set(pred.matchId, {
        id:          sid,
        fuente:      'firestore',
        fuente_path: `odds_snapshots/${sid}`,
        ...snap.data(),
      });
      const h2h    = snap.data().mercados?.h2h;
      const totals = snap.data().mercados?.totals;
      console.log(`    ${pred.matchId}  [firestore] snapshot: ${sid}`);
      if (h2h)    console.log(`      h2h    : L=${h2h.odds_local} X=${h2h.odds_empate} V=${h2h.odds_visitante}  (n_bk=${h2h.n_bookmakers} overround=${h2h.overround_pct}%)`);
      if (totals) console.log(`      totals : línea=${totals.linea} over=${totals.odds_over} under=${totals.odds_under}  (n_bk=${totals.n_bookmakers})`);
      if (!h2h)   console.log(`      AVISO : mercado h2h ausente en el snapshot`);
      if (!totals) console.log(`      INFO  : mercado totals ausente`);
      return;
    }
  }

  // ── Fuente B: caché local ────────────────────────────────────────────────
  const cacheEntry = cacheOddsMap?.get(pred.matchId);
  if (cacheEntry) {
    const { mercados, capturado_en, fuente_path } = cacheEntry;
    snapshotsMap.set(pred.matchId, {
      id:           `cache_${pred.matchId}`,
      fuente:       'cache',
      fuente_path:  fuente_path,
      mercados,
      tipo_snapshot: 'pre_partido',
      capturado_en,
    });
    const h2h    = mercados?.h2h;
    const totals = mercados?.totals;
    console.log(`    ${pred.matchId}  [caché] ${fuente_path}`);
    if (h2h)    console.log(`      h2h    : L=${h2h.odds_local} X=${h2h.odds_empate} V=${h2h.odds_visitante}  (n_bk=${h2h.n_bookmakers ?? '?'} overround=${h2h.overround_pct ?? '?'}%)`);
    if (totals) console.log(`      totals : línea=${totals.linea} over=${totals.odds_over} under=${totals.odds_under}  (n_bk=${totals.n_bookmakers ?? '?'})`);
    if (!h2h)   console.log(`      AVISO : mercado h2h ausente en caché`);
    if (!totals) console.log(`      INFO  : mercado totals ausente en caché`);
    return;
  }

  console.log(`  WARN  ${pred.matchId}: sin snapshot Firestore ni caché. Omitido.`);
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

  // ── Clasificar con taxonomía post-J1 ──────────────────────────────────────
  // Enriquece cada señal con betting_status, regla, etiqueta.
  // Calcula prediction_status, risk_level, model_warnings a nivel de partido.
  const clasificado = clasificarSenales({
    prediccion: pred,
    senales:    todasSenales,
  });
  // Las señales enriquecidas conservan todos los campos originales + betting_status
  const senalesEnriquecidas = clasificado.senales;

  // Mostrar señales
  const conValor = senalesEnriquecidas.filter(s => s.is_value_bet);
  console.log(`\n  Señales evaluadas: ${todasSenales.length}  |  Con valor (EV > ${TAU}): ${conValor.length}`);

  for (const s of senalesEnriquecidas) imprimirSenal(s);

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

  const mercadosEvaluados = [...new Set(senalesEnriquecidas.map(s => s.mercado))];

  // Mostrar clasificación post-J1
  console.log(`  prediction_status: ${clasificado.prediction_status}  risk_level: ${clasificado.risk_level}`);
  if (clasificado.model_warnings.length > 0) {
    console.log(`  model_warnings: ${clasificado.model_warnings.join(', ')}`);
  }

  resultados.push({
    matchId: pred.matchId,
    titulo,
    snapshotId:        snapshot.id,
    fuente:            snapshot.fuente       ?? 'firestore',
    fuente_path:       snapshot.fuente_path  ?? snapshot.id,
    capturado_en:      snapshot.capturado_en ?? null,
    señales:           senalesEnriquecidas,
    conValor:          conValor.length,
    mercadosEvaluados,
    advertencias:      todasAdvertencias,
    prediction_status: clasificado.prediction_status,
    risk_level:        clasificado.risk_level,
    model_warnings:    clasificado.model_warnings,
  });
}

// ── Terminar si es dry-run ────────────────────────────────────────────────────

if (DRY_RUN) {
  const totalSenales = resultados.reduce((a, r) => a + r.señales.length, 0);
  const totalValor   = resultados.reduce((a, r) => a + r.conValor, 0);
  const fuentes      = [...new Set(resultados.map(r => r.fuente))];
  console.log('\n' + '═'.repeat(76));
  console.log('  DRY-RUN completado.');
  console.log(`  Partidos evaluados : ${resultados.length}`);
  console.log(`  Señales calculadas : ${totalSenales} (${totalValor} con valor EV > ${TAU})`);
  console.log(`  Fuente odds        : ${fuentes.join(', ')}`);
  console.log(`  Escrituras         : 0`);
  console.log('');
  console.log('  Para escribir en Firestore (update(), no reemplaza predicción):');
  const cmdWrite = MODO === 'fromConfig'
    ? `node scripts/actualizarSenalesConOdds.js --fromConfig ${fromConfigPath} --write`
    : MODO === 'matchIds'
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
      señales_valor:            r.señales,        // incluye betting_status por señal
      evaluado_con_odds_en:     FieldValue.serverTimestamp(),
      mercados_evaluados:       r.mercadosEvaluados,
      // Taxonomía post-J1 a nivel de partido
      prediction_status:        r.prediction_status,
      risk_level:               r.risk_level,
      model_warnings:           r.model_warnings,
      // Metadata de fuente y conteo
      fuente_odds:              r.fuente,
      odds_cache_path:          r.fuente === 'cache' ? r.fuente_path : null,
      odds_capturado_en:        r.capturado_en,
      senales_count:            r.señales.length,
      senales_con_valor_count:  r.conValor,
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

process.exit(errores > 0 ? 1 : 0);

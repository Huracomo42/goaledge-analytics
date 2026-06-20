/**
 * auditarRecomendacionesJornada.js — Auditoría de predicciones y señales por jornada.
 *
 * Aplica clasificarSenales() a todos los partidos de una jornada y genera
 * un reporte completo con prediction_status, risk_level, model_warnings y
 * betting_status de cada señal.
 *
 * Usos:
 *   node scripts/auditarRecomendacionesJornada.js --fromConfig config/j2_ids.json
 *   node scripts/auditarRecomendacionesJornada.js --matchIds 537360 537361 537362
 *   node scripts/auditarRecomendacionesJornada.js --fecha 2026-06-25
 *   node scripts/auditarRecomendacionesJornada.js --fromConfig config/j2_ids.json --jornada J2
 *
 * La auditoría es solo lectura. No escribe Firestore.
 *
 * Outputs:
 *   reports/auditoria_recomendaciones_<jornada>_<ts>.json
 *   reports/auditoria_recomendaciones_<jornada>_<ts>.md  (si --md)
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getFirestore } from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import {
  clasificarSenales,
  BETTING_STATUS,
  PREDICTION_STATUS,
  RISK_LEVEL,
  MODEL_WARNING,
  clasificarTipo,
  TIPO_SENAL,
} from '../src/core/betting/signalFilters.js';

const db = getFirestore();

// ── Argumentos ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const genMD   = !args.includes('--no-md');
const jornada = (() => {
  const idx = args.indexOf('--jornada');
  return idx !== -1 ? args[idx + 1] : null;
})();
const fecha = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

const matchIdsFlagIdx = args.indexOf('--matchIds');
const matchIdsArg = matchIdsFlagIdx !== -1
  ? args.slice(matchIdsFlagIdx + 1)
      .filter(a => !a.startsWith('--'))
      .flatMap(a => a.split(','))
      .filter(a => /^\d+$/.test(a))
  : [];

const fromConfigFlagIdx = args.indexOf('--fromConfig');
const fromConfigPath    = fromConfigFlagIdx !== -1 ? args[fromConfigFlagIdx + 1] : null;

if (!fecha && matchIdsArg.length === 0 && !fromConfigPath) {
  console.error('\n  ERROR: debes pasar --fecha YYYY-MM-DD, --matchIds <id...> o --fromConfig <path>.\n');
  console.error('  Ejemplos:');
  console.error('    node scripts/auditarRecomendacionesJornada.js --fromConfig config/j2_ids.json --jornada J2');
  console.error('    node scripts/auditarRecomendacionesJornada.js --matchIds 537360 537361');
  console.error('    node scripts/auditarRecomendacionesJornada.js --fecha 2026-06-25\n');
  process.exit(1);
}

// ── Cargar matchIds ───────────────────────────────────────────────────────────

let matchIds = [];
let fuenteLabel = '';

if (fromConfigPath) {
  const raw = JSON.parse(readFileSync(resolve(fromConfigPath), 'utf-8'));
  const entries = Array.isArray(raw) ? raw : (raw.partidos ?? []);
  matchIds = entries.map(e => String(e.matchId ?? e.id ?? e)).filter(id => /^\d+$/.test(id));
  if (matchIds.length === 0) {
    console.error(`\n  ERROR: ${fromConfigPath} no contiene matchIds válidos.\n`);
    process.exit(1);
  }
  fuenteLabel = fromConfigPath;
} else if (matchIdsArg.length > 0) {
  matchIds = matchIdsArg;
  fuenteLabel = `matchIds: ${matchIds.join(', ')}`;
}

const jornadaLabel = jornada ?? (fecha ? `fecha_${fecha}` : 'JX');

// ── Helpers ───────────────────────────────────────────────────────────────────

const p2 = n => n != null ? `${(n * 100).toFixed(2)}%` : '—';
const p1 = n => n != null ? `${(n * 100).toFixed(1)}%` : '—';
const f2 = n => n != null ? n.toFixed(2) : '—';

const ICON_BS = {
  [BETTING_STATUS.VALUE_BET]:      '★',
  [BETTING_STATUS.PROTECTED_ONLY]: '○',
  [BETTING_STATUS.WATCHLIST]:      '◎',
  [BETTING_STATUS.NO_BET]:         '·',
  [BETTING_STATUS.TECHNICAL_ERROR]: '✗',
};

const ICON_PS = {
  [PREDICTION_STATUS.OK]:              '✓',
  [PREDICTION_STATUS.DATA_INCOMPLETE]: '~',
  [PREDICTION_STATUS.TECHNICAL_ERROR]: '✗',
};

const ICON_RL = {
  [RISK_LEVEL.LOW]:     '▪',
  [RISK_LEVEL.MEDIUM]:  '▲',
  [RISK_LEVEL.HIGH]:    '▲▲',
  [RISK_LEVEL.EXTREME]: '▲▲▲',
};

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log(`  auditarRecomendacionesJornada — ${jornadaLabel}`);
console.log('═'.repeat(76));

// 1. Cargar predicciones
let predicciones = [];

if (fecha) {
  console.log(`\n  [1] Leyendo predicciones para ${fecha}...`);
  const snap = await db.collection('predicciones').where('fechaPartido', '==', fecha).get();
  if (snap.empty) {
    console.log(`  0 predicciones en Firestore para ${fecha}.`);
    process.exit(0);
  }
  predicciones = snap.docs.map(doc => ({ ...doc.data(), matchId: doc.id }));
  matchIds = predicciones.map(p => p.matchId);
} else {
  console.log(`\n  [1] Leyendo ${matchIds.length} predicción(es) por matchId...`);
  const docSnaps = await Promise.all(matchIds.map(id => db.collection('predicciones').doc(id).get()));
  predicciones = docSnaps
    .filter(snap => {
      if (!snap.exists) { console.log(`  WARN  ${snap.id}: no existe en predicciones/`); return false; }
      return true;
    })
    .map(snap => ({ ...snap.data(), matchId: snap.id }));
}

console.log(`  ${predicciones.length}/${matchIds.length} predicciones encontradas.`);

// 2. Clasificar señales
console.log('\n  [2] Clasificando señales...\n');
console.log('─'.repeat(76));

const resultados = [];
const statsGlobal = {
  partidos:        predicciones.length,
  ok:              0,
  data_incomplete: 0,
  technical_error: 0,
  risk_low:        0,
  risk_medium:     0,
  risk_high:       0,
  risk_extreme:    0,
  value_bet:       0,
  protected_only:  0,
  watchlist:       0,
  no_bet:          0,
  senales_total:   0,
  // Model warnings
  warnings: Object.fromEntries(Object.values(MODEL_WARNING).map(w => [w, 0])),
};

for (const pred of predicciones) {
  const nombre  = `${pred.nombreLocal ?? '?'} vs ${pred.nombreVisitante ?? '?'}`;
  const senalesRaw = pred.señales_valor ?? pred.senales_valor ?? [];

  const resultado = clasificarSenales({
    prediccion: pred,
    senales:    senalesRaw,
    contexto:   { tipo: 'individual' },
  });

  // Contadores globales
  const ps = resultado.prediction_status;
  if (ps === PREDICTION_STATUS.OK)              statsGlobal.ok++;
  else if (ps === PREDICTION_STATUS.DATA_INCOMPLETE) statsGlobal.data_incomplete++;
  else                                          statsGlobal.technical_error++;

  const rl = resultado.risk_level;
  if (rl === RISK_LEVEL.LOW)         statsGlobal.risk_low++;
  else if (rl === RISK_LEVEL.MEDIUM) statsGlobal.risk_medium++;
  else if (rl === RISK_LEVEL.HIGH)   statsGlobal.risk_high++;
  else if (rl === RISK_LEVEL.EXTREME) statsGlobal.risk_extreme++;

  statsGlobal.value_bet      += resultado.senales_value_bet.length;
  statsGlobal.protected_only += resultado.senales_protected.length;
  statsGlobal.watchlist      += resultado.senales_watchlist.length;
  statsGlobal.no_bet         += resultado.senales_no_bet.length;
  statsGlobal.senales_total  += resultado.senales.length;

  for (const w of resultado.model_warnings) {
    if (statsGlobal.warnings[w] != null) statsGlobal.warnings[w]++;
  }

  // Imprimir partido
  const iconPs = ICON_PS[ps] ?? '?';
  const iconRl = ICON_RL[rl] ?? '?';
  const warnStr = resultado.model_warnings.length > 0 ? ` [${resultado.model_warnings.join(', ')}]` : '';
  console.log(`  ${iconPs} ${pred.matchId}  ${nombre}`);

  const pm = pred;
  if (pm.lambda_local != null) {
    const pct1x2 = pm.prob_1x2
      ? `1X2: ${(pm.prob_1x2.local*100).toFixed(0)}/${(pm.prob_1x2.empate*100).toFixed(0)}/${(pm.prob_1x2.visitante*100).toFixed(0)}`
      : '';
    console.log(`       λ: ${pm.lambda_local.toFixed(2)}/${pm.lambda_visitante.toFixed(2)}  ${pct1x2}  risk:${rl}${iconRl}${warnStr}`);
  }

  if (ps === PREDICTION_STATUS.TECHNICAL_ERROR) {
    console.log(`       ✗ ERROR TÉCNICO: ${resultado.razon_no_apuesta}`);
  } else if (ps === PREDICTION_STATUS.DATA_INCOMPLETE) {
    console.log('       ~ Sin señales (odds no disponibles)');
  } else {
    // Señales VALUE_BET y PROTECTED_ONLY
    for (const s of resultado.senales_value_bet) {
      const tipo = clasificarTipo(s);
      console.log(`       ★ VALUE_BET   ${s.mercado}/${s.seleccion.padEnd(12)} EV=${p2(s.expected_value).padStart(7)}  odds=${f2(s.bookmaker_odds)}  ${s.fragilidad ? `[fragil=${s.fragilidad}]` : ''}`);
    }
    for (const s of resultado.senales_protected) {
      console.log(`       ○ PROTECTED   ${s.mercado}/${s.seleccion.padEnd(12)} EV=${p2(s.expected_value).padStart(7)}  odds=${f2(s.bookmaker_odds)}  [${(s.regla ?? 'R?')}] ${(s.sugerencia ?? '').slice(0, 40)}`);
    }
    for (const s of resultado.senales_watchlist) {
      console.log(`       ◎ WATCHLIST   ${s.mercado}/${s.seleccion.padEnd(12)} EV=${p2(s.expected_value).padStart(7)}  [${s.regla ?? 'R?'}]`);
    }

    if (resultado.razon_no_apuesta) {
      console.log(`       — ${resultado.razon_no_apuesta.slice(0, 80)}`);
    }
  }
  console.log('');

  resultados.push({
    matchId:         pred.matchId,
    partido:         nombre,
    fecha_partido:   pred.fechaPartido ?? null,
    prediction_status: ps,
    risk_level:      rl,
    model_warnings:  resultado.model_warnings,
    lambda_local:    pred.lambda_local   ?? null,
    lambda_visitante: pred.lambda_visitante ?? null,
    prob_1x2:        pred.prob_1x2       ?? null,
    prob_over_under: pred.prob_over_under ?? null,
    prob_btts:       pred.prob_btts       ?? null,
    marcador_mas_probable: pred.marcador_mas_probable ?? null,
    senales_disponibles:   senalesRaw.length,
    value_bet:        resultado.senales_value_bet,
    protected_only:   resultado.senales_protected,
    watchlist:        resultado.senales_watchlist,
    no_bet:           resultado.senales_no_bet,
    razon_no_apuesta: resultado.razon_no_apuesta,
    _lambda_extrema_info: resultado._lambda_extrema_info,
  });
}

// 3. Resumen global
console.log('═'.repeat(76));
console.log('  RESUMEN AUDITORÍA');
console.log('─'.repeat(76));
console.log(`  Partidos analizados: ${statsGlobal.partidos}`);
console.log(`    prediction_status  OK:              ${statsGlobal.ok}`);
console.log(`    prediction_status  DATA_INCOMPLETE: ${statsGlobal.data_incomplete}`);
console.log(`    prediction_status  TECHNICAL_ERROR: ${statsGlobal.technical_error}`);
console.log('─'.repeat(76));
console.log(`  Risk level:`);
console.log(`    LOW:     ${statsGlobal.risk_low}  MEDIUM: ${statsGlobal.risk_medium}  HIGH: ${statsGlobal.risk_high}  EXTREME: ${statsGlobal.risk_extreme}`);
console.log('─'.repeat(76));
console.log(`  Señales totales: ${statsGlobal.senales_total}`);
console.log(`    VALUE_BET:      ${statsGlobal.value_bet}`);
console.log(`    PROTECTED_ONLY: ${statsGlobal.protected_only}`);
console.log(`    WATCHLIST:      ${statsGlobal.watchlist}`);
console.log(`    NO_BET:         ${statsGlobal.no_bet}`);
console.log('─'.repeat(76));
const activeWarnings = Object.entries(statsGlobal.warnings).filter(([, n]) => n > 0);
if (activeWarnings.length > 0) {
  console.log('  Model warnings activos:');
  for (const [w, n] of activeWarnings.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${w.padEnd(32)}: ${n} partido(s)`);
  }
  console.log('─'.repeat(76));
}

// TOP señales VALUE_BET
const topValueBet = resultados
  .flatMap(r => r.value_bet.map(s => ({ ...s, matchId: r.matchId, partido: r.partido })))
  .sort((a, b) => (b.expected_value ?? 0) - (a.expected_value ?? 0))
  .slice(0, 10);

if (topValueBet.length > 0) {
  console.log('  TOP VALUE_BET (por EV):');
  for (const s of topValueBet) {
    console.log(`    ★ ${s.partido.padEnd(32)} ${(s.mercado+'/'+s.seleccion).padEnd(22)} EV=${p2(s.expected_value)} odds=${f2(s.bookmaker_odds)}`);
  }
  console.log('─'.repeat(76));
}

console.log('═'.repeat(76));

// 4. Guardar JSON
const ts       = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const baseName = `auditoria_recomendaciones_${jornadaLabel}_${ts}`;
const OUT_DIR  = resolve('reports');
mkdirSync(OUT_DIR, { recursive: true });

const jsonPath = resolve(OUT_DIR, `${baseName}.json`);
writeFileSync(jsonPath, JSON.stringify({
  generado_en:   new Date().toISOString(),
  jornada:       jornadaLabel,
  fuente:        fuenteLabel || `fecha:${fecha}`,
  partidos:      resultados.length,
  estadisticas:  statsGlobal,
  top_value_bet: topValueBet.map(s => ({
    matchId: s.matchId, partido: s.partido,
    mercado: s.mercado, seleccion: s.seleccion,
    prob_modelo: s.prob_modelo, bookmaker_odds: s.bookmaker_odds,
    expected_value: s.expected_value, edge: s.edge,
  })),
  detalle: resultados,
}, null, 2), 'utf-8');

console.log(`\n  JSON: reports/${baseName}.json`);

// 5. Generar MD (si se pidió)
if (!genMD) { process.exit(0); }

const md = [];
md.push(`# Auditoría de Recomendaciones — ${jornadaLabel} — ${new Date().toISOString().slice(0, 10)}`);
md.push('');
md.push(`> Fuente: \`${fuenteLabel || `fecha:${fecha}`}\` | Partidos: ${resultados.length}`);
md.push('');
md.push('---');
md.push('');
md.push('## Resumen');
md.push('');
md.push('| Estadística | Valor |');
md.push('|---|---|');
md.push(`| Partidos analizados | ${statsGlobal.partidos} |`);
md.push(`| prediction OK | ${statsGlobal.ok} |`);
md.push(`| prediction DATA_INCOMPLETE | ${statsGlobal.data_incomplete} |`);
md.push(`| prediction TECHNICAL_ERROR | ${statsGlobal.technical_error} |`);
md.push(`| risk LOW | ${statsGlobal.risk_low} |`);
md.push(`| risk MEDIUM | ${statsGlobal.risk_medium} |`);
md.push(`| risk HIGH | ${statsGlobal.risk_high} |`);
md.push(`| risk EXTREME | ${statsGlobal.risk_extreme} |`);
md.push(`| **VALUE_BET** | **${statsGlobal.value_bet}** |`);
md.push(`| PROTECTED_ONLY | ${statsGlobal.protected_only} |`);
md.push(`| WATCHLIST | ${statsGlobal.watchlist} |`);
md.push(`| NO_BET | ${statsGlobal.no_bet} |`);
md.push('');

if (activeWarnings.length > 0) {
  md.push('### Model warnings activos');
  md.push('');
  md.push('| Warning | Partidos |');
  md.push('|---|---|');
  for (const [w, n] of activeWarnings.sort((a, b) => b[1] - a[1])) {
    md.push(`| \`${w}\` | ${n} |`);
  }
  md.push('');
}

md.push('---');
md.push('');
md.push('## Tabla de partidos');
md.push('');
md.push('| matchId | Partido | λ L | λ V | pred | risk | VALUE | PROT | WATCH | Warnings |');
md.push('|---|---|---|---|---|---|---|---|---|---|');

for (const r of resultados) {
  const lL = r.lambda_local    != null ? r.lambda_local.toFixed(2)    : '—';
  const lV = r.lambda_visitante != null ? r.lambda_visitante.toFixed(2) : '—';
  const ws = r.model_warnings.join(', ') || '—';
  md.push(`| ${r.matchId} | ${r.partido} | ${lL} | ${lV} | \`${r.prediction_status}\` | \`${r.risk_level ?? '—'}\` | ${r.value_bet.length} | ${r.protected_only.length} | ${r.watchlist.length} | ${ws} |`);
}

md.push('');
md.push('---');
md.push('');
md.push('## Detalle por partido');
md.push('');

for (const r of resultados) {
  md.push(`### ${r.partido} \`${r.matchId}\``);
  md.push('');

  if (r.lambda_local != null) {
    const p = r.prob_1x2;
    md.push(`**Modelo:** λ \`${r.lambda_local.toFixed(2)} / ${r.lambda_visitante.toFixed(2)}\`` +
      (p ? ` | 1X2 \`${(p.local*100).toFixed(1)}%/${(p.empate*100).toFixed(1)}%/${(p.visitante*100).toFixed(1)}%\`` : '') +
      (r.marcador_mas_probable ? ` | Marcador: \`${r.marcador_mas_probable}\`` : ''));
    md.push('');
  }

  md.push(`**prediction_status:** \`${r.prediction_status}\` | **risk_level:** \`${r.risk_level ?? '—'}\`` +
    (r.model_warnings.length > 0 ? ` | **warnings:** ${r.model_warnings.join(', ')}` : ''));
  md.push('');

  if (r.prediction_status === PREDICTION_STATUS.TECHNICAL_ERROR) {
    md.push(`> ✗ Error técnico: ${r.razon_no_apuesta}`);
  } else if (r.prediction_status === PREDICTION_STATUS.DATA_INCOMPLETE) {
    md.push('> Sin señales de valor (odds no capturadas).');
  } else {
    const apostables = [...r.value_bet, ...r.protected_only];
    if (apostables.length > 0) {
      md.push('| betting_status | Mercado | P_modelo | Odds | EV | Regla | Sugerencia |');
      md.push('|---|---|---|---|---|---|---|');
      for (const s of apostables) {
        const sug = (s.sugerencia ?? '').slice(0, 50);
        md.push(`| \`${s.betting_status}\` | \`${s.mercado}/${s.seleccion}\` | ${p1(s.prob_modelo)} | ${f2(s.bookmaker_odds)} | ${p2(s.expected_value)} | ${s.regla ?? '—'} | ${sug} |`);
      }
      md.push('');
    }
    if (r.watchlist.length > 0) {
      md.push('**WATCHLIST:**');
      md.push('');
      for (const s of r.watchlist) {
        md.push(`- \`${s.mercado}/${s.seleccion}\` EV=${p2(s.expected_value)} — ${(s.razon ?? '').slice(0, 70)}`);
      }
      md.push('');
    }
    if (r.razon_no_apuesta) {
      md.push(`> ${r.razon_no_apuesta}`);
    }
  }
  md.push('');
}

const mdPath = resolve(OUT_DIR, `${baseName}.md`);
writeFileSync(mdPath, md.join('\n'), 'utf-8');
console.log(`  MD:   reports/${baseName}.md\n`);

process.exit(0);

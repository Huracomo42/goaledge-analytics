/**
 * generarRecomendacionesJ2FinalConservador.js
 *
 * Genera recomendaciones finales J2 aplicando tres capas de clasificación:
 *   1. Risk gate   (config/j2_risk_gate.json)
 *   2. clasificarSenales() — taxonomía VALUE_BET / PROTECTED_ONLY / WATCHLIST / NO_BET
 *   3. Ajuste conservador J2 (degrada betting_status, nunca elimina predicción)
 *
 * Ajuste conservador (DEGRADA betting_status, no elimina):
 *   C1 — H2H empate VALUE_BET     → NO_BET (MERCADO_EMPATE_FRAGIL)
 *   C2 — H2H ganador VALUE_BET con EV < 5%, lambda extrema, o risk_class ≠ A
 *         → PROTECTED_ONLY (no NO_BET: la señal tiene valor potencial, solo es frágil)
 *   C3 — Totals VALUE_BET con EV < 3% (no exceptuando under≥3.5, over≤0.5)
 *         → WATCHLIST (no bloqueo: puede haber valor pero bajo)
 *
 * Clasificación final de cada señal apostable:
 *   FUERTE      — A class, sin lambda extrema, EV ≥ 10%, fragilidad ≠ alta
 *   MODERADA    — A class, sin lambda extrema, EV ≥ 3%
 *   MODERADA_B  — B class, sin lambda extrema, EV ≥ 3%
 *   OBSERVACION — PROTECTED_ONLY o WATCHLIST con EV ≥ 3%
 *   REFERENCIA  — WATCHLIST con EV < 3% o NO_BET con EV leve
 *
 * Regla principal: La predicción del modelo SIEMPRE se muestra.
 * Los filtros solo afectan betting_status, nunca eliminan un partido del output.
 *
 * SOLO LECTURA. Zero escrituras Firestore. Zero llamadas API.
 *
 * Outputs:
 *   reports/recomendaciones_j2_final_conservador_dryrun.json
 *   reports/recomendaciones_j2_final_conservador_dryrun.md
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve }       from 'path';
import { getFirestore }  from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import {
  clasificarSenales,
  clasificarTipo,
  TIPO_SENAL,
  BETTING_STATUS,
  PREDICTION_STATUS,
  MODEL_WARNING,
  RISK_LEVEL,
} from '../src/core/betting/signalFilters.js';

const db      = getFirestore();
const OUT_DIR = resolve('reports');

// ── Rutas ─────────────────────────────────────────────────────────────────────

const GATE_PATH = resolve('config', 'j2_risk_gate.json');
const JSON_OUT  = resolve(OUT_DIR, 'recomendaciones_j2_final_conservador_dryrun.json');
const MD_OUT    = resolve(OUT_DIR, 'recomendaciones_j2_final_conservador_dryrun.md');

// ── Gate config ───────────────────────────────────────────────────────────────

const gate        = JSON.parse(readFileSync(GATE_PATH, 'utf-8'));
const gateByMatch = Object.fromEntries(gate.matches.map(m => [m.matchId, m]));

// ── Helpers ───────────────────────────────────────────────────────────────────

const p1   = n  => n != null ? `${(n * 100).toFixed(1)}%` : '—';
const p2   = n  => n != null ? `${(n * 100).toFixed(2)}%` : '—';
const f2   = n  => n != null ? n.toFixed(2) : '—';
const icon = cl => ({ FUERTE: '★★', MODERADA: '★', MODERADA_B: '★~', OBSERVACION: '○', REFERENCIA: '·' })[cl] ?? '?';

function extraerLinea(seleccion) {
  const m = /(\d+\.?\d*)/.exec(String(seleccion ?? ''));
  return m ? parseFloat(m[1]) : null;
}

function esApostable(rec) {
  return (rec.clasificacion === 'FUERTE' ||
          rec.clasificacion === 'MODERADA' ||
          rec.clasificacion === 'MODERADA_B') &&
         (rec.expected_value ?? 0) >= 0.03;
}

// ── Filtro B (degradar agresivos en B_SOLO_PROTEGIDOS) ───────────────────────

function aplicarDowngradeB(senales) {
  return senales.map(s => {
    if (s.betting_status !== BETTING_STATUS.VALUE_BET) return s;
    const tipo     = clasificarTipo(s);
    const mercado  = (s.mercado   ?? '').toLowerCase();
    const seleccion = (s.seleccion ?? '').toLowerCase();

    if (tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE ||
        tipo === TIPO_SENAL.H2H_EMPATE ||
        tipo === TIPO_SENAL.BTTS_SI || tipo === TIPO_SENAL.BTTS_NO) {
      return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_b: `${tipo.toUpperCase()} — risk B` };
    }
    if (tipo === TIPO_SENAL.OVER) {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea > 2.5) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_b: `OVER_AGRESIVO (linea=${linea}) — risk B` };
      }
    }
    if (mercado.includes('handicap') || mercado === 'spreads' || mercado === 'ah') {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea < -1.0) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_b: `HANDICAP_AGRESIVO (linea=${linea}) — risk B` };
      }
    }
    return s;
  });
}

// ── Ajuste conservador C1/C2/C3 ──────────────────────────────────────────────
// Degrada betting_status. NUNCA elimina la señal del array.

function aplicarAjusteConservador(senales, riskClass, hayLambdaExtrema) {
  return senales.map(s => {
    const tipo = clasificarTipo(s);
    const ev   = s.expected_value ?? 0;
    const sel  = (s.seleccion ?? '').toLowerCase();
    const esH2HGanador = tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE;
    const esTotals     = tipo === TIPO_SENAL.OVER || tipo === TIPO_SENAL.UNDER;

    // C1 — empate VALUE_BET → NO_BET (fragil por diseño)
    if (tipo === TIPO_SENAL.H2H_EMPATE && s.betting_status === BETTING_STATUS.VALUE_BET) {
      return { ...s, betting_status: BETTING_STATUS.NO_BET, motivo_conservador: 'MERCADO_EMPATE_FRAGIL (C1)' };
    }

    // C2 — H2H ganador VALUE_BET frágil → PROTECTED_ONLY (no NO_BET: hay señal de valor)
    if (esH2HGanador && s.betting_status === BETTING_STATUS.VALUE_BET) {
      if (ev < 0.05) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'H2H_EV_INSUFICIENTE <5% (C2)' };
      }
      if (hayLambdaExtrema) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'H2H_LAMBDA_EXTREMA (C2)' };
      }
      if (riskClass !== 'A_USABLE') {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: `H2H_RISK_${riskClass.split('_')[0]} (C2)` };
      }
    }

    // C3 — Totals VALUE_BET con EV bajo → WATCHLIST (no bloqueo)
    if (esTotals && s.betting_status === BETTING_STATUS.VALUE_BET) {
      const linea = s.linea ?? extraerLinea(sel);
      const esExcepcion =
        (tipo === TIPO_SENAL.UNDER && linea !== null && linea >= 3.5) ||
        (tipo === TIPO_SENAL.OVER  && linea !== null && linea <= 0.5);
      if (!esExcepcion) {
        if (ev < 0.03) {
          return { ...s, betting_status: BETTING_STATUS.WATCHLIST, motivo_conservador: 'TOTALS_EV_BAJO <3% (C3)' };
        }
        if (hayLambdaExtrema) {
          return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'TOTALS_LAMBDA_EXTREMA (C3)' };
        }
      }
    }

    return s;
  });
}

// ── Clasificación final ───────────────────────────────────────────────────────

function clasificarFinal(senal, riskClass, hayLambdaExtrema) {
  const ev    = senal.expected_value ?? 0;
  const bs    = senal.betting_status;
  const sinLambda = !hayLambdaExtrema;

  if (bs === BETTING_STATUS.VALUE_BET) {
    if (riskClass === 'A_USABLE' && sinLambda && ev >= 0.10 && senal.fragilidad !== 'alta') return 'FUERTE';
    if (riskClass === 'A_USABLE' && sinLambda && ev >= 0.03)                                return 'MODERADA';
    if (riskClass === 'B_SOLO_PROTEGIDOS' && sinLambda && ev >= 0.03)                      return 'MODERADA_B';
    return 'OBSERVACION';
  }
  if (bs === BETTING_STATUS.PROTECTED_ONLY && ev >= 0.03) return 'OBSERVACION';
  return 'REFERENCIA';
}

function securityScore(rec) {
  const ev      = rec.expected_value ?? 0;
  const tipo    = clasificarTipo(rec);
  const esUnder = tipo === TIPO_SENAL.UNDER;
  const esOver  = tipo === TIPO_SENAL.OVER;
  const linea   = rec.linea ?? extraerLinea(rec.seleccion ?? '');
  const clScore = { FUERTE: 20, MODERADA: 12, MODERADA_B: 8, OBSERVACION: 4, REFERENCIA: 0 };

  let s = 0;
  s += rec.risk_class === 'A_USABLE' ? 40 : 20;
  s += rec.hay_lambda_extrema ? 0 : 30;
  s += clScore[rec.clasificacion] ?? 0;
  s += esUnder ? 15 : esOver ? 8 : 0;
  s += (esUnder && linea !== null && linea >= 3.5) ? 10 : 0;
  s += Math.min(ev * 30, 15);
  return s;
}

// ── Cargar datos y procesar ───────────────────────────────────────────────────

console.log('═'.repeat(76));
console.log('  generarRecomendacionesJ2FinalConservador — SOLO LECTURA');
console.log('═'.repeat(76));
console.log(`\n  Gate: ${gate.matches.length} matchIds | A=${gate.resumen.A} B=${gate.resumen.B} C=${gate.resumen.C} D=${gate.resumen.D}`);
console.log('  Cargando predicciones desde Firestore...\n');

const matchIds = gate.matches.map(m => m.matchId);
const snaps    = await Promise.all(
  matchIds.map(id => db.collection('predicciones').doc(id).get())
);

const stats = {
  partidos_total:            gate.matches.length,
  sin_prediccion:            0,
  sin_senales:               0,
  errores_tecnicos:          0,
  degradaciones_c1_empate:   0,
  degradaciones_c2_h2h:      0,
  degradaciones_c3_totals:   0,
  apostables_fuerte:         0,
  apostables_moderada:       0,
  apostables_moderada_b:     0,
  observacion:               0,
  referencia:                0,
};

const recomendacionesFinales = [];
const detallePartidos        = [];

for (let i = 0; i < matchIds.length; i++) {
  const matchId  = matchIds[i];
  const gateInfo = gateByMatch[matchId];
  const snap     = snaps[i];

  const resPartido = {
    matchId,
    partido:       gateInfo.partido,
    risk_class:    gateInfo.risk_class,
    motivos_gate:  gateInfo.motivos,
    prediccion_modelo:   null,
    prediction_status:   null,
    risk_level:          null,
    model_warnings:      [],
    hay_lambda_extrema:  false,
    senales_disponibles: 0,
    senales_finales:     [],
    senales_degradadas:  [],
    recomendaciones_finales: 0,
    estado: null,
  };

  if (!snap.exists) {
    resPartido.estado = 'SIN_PREDICCION';
    resPartido.prediction_status = PREDICTION_STATUS.TECHNICAL_ERROR;
    stats.sin_prediccion++;
    detallePartidos.push(resPartido);
    continue;
  }

  const pred       = snap.data();
  const senalesRaw = pred.señales_valor ?? pred.senales_valor ?? [];

  // Capturar predicción del modelo siempre
  resPartido.prediccion_modelo = {
    lambda_local:          pred.lambda_local,
    lambda_visitante:      pred.lambda_visitante,
    prob_1x2:              pred.prob_1x2,
    prob_over_under:       pred.prob_over_under ?? null,
    prob_btts:             pred.prob_btts ?? null,
    marcador_mas_probable: pred.marcador_mas_probable ?? null,
  };

  if (senalesRaw.length === 0) {
    resPartido.estado = 'SIN_SENALES_VALOR';
    resPartido.prediction_status = PREDICTION_STATUS.DATA_INCOMPLETE;
    stats.sin_senales++;
    detallePartidos.push(resPartido);
    continue;
  }

  resPartido.senales_disponibles = senalesRaw.length;

  // ── Capa 1: clasificarSenales ────────────────────────────────────────────
  const clasificado = clasificarSenales({
    prediccion: pred,
    senales:    senalesRaw,
    contexto:   { tipo: 'individual' },
  });

  if (clasificado.prediction_status === PREDICTION_STATUS.TECHNICAL_ERROR) {
    resPartido.estado = `ERROR_TECNICO: ${clasificado.razon_no_apuesta ?? ''}`;
    resPartido.prediction_status = PREDICTION_STATUS.TECHNICAL_ERROR;
    stats.errores_tecnicos++;
    detallePartidos.push(resPartido);
    continue;
  }

  resPartido.prediction_status = clasificado.prediction_status;
  resPartido.risk_level        = clasificado.risk_level;
  resPartido.model_warnings    = clasificado.model_warnings;

  const hayLambdaExtrema = clasificado.model_warnings.includes(MODEL_WARNING.LAMBDA_EXTREMA);
  resPartido.hay_lambda_extrema = hayLambdaExtrema;

  // ── Capa 2: downgrade B ──────────────────────────────────────────────────
  let senales = clasificado.senales;
  if (gateInfo.risk_class === 'B_SOLO_PROTEGIDOS') {
    senales = aplicarDowngradeB(senales);
  }

  // ── Gate C/D: downgrade VALUE_BET ────────────────────────────────────────
  const gateOverride = {
    C_BLOQUEAR_APUESTAS:   { target: BETTING_STATUS.PROTECTED_ONLY, razon: `Gate C — ${gateInfo.motivos.join(',')}` },
    D_RECALCULAR_PREDICCION: { target: BETTING_STATUS.WATCHLIST,   razon: `Gate D — ${gateInfo.motivos.join(',')}` },
  }[gateInfo.risk_class];

  if (gateOverride) {
    senales = senales.map(s =>
      s.betting_status === BETTING_STATUS.VALUE_BET
        ? { ...s, betting_status: gateOverride.target, razon_gate: gateOverride.razon }
        : s
    );
    if (!resPartido.model_warnings.includes(
          gateInfo.risk_class === 'C_BLOQUEAR_APUESTAS' ? MODEL_WARNING.FAVORITO_SUBESTIMADO : MODEL_WARNING.MODELO_INVERTIDO
        )) {
      resPartido.model_warnings.push(
        gateInfo.risk_class === 'C_BLOQUEAR_APUESTAS' ? MODEL_WARNING.FAVORITO_SUBESTIMADO : MODEL_WARNING.MODELO_INVERTIDO
      );
    }
  }

  // ── Capa 3: ajuste conservador ───────────────────────────────────────────
  const senalesAjustadas = aplicarAjusteConservador(senales, gateInfo.risk_class, hayLambdaExtrema);

  // Contabilizar degradaciones
  for (let j = 0; j < senalesAjustadas.length; j++) {
    const antes  = senales[j];
    const despues = senalesAjustadas[j];
    if (antes.betting_status !== despues.betting_status) {
      const motivo = despues.motivo_conservador ?? '';
      if (motivo.includes('(C1)')) stats.degradaciones_c1_empate++;
      else if (motivo.includes('(C2)')) stats.degradaciones_c2_h2h++;
      else if (motivo.includes('(C3)')) stats.degradaciones_c3_totals++;
    }
  }

  // ── Clasificar señales finales ───────────────────────────────────────────
  const senalesFinales   = [];
  const senalesDegradadas = [];

  for (const s of senalesAjustadas) {
    const cl  = clasificarFinal(s, gateInfo.risk_class, hayLambdaExtrema);
    const rec = {
      matchId,
      partido:            gateInfo.partido,
      risk_class:         gateInfo.risk_class,
      hay_lambda_extrema: hayLambdaExtrema,
      mercado:            s.mercado,
      seleccion:          s.seleccion,
      equipo:             s.equipo    ?? null,
      linea:              s.linea     ?? null,
      prob_modelo:        s.prob_modelo,
      bookmaker_odds:     s.bookmaker_odds,
      expected_value:     s.expected_value,
      edge:               s.edge,
      nivel_valor:        s.nivel_valor,
      fragilidad:         s.fragilidad ?? null,
      betting_status:     s.betting_status,
      regla:              s.regla ?? null,
      razon:              s.razon ?? null,
      sugerencia:         s.sugerencia ?? null,
      motivo_conservador: s.motivo_conservador ?? null,
      razon_gate:         s.razon_gate ?? null,
      clasificacion:      cl,
    };

    if (cl === 'FUERTE')       stats.apostables_fuerte++;
    else if (cl === 'MODERADA')   stats.apostables_moderada++;
    else if (cl === 'MODERADA_B') stats.apostables_moderada_b++;
    else if (cl === 'OBSERVACION') stats.observacion++;
    else                           stats.referencia++;

    if (s.betting_status === BETTING_STATUS.VALUE_BET ||
        s.betting_status === BETTING_STATUS.PROTECTED_ONLY ||
        s.betting_status === BETTING_STATUS.WATCHLIST) {
      senalesFinales.push(rec);
    } else {
      senalesDegradadas.push(rec);
    }

    recomendacionesFinales.push(rec);
  }

  resPartido.senales_finales     = senalesFinales;
  resPartido.senales_degradadas  = senalesDegradadas.map(s => ({
    mercado:    s.mercado, seleccion: s.seleccion,
    ev:         +((s.expected_value ?? 0) * 100).toFixed(1),
    motivo:     s.motivo_conservador ?? s.razon ?? s.betting_status,
  }));
  resPartido.recomendaciones_finales = senalesFinales.filter(s =>
    s.betting_status === BETTING_STATUS.VALUE_BET ||
    s.betting_status === BETTING_STATUS.PROTECTED_ONLY
  ).length;
  resPartido.estado = senalesFinales.length > 0 ? 'CON_CLASIFICACION' : 'SIN_SENALES_APOSTABLES';

  detallePartidos.push(resPartido);
}

// ── Separar por apostabilidad ─────────────────────────────────────────────────

const apostables    = recomendacionesFinales.filter(r => esApostable(r));
const observaciones = recomendacionesFinales.filter(r => !esApostable(r));

const rankingSeguridad = [...apostables].sort((a, b) => {
  const sa = securityScore(a), sb = securityScore(b);
  return sb - sa || (b.expected_value ?? 0) - (a.expected_value ?? 0);
});

// ── Imprimir consola ──────────────────────────────────────────────────────────

const TOTAL_APOSTABLE = stats.apostables_fuerte + stats.apostables_moderada + stats.apostables_moderada_b;

console.log('  DETALLE POR PARTIDO\n' + '─'.repeat(76));

for (const r of detallePartidos) {
  const letra = r.risk_class?.split('_')[0] ?? '?';
  const pm    = r.prediccion_modelo;
  const lambdaStr = pm?.lambda_local != null ? ` λ:${pm.lambda_local.toFixed(2)}/${pm.lambda_visitante.toFixed(2)}` : '';
  const warnStr   = r.model_warnings?.length > 0 ? ` [${r.model_warnings.join(',')}]` : '';

  if (!pm) {
    console.log(`  [${letra}] ${r.matchId}  ${r.partido}  →  ${r.estado}`);
    continue;
  }
  if (r.estado === 'SIN_SENALES_VALOR') {
    console.log(`  [${letra}] ${r.matchId}  ${r.partido}${lambdaStr}  →  SIN_SENALES_VALOR`);
    continue;
  }
  if (r.estado?.startsWith('ERROR_TECNICO')) {
    console.log(`  [${letra}] ${r.matchId}  ${r.partido}  →  ${r.estado}`);
    continue;
  }

  const lambdaTag = r.hay_lambda_extrema ? ' ⚠LAMBDA' : '';
  console.log(`  [${letra}] ${r.matchId}  ${r.partido}${lambdaStr}${lambdaTag}${warnStr}`);

  for (const s of r.senales_finales) {
    const ic  = icon(s.clasificacion);
    const tag = esApostable(s) ? '' : '  [solo referencia]';
    console.log(`       ${ic} [${s.betting_status}] ${(s.mercado+'/'+s.seleccion).padEnd(22)}  EV=${p2(s.expected_value).padStart(7)}  odds=${f2(s.bookmaker_odds)}  ${s.clasificacion}${tag}`);
  }
  for (const b of r.senales_degradadas) {
    console.log(`       ✗ [NO_BET] ${(b.mercado+'/'+b.seleccion).padEnd(22)}  EV=${String(b.ev+'%').padStart(7)}  [${b.motivo?.slice(0, 50)}]`);
  }
}

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN AJUSTE CONSERVADOR');
console.log('─'.repeat(76));
console.log(`  Degradaciones C1 empate       : ${stats.degradaciones_c1_empate}`);
console.log(`  Degradaciones C2 H2H ganador  : ${stats.degradaciones_c2_h2h}`);
console.log(`  Degradaciones C3 totals       : ${stats.degradaciones_c3_totals}`);
console.log('─'.repeat(76));
console.log(`  Recomendaciones apostables    : ${TOTAL_APOSTABLE}`);
console.log(`    ★★ FUERTE                   : ${stats.apostables_fuerte}`);
console.log(`    ★  MODERADA                 : ${stats.apostables_moderada}`);
console.log(`    ★~ MODERADA_B               : ${stats.apostables_moderada_b}`);
console.log(`  Observaciones/referencias     : ${stats.observacion + stats.referencia}`);
console.log(`  Errores técnicos              : ${stats.errores_tecnicos}`);
console.log(`  Firestore escrituras          : 0`);
console.log('─'.repeat(76));
console.log('  TOP RECOMENDACIONES APOSTABLES');
console.log('─'.repeat(76));

for (let idx = 0; idx < rankingSeguridad.length; idx++) {
  const r   = rankingSeguridad[idx];
  const ic  = icon(r.clasificacion);
  const cls = r.risk_class.split('_')[0];
  const lam = r.hay_lambda_extrema ? '⚠' : '';
  console.log(`  ${String(idx+1).padStart(2)}. ${ic} [${cls}${lam}] ${r.partido.padEnd(32)}  ${(r.mercado+'/'+r.seleccion).padEnd(22)}  EV=${p2(r.expected_value).padStart(7)}  ${r.clasificacion}`);
}

console.log('═'.repeat(76));

// ── Generar JSON ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(JSON_OUT, JSON.stringify({
  generado_en:       new Date().toISOString(),
  modo:              'dry-run',
  firestore_escrito: false,
  estadisticas: {
    ...stats,
    total_apostable:  TOTAL_APOSTABLE,
  },
  recomendaciones_apostables:  rankingSeguridad,
  observaciones_no_apostables: observaciones,
  detalle_partidos:            detallePartidos,
}, null, 2), 'utf-8');

console.log(`\n  JSON: reports/recomendaciones_j2_final_conservador_dryrun.json`);

// ── Generar Markdown ──────────────────────────────────────────────────────────

const hoy = new Date().toISOString().slice(0, 10);
const md  = [];

md.push(`# Recomendaciones J2 — Clasificador Conservador — ${hoy}`);
md.push('');
md.push('> **Pipeline:** gate de riesgo → clasificarSenales → downgrade B → ajuste conservador C1/C2/C3');
md.push('> **Regla principal:** La predicción del modelo siempre se muestra. Los filtros solo afectan `betting_status`.');
md.push('');
md.push('---');
md.push('');
md.push('## Resumen');
md.push('');
md.push('| Etapa | N |');
md.push('|---|---|');
md.push(`| Degradaciones C1 (empate → NO_BET) | ${stats.degradaciones_c1_empate} |`);
md.push(`| Degradaciones C2 (H2H ganador → PROTECTED_ONLY) | ${stats.degradaciones_c2_h2h} |`);
md.push(`| Degradaciones C3 (totals → WATCHLIST) | ${stats.degradaciones_c3_totals} |`);
md.push(`| **Apostables FUERTE** | **${stats.apostables_fuerte}** |`);
md.push(`| **Apostables MODERADA** | **${stats.apostables_moderada}** |`);
md.push(`| **Apostables MODERADA_B** | **${stats.apostables_moderada_b}** |`);
md.push(`| Total apostable | **${TOTAL_APOSTABLE}** |`);
md.push('');
md.push('---');
md.push('');
md.push('## TOP Apostables (ranking por seguridad)');
md.push('');
md.push('| # | Cl. | Partido | Mercado | P_modelo | Odds | EV | Clasif. |');
md.push('|---|---|---|---|---|---|---|---|');

for (let idx = 0; idx < rankingSeguridad.length; idx++) {
  const r   = rankingSeguridad[idx];
  const ic  = icon(r.clasificacion);
  const cls = r.risk_class.split('_')[0];
  const lam = r.hay_lambda_extrema ? '⚠' : '';
  md.push(`| ${idx+1} | ${lam}${cls} | **${r.partido}** | \`${r.mercado}/${r.seleccion}\` | ${p1(r.prob_modelo)} | ${f2(r.bookmaker_odds)} | ${p2(r.expected_value)} | ${ic} ${r.clasificacion} |`);
}

md.push('');
md.push('---');
md.push('');
md.push('## Detalle por partido');
md.push('');

for (const r of detallePartidos) {
  const letra = r.risk_class?.split('_')[0] ?? '?';
  md.push(`### [${letra}] ${r.partido} \`${r.matchId}\``);
  md.push('');

  const pm = r.prediccion_modelo;
  if (pm?.lambda_local != null) {
    md.push(`**Modelo:** λ \`${pm.lambda_local.toFixed(2)} / ${pm.lambda_visitante.toFixed(2)}\` | ` +
      `1X2 \`${(pm.prob_1x2?.local*100).toFixed(1)}%/${(pm.prob_1x2?.empate*100).toFixed(1)}%/${(pm.prob_1x2?.visitante*100).toFixed(1)}%\`` +
      (pm.marcador_mas_probable ? ` | Marcador: \`${pm.marcador_mas_probable}\`` : ''));
    md.push('');
  }

  if (r.estado === 'SIN_PREDICCION' || r.estado?.startsWith('ERROR_TECNICO')) {
    md.push(`> ✗ \`${r.estado}\``);
    md.push('');
    continue;
  }
  if (r.estado === 'SIN_SENALES_VALOR') {
    md.push('> Sin señales. Pipeline de odds pendiente.');
    md.push('');
    continue;
  }

  const lambdaTag = r.hay_lambda_extrema ? ' ⚠ _LAMBDA\\_EXTREMA_' : '';
  const warnStr   = r.model_warnings?.length > 0 ? ` | warnings: ${r.model_warnings.join(', ')}` : '';
  md.push(`**risk_class:** \`${r.risk_class}\`${lambdaTag}${warnStr}`);
  md.push('');

  if (r.senales_finales.length > 0) {
    md.push('**Señales clasificadas:**');
    md.push('');
    md.push('| betting_status | Mercado | P_modelo | Odds | EV | Clasif. | Razón/Sugerencia |');
    md.push('|---|---|---|---|---|---|---|');
    for (const s of r.senales_finales) {
      const ic    = icon(s.clasificacion);
      const razon = (s.motivo_conservador ?? s.razon_gate ?? s.razon ?? '').slice(0, 50);
      md.push(`| \`${s.betting_status}\` | \`${s.mercado}/${s.seleccion}\` | ${p1(s.prob_modelo)} | ${f2(s.bookmaker_odds)} | ${p2(s.expected_value)} | ${ic} ${s.clasificacion} | ${razon} |`);
    }
    md.push('');
  }

  if (r.senales_degradadas.length > 0) {
    md.push('<details><summary>Señales NO_BET por ajuste conservador</summary>');
    md.push('');
    md.push('| Mercado | EV | Motivo |');
    md.push('|---|---|---|');
    for (const b of r.senales_degradadas) {
      md.push(`| \`${b.mercado}/${b.seleccion}\` | ${b.ev}% | ${b.motivo} |`);
    }
    md.push('');
    md.push('</details>');
    md.push('');
  }
}

md.push('---');
md.push('');
md.push('## Criterios de clasificación');
md.push('');
md.push('| Clasif. | Condición |');
md.push('|---|---|');
md.push('| **FUERTE** | A class, sin lambda extrema, EV ≥ 10%, fragilidad normal, VALUE_BET |');
md.push('| **MODERADA** | A class, sin lambda extrema, EV ≥ 3%, VALUE_BET |');
md.push('| **MODERADA_B** | B class, sin lambda extrema, EV ≥ 3%, VALUE_BET |');
md.push('| **OBSERVACION** | PROTECTED_ONLY o WATCHLIST con EV ≥ 3% |');
md.push('| **REFERENCIA** | WATCHLIST/PROTECTED con EV < 3% o NO_BET con EV leve |');

writeFileSync(MD_OUT, md.join('\n'), 'utf-8');
console.log(`  MD:   reports/recomendaciones_j2_final_conservador_dryrun.md\n`);

process.exit(0);

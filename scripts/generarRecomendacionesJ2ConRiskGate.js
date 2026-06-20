/**
 * generarRecomendacionesJ2ConRiskGate.js — Recomendaciones J2 con gate de riesgo.
 *
 * SOLO LECTURA. Zero escrituras Firestore. Zero llamadas API.
 *
 * Flujo:
 *   1. Lee config/j2_risk_gate.json → clase de riesgo por matchId.
 *   2. Lee predicciones/{matchId} de Firestore para TODOS los partidos.
 *   3. Por partido, aplica clasificarSenales() + gate override:
 *      A_USABLE          → clasificarSenales() normal.
 *      B_SOLO_PROTEGIDOS → clasificarSenales() + filtro adicional mercados B.
 *      C_BLOQUEAR        → clasificarSenales() + downgrade VALUE_BET → PROTECTED_ONLY
 *                          + model_warning FAVORITO_SUBESTIMADO.
 *      D_RECALCULAR      → clasificarSenales() + downgrade VALUE_BET → WATCHLIST
 *                          + model_warning MODELO_INVERTIDO.
 *
 * Regla principal: NUNCA omitir un partido del output.
 * La predicción del modelo siempre se muestra (lambda, prob_1x2, etc.).
 * El gate solo afecta el betting_status de las señales, no la predicción.
 *
 * Outputs:
 *   reports/recomendaciones_j2_con_risk_gate_dryrun.json
 *   reports/recomendaciones_j2_con_risk_gate_dryrun.md
 *
 * --execute (cuando esté listo) escribe señales en Firestore.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getFirestore } from 'firebase-admin/firestore';

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
const DRY_RUN = !process.argv.includes('--execute');
const OUT_DIR = resolve('reports');

// ── Rutas ─────────────────────────────────────────────────────────────────────

const GATE_PATH = resolve('config', 'j2_risk_gate.json');
const JSON_OUT  = resolve(OUT_DIR, 'recomendaciones_j2_con_risk_gate_dryrun.json');
const MD_OUT    = resolve(OUT_DIR, 'recomendaciones_j2_con_risk_gate_dryrun.md');

// ── Cargar gate ───────────────────────────────────────────────────────────────

const gate        = JSON.parse(readFileSync(GATE_PATH, 'utf-8'));
const gateByMatch = Object.fromEntries(gate.matches.map(m => [m.matchId, m]));

// ── Gate override por clase ───────────────────────────────────────────────────
// C/D no bloquean la predicción. Solo agregan model_warning y degradan
// VALUE_BET a PROTECTED_ONLY (C) o WATCHLIST (D).

const GATE_OVERRIDE = Object.freeze({
  C_BLOQUEAR_APUESTAS:   {
    warning:   MODEL_WARNING.FAVORITO_SUBESTIMADO,
    downgrade: BETTING_STATUS.PROTECTED_ONLY,
    label:     'FAVORITO_GRANDE_SUBESTIMADO — solo mercados protegidos',
  },
  D_RECALCULAR_PREDICCION: {
    warning:   MODEL_WARNING.MODELO_INVERTIDO,
    downgrade: BETTING_STATUS.WATCHLIST,
    label:     'MODELO_INVERTIDO — señales en watchlist hasta recalcular',
  },
});

// ── Filtro adicional para clase B ─────────────────────────────────────────────

function extraerLinea(seleccion) {
  const m = /(\d+\.?\d*)/.exec(String(seleccion ?? ''));
  return m ? parseFloat(m[1]) : null;
}

const MOTIVO_B = Object.freeze({
  H2H_GANADOR:       'H2H_GANADOR_SECO — riesgo clase B',
  EMPATE:            'EMPATE — riesgo clase B',
  BTTS:              'BTTS — riesgo clase B',
  OVER_AGRESIVO:     'OVER_AGRESIVO (linea > 2.5) — riesgo clase B',
  HANDICAP_AGRESIVO: 'HANDICAP_AGRESIVO (linea < -1.0) — riesgo clase B',
});

/**
 * Segunda capa para clase B: degrada VALUE_BET agresivos a PROTECTED_ONLY.
 * Permitidas: under, over ≤ 2.5, handicap protegido, DC.
 * Degradadas a PROTECTED_ONLY: H2H ganador seco, empate, BTTS, over > 2.5, handicap agresivo.
 */
function aplicarDowngradeB(senales) {
  return senales.map(s => {
    if (s.betting_status !== BETTING_STATUS.VALUE_BET) return s;

    const tipo     = clasificarTipo(s);
    const mercado  = (s.mercado   ?? '').toLowerCase();
    const seleccion = (s.seleccion ?? '').toLowerCase();

    if (tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE) {
      return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, razon_gate_b: MOTIVO_B.H2H_GANADOR };
    }
    if (tipo === TIPO_SENAL.H2H_EMPATE) {
      return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, razon_gate_b: MOTIVO_B.EMPATE };
    }
    if (tipo === TIPO_SENAL.BTTS_SI || tipo === TIPO_SENAL.BTTS_NO) {
      return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, razon_gate_b: MOTIVO_B.BTTS };
    }
    if (tipo === TIPO_SENAL.OVER) {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea > 2.5) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, razon_gate_b: MOTIVO_B.OVER_AGRESIVO };
      }
    }
    if (mercado.includes('handicap') || mercado === 'spreads' || mercado === 'ah') {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea < -1.0) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, razon_gate_b: MOTIVO_B.HANDICAP_AGRESIVO };
      }
    }
    return s;
  });
}

// ── Procesar partidos ─────────────────────────────────────────────────────────

console.log('═'.repeat(76));
console.log(`  generarRecomendacionesJ2ConRiskGate — ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}`);
console.log('═'.repeat(76));
console.log(`\n  Gate: ${gate.matches.length} matchIds | A=${gate.resumen.A} B=${gate.resumen.B} C=${gate.resumen.C} D=${gate.resumen.D}`);
console.log('  Cargando predicciones desde Firestore...\n');

const matchIds = gate.matches.map(m => m.matchId);
const snaps    = await Promise.all(
  matchIds.map(id => db.collection('predicciones').doc(id).get())
);

const resultados    = [];
const statsGlobales = {
  partidos_procesados:     0,
  partidos_sin_prediccion: 0,
  partidos_sin_senales:    0,
  senales_total:           0,
  senales_value_bet:       0,
  senales_protected:       0,
  senales_watchlist:       0,
  senales_no_bet:          0,
  recomendaciones_finales: 0,  // VALUE_BET + PROTECTED_ONLY
};

for (let i = 0; i < matchIds.length; i++) {
  const matchId  = matchIds[i];
  const gateInfo = gateByMatch[matchId];
  const snap     = snaps[i];

  statsGlobales.partidos_procesados++;

  // ── Sin predicción en Firestore ───────────────────────────────────────────
  if (!snap.exists) {
    statsGlobales.partidos_sin_prediccion++;
    resultados.push({
      matchId,
      partido:          gateInfo.partido,
      risk_class:       gateInfo.risk_class,
      motivos_gate:     gateInfo.motivos,
      accion:           gateInfo.accion,
      max_abs_diff:     gateInfo.max_abs_diff,
      prediction_status: PREDICTION_STATUS.TECHNICAL_ERROR,
      risk_level:       RISK_LEVEL.EXTREME,
      model_warnings:   [],
      estado:           'SIN_PREDICCION',
      prediccion_modelo: null,
      senales_disponibles: 0,
      senales:          [],
      recomendaciones_finales: 0,
    });
    continue;
  }

  const pred       = snap.data();
  const senalesRaw = pred.señales_valor ?? pred.senales_valor ?? [];

  if (senalesRaw.length === 0) {
    statsGlobales.partidos_sin_senales++;
  }

  // ── Determinar override de gate ───────────────────────────────────────────
  const override = GATE_OVERRIDE[gateInfo.risk_class] ?? null;

  // ── Clasificar señales ────────────────────────────────────────────────────
  const clasificado = clasificarSenales({
    prediccion: pred,
    senales:    senalesRaw,
    contexto:   { tipo: 'individual' },
  });

  // Agregar model_warning del gate al resultado
  if (override && !clasificado.model_warnings.includes(override.warning)) {
    clasificado.model_warnings.push(override.warning);
  }

  // ── Aplicar downgrade por clase B ─────────────────────────────────────────
  let senalesFinales = clasificado.senales;
  if (gateInfo.risk_class === 'B_SOLO_PROTEGIDOS') {
    senalesFinales = aplicarDowngradeB(senalesFinales);
  }

  // ── Aplicar downgrade por clase C o D ─────────────────────────────────────
  if (override) {
    senalesFinales = senalesFinales.map(s => {
      if (s.betting_status === BETTING_STATUS.VALUE_BET) {
        return {
          ...s,
          betting_status: override.downgrade,
          razon_gate: `Gate ${gateInfo.risk_class} — ${gateInfo.motivos.join(', ')}: ${override.label}`,
        };
      }
      return s;
    });
  }

  // ── Reconteo por betting_status ───────────────────────────────────────────
  const value_bet  = senalesFinales.filter(s => s.betting_status === BETTING_STATUS.VALUE_BET);
  const protected_ = senalesFinales.filter(s => s.betting_status === BETTING_STATUS.PROTECTED_ONLY);
  const watchlist  = senalesFinales.filter(s => s.betting_status === BETTING_STATUS.WATCHLIST);
  const no_bet     = senalesFinales.filter(s => s.betting_status === BETTING_STATUS.NO_BET || s.betting_status === BETTING_STATUS.TECHNICAL_ERROR);
  const recomFin   = value_bet.length + protected_.length;

  statsGlobales.senales_total           += senalesFinales.length;
  statsGlobales.senales_value_bet       += value_bet.length;
  statsGlobales.senales_protected       += protected_.length;
  statsGlobales.senales_watchlist       += watchlist.length;
  statsGlobales.senales_no_bet          += no_bet.length;
  statsGlobales.recomendaciones_finales += recomFin;

  // ── Capturar campos del modelo (siempre presentes) ────────────────────────
  const prediccionModelo = {
    lambda_local:        pred.lambda_local,
    lambda_visitante:    pred.lambda_visitante,
    prob_1x2:            pred.prob_1x2,
    prob_over_under:     pred.prob_over_under ?? null,
    prob_btts:           pred.prob_btts ?? null,
    marcador_mas_probable: pred.marcador_mas_probable ?? null,
  };

  const estado =
    clasificado.prediction_status === PREDICTION_STATUS.TECHNICAL_ERROR ? 'ERROR_TECNICO_MODELO'
    : senalesRaw.length === 0                                            ? 'SIN_SENALES_VALOR'
    : recomFin > 0                                                       ? 'CON_RECOMENDACIONES'
    :                                                                      'SIN_RECOMENDACIONES';

  resultados.push({
    matchId,
    partido:          gateInfo.partido,
    risk_class:       gateInfo.risk_class,
    motivos_gate:     gateInfo.motivos,
    accion:           gateInfo.accion,
    max_abs_diff:     gateInfo.max_abs_diff,
    prediction_status: clasificado.prediction_status,
    risk_level:       clasificado.risk_level,
    model_warnings:   clasificado.model_warnings,
    estado,
    prediccion_modelo: prediccionModelo,
    senales_disponibles: senalesRaw.length,
    senales:          senalesFinales,
    value_bet:        value_bet.map(s => pick(s)),
    protected_only:   protected_.map(s => pick(s)),
    watchlist:        watchlist.map(s => pick(s)),
    no_bet:           no_bet.map(s => pick(s)),
    recomendaciones_finales: recomFin,
    razon_no_apuesta: recomFin === 0 ? (clasificado.razon_no_apuesta ?? 'Sin señal apostable.') : null,
  });
}

function pick(s) {
  return {
    mercado:        s.mercado,
    seleccion:      s.seleccion,
    equipo:         s.equipo        ?? null,
    linea:          s.linea         ?? null,
    prob_modelo:    s.prob_modelo,
    bookmaker_odds: s.bookmaker_odds,
    expected_value: s.expected_value,
    edge:           s.edge          ?? null,
    nivel_valor:    s.nivel_valor   ?? null,
    betting_status: s.betting_status,
    regla:          s.regla         ?? null,
    fragilidad:     s.fragilidad    ?? null,
    razon:          s.razon         ?? null,
    sugerencia:     s.sugerencia    ?? null,
    razon_gate:     s.razon_gate    ?? null,
    razon_gate_b:   s.razon_gate_b  ?? null,
  };
}

// ── Imprimir resumen en consola ───────────────────────────────────────────────

const clsIcon = {
  A_USABLE: '✓A', B_SOLO_PROTEGIDOS: '~B',
  C_BLOQUEAR_APUESTAS: '!C', D_RECALCULAR_PREDICCION: '✗D',
};

for (const r of resultados) {
  const cls  = clsIcon[r.risk_class] ?? '?';
  const warn = r.model_warnings.length > 0 ? ` [${r.model_warnings.join(',')}]` : '';
  console.log(`  [${cls}] ${r.matchId}  ${r.partido}${warn}`);

  if (r.estado === 'SIN_PREDICCION') {
    console.log('       Sin predicción en Firestore');
    continue;
  }

  const pm = r.prediccion_modelo;
  if (pm?.lambda_local != null) {
    console.log(`       λ: ${pm.lambda_local.toFixed(2)}/${pm.lambda_visitante.toFixed(2)}  ` +
      `1X2: ${(pm.prob_1x2?.local * 100).toFixed(0)}%/${(pm.prob_1x2?.empate * 100).toFixed(0)}%/${(pm.prob_1x2?.visitante * 100).toFixed(0)}%  ` +
      `risk: ${r.risk_level}  pred: ${r.prediction_status}`);
  }

  if (r.estado === 'SIN_SENALES_VALOR') {
    console.log('       señales_valor: [] (pipeline de odds pendiente)');
    continue;
  }

  const resumen = [
    r.value_bet.length > 0    ? `VALUE_BET:${r.value_bet.length}`    : null,
    r.protected_only.length > 0 ? `PROTECTED:${r.protected_only.length}` : null,
    r.watchlist.length > 0    ? `WATCHLIST:${r.watchlist.length}`    : null,
    r.no_bet.length > 0       ? `NO_BET:${r.no_bet.length}`          : null,
  ].filter(Boolean).join('  ');
  console.log(`       ${resumen || 'ninguna señal'}`);

  for (const s of [...r.value_bet, ...r.protected_only]) {
    const gate = s.razon_gate ? ' [gate]' : '';
    console.log(`         ★ [${s.betting_status}] ${s.mercado}/${s.seleccion}  EV=${((s.expected_value ?? 0) * 100).toFixed(1)}%  odds=${s.bookmaker_odds}${gate}`);
  }
  for (const s of r.watchlist) {
    console.log(`         ◎ [WATCHLIST] ${s.mercado}/${s.seleccion}  EV=${((s.expected_value ?? 0) * 100).toFixed(1)}%  ${s.razon?.slice(0, 60) ?? ''}`);
  }
  if (r.razon_no_apuesta) {
    console.log(`         — ${r.razon_no_apuesta.slice(0, 90)}`);
  }
}

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN GLOBAL');
console.log('─'.repeat(76));
console.log(`  Partidos procesados      : ${statsGlobales.partidos_procesados}`);
console.log(`  Sin predicción Firestore : ${statsGlobales.partidos_sin_prediccion}`);
console.log(`  Sin señales_valor        : ${statsGlobales.partidos_sin_senales}`);
console.log(`  Señales totales          : ${statsGlobales.senales_total}`);
console.log(`    VALUE_BET              : ${statsGlobales.senales_value_bet}`);
console.log(`    PROTECTED_ONLY         : ${statsGlobales.senales_protected}`);
console.log(`    WATCHLIST              : ${statsGlobales.senales_watchlist}`);
console.log(`    NO_BET                 : ${statsGlobales.senales_no_bet}`);
console.log(`  Recomendaciones finales  : ${statsGlobales.recomendaciones_finales}  (VALUE_BET + PROTECTED_ONLY)`);
console.log('─'.repeat(76));

if (statsGlobales.recomendaciones_finales === 0 && statsGlobales.partidos_sin_senales > 0) {
  console.log('\n  CAUSA: señales_valor vacío — pipeline de odds no ejecutado para J2.');
  console.log('  ACCIÓN: guardarOddsPorMatchIds.js --write → actualizarSenalesConOdds.js');
}
console.log('═'.repeat(76));

// ── Generar JSON ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const jsonOut = {
  generado_en:       new Date().toISOString(),
  modo:              DRY_RUN ? 'dry-run' : 'execute',
  firestore_escrito: false,
  gate_config:       GATE_PATH.replace(/\\/g, '/').replace(/.*config\//, 'config/'),
  estadisticas:      statsGlobales,
  distribucion_gate: gate.resumen,
  partidos:          resultados,
};

writeFileSync(JSON_OUT, JSON.stringify(jsonOut, null, 2), 'utf-8');
console.log(`\n  JSON: reports/recomendaciones_j2_con_risk_gate_dryrun.json`);

// ── Generar Markdown ──────────────────────────────────────────────────────────

const hoy = new Date().toISOString().slice(0, 10);
const md  = [];

md.push(`# Recomendaciones J2 con Risk Gate — ${hoy} (DRY-RUN)`);
md.push('');
md.push('> **Regla principal:** Solo `TECHNICAL_ERROR` puede bloquear una predicción.');
md.push('> El gate C/D degrada señales a `PROTECTED_ONLY`/`WATCHLIST` — nunca elimina la predicción.');
md.push('');
md.push('---');
md.push('');
md.push('## Taxonomía de betting_status');
md.push('');
md.push('| Status | Significado |');
md.push('|---|---|');
md.push('| `VALUE_BET` | EV positivo, riesgo bajo/medio |');
md.push('| `PROTECTED_ONLY` | Señal válida pero requiere mercado protegido (AH+, DC, under) |');
md.push('| `WATCHLIST` | Hay señal pero falta confirmación (gate D, EV especulativo, BTTS combinada) |');
md.push('| `NO_BET` | EV negativo o edge insuficiente |');
md.push('| `TECHNICAL_ERROR` | NaN, odds inválidas, lambdas inválidas |');
md.push('');
md.push('## Resumen ejecutivo');
md.push('');
md.push('| Estadística | Valor |');
md.push('|---|---|');
md.push(`| Partidos procesados | ${statsGlobales.partidos_procesados} |`);
md.push(`| Sin predicción | ${statsGlobales.partidos_sin_prediccion} |`);
md.push(`| Sin señales_valor (pipeline pendiente) | ${statsGlobales.partidos_sin_senales} |`);
md.push(`| VALUE_BET | ${statsGlobales.senales_value_bet} |`);
md.push(`| PROTECTED_ONLY | ${statsGlobales.senales_protected} |`);
md.push(`| WATCHLIST | ${statsGlobales.senales_watchlist} |`);
md.push(`| NO_BET | ${statsGlobales.senales_no_bet} |`);
md.push(`| **Recomendaciones finales** | **${statsGlobales.recomendaciones_finales}** |`);
md.push('');
md.push('## Tabla de partidos');
md.push('');
md.push('| Gate | matchId | Partido | λ local | λ visita | Risk | VALUE_BET | PROTECTED | WATCHLIST |');
md.push('|---|---|---|---|---|---|---|---|---|');

for (const r of resultados) {
  const pm   = r.prediccion_modelo;
  const lL   = pm?.lambda_local    != null ? pm.lambda_local.toFixed(2)    : '—';
  const lV   = pm?.lambda_visitante != null ? pm.lambda_visitante.toFixed(2) : '—';
  const risk = r.risk_level ?? '—';
  const cls  = { A_USABLE: '✓A', B_SOLO_PROTEGIDOS: '~B', C_BLOQUEAR_APUESTAS: '!C', D_RECALCULAR_PREDICCION: '✗D' }[r.risk_class] ?? r.risk_class;
  md.push(`| **${cls}** | ${r.matchId} | ${r.partido} | ${lL} | ${lV} | ${risk} | ${r.value_bet?.length ?? 0} | ${r.protected_only?.length ?? 0} | ${r.watchlist?.length ?? 0} |`);
}

md.push('');
md.push('---');
md.push('');
md.push('## Detalle por partido');
md.push('');

for (const r of resultados) {
  const clsLabel = {
    A_USABLE:            '✓ A — USABLE',
    B_SOLO_PROTEGIDOS:   '~ B — SOLO PROTEGIDOS',
    C_BLOQUEAR_APUESTAS: '! C — FAVORITO SUBESTIMADO',
    D_RECALCULAR_PREDICCION: '✗ D — MODELO INVERTIDO',
  }[r.risk_class] ?? r.risk_class;

  md.push(`### ${r.partido} \`${r.matchId}\`  →  ${clsLabel}`);
  md.push('');

  const pm = r.prediccion_modelo;
  if (pm?.lambda_local != null) {
    md.push(`**Predicción modelo:**`);
    md.push(`- λ: \`${pm.lambda_local.toFixed(2)} / ${pm.lambda_visitante.toFixed(2)}\``);
    md.push(`- 1X2: \`${(pm.prob_1x2?.local * 100).toFixed(1)}% / ${(pm.prob_1x2?.empate * 100).toFixed(1)}% / ${(pm.prob_1x2?.visitante * 100).toFixed(1)}%\``);
    if (pm.marcador_mas_probable) md.push(`- Marcador más probable: \`${pm.marcador_mas_probable}\``);
    md.push('');
  }

  md.push(`**prediction_status:** \`${r.prediction_status}\` | **risk_level:** \`${r.risk_level}\` | **model_warnings:** ${r.model_warnings.length > 0 ? r.model_warnings.join(', ') : 'ninguno'}`);
  md.push('');

  if (r.estado === 'SIN_PREDICCION') {
    md.push('> Sin predicción en Firestore. Verificar matchId.');
  } else if (r.estado === 'SIN_SENALES_VALOR') {
    md.push('> `señales_valor: []` — Pipeline de odds no ejecutado para J2.');
    md.push('> Para activar: `guardarOddsPorMatchIds.js --write` → `actualizarSenalesConOdds.js`');
  } else if (r.recomendaciones_finales > 0) {
    if (r.value_bet.length > 0) {
      md.push('**VALUE_BET:**');
      md.push('');
      md.push('| Mercado | Selección | P_modelo | Odds | EV |');
      md.push('|---|---|---|---|---|');
      for (const s of r.value_bet) {
        md.push(`| ${s.mercado} | ${s.seleccion} | ${((s.prob_modelo ?? 0)*100).toFixed(1)}% | ${s.bookmaker_odds} | ${((s.expected_value ?? 0)*100).toFixed(1)}% |`);
      }
      md.push('');
    }
    if (r.protected_only.length > 0) {
      md.push('**PROTECTED_ONLY:**');
      md.push('');
      md.push('| Mercado | Selección | P_modelo | Odds | EV | Razón |');
      md.push('|---|---|---|---|---|---|');
      for (const s of r.protected_only) {
        const razon = (s.razon_gate ?? s.razon_gate_b ?? s.razon ?? '').slice(0, 60);
        md.push(`| ${s.mercado} | ${s.seleccion} | ${((s.prob_modelo ?? 0)*100).toFixed(1)}% | ${s.bookmaker_odds} | ${((s.expected_value ?? 0)*100).toFixed(1)}% | ${razon} |`);
      }
      md.push('');
    }
    if (r.watchlist.length > 0) {
      md.push('**WATCHLIST:**');
      md.push('');
      md.push('| Mercado | Selección | EV | Razón |');
      md.push('|---|---|---|---|');
      for (const s of r.watchlist) {
        const razon = (s.razon_gate ?? s.razon ?? '').slice(0, 80);
        md.push(`| ${s.mercado} | ${s.seleccion} | ${((s.expected_value ?? 0)*100).toFixed(1)}% | ${razon} |`);
      }
      md.push('');
    }
  } else if (r.razon_no_apuesta) {
    md.push(`> Sin recomendaciones apostables: ${r.razon_no_apuesta}`);
    if (r.watchlist.length > 0) {
      md.push('');
      md.push(`> WATCHLIST (${r.watchlist.length} señal(es) para monitorear):`);
      for (const s of r.watchlist) {
        md.push(`> - \`${s.mercado}/${s.seleccion}\` EV=${((s.expected_value ?? 0)*100).toFixed(1)}% — ${s.razon?.slice(0, 60) ?? ''}`);
      }
    }
  } else {
    md.push(`> Estado: \`${r.estado}\``);
  }

  md.push('');
}

md.push('---');
md.push('');
md.push('## Acciones pendientes para activar señales J2');
md.push('');
md.push('1. `guardarOddsPorMatchIds.js --write` con los 24 matchIds J2');
md.push('2. `actualizarSenalesConOdds.js` → crea `señales_valor` en Firestore');
md.push('3. Re-ejecutar este script → producirá clasificaciones reales');
md.push('4. Para escribir a Firestore: añadir flag `--execute`');

writeFileSync(MD_OUT, md.join('\n'), 'utf-8');
console.log(`  MD:   reports/recomendaciones_j2_con_risk_gate_dryrun.md\n`);

process.exit(0);

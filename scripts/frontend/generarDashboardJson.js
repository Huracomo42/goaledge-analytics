/**
 * generarDashboardJson.js — Output oficial para el dashboard MVP de GoalEdge Analytics.
 *
 * Lee predicciones J2 de Firestore, aplica el pipeline post-J1 completo
 * (gate → clasificarSenales → downgrade B → ajuste conservador C1/C2/C3)
 * y exporta JSON limpios para consumo de Lovable.
 *
 * Política:
 *   - Todos los partidos aparecen aunque no haya apuesta.
 *   - Las señales siempre se clasifican (VALUE_BET / PROTECTED_ONLY / WATCHLIST / NO_BET).
 *   - WATCHLIST y NO_BET se muestran explícitamente con razon_no_apuesta.
 *   - TECHNICAL_ERROR solo por error real del modelo.
 *   - Sin combinadas. Sin apuestas especulativas. Sin textos "apuesta segura".
 *
 * Outputs:
 *   data/frontend/recomendaciones_dashboard.json   ← por partido
 *   data/frontend/metadata_dashboard.json          ← resumen global + política
 *
 * Uso:
 *   node scripts/frontend/generarDashboardJson.js
 *
 * No modifica Firestore. Zero escrituras.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname }  from 'path';
import { fileURLToPath }     from 'url';
import { getFirestore }      from 'firebase-admin/firestore';

import '../../src/firebase/init.js';
import {
  clasificarSenales,
  clasificarTipo,
  TIPO_SENAL,
  BETTING_STATUS,
  PREDICTION_STATUS,
  MODEL_WARNING,
  RISK_LEVEL,
  POLICY_VERSION,
  OFFICIAL_PIPELINE,
  DEPRECATED_SCRIPTS,
  COMBINADAS_POLICY,
} from '../../src/core/betting/recommendationPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const db       = getFirestore();
const OUT_DIR  = resolve(__dirname, '../../data/frontend');
const GATE_PATH = resolve(__dirname, '../../config/j2_risk_gate.json');

// ── Gate config ───────────────────────────────────────────────────────────────

const gate        = JSON.parse(readFileSync(GATE_PATH, 'utf-8'));
const gateByMatch = Object.fromEntries(gate.matches.map(m => [String(m.matchId), m]));
const JORNADA     = 2;

// ── Pipeline helpers (misma lógica que generarRecomendacionesJ2FinalConservador) ──

function extraerLinea(seleccion) {
  const m = /(\d+\.?\d*)/.exec(String(seleccion ?? ''));
  return m ? parseFloat(m[1]) : null;
}

function aplicarDowngradeB(senales) {
  return senales.map(s => {
    if (s.betting_status !== BETTING_STATUS.VALUE_BET) return s;
    const tipo     = clasificarTipo(s);
    const mercado  = (s.mercado   ?? '').toLowerCase();
    const seleccion = (s.seleccion ?? '').toLowerCase();
    if (tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE ||
        tipo === TIPO_SENAL.H2H_EMPATE ||
        tipo === TIPO_SENAL.BTTS_SI || tipo === TIPO_SENAL.BTTS_NO) {
      return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_downgrade: `${tipo.toUpperCase()} — risk B` };
    }
    if (tipo === TIPO_SENAL.OVER) {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea > 2.5) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_downgrade: `OVER_AGRESIVO (linea=${linea}) — risk B` };
      }
    }
    if (mercado.includes('handicap') || mercado === 'spreads' || mercado === 'ah') {
      const linea = s.linea ?? extraerLinea(seleccion);
      if (linea !== null && linea < -1.0) {
        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_downgrade: `HANDICAP_AGRESIVO (linea=${linea}) — risk B` };
      }
    }
    return s;
  });
}

function aplicarAjusteConservador(senales, riskClass, hayLambdaExtrema) {
  return senales.map(s => {
    const tipo = clasificarTipo(s);
    const ev   = s.expected_value ?? 0;
    const sel  = (s.seleccion ?? '').toLowerCase();
    const esH2HGanador = tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE;
    const esTotals     = tipo === TIPO_SENAL.OVER || tipo === TIPO_SENAL.UNDER;

    // C1 — empate VALUE_BET → NO_BET
    if (tipo === TIPO_SENAL.H2H_EMPATE && s.betting_status === BETTING_STATUS.VALUE_BET) {
      return { ...s, betting_status: BETTING_STATUS.NO_BET, motivo_conservador: 'C1_MERCADO_EMPATE_FRAGIL' };
    }
    // C2 — H2H ganador VALUE_BET frágil → PROTECTED_ONLY
    if (esH2HGanador && s.betting_status === BETTING_STATUS.VALUE_BET) {
      if (ev < 0.05)        return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'C2_H2H_EV_BAJO' };
      if (hayLambdaExtrema) return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'C2_H2H_LAMBDA_EXTREMA' };
      if (riskClass !== 'A_USABLE') return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: `C2_H2H_RISK_${riskClass.split('_')[0]}` };
    }
    // C3 — Totals VALUE_BET con EV bajo → WATCHLIST
    if (esTotals && s.betting_status === BETTING_STATUS.VALUE_BET) {
      const linea     = s.linea ?? extraerLinea(sel);
      const esExcepcion =
        (tipo === TIPO_SENAL.UNDER && linea !== null && linea >= 3.5) ||
        (tipo === TIPO_SENAL.OVER  && linea !== null && linea <= 0.5);
      if (!esExcepcion) {
        if (ev < 0.03)        return { ...s, betting_status: BETTING_STATUS.WATCHLIST,    motivo_conservador: 'C3_TOTALS_EV_BAJO' };
        if (hayLambdaExtrema) return { ...s, betting_status: BETTING_STATUS.PROTECTED_ONLY, motivo_conservador: 'C3_TOTALS_LAMBDA_EXTREMA' };
      }
    }
    return s;
  });
}

function clasificarFinal(senal, riskClass, hayLambdaExtrema) {
  const ev     = senal.expected_value ?? 0;
  const bs     = senal.betting_status;
  const sinLam = !hayLambdaExtrema;
  if (bs === BETTING_STATUS.VALUE_BET) {
    if (riskClass === 'A_USABLE' && sinLam && ev >= 0.10 && senal.fragilidad !== 'alta') return 'FUERTE';
    if (riskClass === 'A_USABLE' && sinLam && ev >= 0.03)  return 'MODERADA';
    if (riskClass === 'B_SOLO_PROTEGIDOS' && sinLam && ev >= 0.03) return 'MODERADA_B';
    return 'OBSERVACION';
  }
  if (bs === BETTING_STATUS.PROTECTED_ONLY && ev >= 0.03) return 'OBSERVACION';
  return 'REFERENCIA';
}

// Prioridad de betting_status a nivel de partido
const STATUS_PRIORIDAD = {
  [BETTING_STATUS.VALUE_BET]:     4,
  [BETTING_STATUS.PROTECTED_ONLY]: 3,
  [BETTING_STATUS.WATCHLIST]:      2,
  [BETTING_STATUS.NO_BET]:         1,
};

function derivarBettingStatusPartido(senalesAjustadas) {
  let mejor = BETTING_STATUS.NO_BET;
  for (const s of senalesAjustadas) {
    if ((STATUS_PRIORIDAD[s.betting_status] ?? 0) > (STATUS_PRIORIDAD[mejor] ?? 0)) {
      mejor = s.betting_status;
    }
  }
  return mejor;
}

function construirRecomendacionApuesta(senalesAjustadas, riskClass, hayLambdaExtrema) {
  const apostables = senalesAjustadas
    .filter(s => s.betting_status === BETTING_STATUS.VALUE_BET)
    .sort((a, b) => (b.expected_value ?? 0) - (a.expected_value ?? 0));

  if (apostables.length === 0) return null;

  const top = apostables[0];
  const cl  = clasificarFinal(top, riskClass, hayLambdaExtrema);
  const ev  = top.expected_value != null ? `${(top.expected_value * 100).toFixed(1)}%` : '—';
  return {
    mercado:         top.mercado,
    seleccion:       top.seleccion,
    prob_modelo:     top.prob_modelo,
    bookmaker_odds:  top.bookmaker_odds,
    expected_value:  top.expected_value,
    clasificacion:   cl,
    descripcion:     `${top.mercado}/${top.seleccion} — odds ${top.bookmaker_odds?.toFixed(2) ?? '?'}, EV ${ev}, ${cl}`,
  };
}

function construirRazonNoApuesta(clasificado, gateInfo, senalesAjustadas) {
  const razones = [];

  if (clasificado.razon_no_apuesta) razones.push(clasificado.razon_no_apuesta);

  const gateClass = gateInfo?.risk_class;
  if (gateClass === 'C_BLOQUEAR_APUESTAS') {
    razones.push(`Gate C — ${(gateInfo.motivos ?? []).join(', ')}: modelo subestima favorito, señales de valor bloqueadas.`);
  }
  if (gateClass === 'D_RECALCULAR_PREDICCION') {
    razones.push(`Gate D — ${(gateInfo.motivos ?? []).join(', ')}: modelo invertido respecto al mercado, pendiente recálculo.`);
  }

  const hayValueBet = senalesAjustadas.some(s => s.betting_status === BETTING_STATUS.VALUE_BET);
  if (!hayValueBet && senalesAjustadas.length > 0 && razones.length === 0) {
    const motivos = [...new Set(senalesAjustadas
      .filter(s => s.motivo_conservador)
      .map(s => s.motivo_conservador))];
    if (motivos.length > 0) {
      razones.push(`Ajuste conservador C1/C2/C3 degradó todas las señales: ${motivos.join('; ')}`);
    }
  }

  return razones.length > 0 ? razones.join(' | ') : null;
}

// ── Preparar señal para output frontend ───────────────────────────────────────

function formatearSenal(s, riskClass, hayLambdaExtrema) {
  return {
    mercado:            s.mercado,
    seleccion:          s.seleccion,
    equipo:             s.equipo             ?? null,
    linea:              s.linea              ?? null,
    prob_modelo:        s.prob_modelo        ?? null,
    bookmaker_odds:     s.bookmaker_odds     ?? null,
    expected_value:     s.expected_value     ?? null,
    edge:               s.edge               ?? null,
    betting_status:     s.betting_status,
    clasificacion:      clasificarFinal(s, riskClass, hayLambdaExtrema),
    fragilidad:         s.fragilidad         ?? null,
    regla:              s.regla              ?? null,
    motivo_conservador: s.motivo_conservador ?? null,
    motivo_downgrade:   s.motivo_downgrade   ?? null,
    razon_gate:         s.razon_gate         ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  generarDashboardJson — GoalEdge Analytics MVP Frontend');
console.log('  Pipeline: gate → clasificarSenales → downgrade B → C1/C2/C3');
console.log(`  Policy:   ${POLICY_VERSION}`);
console.log('═'.repeat(76));

const matchIds = gate.matches.map(m => String(m.matchId));
console.log(`\n  Cargando ${matchIds.length} predicciones J2 desde Firestore...`);

const snaps = await Promise.all(
  matchIds.map(id => db.collection('predicciones').doc(id).get())
);

const conteos = {
  VALUE_BET:       0,
  PROTECTED_ONLY:  0,
  WATCHLIST:       0,
  NO_BET:          0,
  TECHNICAL_ERROR: 0,
};

const partidos = [];

for (let i = 0; i < matchIds.length; i++) {
  const matchId  = matchIds[i];
  const gateInfo = gateByMatch[matchId];
  const snap     = snaps[i];

  // ── Base del partido (siempre presente) ──────────────────────────────────
  const [homeFromGate, awayFromGate] = (gateInfo.partido ?? '').split(' vs ');

  const partidoOut = {
    matchId,
    home_team:             homeFromGate?.trim() ?? null,
    away_team:             awayFromGate?.trim() ?? null,
    fecha:                 null,
    kickoff:               null,
    jornada:               JORNADA,
    grupo:                 null,
    risk_class:            gateInfo.risk_class,
    gate_motivos:          gateInfo.motivos ?? [],
    prediction_status:     null,
    betting_status:        null,
    risk_level:            null,
    model_warnings:        [],
    lambda_local:          null,
    lambda_visitante:      null,
    prob_1x2:              null,
    prob_over_under:       null,
    prob_btts:             null,
    marcador_mas_probable: null,
    recomendacion_apuesta: null,
    razon_no_apuesta:      null,
    senales_value_bet:     [],
    senales_protected:     [],
    senales_watchlist:     [],
    senales_no_bet:        [],
    policy_version:        POLICY_VERSION,
    generated_at:          new Date().toISOString(),
  };

  // ── Sin predicción en Firestore ───────────────────────────────────────────
  if (!snap.exists) {
    partidoOut.prediction_status = PREDICTION_STATUS.TECHNICAL_ERROR;
    partidoOut.betting_status    = BETTING_STATUS.NO_BET;
    partidoOut.razon_no_apuesta  = 'Predicción no encontrada en Firestore.';
    conteos.TECHNICAL_ERROR++;
    partidos.push(partidoOut);
    console.log(`  ✗ ${matchId}  ${gateInfo.partido}  → SIN_PREDICCION`);
    continue;
  }

  const pred = snap.data();

  // Enriquecer con campos del documento
  partidoOut.home_team             = pred.nombreLocal     ?? homeFromGate?.trim() ?? null;
  partidoOut.away_team             = pred.nombreVisitante ?? awayFromGate?.trim() ?? null;
  partidoOut.fecha                 = pred.fechaPartido    ?? null;
  partidoOut.kickoff               = pred.kickoff         ?? pred.utcDate        ?? null;
  partidoOut.jornada               = pred.jornadaGrupo    ?? JORNADA;
  partidoOut.grupo                 = pred.grupo           ?? null;
  partidoOut.lambda_local          = pred.lambda_local    ?? null;
  partidoOut.lambda_visitante      = pred.lambda_visitante ?? null;
  partidoOut.prob_1x2              = pred.prob_1x2        ?? null;
  partidoOut.prob_over_under       = pred.prob_over_under ?? null;
  partidoOut.prob_btts             = pred.prob_btts       ?? null;
  partidoOut.marcador_mas_probable = pred.marcador_mas_probable ?? null;

  const senalesRaw = pred.señales_valor ?? pred.senales_valor ?? [];

  // ── Sin señales (odds no capturadas) ─────────────────────────────────────
  if (senalesRaw.length === 0) {
    partidoOut.prediction_status = PREDICTION_STATUS.DATA_INCOMPLETE;
    partidoOut.betting_status    = BETTING_STATUS.NO_BET;
    partidoOut.risk_level        = RISK_LEVEL.LOW;
    partidoOut.razon_no_apuesta  = 'Odds no disponibles para este partido. El modelo tiene predicción pero sin señales de valor evaluadas.';
    conteos.NO_BET++;
    partidos.push(partidoOut);
    console.log(`  ○ ${matchId}  ${gateInfo.partido}  → DATA_INCOMPLETE (sin odds)`);
    continue;
  }

  // ── Capa 1: clasificarSenales ─────────────────────────────────────────────
  const clasificado = clasificarSenales({
    prediccion: pred,
    senales:    senalesRaw,
    contexto:   { tipo: 'individual' },
  });

  if (clasificado.prediction_status === PREDICTION_STATUS.TECHNICAL_ERROR) {
    partidoOut.prediction_status = PREDICTION_STATUS.TECHNICAL_ERROR;
    partidoOut.betting_status    = BETTING_STATUS.NO_BET;
    partidoOut.risk_level        = RISK_LEVEL.EXTREME;
    partidoOut.razon_no_apuesta  = clasificado.razon_no_apuesta ?? 'Error técnico en clasificación de señales.';
    conteos.TECHNICAL_ERROR++;
    partidos.push(partidoOut);
    console.log(`  ✗ ${matchId}  ${gateInfo.partido}  → TECHNICAL_ERROR`);
    continue;
  }

  const hayLambdaExtrema = clasificado.model_warnings.includes(MODEL_WARNING.LAMBDA_EXTREMA);

  // ── Capa 2: downgrade B ───────────────────────────────────────────────────
  let senales = clasificado.senales;
  if (gateInfo.risk_class === 'B_SOLO_PROTEGIDOS') {
    senales = aplicarDowngradeB(senales);
  }

  // ── Gate C/D: downgrade VALUE_BET por riesgo sistémico ───────────────────
  const gateOverride = {
    C_BLOQUEAR_APUESTAS:    { target: BETTING_STATUS.PROTECTED_ONLY, warning: MODEL_WARNING.FAVORITO_SUBESTIMADO },
    D_RECALCULAR_PREDICCION:{ target: BETTING_STATUS.WATCHLIST,      warning: MODEL_WARNING.MODELO_INVERTIDO    },
  }[gateInfo.risk_class];

  let modelWarnings = [...clasificado.model_warnings];

  if (gateOverride) {
    senales = senales.map(s =>
      s.betting_status === BETTING_STATUS.VALUE_BET
        ? { ...s, betting_status: gateOverride.target, razon_gate: `Gate ${gateInfo.risk_class.split('_')[0]} — ${gateInfo.motivos.join(', ')}` }
        : s
    );
    if (!modelWarnings.includes(gateOverride.warning)) {
      modelWarnings.push(gateOverride.warning);
    }
  }

  // ── Capa 3: ajuste conservador C1/C2/C3 ──────────────────────────────────
  const senalesAjustadas = aplicarAjusteConservador(senales, gateInfo.risk_class, hayLambdaExtrema);

  // ── Derivar campos a nivel de partido ────────────────────────────────────
  const bettingStatusPartido = derivarBettingStatusPartido(senalesAjustadas);
  const recomendacion        = construirRecomendacionApuesta(senalesAjustadas, gateInfo.risk_class, hayLambdaExtrema);
  const razonNoApuesta       = bettingStatusPartido !== BETTING_STATUS.VALUE_BET
    ? construirRazonNoApuesta(clasificado, gateInfo, senalesAjustadas)
    : null;

  // ── Separar señales por categoría ────────────────────────────────────────
  const senalesVB    = senalesAjustadas.filter(s => s.betting_status === BETTING_STATUS.VALUE_BET);
  const senalesPO    = senalesAjustadas.filter(s => s.betting_status === BETTING_STATUS.PROTECTED_ONLY);
  const senalesWL    = senalesAjustadas.filter(s => s.betting_status === BETTING_STATUS.WATCHLIST);
  const senalesNB    = senalesAjustadas.filter(s => s.betting_status === BETTING_STATUS.NO_BET);

  partidoOut.prediction_status    = clasificado.prediction_status;
  partidoOut.betting_status       = bettingStatusPartido;
  partidoOut.risk_level           = clasificado.risk_level;
  partidoOut.model_warnings       = modelWarnings;
  partidoOut.recomendacion_apuesta = recomendacion;
  partidoOut.razon_no_apuesta     = razonNoApuesta;
  partidoOut.senales_value_bet    = senalesVB.map(s => formatearSenal(s, gateInfo.risk_class, hayLambdaExtrema));
  partidoOut.senales_protected    = senalesPO.map(s => formatearSenal(s, gateInfo.risk_class, hayLambdaExtrema));
  partidoOut.senales_watchlist    = senalesWL.map(s => formatearSenal(s, gateInfo.risk_class, hayLambdaExtrema));
  partidoOut.senales_no_bet       = senalesNB.map(s => formatearSenal(s, gateInfo.risk_class, hayLambdaExtrema));

  conteos[bettingStatusPartido]   = (conteos[bettingStatusPartido] ?? 0) + 1;

  // ── Log por partido ───────────────────────────────────────────────────────
  const icon = { VALUE_BET: '★', PROTECTED_ONLY: '○', WATCHLIST: '~', NO_BET: '—' }[bettingStatusPartido] ?? '?';
  const wStr = modelWarnings.length > 0 ? `  [${modelWarnings.join(',')}]` : '';
  console.log(`  ${icon} ${matchId}  ${gateInfo.partido.padEnd(34)}  ${bettingStatusPartido}  (VB:${senalesVB.length} PO:${senalesPO.length} WL:${senalesWL.length} NB:${senalesNB.length})${wStr}`);

  partidos.push(partidoOut);
}

// ── Construir policy metadata ─────────────────────────────────────────────────

const combinadasPolicyOutput = {
  conservadoras_default:  false,
  moderadas_default:      false,
  especulativas_default:  false,
  reason:                 'J1 audit: conservadoras 18.2% hit rate, -49.9% ROI; moderadas 13.2%; especulativas 5.4%',
  flags_requeridos: {
    conservadoras:  '--include-conservadoras',
    moderadas:      '--include-moderadas',
    especulativas:  '--include-especulativas',
  },
};

// ── Elegir ejemplos para el log ───────────────────────────────────────────────

const ejemploVB  = partidos.find(p => p.betting_status === BETTING_STATUS.VALUE_BET);
const ejemploNBWL = partidos.find(p =>
  p.betting_status === BETTING_STATUS.NO_BET ||
  p.betting_status === BETTING_STATUS.WATCHLIST
);

// ── Escribir recomendaciones_dashboard.json ───────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const dashboardOutput = {
  generated_at:    new Date().toISOString(),
  policy_version:  POLICY_VERSION,
  jornada:         JORNADA,
  total_partidos:  partidos.length,
  conteos_betting_status: conteos,
  combinadas_policy: combinadasPolicyOutput,
  partidos,
};

const DASH_PATH = resolve(OUT_DIR, 'recomendaciones_dashboard.json');
writeFileSync(DASH_PATH, JSON.stringify(dashboardOutput, null, 2), 'utf-8');

// ── Escribir metadata_dashboard.json ─────────────────────────────────────────

const metadataOutput = {
  generated_at:            new Date().toISOString(),
  policy_version:          POLICY_VERSION,
  official_pipeline:       OFFICIAL_PIPELINE,
  deprecated_scripts:      DEPRECATED_SCRIPTS.map(d => ({ script: d.script, razon: d.razon })),
  jornada:                 JORNADA,
  total_partidos:          partidos.length,
  conteo_VALUE_BET:        conteos.VALUE_BET,
  conteo_PROTECTED_ONLY:   conteos.PROTECTED_ONLY,
  conteo_WATCHLIST:        conteos.WATCHLIST,
  conteo_NO_BET:           conteos.NO_BET,
  conteo_TECHNICAL_ERROR:  conteos.TECHNICAL_ERROR,
  combinadas_policy:       combinadasPolicyOutput,
};

const META_PATH = resolve(OUT_DIR, 'metadata_dashboard.json');
writeFileSync(META_PATH, JSON.stringify(metadataOutput, null, 2), 'utf-8');

// ── Resumen final ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  OUTPUT GENERADO');
console.log('─'.repeat(76));
console.log(`  Dashboard JSON  : ${DASH_PATH}`);
console.log(`  Metadata JSON   : ${META_PATH}`);
console.log(`  Partidos        : ${partidos.length}`);
console.log('─'.repeat(76));
console.log('  Conteos por betting_status:');
console.log(`    ★  VALUE_BET       : ${conteos.VALUE_BET}`);
console.log(`    ○  PROTECTED_ONLY  : ${conteos.PROTECTED_ONLY}`);
console.log(`    ~  WATCHLIST       : ${conteos.WATCHLIST}`);
console.log(`    —  NO_BET          : ${conteos.NO_BET}`);
console.log(`    ✗  TECHNICAL_ERROR : ${conteos.TECHNICAL_ERROR}`);

if (ejemploVB) {
  const top = ejemploVB.recomendacion_apuesta;
  console.log('\n─'.padEnd(77, '─'));
  console.log('  EJEMPLO VALUE_BET:');
  console.log(`    ${ejemploVB.matchId}  ${ejemploVB.home_team} vs ${ejemploVB.away_team}`);
  console.log(`    fecha: ${ejemploVB.fecha ?? '—'}  risk_class: ${ejemploVB.risk_class}`);
  if (top) {
    console.log(`    recomendacion: ${top.descripcion}`);
  }
  console.log(`    model_warnings: ${ejemploVB.model_warnings.length > 0 ? ejemploVB.model_warnings.join(', ') : 'ninguno'}`);
}

if (ejemploNBWL) {
  console.log('\n─'.padEnd(77, '─'));
  const label = ejemploNBWL.betting_status === BETTING_STATUS.NO_BET ? 'EJEMPLO NO_BET' : 'EJEMPLO WATCHLIST';
  console.log(`  ${label}:`);
  console.log(`    ${ejemploNBWL.matchId}  ${ejemploNBWL.home_team} vs ${ejemploNBWL.away_team}`);
  console.log(`    fecha: ${ejemploNBWL.fecha ?? '—'}  risk_class: ${ejemploNBWL.risk_class}`);
  console.log(`    razon_no_apuesta: ${ejemploNBWL.razon_no_apuesta ?? '—'}`);
  console.log(`    model_warnings: ${ejemploNBWL.model_warnings.length > 0 ? ejemploNBWL.model_warnings.join(', ') : 'ninguno'}`);
}

console.log('\n' + '═'.repeat(76));

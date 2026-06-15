/**
 * probarBuildCalibrationDataset.js — Prueba de buildCalibrationDataset.js
 *
 * 100% sin Firestore ni APIs: todo con objetos artificiales.
 * Ejecutar: node scripts/probarBuildCalibrationDataset.js
 */

import {
  construirObservacionCalibrable,
  construirDatasetCalibrable,
} from '../src/core/calibration/buildCalibrationDataset.js';

// ── Utilidades de test ────────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function check(descripcion, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`
  );
  if (!ok) errores++;
}

function titulo(texto) {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${texto}`);
  console.log('═'.repeat(62));
}

function subtitulo(texto) {
  console.log(`\n  ── ${texto}`);
}

// ── Fixtures artificiales ─────────────────────────────────────────────────────

// Predicción V2 válida — estructura exacta de Firestore
const PRED_V2 = {
  id:             '537353',
  matchId:        537353,
  nombreLocal:    'Germany',
  nombreVisitante: 'Ivory Coast',
  fechaPartido:   '2026-06-20',
  version_modelo: '2.0',
  lambda_local:   2.10,
  lambda_visitante: 0.92,
  prob_1x2: {
    local:     0.62,
    empate:    0.23,
    visitante: 0.15,
  },
  prob_over_under: {
    '1.5': { over: 0.78, under: 0.22 },
    '2.5': { over: 0.55, under: 0.45 },
    '3.5': { over: 0.31, under: 0.69 },
    '4.5': { over: 0.15, under: 0.85 },
  },
  prob_btts: { si: 0.42, no: 0.58 },
  marcador_mas_probable: { local: 2, visitante: 0, prob: 0.18 },  // campo "prob" (no "probabilidad")
  generado_en:            '2026-06-14T07:16:00.000Z',
  fuentes_p_disponibles:  false,
  analisis_psicologico_ref: null,
};

// Resultado real: Germany 2 - 1 Ivory Coast
const RESULTADO_2_1 = {
  id:               '537353',
  matchId:          '537353',
  goles_local:      2,
  goles_visitante:  1,
  xg_local_real:    1.85,
  xg_visitante_real: 0.72,
  fuente:           'fotmob',
  terminado:        true,
  resultado_1x2:    'local',
  total_goles:      3,
  over_under_result: {
    '1.5': 'over',
    '2.5': 'over',
    '3.5': 'under',
    '4.5': 'under',
  },
  btts_result: true,
};

// Resultado 0-0 empate (BTTS false)
const RESULTADO_0_0 = {
  ...RESULTADO_2_1,
  goles_local:     0,
  goles_visitante: 0,
  xg_local_real:   null,
  xg_visitante_real: null,
  resultado_1x2:   'empate',
  total_goles:     0,
  over_under_result: {
    '1.5': 'under',
    '2.5': 'under',
    '3.5': 'under',
    '4.5': 'under',
  },
  btts_result: false,
};

// Odds snapshot (opcional)
const ODDS_SNAP = {
  snapshotId: '537353_20260620120000',
  matchId:    537353,
  tipo_snapshot: 'cierre',
  fuente_api: 'the-odds-api',
  region: 'eu',
  mercados: {
    h2h: {
      n_bookmakers:    12,
      odds_local:      1.60,
      odds_empate:     4.00,
      odds_visitante:  5.00,
      overround_pct:   0.053,
    },
    totals: {
      linea:      2.5,
      odds_over:  1.95,
      odds_under: 1.95,
      overround_pct: 0.026,
    },
  },
};

// ── [1] Caso principal: predicción V2 + resultado + sin odds ─────────────────

titulo('1. Caso principal: V2 + resultado + sin odds');

const r1 = construirObservacionCalibrable({ prediccion: PRED_V2, resultado: RESULTADO_2_1 });

check('ok = true',                                    r1.ok, true);

if (r1.ok) {
  const obs = r1.observacion;

  subtitulo('Identificación y metadata');
  check('matchId = "537353"',                          obs.matchId,        '537353');
  check('version_modelo = "2.0"',                     obs.version_modelo, '2.0');

  subtitulo('Lambdas extraídas');
  check('lambda_local = 2.10',                         obs.lambda_local,    2.10);
  check('lambda_visitante = 0.92',                     obs.lambda_visitante, 0.92);

  subtitulo('Marcador predicho — campo "prob" (hallazgo Paso 2)');
  check('marcador_predicho_local = 2',                 obs.marcador_predicho_local,     2);
  check('marcador_predicho_visitante = 0',             obs.marcador_predicho_visitante, 0);
  check('prob_marcador_predicho = 0.18',               obs.prob_marcador_predicho,      0.18);

  subtitulo('Variables observadas y_1x2');
  check('y_1x2.local = 1   (ocurrió victoria local)',  obs.y_1x2.local,     1);
  check('y_1x2.empate = 0',                            obs.y_1x2.empate,    0);
  check('y_1x2.visitante = 0',                         obs.y_1x2.visitante, 0);

  subtitulo('Variables observadas y_over_under');
  check('y_over_under["1.5"] = 1  (3 > 1.5 → over)',  obs.y_over_under['1.5'], 1);
  check('y_over_under["2.5"] = 1  (3 > 2.5 → over)',  obs.y_over_under['2.5'], 1);
  check('y_over_under["3.5"] = 0  (3 ≤ 3.5 → under)', obs.y_over_under['3.5'], 0);
  check('y_over_under["4.5"] = 0  (3 ≤ 4.5 → under)', obs.y_over_under['4.5'], 0);

  subtitulo('Variables observadas y_btts');
  check('y_btts.si = 1  (ambos marcaron)',             obs.y_btts.si, 1);
  check('y_btts.no = 0',                               obs.y_btts.no, 0);

  subtitulo('Resultado real');
  check('goles_local = 2',                             obs.goles_local,       2);
  check('goles_visitante = 1',                         obs.goles_visitante,   1);
  check('total_goles = 3',                             obs.total_goles,       3);
  check('xg_local_real = 1.85',                        obs.xg_local_real,     1.85);
  check('xg_visitante_real = 0.72',                    obs.xg_visitante_real, 0.72);

  subtitulo('Odds (sin snapshot)');
  check('tiene_odds = false',                          obs.tiene_odds,       false);
  check('odds_snapshot_id = null',                     obs.odds_snapshot_id, null);
  check('odds = null',                                 obs.odds,             null);

  subtitulo('Probabilidades del modelo pasadas tal cual');
  check('p_1x2.local = 0.62',                         obs.p_1x2.local,     0.62);
  check('p_1x2.empate = 0.23',                        obs.p_1x2.empate,    0.23);
  check('p_1x2.visitante = 0.15',                     obs.p_1x2.visitante, 0.15);
  check('p_over_under["2.5"].over = 0.55',             obs.p_over_under['2.5'].over, 0.55);
  check('p_btts.si = 0.42',                            obs.p_btts.si, 0.42);
}

// ── [2] Con odds snapshot ─────────────────────────────────────────────────────

titulo('2. Con odds snapshot');

const r2 = construirObservacionCalibrable({
  prediccion:   PRED_V2,
  resultado:    RESULTADO_2_1,
  oddsSnapshot: ODDS_SNAP,
});

check('ok = true',                                       r2.ok, true);
if (r2.ok) {
  check('tiene_odds = true',                             r2.observacion.tiene_odds,       true);
  check('odds_snapshot_id = "537353_20260620120000"',    r2.observacion.odds_snapshot_id, '537353_20260620120000');
  check('odds.h2h.odds_local = 1.60',                    r2.observacion.odds?.h2h?.odds_local, 1.60);
  check('odds.totals.linea = 2.5',                       r2.observacion.odds?.totals?.linea,   2.5);
}

// ── [3] Resultado 0-0: empate, sin BTTS ──────────────────────────────────────

titulo('3. Resultado 0-0 (empate, sin BTTS, todos unders)');

const r3 = construirObservacionCalibrable({ prediccion: PRED_V2, resultado: RESULTADO_0_0 });

check('ok = true',                                       r3.ok, true);
if (r3.ok) {
  check('y_1x2.local = 0',                              r3.observacion.y_1x2.local,     0);
  check('y_1x2.empate = 1',                             r3.observacion.y_1x2.empate,    1);
  check('y_1x2.visitante = 0',                          r3.observacion.y_1x2.visitante, 0);
  check('y_btts.si = 0  (ninguno marcó)',                r3.observacion.y_btts.si, 0);
  check('y_btts.no = 1',                                r3.observacion.y_btts.no, 1);
  check('y_over_under["1.5"] = 0  (0 ≤ 1.5)',           r3.observacion.y_over_under['1.5'], 0);
  check('total_goles = 0',                              r3.observacion.total_goles, 0);
  check('xg_local_real = null',                         r3.observacion.xg_local_real, null);
}

// ── [4] Casos inválidos: descartados ─────────────────────────────────────────

titulo('4. Casos inválidos — deben devolver ok=false');

subtitulo('Falta resultado');
const r_sinRes = construirObservacionCalibrable({ prediccion: PRED_V2, resultado: null });
check('ok = false',                                     r_sinRes.ok,    false);
check('razon = "falta_resultado"',                      r_sinRes.razon, 'falta_resultado');

subtitulo('Falta predicción');
const r_sinPred = construirObservacionCalibrable({ prediccion: null, resultado: RESULTADO_2_1 });
check('ok = false',                                     r_sinPred.ok,    false);
check('razon = "falta_prediccion"',                     r_sinPred.razon, 'falta_prediccion');

subtitulo('Predicción V1 (version_modelo: "1.0")');
const PRED_V1 = { ...PRED_V2, version_modelo: '1.0', apuestas: { win: 50 } };
const r_v1 = construirObservacionCalibrable({ prediccion: PRED_V1, resultado: RESULTADO_2_1 });
check('ok = false',                                     r_v1.ok,    false);
check('razon = "prediccion_no_v2_o_incompleta"',        r_v1.razon, 'prediccion_no_v2_o_incompleta');

subtitulo('Predicción V1 por campos delator (sin version_modelo)');
const PRED_V1_CAMPO = { ...PRED_V2, version_modelo: '2.0', score_local: 75, score_visitante: 40 };
const r_v1c = construirObservacionCalibrable({ prediccion: PRED_V1_CAMPO, resultado: RESULTADO_2_1 });
check('ok = false',                                     r_v1c.ok,    false);
check('razon = "prediccion_no_v2_o_incompleta"',        r_v1c.razon, 'prediccion_no_v2_o_incompleta');

subtitulo('Predicción V2 con campo mínimo faltante (lambda_local)');
const PRED_INCOMPLETA = { ...PRED_V2, lambda_local: undefined };
const r_inc = construirObservacionCalibrable({ prediccion: PRED_INCOMPLETA, resultado: RESULTADO_2_1 });
check('ok = false',                                     r_inc.ok,    false);
check('razon = "prediccion_no_v2_o_incompleta"',        r_inc.razon, 'prediccion_no_v2_o_incompleta');
check('campos_faltantes incluye lambda_local',          r_inc.campos_faltantes?.includes('lambda_local'), true);

subtitulo('Predicción V2 con lambda NaN');
const PRED_NAN = { ...PRED_V2, lambda_local: NaN };
const r_nan = construirObservacionCalibrable({ prediccion: PRED_NAN, resultado: RESULTADO_2_1 });
check('ok = false  (NaN rechazado en lambda)',           r_nan.ok,    false);

subtitulo('Predicción V2 con marcador_mas_probable usando "probabilidad" (fallback)');
const PRED_PROB_ALT = {
  ...PRED_V2,
  marcador_mas_probable: { local: 1, visitante: 0, probabilidad: 0.25 },  // campo alternativo
};
const r_alt = construirObservacionCalibrable({ prediccion: PRED_PROB_ALT, resultado: RESULTADO_2_1 });
check('ok = true',                                      r_alt.ok, true);
if (r_alt.ok) {
  check('prob_marcador_predicho = 0.25 (fallback a .probabilidad)', r_alt.observacion.prob_marcador_predicho, 0.25);
}

// ── [5] Warning de suma de probs ─────────────────────────────────────────────

titulo('5. Warning si prob_1x2 no suma ≈ 1');

const PRED_SUMA_MAL = {
  ...PRED_V2,
  prob_1x2: { local: 0.50, empate: 0.20, visitante: 0.10 }, // suma = 0.80
};
const r_sum = construirObservacionCalibrable({ prediccion: PRED_SUMA_MAL, resultado: RESULTADO_2_1 });
check('ok = true (warning, no descarte)',                r_sum.ok, true);
if (r_sum.ok) {
  check('warnings.length = 1',                          r_sum.observacion.warnings.length, 1);
  console.log(`${OK}  warning: "${r_sum.observacion.warnings[0]}"`);
}

// ── [6] construirDatasetCalibrable ───────────────────────────────────────────

titulo('6. construirDatasetCalibrable — lote de predicciones');

const PREDICCIONES = [
  PRED_V2,
  { ...PRED_V2, id: '537354', matchId: 537354, nombreLocal: 'Ecuador', nombreVisitante: 'Curaçao' },
  { ...PRED_V2, version_modelo: '1.0', id: '537355', matchId: 537355 },                    // V1 → descartado
  { ...PRED_V2, id: 'TEST_CALIBRATION_RESULT', matchId: 'TEST_CALIBRATION_RESULT' },        // TEST_ → ignorado
];

const RESULTADOS = [
  RESULTADO_2_1,                                                           // matchId 537353
  { ...RESULTADO_0_0, id: '537354', matchId: '537354' },                  // matchId 537354
  // matchId 537355 no tiene resultado (ya es V1, pero igual faltaría)
];

const dataset = construirDatasetCalibrable({
  predicciones: PREDICCIONES,
  resultados:   RESULTADOS,
});

subtitulo('Conteos del dataset');
check('total = 4 (incluyendo TEST_)',                    dataset.total,         4);
check('n_ok = 2',                                       dataset.n_ok,          2);
check('n_descartados = 1  (V1; TEST_ ignorado)',        dataset.n_descartados, 1);
check('n_con_odds = 0',                                 dataset.n_con_odds,    0);
check('n_con_warnings = 0',                             dataset.n_con_warnings, 0);

subtitulo('TEST_* ignorados');
const testEnDataset = dataset.observaciones.some(o => o.matchId.startsWith('TEST_'));
check('ningún TEST_ en observaciones',                  testEnDataset, false);
const testEnDescartados = dataset.descartados.some(d => d.matchId.startsWith('TEST_'));
check('ningún TEST_ en descartados',                    testEnDescartados, false);

subtitulo('Descartado es el V1');
check('descartado[0].razon = "prediccion_no_v2_o_incompleta"',
  dataset.descartados[0]?.razon, 'prediccion_no_v2_o_incompleta');

subtitulo('Predicción sin resultado → descarte "falta_resultado"');
const PRED_SIN_RES = [
  { ...PRED_V2, id: '999', matchId: 999 },
];
const datasetSinRes = construirDatasetCalibrable({ predicciones: PRED_SIN_RES, resultados: [] });
check('n_ok = 0',                                       datasetSinRes.n_ok,          0);
check('n_descartados = 1',                              datasetSinRes.n_descartados, 1);
check('razon = "falta_resultado"',                      datasetSinRes.descartados[0]?.razon, 'falta_resultado');

// ── [7] Estructura completa de una observación ───────────────────────────────

titulo('7. Estructura completa de una observación calibrable');

if (r1.ok) {
  const obs = r1.observacion;
  const campos = Object.keys(obs).sort();
  console.log('\n  Campos en observacion:', campos.join(', '));
  console.log('\n  JSON completo:');
  console.log(JSON.stringify(obs, null, 4));
}

// ── Resumen ──────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(62)}`);
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('  Sin Firestore. Sin APIs. 0 escrituras.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(62) + '\n');

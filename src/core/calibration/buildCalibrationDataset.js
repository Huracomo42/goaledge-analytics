/**
 * buildCalibrationDataset.js — Construcción de dataset calibrable.
 *
 * Une predicción V2 + resultado real + odds snapshot opcional en objetos
 * calibrables listos para métricas (Fase 3.2).
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 * Acepta los objetos tal como los devuelven leerPrediccion / leerResultado.
 *
 * REGLA IMPORTANTE (aprendida en Paso 2):
 *   marcador_mas_probable usa campo "prob", no "probabilidad".
 *   La conversión de btts_result (boolean) → 0/1 numérico ocurre aquí,
 *   NO dentro de calibrationMath.js.
 */

// ── Constantes de validación ─────────────────────────────────────────────────

// Campos cuya presencia delata un documento V1
const V1_CAMPOS_DELATOR = [
  'apuestas', 'scores', 'pesos_usados',
  'scoreStat', 'scorePsico', 'boost',
  'score_local', 'score_visitante', 'analisis_ia_cache',
];

// Líneas de Over/Under que replica el modelo
const LINEAS_OU = ['1.5', '2.5', '3.5', '4.5'];

// Tolerancia para verificar que prob_1x2 suma ≈ 1
const SUMA_PROB_TOLERANCIA = 0.01;

// ── Validación de predicción ──────────────────────────────────────────────────

function esV2Limpia(pred) {
  if (!pred) return { ok: false, razon: 'prediccion_ausente' };

  if (pred.version_modelo === '1.0' || V1_CAMPOS_DELATOR.some(c => pred[c] !== undefined)) {
    return { ok: false, razon: 'prediccion_no_v2_o_incompleta' };
  }

  if (pred.version_modelo !== '2.0') {
    return { ok: false, razon: 'prediccion_no_v2_o_incompleta' };
  }

  const camposFaltantes = [];
  if (typeof pred.lambda_local     !== 'number' || !isFinite(pred.lambda_local)     || pred.lambda_local     < 0) camposFaltantes.push('lambda_local');
  if (typeof pred.lambda_visitante !== 'number' || !isFinite(pred.lambda_visitante) || pred.lambda_visitante < 0) camposFaltantes.push('lambda_visitante');
  if (pred.prob_1x2?.local     == null) camposFaltantes.push('prob_1x2.local');
  if (pred.prob_1x2?.empate    == null) camposFaltantes.push('prob_1x2.empate');
  if (pred.prob_1x2?.visitante == null) camposFaltantes.push('prob_1x2.visitante');
  if (pred.prob_over_under       == null) camposFaltantes.push('prob_over_under');
  if (pred.prob_btts             == null) camposFaltantes.push('prob_btts');
  if (pred.marcador_mas_probable == null) camposFaltantes.push('marcador_mas_probable');

  if (camposFaltantes.length > 0) {
    return { ok: false, razon: 'prediccion_no_v2_o_incompleta', campos_faltantes: camposFaltantes };
  }

  return { ok: true };
}

// ── Conversión de resultado a variables observadas ────────────────────────────

function construirVariablesObservadas(resultado) {
  const r1x2  = resultado.resultado_1x2;
  const btts   = resultado.btts_result;
  const ouMap  = resultado.over_under_result ?? {};

  // y_1x2: indicadores binarios 0/1 para cada resultado
  const y_1x2 = {
    local:     r1x2 === 'local'     ? 1 : 0,
    empate:    r1x2 === 'empate'    ? 1 : 0,
    visitante: r1x2 === 'visitante' ? 1 : 0,
  };

  // y_over_under: 'over' → 1, 'under' → 0
  const y_over_under = {};
  for (const linea of LINEAS_OU) {
    y_over_under[linea] = ouMap[linea] === 'over' ? 1 : 0;
  }

  // y_btts: true → { si:1, no:0 } | false → { si:0, no:1 }
  const y_btts = {
    si: btts === true ? 1 : 0,
    no: btts === true ? 0 : 1,
  };

  return { y_1x2, y_over_under, y_btts };
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Construye una observación calibrable a partir de predicción + resultado + odds (opcional).
 *
 * @param {{
 *   prediccion:    object|null,  — doc de predicciones/ (de leerPrediccion)
 *   resultado:     object|null,  — doc de resultados/ (de leerResultado)
 *   oddsSnapshot?: object|null,  — doc de odds_snapshots/ (de leerOddsSnapshot), opcional
 * }} params
 * @returns {{ ok: true, observacion: object } | { ok: false, razon: string, matchId: string|null }}
 */
export function construirObservacionCalibrable({ prediccion, resultado, oddsSnapshot = null }) {
  const matchId = String(prediccion?.matchId ?? prediccion?.id ?? resultado?.matchId ?? resultado?.id ?? null);

  // — Validar predicción —
  if (!prediccion) {
    return { ok: false, razon: 'falta_prediccion', matchId };
  }

  const validacion = esV2Limpia(prediccion);
  if (!validacion.ok) {
    return { ok: false, razon: validacion.razon, matchId, campos_faltantes: validacion.campos_faltantes ?? [] };
  }

  // — Validar resultado —
  if (!resultado) {
    return { ok: false, razon: 'falta_resultado', matchId };
  }

  // — Extraer probabilidades del modelo —
  const p_1x2        = prediccion.prob_1x2;
  const p_over_under = prediccion.prob_over_under;
  const p_btts       = prediccion.prob_btts;

  // — Extraer lambdas —
  const lambda_local     = prediccion.lambda_local;
  const lambda_visitante = prediccion.lambda_visitante;

  // — Extraer marcador predicho —
  const mmp                   = prediccion.marcador_mas_probable ?? {};
  const marcador_predicho_local     = mmp.local     ?? null;
  const marcador_predicho_visitante = mmp.visitante ?? null;
  // "prob" es el campo real (hallado en Paso 2); "probabilidad" es fallback defensivo
  const prob_marcador_predicho      = mmp.prob ?? mmp.probabilidad ?? null;

  // — Variables observadas (booleanos → 0/1, rule: conversión en dataset builder) —
  const { y_1x2, y_over_under, y_btts } = construirVariablesObservadas(resultado);

  // — Resultado real —
  const goles_local       = resultado.goles_local;
  const goles_visitante   = resultado.goles_visitante;
  const total_goles       = resultado.total_goles;
  const xg_local_real     = resultado.xg_local_real     ?? null;
  const xg_visitante_real = resultado.xg_visitante_real ?? null;

  // — Odds metadata —
  const tiene_odds      = oddsSnapshot != null;
  const odds_snapshot_id = oddsSnapshot?.snapshotId ?? null;
  const odds            = tiene_odds ? {
    h2h:    oddsSnapshot.mercados?.h2h    ?? null,
    totals: oddsSnapshot.mercados?.totals ?? null,
  } : null;

  // — Metadata —
  const generado_en = prediccion.generado_en?.toDate?.()?.toISOString()
    ?? prediccion.generado_en
    ?? null;

  // — Warnings —
  const warnings = [];
  const sumaProb1x2 = (p_1x2.local ?? 0) + (p_1x2.empate ?? 0) + (p_1x2.visitante ?? 0);
  if (Math.abs(sumaProb1x2 - 1) > SUMA_PROB_TOLERANCIA) {
    warnings.push(`prob_1x2 suma ${sumaProb1x2.toFixed(6)}, esperado ≈1.0`);
  }

  const observacion = {
    // Identificación
    matchId,
    version_modelo:  prediccion.version_modelo,
    generado_en,

    // Lambdas del modelo
    lambda_local,
    lambda_visitante,

    // Probabilidades del modelo
    p_1x2,
    p_over_under,
    p_btts,

    // Marcador predicho
    marcador_predicho_local,
    marcador_predicho_visitante,
    prob_marcador_predicho,

    // Variables observadas (0/1 numérico)
    y_1x2,
    y_over_under,
    y_btts,

    // Resultado real
    goles_local,
    goles_visitante,
    total_goles,
    xg_local_real,
    xg_visitante_real,

    // Odds
    tiene_odds,
    odds_snapshot_id,
    odds,

    // Diagnóstico
    warnings,
  };

  return { ok: true, observacion };
}

/**
 * Construye el dataset calibrable completo a partir de colecciones.
 *
 * @param {{
 *   predicciones:  object[],          — array de docs de predicciones/ (con campo id)
 *   resultados:    object[],          — array de docs de resultados/ (con campo id)
 *   oddsSnapshots?: Record<string, object>,  — mapa { [snapshotId]: doc } (por defecto vacío)
 * }} params
 * @returns {{
 *   observaciones: object[],   — observaciones con ok=true
 *   descartados:   object[],   — razones de descarte
 *   total:         number,
 *   n_ok:          number,
 *   n_descartados: number,
 *   n_con_odds:    number,
 *   n_con_warnings: number,
 * }}
 */
export function construirDatasetCalibrable({ predicciones, resultados, oddsSnapshots = {} }) {
  // Construir índice de resultados por matchId (string)
  const resultadosPorId = {};
  for (const r of resultados) {
    const key = String(r.matchId ?? r.id);
    resultadosPorId[key] = r;
  }

  const observaciones = [];
  const descartados   = [];

  for (const pred of predicciones) {
    const mId = String(pred.matchId ?? pred.id ?? '');

    // Guard: ignorar TEST_*
    if (mId.startsWith('TEST_')) continue;

    const resultado = resultadosPorId[mId] ?? null;

    // Buscar odds snapshot si la predicción tiene el ID referenciado
    const snapshotId  = pred.ultimo_odds_snapshot_id ?? pred.odds_snapshot_id ?? null;
    const oddsSnapshot = snapshotId ? (oddsSnapshots[snapshotId] ?? null) : null;

    const resultado_obs = construirObservacionCalibrable({ prediccion: pred, resultado, oddsSnapshot });

    if (resultado_obs.ok) {
      observaciones.push(resultado_obs.observacion);
    } else {
      descartados.push({ matchId: mId, razon: resultado_obs.razon, campos_faltantes: resultado_obs.campos_faltantes ?? [] });
    }
  }

  return {
    observaciones,
    descartados,
    total:           predicciones.length,
    n_ok:            observaciones.length,
    n_descartados:   descartados.length,
    n_con_odds:      observaciones.filter(o => o.tiene_odds).length,
    n_con_warnings:  observaciones.filter(o => o.warnings.length > 0).length,
  };
}

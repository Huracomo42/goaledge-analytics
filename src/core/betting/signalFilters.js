/**
 * signalFilters.js — Clasificador de señales de apuesta.
 *
 * Módulo puro. Sin efectos secundarios.
 * Reglas derivadas de auditoría J1 V2.1 (2026-06-18).
 *
 * Función principal:
 *   clasificarSenales({ prediccion, senales, contexto })
 *
 * Taxonomía de salida:
 *   prediction_status : OK | DATA_INCOMPLETE | TECHNICAL_ERROR
 *   betting_status    : VALUE_BET | PROTECTED_ONLY | WATCHLIST | NO_BET | TECHNICAL_ERROR
 *   risk_level        : LOW | MEDIUM | HIGH | EXTREME
 *   model_warnings    : MODEL_WARNING[]
 *
 * Regla principal: solo TECHNICAL_ERROR puede bloquear una predicción.
 * Incertidumbre y riesgo son advertencias/clasificaciones, no bloqueos.
 *
 * Reglas J2:
 *   R1 — EV ≥ 0.50 → WATCHLIST + MERCADO_CONTRADICE_MODELO
 *   R2 — H2H ganador prob < 0.60 → PROTECTED_ONLY; prob < 0.50 → NO_BET
 *   R3 — H2H ganador p_empate ≥ 0.22 → PROTECTED_ONLY + PARTIDO_CERRADO
 *   R4 — BTTS_NO λ_underdog ∈ [0.45, 0.90] → NO_BET
 *   R5 — BTTS en combinadas → WATCHLIST
 *   R6 — H2H ganador prob < 0.70 → VALUE_BET con fragilidad='alta'
 *   R7 — H2H no-VALUE → sugerencia OU si disponible
 *   R8 — λ extrema + señal agresiva → PROTECTED_ONLY + LAMBDA_EXTREMA
 *   TE — datos corruptos (NaN/null/fuera rango) → TECHNICAL_ERROR
 */

// ── Taxonomía ─────────────────────────────────────────────────────────────────

export const PREDICTION_STATUS = Object.freeze({
  OK:              'OK',
  DATA_INCOMPLETE: 'DATA_INCOMPLETE',
  TECHNICAL_ERROR: 'TECHNICAL_ERROR',
});

export const BETTING_STATUS = Object.freeze({
  VALUE_BET:       'VALUE_BET',
  PROTECTED_ONLY:  'PROTECTED_ONLY',
  WATCHLIST:       'WATCHLIST',
  NO_BET:          'NO_BET',
  TECHNICAL_ERROR: 'TECHNICAL_ERROR',
});

export const RISK_LEVEL = Object.freeze({
  LOW:     'LOW',
  MEDIUM:  'MEDIUM',
  HIGH:    'HIGH',
  EXTREME: 'EXTREME',
});

export const MODEL_WARNING = Object.freeze({
  FAVORITO_SUBESTIMADO:      'FAVORITO_SUBESTIMADO',
  MODELO_INVERTIDO:           'MODELO_INVERTIDO',
  PARTIDO_CERRADO:            'PARTIDO_CERRADO',
  MERCADO_CONTRADICE_MODELO:  'MERCADO_CONTRADICE_MODELO',
  BAJA_MUESTRA:               'BAJA_MUESTRA',
  PSICO_NO_DISPONIBLE:        'PSICO_NO_DISPONIBLE',
  ODDS_NO_DISPONIBLES:        'ODDS_NO_DISPONIBLES',
  LAMBDA_EXTREMA:             'LAMBDA_EXTREMA',
});

// ── Tipos de señal (invariante) ───────────────────────────────────────────────

export const TIPO_SENAL = Object.freeze({
  H2H_LOCAL:     'h2h_local',
  H2H_EMPATE:    'h2h_empate',
  H2H_VISITANTE: 'h2h_visitante',
  OVER:          'over',
  UNDER:         'under',
  BTTS_SI:       'btts_si',
  BTTS_NO:       'btts_no',
  DESCONOCIDO:   'desconocido',
});

// ── Legacy — mantenidos para imports existentes en scripts ────────────────────

export const ETIQUETA = Object.freeze({
  EV_EXTREMO:            'EV_EXTREMO_NO_CONFIABLE',
  FAVORITO_INSUFICIENTE: 'FAVORITO_INSUFICIENTE',
  MASA_EMPATE:           'MASA_EMPATE_ALTA',
  RIESGO_UNDERDOG:       'RIESGO_GOL_UNDERDOG',
  BTTS_COMBINADA:        'BTTS_BLOQUEADO_EN_COMBINADA',
  LAMBDA_EXTREMA:        'LAMBDA_EXTREMA_REVISAR_DATOS',
});

export const FRAGILIDAD = Object.freeze({
  NINGUNA: 'ninguna',
  BAJA:    'baja',
  MEDIA:   'media',
  ALTA:    'alta',
  CRITICA: 'critica',
});

// ── Umbrales ──────────────────────────────────────────────────────────────────

export const UMBRALES = Object.freeze({
  EV_ESPECULATIVO:      0.50,
  P_FAVORITO_MIN:       0.60,
  P_FAVORITO_NO_BET:    0.50,
  P_EMPATE_MAX:         0.22,
  LAMBDA_UNDERDOG_MIN:  0.45,
  LAMBDA_UNDERDOG_MAX:  0.90,
  P_FRAGIL_H2H:         0.70,
  LAMBDA_EXTREMA_MAX:   3.00,
  LAMBDA_EXTREMA_MIN:   0.30,
  LAMBDA_BTTS_RIESGO:   0.60,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

export function clasificarTipo(señal) {
  const mercado   = (señal.mercado   ?? '').toLowerCase();
  const seleccion = (señal.seleccion ?? '').toLowerCase();

  if (mercado === 'h2h') {
    if (seleccion === 'local')     return TIPO_SENAL.H2H_LOCAL;
    if (seleccion === 'empate')    return TIPO_SENAL.H2H_EMPATE;
    if (seleccion === 'visitante') return TIPO_SENAL.H2H_VISITANTE;
  }
  if (mercado === 'totals') {
    if (seleccion.startsWith('over'))  return TIPO_SENAL.OVER;
    if (seleccion.startsWith('under')) return TIPO_SENAL.UNDER;
  }
  if (mercado === 'btts') {
    if (seleccion === 'si'  || seleccion === 'true')  return TIPO_SENAL.BTTS_SI;
    if (seleccion === 'no'  || seleccion === 'false') return TIPO_SENAL.BTTS_NO;
  }
  return TIPO_SENAL.DESCONOCIDO;
}

function detectarLambdaExtrema(lambdaL, lambdaV) {
  const problemas = [];
  if (lambdaL > UMBRALES.LAMBDA_EXTREMA_MAX)
    problemas.push(`lambda_local=${lambdaL.toFixed(2)} > ${UMBRALES.LAMBDA_EXTREMA_MAX}`);
  if (lambdaV > UMBRALES.LAMBDA_EXTREMA_MAX)
    problemas.push(`lambda_visitante=${lambdaV.toFixed(2)} > ${UMBRALES.LAMBDA_EXTREMA_MAX}`);
  if (lambdaL < UMBRALES.LAMBDA_EXTREMA_MIN)
    problemas.push(`lambda_local=${lambdaL.toFixed(2)} < ${UMBRALES.LAMBDA_EXTREMA_MIN}`);
  if (lambdaV < UMBRALES.LAMBDA_EXTREMA_MIN)
    problemas.push(`lambda_visitante=${lambdaV.toFixed(2)} < ${UMBRALES.LAMBDA_EXTREMA_MIN}`);
  return problemas;
}

function calcularRiskLevel(modelWarnings, hayLambdaExtrema) {
  if (modelWarnings.includes(MODEL_WARNING.MODELO_INVERTIDO))       return RISK_LEVEL.EXTREME;
  if (hayLambdaExtrema ||
      modelWarnings.includes(MODEL_WARNING.FAVORITO_SUBESTIMADO))   return RISK_LEVEL.HIGH;
  if (modelWarnings.includes(MODEL_WARNING.PARTIDO_CERRADO) ||
      modelWarnings.includes(MODEL_WARNING.MERCADO_CONTRADICE_MODELO)) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

// ── Clasificador de señal individual ─────────────────────────────────────────

/**
 * Clasifica una señal individual en BETTING_STATUS.
 * Nunca bloquea la predicción — solo clasifica la señal.
 *
 * @returns {{ betting_status, regla, etiqueta, razon, sugerencia, fragilidad, model_warnings }}
 */
function clasificarSenal(señal, tipo, prediccion, ctx, hayLambdaExtrema) {
  const lambdaL        = prediccion.lambda_local;
  const lambdaV        = prediccion.lambda_visitante;
  const pEmpate        = prediccion.prob_1x2.empate;
  const lambdaUnderdog = Math.min(lambdaL, lambdaV);
  const esH2HGanador   = tipo === TIPO_SENAL.H2H_LOCAL || tipo === TIPO_SENAL.H2H_VISITANTE;
  const esBtts         = tipo === TIPO_SENAL.BTTS_SI || tipo === TIPO_SENAL.BTTS_NO;

  // TE — Error técnico en datos propios de la señal
  if (señal.prob_modelo == null || isNaN(señal.prob_modelo) ||
      señal.prob_modelo < 0 || señal.prob_modelo > 1) {
    return {
      betting_status: BETTING_STATUS.TECHNICAL_ERROR,
      regla: 'TE', etiqueta: 'PROB_MODELO_INVALIDA',
      razon: `prob_modelo inválida: ${señal.prob_modelo}`,
      sugerencia: null, fragilidad: null, model_warnings: [],
    };
  }
  if (!señal.bookmaker_odds || señal.bookmaker_odds <= 1 || isNaN(señal.bookmaker_odds)) {
    return {
      betting_status: BETTING_STATUS.TECHNICAL_ERROR,
      regla: 'TE', etiqueta: 'ODDS_INVALIDAS',
      razon: `bookmaker_odds inválida: ${señal.bookmaker_odds}`,
      sugerencia: null, fragilidad: null, model_warnings: [],
    };
  }
  if (señal.expected_value == null || isNaN(señal.expected_value)) {
    return {
      betting_status: BETTING_STATUS.TECHNICAL_ERROR,
      regla: 'TE', etiqueta: 'EV_NAN',
      razon: 'expected_value es NaN o null',
      sugerencia: null, fragilidad: null, model_warnings: [],
    };
  }

  // Señal sin valor positivo → NO_BET (resultado natural, no error)
  if (!señal.is_value_bet) {
    return {
      betting_status: BETTING_STATUS.NO_BET,
      regla: null, etiqueta: 'EV_NO_POSITIVO',
      razon: `EV=${(señal.expected_value * 100).toFixed(1)}% ≤ 0: mercado sin valor esperado positivo.`,
      sugerencia: null, fragilidad: null, model_warnings: [],
    };
  }

  // R1 — EV especulativo: divergencia extrema modelo/mercado → WATCHLIST, no bloqueo
  if (señal.expected_value >= UMBRALES.EV_ESPECULATIVO) {
    return {
      betting_status: BETTING_STATUS.WATCHLIST,
      regla: 'R1', etiqueta: ETIQUETA.EV_EXTREMO,
      razon: `EV=${(señal.expected_value * 100).toFixed(1)}% ≥ ${UMBRALES.EV_ESPECULATIVO * 100}%: divergencia extrema modelo/mercado. Puede ser error del modelo o ineficiencia real — verificar antes de apostar.`,
      sugerencia: 'Confirmar con otra fuente de probabilidades antes de apostar.',
      fragilidad: 'alta',
      model_warnings: [MODEL_WARNING.MERCADO_CONTRADICE_MODELO],
    };
  }

  // R8 — Lambda extrema + señal agresiva → PROTECTED_ONLY, no bloqueo total
  if (hayLambdaExtrema) {
    const esAgresiva = tipo === TIPO_SENAL.OVER
                    || tipo === TIPO_SENAL.BTTS_NO
                    || señal.mercado === 'marcador_exacto';
    if (esAgresiva) {
      return {
        betting_status: BETTING_STATUS.PROTECTED_ONLY,
        regla: 'R8', etiqueta: ETIQUETA.LAMBDA_EXTREMA,
        razon: `Lambda extrema: señal ${tipo} no es fiable cuando λ < ${UMBRALES.LAMBDA_EXTREMA_MIN} o λ > ${UMBRALES.LAMBDA_EXTREMA_MAX}.`,
        sugerencia: 'Preferir under o handicap protegido (+1.5/+2.0) en partidos con lambda extrema.',
        fragilidad: 'alta',
        model_warnings: [MODEL_WARNING.LAMBDA_EXTREMA],
      };
    }
  }

  // R5 — BTTS en combinadas → WATCHLIST
  if (esBtts && ctx.tipo === 'combinada' && !ctx.permitir_btts_en_combinada) {
    return {
      betting_status: BETTING_STATUS.WATCHLIST,
      regla: 'R5', etiqueta: ETIQUETA.BTTS_COMBINADA,
      razon: 'BTTS en combinadas: hit rate J1 33.3% — riesgo acumulado en parlay.',
      sugerencia: null, fragilidad: 'media', model_warnings: [],
    };
  }

  // R4 — BTTS_NO con lambda underdog en zona de riesgo → NO_BET
  if (tipo === TIPO_SENAL.BTTS_NO &&
      lambdaUnderdog >= UMBRALES.LAMBDA_UNDERDOG_MIN &&
      lambdaUnderdog <= UMBRALES.LAMBDA_UNDERDOG_MAX) {
    return {
      betting_status: BETTING_STATUS.NO_BET,
      regla: 'R4', etiqueta: ETIQUETA.RIESGO_UNDERDOG,
      razon: `λ_underdog=${lambdaUnderdog.toFixed(2)} ∈ [${UMBRALES.LAMBDA_UNDERDOG_MIN}, ${UMBRALES.LAMBDA_UNDERDOG_MAX}]: P(equipo menor anota ≥1) ≈ ${((1 - Math.exp(-lambdaUnderdog)) * 100).toFixed(0)}%. Modelo subestima goles aislados.`,
      sugerencia: 'Evitar BTTS_NO cuando underdog tiene λ en este rango.',
      fragilidad: 'alta', model_warnings: [],
    };
  }

  // R2 — H2H ganador con prob insuficiente
  if (esH2HGanador && señal.prob_modelo < UMBRALES.P_FAVORITO_MIN) {
    if (señal.prob_modelo < UMBRALES.P_FAVORITO_NO_BET) {
      return {
        betting_status: BETTING_STATUS.NO_BET,
        regla: 'R2', etiqueta: ETIQUETA.FAVORITO_INSUFICIENTE,
        razon: `prob_modelo=${(señal.prob_modelo * 100).toFixed(1)}% < ${UMBRALES.P_FAVORITO_NO_BET * 100}%: sin ventaja real sobre el azar.`,
        sugerencia: 'Doble oportunidad (1X o X2) si hay señal de valor.',
        fragilidad: 'alta',
        model_warnings: [MODEL_WARNING.FAVORITO_SUBESTIMADO],
      };
    }
    return {
      betting_status: BETTING_STATUS.PROTECTED_ONLY,
      regla: 'R2', etiqueta: ETIQUETA.FAVORITO_INSUFICIENTE,
      razon: `prob_modelo=${(señal.prob_modelo * 100).toFixed(1)}% ∈ [${UMBRALES.P_FAVORITO_NO_BET * 100}%, ${UMBRALES.P_FAVORITO_MIN * 100}%): no es favorito suficientemente claro para ganador seco.`,
      sugerencia: 'Preferir doble oportunidad (1X o X2) o handicap asiático +0.5.',
      fragilidad: 'alta',
      model_warnings: [MODEL_WARNING.FAVORITO_SUBESTIMADO],
    };
  }

  // R3 — H2H ganador con masa de empate alta → PROTECTED_ONLY
  if (esH2HGanador && pEmpate >= UMBRALES.P_EMPATE_MAX) {
    return {
      betting_status: BETTING_STATUS.PROTECTED_ONLY,
      regla: 'R3', etiqueta: ETIQUETA.MASA_EMPATE,
      razon: `p_empate=${(pEmpate * 100).toFixed(1)}% ≥ ${UMBRALES.P_EMPATE_MAX * 100}%: partido cerrado, resultado ganador seco frágil.`,
      sugerencia: 'Handicap asiático +0.5 o mercado over/under como alternativa protegida.',
      fragilidad: 'alta',
      model_warnings: [MODEL_WARNING.PARTIDO_CERRADO],
    };
  }

  // R6 — H2H ganador con baja confianza: VALUE_BET pero fragilidad alta
  if (esH2HGanador && señal.prob_modelo < UMBRALES.P_FRAGIL_H2H) {
    return {
      betting_status: BETTING_STATUS.VALUE_BET,
      regla: 'R6', etiqueta: null,
      razon: null, sugerencia: null,
      fragilidad: 'alta', model_warnings: [],
    };
  }

  // Sin regla activada → VALUE_BET limpio
  return {
    betting_status: BETTING_STATUS.VALUE_BET,
    regla: null, etiqueta: null,
    razon: null, sugerencia: null,
    fragilidad: null, model_warnings: [],
  };
}

// ── Función de error técnico ──────────────────────────────────────────────────

function _errorTecnico(senales, razon, errorDetail) {
  const senalas = Array.isArray(senales) ? senales.map(s => ({
    ...s,
    betting_status: BETTING_STATUS.TECHNICAL_ERROR,
    razon,
    sugerencia: null,
    fragilidad: null,
  })) : [];
  return {
    prediction_status:  PREDICTION_STATUS.TECHNICAL_ERROR,
    risk_level:         RISK_LEVEL.EXTREME,
    model_warnings:     [],
    senales:            senalas,
    senales_value_bet:  [],
    senales_protected:  [],
    senales_watchlist:  [],
    senales_no_bet:     senalas,
    razon_no_apuesta:   razon,
    error_tecnico:      errorDetail,
    _lambda_extrema_info:      null,
    _btts_ambas_lambda_riesgo: false,
  };
}

// ── Función principal: clasificarSenales ──────────────────────────────────────

/**
 * Clasifica señales de apuesta con taxonomía explícita.
 * NUNCA elimina la predicción ni omite partidos.
 * NUNCA bloquea por incertidumbre o riesgo — solo por TECHNICAL_ERROR.
 *
 * @param {object} params
 * @param {object}   params.prediccion  - Doc predicciones/{matchId}
 * @param {object[]} params.senales     - Array de señales (campo señales_valor)
 * @param {object}   [params.contexto]  - { tipo: 'individual'|'combinada', permitir_btts_en_combinada? }
 *
 * @returns {{
 *   prediction_status : string,
 *   risk_level        : string,
 *   model_warnings    : string[],
 *   senales           : object[],
 *   senales_value_bet : object[],
 *   senales_protected : object[],
 *   senales_watchlist : object[],
 *   senales_no_bet    : object[],
 *   razon_no_apuesta  : string|null,
 * }}
 */
export function clasificarSenales({ prediccion, senales, contexto = {} }) {
  // ── Validación técnica de la predicción ──────────────────────────────────
  if (!prediccion || typeof prediccion !== 'object') {
    return _errorTecnico(senales, 'prediccion debe ser un objeto', 'prediccion is not an object');
  }

  const lambdaL = prediccion.lambda_local;
  const lambdaV = prediccion.lambda_visitante;

  if (lambdaL == null || lambdaV == null ||
      isNaN(lambdaL) || isNaN(lambdaV) ||
      lambdaL <= 0   || lambdaV <= 0) {
    return _errorTecnico(
      senales,
      `Lambda inválida: local=${lambdaL} visitante=${lambdaV}. Verificar datos del modelo.`,
      `lambda_local=${lambdaL} lambda_visitante=${lambdaV}`,
    );
  }

  if (!prediccion.prob_1x2 || prediccion.prob_1x2.empate == null) {
    return _errorTecnico(
      senales,
      'prob_1x2 ausente o incompleto en la predicción.',
      'prediccion.prob_1x2 missing',
    );
  }

  // Sin señales → DATA_INCOMPLETE (no es error técnico del modelo)
  if (!Array.isArray(senales) || senales.length === 0) {
    return {
      prediction_status: PREDICTION_STATUS.DATA_INCOMPLETE,
      risk_level:        RISK_LEVEL.LOW,
      model_warnings:    [MODEL_WARNING.ODDS_NO_DISPONIBLES],
      senales:           [],
      senales_value_bet: [],
      senales_protected: [],
      senales_watchlist: [],
      senales_no_bet:    [],
      razon_no_apuesta:  'Sin señales disponibles (odds no capturadas para este partido).',
      _lambda_extrema_info:      null,
      _btts_ambas_lambda_riesgo: false,
    };
  }

  const ctx = {
    tipo:                       contexto.tipo                       ?? 'individual',
    permitir_btts_en_combinada: contexto.permitir_btts_en_combinada ?? false,
  };

  // ── Advertencias de modelo ──────────────────────────────────────────────
  const modelWarnings    = [];
  const problemasLambda  = detectarLambdaExtrema(lambdaL, lambdaV);
  const hayLambdaExtrema = problemasLambda.length > 0;
  if (hayLambdaExtrema) modelWarnings.push(MODEL_WARNING.LAMBDA_EXTREMA);
  if (prediccion.prob_1x2.empate >= UMBRALES.P_EMPATE_MAX) {
    modelWarnings.push(MODEL_WARNING.PARTIDO_CERRADO);
  }

  const riskLevel = calcularRiskLevel(modelWarnings, hayLambdaExtrema);

  // ── Clasificar señales ──────────────────────────────────────────────────
  const senalesClasificadas = [];

  for (const señal of senales) {
    const tipo   = clasificarTipo(señal);
    const result = clasificarSenal(señal, tipo, prediccion, ctx, hayLambdaExtrema);

    // Propagar model_warnings de la señal al nivel global (sin duplicados)
    for (const w of (result.model_warnings ?? [])) {
      if (!modelWarnings.includes(w)) modelWarnings.push(w);
    }

    senalesClasificadas.push({
      ...señal,
      tipo_senal:     tipo,
      betting_status: result.betting_status,
      regla:          result.regla,
      etiqueta:       result.etiqueta,
      razon:          result.razon,
      sugerencia:     result.sugerencia,
      fragilidad:     result.fragilidad,
    });
  }

  // R7 — Añadir sugerencia OU a H2H PROTECTED_ONLY/NO_BET sin sugerencia propia
  const ouValueBet = senalesClasificadas.filter(
    s => (s.tipo_senal === TIPO_SENAL.OVER || s.tipo_senal === TIPO_SENAL.UNDER)
      && s.betting_status === BETTING_STATUS.VALUE_BET
  );
  for (const s of senalesClasificadas) {
    const esH2HDegradado =
      (s.tipo_senal === TIPO_SENAL.H2H_LOCAL || s.tipo_senal === TIPO_SENAL.H2H_VISITANTE) &&
      (s.betting_status === BETTING_STATUS.PROTECTED_ONLY || s.betting_status === BETTING_STATUS.NO_BET) &&
      !s.sugerencia;
    if (esH2HDegradado && ouValueBet.length > 0) {
      const mejorOU = ouValueBet.reduce(
        (best, ou) => ou.expected_value > (best?.expected_value ?? -Infinity) ? ou : best,
        null
      );
      if (mejorOU) {
        s.sugerencia = `R7 — alternativa OU: ${mejorOU.seleccion} (EV=${(mejorOU.expected_value * 100).toFixed(1)}%, cuota=${mejorOU.bookmaker_odds})`;
      }
    }
  }

  // ── Particiones ─────────────────────────────────────────────────────────
  const senalesValueBet  = senalesClasificadas.filter(s => s.betting_status === BETTING_STATUS.VALUE_BET);
  const senalesProtected = senalesClasificadas.filter(s => s.betting_status === BETTING_STATUS.PROTECTED_ONLY);
  const senalesWatchlist = senalesClasificadas.filter(s => s.betting_status === BETTING_STATUS.WATCHLIST);
  const senalesNoBet     = senalesClasificadas.filter(
    s => s.betting_status === BETTING_STATUS.NO_BET || s.betting_status === BETTING_STATUS.TECHNICAL_ERROR
  );

  // razon_no_apuesta — cuando no hay VALUE_BET ni PROTECTED_ONLY
  let razonNoApuesta = null;
  if (senalesValueBet.length === 0 && senalesProtected.length === 0) {
    const razones = senalesClasificadas
      .filter(s => s.razon && s.betting_status !== BETTING_STATUS.NO_BET)
      .map(s => s.razon)
      .slice(0, 2);
    razonNoApuesta = razones.length > 0
      ? razones.join(' | ')
      : 'Sin señal apostable: EV negativo o mercado sin valor para este partido.';
  }

  const bttsRiesgo = lambdaL > UMBRALES.LAMBDA_BTTS_RIESGO && lambdaV > UMBRALES.LAMBDA_BTTS_RIESGO;

  return {
    prediction_status:  PREDICTION_STATUS.OK,
    risk_level:         riskLevel,
    model_warnings:     modelWarnings,
    senales:            senalesClasificadas,
    senales_value_bet:  senalesValueBet,
    senales_protected:  senalesProtected,
    senales_watchlist:  senalesWatchlist,
    senales_no_bet:     senalesNoBet,
    razon_no_apuesta:   razonNoApuesta,
    _lambda_extrema_info:      problemasLambda.length > 0 ? problemasLambda.join(', ') : null,
    _btts_ambas_lambda_riesgo: bttsRiesgo,
  };
}

// ── Legacy: filtrarSenalesApuesta ─────────────────────────────────────────────

/**
 * @deprecated Usar clasificarSenales().
 *
 * Mantiene la interfaz anterior (senales_aprobadas / senales_bloqueadas /
 * advertencias / nivel_fragilidad_global) para compatibilidad con scripts
 * existentes. Sigue lanzando Error en TECHNICAL_ERROR.
 *
 * Diferencias con el comportamiento anterior:
 *  - R1 (EV ≥ 50%): antes bloqueaba, ahora aparece en senales_bloqueadas con etiqueta WATCHLIST.
 *  - R2 prob ∈ [50%, 60%): antes bloqueaba seco, ahora aparece como PROTECTED_ONLY.
 *  - R8 lambda extrema + señal no agresiva: antes advertencia, igual.
 */
export function filtrarSenalesApuesta({ prediccion, senales, contexto = {} }) {
  const res = clasificarSenales({ prediccion, senales, contexto });

  if (res.prediction_status === PREDICTION_STATUS.TECHNICAL_ERROR) {
    throw new Error(res.error_tecnico ?? res.razon_no_apuesta ?? 'Error técnico en predicción');
  }

  // Solo señales is_value_bet=true (comportamiento original)
  const soloValor         = res.senales.filter(s => s.is_value_bet === true);
  const senalesAprobadas  = soloValor.filter(s => s.betting_status === BETTING_STATUS.VALUE_BET);
  const senalesBloqueadas = soloValor
    .filter(s => s.betting_status !== BETTING_STATUS.VALUE_BET)
    .map(s => ({
      ...s,
      etiqueta:      s.etiqueta ?? s.betting_status,
      razon_bloqueo: s.razon,
    }));

  const advertencias = [];
  if (res._lambda_extrema_info) {
    advertencias.push(`${ETIQUETA.LAMBDA_EXTREMA}: ${res._lambda_extrema_info}`);
  }
  if (res._btts_ambas_lambda_riesgo) {
    advertencias.push(
      `RIESGO_GOL_UNDERDOG: λ_local y λ_visitante > ${UMBRALES.LAMBDA_BTTS_RIESGO} — predicciones btts=false frágiles.`
    );
  }

  const riskToFragilidad = {
    [RISK_LEVEL.EXTREME]: FRAGILIDAD.CRITICA,
    [RISK_LEVEL.HIGH]:    FRAGILIDAD.ALTA,
    [RISK_LEVEL.MEDIUM]:  FRAGILIDAD.MEDIA,
    [RISK_LEVEL.LOW]:     FRAGILIDAD.NINGUNA,
  };

  return {
    senales_aprobadas:       senalesAprobadas,
    senales_bloqueadas:      senalesBloqueadas,
    advertencias,
    nivel_fragilidad_global: riskToFragilidad[res.risk_level] ?? FRAGILIDAD.NINGUNA,
  };
}

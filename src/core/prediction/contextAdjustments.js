/**
 * contextAdjustments.js — Ajustes contextuales y psicodeportivos para el modelo Poisson V2.
 *
 * Todos los ajustes se aplican ANTES de llamar a predecirPartido(),
 * de modo que la matriz Poisson y todas las probabilidades derivadas
 * (1X2, Over/Under, BTTS, marcador probable) reflejan los valores ajustados.
 *
 * Fórmula objetivo (sección 4 de correccion_urgente_cerebro_v2_psico_context.md):
 *
 *   1. ataque_ajustado_i  = ataque_i  * (1 - PESO_AUS_OFE * aus_ofe_i * conf_ofe_i)
 *   2. defensa_ajustada_i = defensa_i * (1 + PESO_AUS_DEF * aus_def_i * conf_def_i)
 *   3. ajuste_exp_i       = ajuste_psico_i + ajuste_contexto_i
 *   4. ataque_efectivo_i  = ataque_ajustado_i * exp(ajuste_exp_i)
 *   5. predecirPartido({ ataque_efectivo_local, defensa_ajustada_local,
 *                         ataque_efectivo_visitante, defensa_ajustada_visitante })
 *
 * Señales que NO mueven lambda todavía (narrativa débil):
 *   venganza_narrativa, rival_maldito, humillacion_previa, underdog
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 */

// ── Pesos iniciales conservadores ────────────────────────────────────────────

export const PESOS_USADOS = {
  peso_ausencias_ofensivas:  0.15,
  peso_ausencias_defensivas: 0.15,
  peso_necesita_ganar:       0.05,
  peso_gap_ranking:          0.04,
  peso_liderazgo:            0.03,
  peso_generacion:           0.03,
  peso_conflicto:            0.04,
  peso_presion:              0.02,
};

const {
  peso_ausencias_ofensivas:  P_AUS_OFE,
  peso_ausencias_defensivas: P_AUS_DEF,
  peso_necesita_ganar:       P_NECESITA,
  peso_gap_ranking:          P_RANKING,
  peso_liderazgo:            P_LIDER,
  peso_generacion:           P_GENERACION,
  peso_conflicto:            P_CONFLICTO,
  peso_presion:              P_PRESION,
} = PESOS_USADOS;

// Confianza mínima para activar ajustes psicodeportivos secundarios.
// Señales con confianza < 0.25 no mueven lambda.
const CONFIANZA_MINIMA = 0.25;

// Efecto de jornada sobre el ajuste de ranking: en J3 el gap ya importa menos
// porque los equipos ya saben su situación real en el grupo.
const EFECTO_JORNADA = { 1: 1.00, 2: 0.70, 3: 0.40 };
const EFECTO_JORNADA_ELIMINATORIA = 0.60;

// ── Utilidades internas ───────────────────────────────────────────────────────

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ── Funciones exportadas ──────────────────────────────────────────────────────

/**
 * Ajusta ataque y defensa de UN equipo según sus ausencias.
 *
 * ausencias_ofensivas → penaliza su propio ataque.
 * ausencias_defensivas → debilita su propia defensa (el rival marcará más).
 *
 * En la fórmula Poisson:
 *   lambda_local = (ataque_local * defensa_visitante / MU_LIGA) * FACTOR_LOCAL
 * La defensa_ajustada_visitante entra directamente en lambda_local,
 * por lo que ausencias_defensivas_visitante sube el lambda del rival correctamente.
 *
 * @param {{ ataque, defensa, ausenciasOfensivas, ausenciasDefensivas, confianzaOfensivas, confianzaDefensivas }}
 * @returns {{ ataqueAjustado, defensaAjustada, factor_ataque, factor_defensa, trazabilidad }}
 */
export function ajustarAtaqueDefensaPorAusencias({
  ataque,
  defensa,
  ausenciasOfensivas  = 0,
  ausenciasDefensivas = 0,
  confianzaOfensivas  = 0,
  confianzaDefensivas = 0,
}) {
  const aOfe = clamp01(ausenciasOfensivas);
  const aDef = clamp01(ausenciasDefensivas);
  const cOfe = clamp01(confianzaOfensivas);
  const cDef = clamp01(confianzaDefensivas);

  // Factor < 1: penaliza el ataque cuando hay ausencias ofensivas con confianza
  const factorAtaque  = 1 - P_AUS_OFE * aOfe * cOfe;
  // Factor > 1: empeora la defensa cuando hay ausencias defensivas con confianza
  const factorDefensa = 1 + P_AUS_DEF * aDef * cDef;

  const ataqueAjustado  = ataque  * factorAtaque;
  const defensaAjustada = defensa * factorDefensa;

  return {
    ataqueAjustado,
    defensaAjustada,
    factor_ataque:  factorAtaque,
    factor_defensa: factorDefensa,
    trazabilidad: {
      ausencias_ofensivas:   aOfe,
      ausencias_defensivas:  aDef,
      confianza_ofensivas:   cOfe,
      confianza_defensivas:  cDef,
      delta_ataque_pct:  +((factorAtaque  - 1) * 100).toFixed(2),
      delta_defensa_pct: +((factorDefensa - 1) * 100).toFixed(2),
    },
  };
}

/**
 * Calcula el gap de ranking FIFA entre dos equipos.
 *
 * gap > 0 → el equipo tiene MEJOR ranking que el rival (ej: equipo=5, rival=45 → gap=40)
 * gap_norm ∈ [-1, 1] → normalizado dividiendo por 100
 *
 * @param {number|null} rankingEquipo
 * @param {number|null} rankingRival
 * @returns {{ gap, gap_norm, disponible }}
 */
export function calcularGapRankingFifa(rankingEquipo, rankingRival) {
  if (!rankingEquipo || !rankingRival || rankingEquipo <= 0 || rankingRival <= 0) {
    return { gap: 0, gap_norm: 0, disponible: false };
  }
  const gap      = rankingRival - rankingEquipo;   // positivo = equipo mejor rankeado
  const gap_norm = Math.max(-1, Math.min(1, gap / 100));
  return { gap, gap_norm, disponible: true };
}

/**
 * Calcula el ajuste exponencial por contexto mundialista y necesidad competitiva.
 *
 * Incluye:
 *   - Gap de ranking FIFA × efecto de jornada
 *   - Necesita ganar × confianza (contextual_proxy)
 *
 * @param {{
 *   rankingEquipo?:    number|null,
 *   rankingRival?:     number|null,
 *   jornadaGrupo?:     number|null,   — 1, 2 o 3 para fase de grupos
 *   faseTorneo?:       string,
 *   necesitaGanar?:    boolean|null,
 *   confianzaNecesita?: number,
 * }}
 * @returns {{ ajuste: number, breakdown: object }}
 */
export function calcularAjusteMundialista({
  rankingEquipo    = null,
  rankingRival     = null,
  jornadaGrupo     = null,
  faseTorneo       = null,
  necesitaGanar    = null,
  confianzaNecesita = 0,
}) {
  let ajuste = 0;
  const breakdown = {};

  // — Ajuste por ranking FIFA —
  const { gap_norm, disponible } = calcularGapRankingFifa(rankingEquipo, rankingRival);

  const esGrupo    = jornadaGrupo != null || (typeof faseTorneo === 'string' && faseTorneo.includes('GROUP'));
  const efJornada  = jornadaGrupo != null
    ? (EFECTO_JORNADA[jornadaGrupo] ?? EFECTO_JORNADA_ELIMINATORIA)
    : (esGrupo ? 1.0 : EFECTO_JORNADA_ELIMINATORIA);

  const ajusteRanking = disponible ? P_RANKING * gap_norm * efJornada : 0;
  ajuste += ajusteRanking;

  breakdown.ranking_disponible = disponible;
  breakdown.gap_norm           = disponible ? +gap_norm.toFixed(4) : null;
  breakdown.efecto_jornada     = efJornada;
  breakdown.ajuste_ranking     = +ajusteRanking.toFixed(5);

  // — Necesita ganar (contextual_proxy) —
  const ngActivo = necesitaGanar === true || necesitaGanar === 1;
  if (ngActivo) {
    const conf        = clamp01(confianzaNecesita ?? 0.75);
    const ajusteNG    = P_NECESITA * conf;
    ajuste           += ajusteNG;
    breakdown.necesita_ganar_activo    = true;
    breakdown.confianza_necesita_ganar = conf;
    breakdown.ajuste_necesita_ganar    = +ajusteNG.toFixed(5);
  } else {
    breakdown.necesita_ganar_activo  = false;
    breakdown.ajuste_necesita_ganar  = 0;
  }

  return { ajuste: +ajuste.toFixed(5), breakdown };
}

/**
 * Calcula el ajuste exponencial por señales psicodeportivas de rendimiento.
 *
 * Señales activadas (team_performance_proxy):
 *   + lider_disponible    (boolean)   → pequeño boost
 *   + generacion_peak     (boolean)   → pequeño boost
 *   - conflicto_interno   (0-3)       → penalización si hay tensión
 *   - presion_mediatica   (0-10)      → penalización pequeña
 *
 * Señales NO activadas todavía (narrativa débil):
 *   venganza_narrativa, rival_maldito, humillacion_previa, underdog
 *
 * Solo se activa un ajuste si confianza >= CONFIANZA_MINIMA (0.25).
 *
 * @param {{
 *   liderDisponible?:    boolean|null,
 *   conflictoInterno?:   number|null,   — escala 0-3
 *   presionMediatica?:   number|null,   — escala 0-10
 *   generacionPeak?:     boolean|null,
 *   confianzaLider?:     number,
 *   confianzaConflicto?: number,
 *   confianzaPresion?:   number,
 *   confianzaGeneracion?: number,
 * }}
 * @returns {{ ajuste: number, breakdown: object }}
 */
export function calcularAjustePsicodeportivo({
  liderDisponible    = null,
  conflictoInterno   = null,
  presionMediatica   = null,
  generacionPeak     = null,
  confianzaLider     = 0,
  confianzaConflicto = 0,
  confianzaPresion   = 0,
  confianzaGeneracion = 0,
}) {
  let ajuste = 0;
  const breakdown = {};

  // — Liderazgo disponible —
  const cLider = clamp01(confianzaLider);
  if (liderDisponible === true && cLider >= CONFIANZA_MINIMA) {
    breakdown.ajuste_lider = +(P_LIDER * cLider).toFixed(5);
    ajuste += breakdown.ajuste_lider;
  } else {
    breakdown.ajuste_lider = 0;
  }

  // — Generación peak —
  const cGen = clamp01(confianzaGeneracion);
  if (generacionPeak === true && cGen >= CONFIANZA_MINIMA) {
    breakdown.ajuste_generacion = +(P_GENERACION * cGen).toFixed(5);
    ajuste += breakdown.ajuste_generacion;
  } else {
    breakdown.ajuste_generacion = 0;
  }

  // — Conflicto interno (0-3 → normalizar a 0-1) —
  const conflictoNorm = clamp01((conflictoInterno ?? 0) / 3);
  const cConflicto    = clamp01(confianzaConflicto);
  if (conflictoNorm > 0 && cConflicto >= CONFIANZA_MINIMA) {
    breakdown.ajuste_conflicto = +(-P_CONFLICTO * conflictoNorm * cConflicto).toFixed(5);
    ajuste += breakdown.ajuste_conflicto;
  } else {
    breakdown.ajuste_conflicto = 0;
  }

  // — Presión mediática (0-10 → normalizar a 0-1) —
  const presionNorm = clamp01((presionMediatica ?? 0) / 10);
  const cPresion    = clamp01(confianzaPresion);
  if (presionNorm > 0 && cPresion >= CONFIANZA_MINIMA) {
    breakdown.ajuste_presion = +(-P_PRESION * presionNorm * cPresion).toFixed(5);
    ajuste += breakdown.ajuste_presion;
  } else {
    breakdown.ajuste_presion = 0;
  }

  return { ajuste: +ajuste.toFixed(5), breakdown };
}

/**
 * Aplica un ajuste exponencial sobre un lambda base.
 *
 * lambda_ajustado = lambda_base * exp(ajuste)
 *
 * Si el resultado es inválido (NaN, Infinity, <= 0), devuelve lambda_base sin cambios.
 *
 * @param {number} lambdaBase  — lambda positivo (>0)
 * @param {number} ajuste      — logarítmico; ej: 0.05 → +5.1%, -0.05 → -4.9%
 * @returns {number}
 */
export function aplicarFactorExponencial(lambdaBase, ajuste) {
  if (!isFinite(lambdaBase) || lambdaBase <= 0) return lambdaBase;
  if (!isFinite(ajuste) || ajuste === 0) return lambdaBase;
  const resultado = lambdaBase * Math.exp(ajuste);
  return (isFinite(resultado) && resultado > 0) ? resultado : lambdaBase;
}

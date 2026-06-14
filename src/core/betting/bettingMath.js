/**
 * bettingMath.js — Motor matemático de apuestas (funciones puras).
 *
 * Implementa secciones 11, 19 y 20 de
 * formulacion_matematica_modelo_apuestas_futbol_BASE.md.
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 * Cada función es testeable aisladamente.
 */

// ── Umbral de decisión ───────────────────────────────────────────────────────
//
// Umbral provisional. El documento de formulación exige que tau se calibre
// con robustez histórica (backtest). No hay backtest todavía
// (Fase 3 - Calibration Engine, bloqueada por calendario).
// NO ajustar este valor sin justificación documentada.
export const TAU = 0;

// ── Funciones primitivas ─────────────────────────────────────────────────────

/**
 * Probabilidad implícita bruta de una cuota decimal.
 * p_imp = 1 / odds
 *
 * @param {number} odds  Cuota decimal del bookmaker. Debe ser > 1.
 * @returns {number}
 */
export function impliedProbability(odds) {
  if (typeof odds !== 'number' || !isFinite(odds) || odds <= 1) {
    throw new Error(
      `impliedProbability: odds debe ser un número decimal > 1. Recibido: ${odds}`
    );
  }
  return 1 / odds;
}

/**
 * Elimina el vigorish normalizando proporcionalmente las probabilidades implícitas.
 *
 * Método proporcional simple. Los documentos base no especifican el
 * método de no-vig (alternativas: Shin's method, power method). Este es
 * el más citado en la literatura referenciada y el más simple de auditar.
 * Si se requiere mayor precisión, reemplazar esta función aisladamente —
 * el resto del motor no depende del método elegido. PENDIENTE DE REVISIÓN.
 *
 * @param {number[]} impliedProbsArray  Array de probs implícitas del mismo mercado.
 * @returns {number[]}  Array normalizado (suma = 1).
 */
export function noVigProbability(impliedProbsArray) {
  if (!Array.isArray(impliedProbsArray) || impliedProbsArray.length === 0) {
    throw new Error('noVigProbability: se requiere un array no vacío.');
  }
  const suma = impliedProbsArray.reduce((acc, p) => acc + p, 0);
  if (suma <= 0) throw new Error('noVigProbability: la suma de probabilidades implícitas es 0 o negativa.');
  return impliedProbsArray.map(p => p / suma);
}

/**
 * Cuota justa ("fair odds") según la probabilidad estimada por el modelo.
 * fairOdds = 1 / probModelo
 *
 * @param {number} probModelo  Probabilidad del modelo en (0, 1].
 * @returns {number}
 */
export function fairOdds(probModelo) {
  if (typeof probModelo !== 'number' || probModelo <= 0 || probModelo > 1) {
    throw new Error(
      `fairOdds: probModelo debe estar en (0, 1]. Recibido: ${probModelo}`
    );
  }
  return 1 / probModelo;
}

/**
 * Edge: ventaja del modelo sobre la probabilidad implícita sin vigorish.
 * Edge = probModelo - probNoVig
 *
 * @param {number} probModelo
 * @param {number} probNoVig
 * @returns {number}  Positivo → el modelo ve más valor del que cotiza el mercado.
 */
export function edge(probModelo, probNoVig) {
  return probModelo - probNoVig;
}

/**
 * Valor esperado de una apuesta unitaria.
 * EV = probModelo * odds - 1
 *
 * EV > 0  → apuesta con valor esperado positivo
 * EV = 0  → punto de equilibrio
 * EV < 0  → apuesta con valor esperado negativo
 *
 * @param {number} probModelo
 * @param {number} odds  Cuota decimal > 1.
 * @returns {number}
 */
export function expectedValue(probModelo, odds) {
  return probModelo * odds - 1;
}

// ── Evaluación completa ──────────────────────────────────────────────────────

/**
 * Evaluación completa de una apuesta sobre un resultado específico.
 *
 * @param {number}   probModelo            Probabilidad del modelo para este resultado.
 * @param {number}   odds                  Cuota decimal del bookmaker para este resultado.
 * @param {number[]} allOddsMismoMercado   Array con TODAS las cuotas del mismo mercado
 *                                          (ej. [odds_L, odds_X, odds_V] para 1X2).
 *                                          Necesario para calcular no_vig_probability
 *                                          correctamente: se normaliza sobre el conjunto,
 *                                          no sobre una sola cuota.
 * @returns {{
 *   model_probability:   number,
 *   bookmaker_odds:      number,
 *   implied_probability: number,
 *   no_vig_probability:  number,
 *   fair_odds:           number,
 *   edge:                number,
 *   expected_value:      number,
 *   is_value_bet:        boolean,
 *   tau_usado:           number,
 * }}
 */
export function evaluateBet(probModelo, odds, allOddsMismoMercado) {
  // Valida odds del resultado evaluado (lanza si <= 1)
  impliedProbability(odds);

  // Suma de probabilidades implícitas brutas de todo el mercado (= overround)
  const sumImplied = allOddsMismoMercado
    .map(impliedProbability)   // valida cada cuota del mercado
    .reduce((a, b) => a + b, 0);

  // No-vig proporcional para este resultado:
  //   (1/odds) / sum(1/o_i  para todo o_i en el mercado)
  const noVigProb = (1 / odds) / sumImplied;

  const implied = 1 / odds;
  const ev      = expectedValue(probModelo, odds);
  const edgeVal = edge(probModelo, noVigProb);
  const fair    = fairOdds(probModelo);

  return {
    model_probability:   probModelo,
    bookmaker_odds:      odds,
    implied_probability: implied,
    no_vig_probability:  noVigProb,
    fair_odds:           fair,
    edge:                edgeVal,
    expected_value:      ev,
    is_value_bet:        ev > TAU,
    tau_usado:           TAU,
  };
}

// ── Kelly criterion (sección 20) ─────────────────────────────────────────────

/**
 * Fracción de Kelly para stake sizing óptimo.
 * f* = (b·p - q) / b  donde b = odds - 1, q = 1 - p
 *
 * Retorna null si el Kelly es negativo (no apostar).
 * En producción usar Kelly fraccional (medio/cuarto Kelly) para controlar volatilidad.
 *
 * @param {number} probModelo  Probabilidad del modelo (p).
 * @param {number} odds        Cuota decimal del bookmaker.
 * @returns {number|null}      Fracción del bankroll, o null si no conviene apostar.
 */
export function kellyFraction(probModelo, odds) {
  const b = odds - 1;
  const q = 1 - probModelo;
  const f = (b * probModelo - q) / b;
  return f > 0 ? f : null;
}

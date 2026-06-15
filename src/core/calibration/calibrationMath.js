/**
 * calibrationMath.js — Métricas de calibración del modelo (funciones puras).
 *
 * Implementa las métricas de Fase 3 (Calibration Engine):
 *   - Brier Score por resultado binario
 *   - Log Loss (con protección contra log(0))
 *   - MAE de goles (lambda vs resultado real)
 *   - Distancia de marcador (acierto exacto, acierto de signo, distancia L1)
 *   - Curvas de calibración por bins de probabilidad
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 * Cada función es testeable aisladamente.
 */

// Protección contra log(0): valor mínimo/máximo para clamp de probabilidad.
const LOG_EPSILON = 1e-15;

// ── Validadores internos ─────────────────────────────────────────────────────

function validarProb(p, contexto) {
  if (typeof p !== 'number' || !isFinite(p) || p < 0 || p > 1) {
    throw new Error(
      `${contexto}: probModelo debe ser un número en [0, 1]. Recibido: ${p}`
    );
  }
}

function validarOcurrio(o, contexto) {
  if (o !== 0 && o !== 1) {
    throw new Error(
      `${contexto}: ocurrio debe ser 0 o 1 (número). Recibido: ${o}`
    );
  }
}

function validarNumericoPositivo(v, nombre, contexto) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) {
    throw new Error(
      `${contexto}: ${nombre} debe ser un número finito >= 0. Recibido: ${v}`
    );
  }
}

// ── Brier Score ──────────────────────────────────────────────────────────────

/**
 * Brier Score para un único resultado binario.
 * BS = (p_modelo - I_ocurrió)²
 *
 * Rango: [0, 1]. 0 = predicción perfecta. Baseline (p=0.5) = 0.25.
 * Se usa para evaluar la calidad de las predicciones de 1X2, BTTS y O/U.
 * Mejor que accuracy porque penaliza la confianza mal depositada.
 *
 * @param {number} probModelo  Probabilidad del modelo en [0, 1].
 * @param {0|1}    ocurrio     1 si el evento ocurrió, 0 si no.
 * @returns {number}
 */
export function brierScore(probModelo, ocurrio) {
  validarProb(probModelo, 'brierScore');
  validarOcurrio(ocurrio, 'brierScore');
  return (probModelo - ocurrio) ** 2;
}

// ── Log Loss ─────────────────────────────────────────────────────────────────

/**
 * Log Loss (binary cross-entropy) para un único resultado binario.
 * LL = -[I·log(p) + (1-I)·log(1-p)]
 *
 * probModelo se clampea a [LOG_EPSILON, 1-LOG_EPSILON] antes de log()
 * para evitar log(0) = -Infinity.
 *
 * Rango: [0, +∞). 0 = predicción perfecta. Penaliza más que Brier
 * las probabilidades altas asignadas a eventos que no ocurren.
 *
 * @param {number} probModelo  Probabilidad del modelo en [0, 1].
 * @param {0|1}    ocurrio     1 si el evento ocurrió, 0 si no.
 * @returns {number}
 */
export function logLoss(probModelo, ocurrio) {
  validarProb(probModelo, 'logLoss');
  validarOcurrio(ocurrio, 'logLoss');
  const p = Math.max(LOG_EPSILON, Math.min(1 - LOG_EPSILON, probModelo));
  return -(ocurrio * Math.log(p) + (1 - ocurrio) * Math.log(1 - p));
}

// ── MAE de goles ─────────────────────────────────────────────────────────────

/**
 * Error Absoluto Medio de goles para un único equipo en un partido.
 * MAE = |lambda - goles_reales|
 *
 * Compara el lambda de Poisson (goles esperados) contra los goles reales.
 * Se calcula por separado para local y visitante.
 *
 * @param {number} lambda      Goles esperados (λ de Poisson). Debe ser >= 0 y finito.
 * @param {number} golesReales Goles marcados en el partido. Debe ser >= 0 y finito.
 * @returns {number}
 */
export function maeGoles(lambda, golesReales) {
  validarNumericoPositivo(lambda, 'lambda', 'maeGoles');
  validarNumericoPositivo(golesReales, 'golesReales', 'maeGoles');
  return Math.abs(lambda - golesReales);
}

// ── Distancia de marcador ────────────────────────────────────────────────────

/**
 * Métricas de error de marcador comparando predicción vs resultado real.
 *
 * predLocal / predVisitante: marcador predicho (enteros de marcador_mas_probable).
 * realLocal / realVisitante: goles reales del partido.
 *
 * Devuelve:
 *   - acierto_exacto:  boolean. True solo si el marcador es idéntico.
 *   - acierto_signo:   boolean. True si el sentido del resultado coincide
 *                       (local gana / empate / visitante gana), independiente
 *                       del marcador exacto.
 *   - distancia_total: número. Distancia L1 (Manhattan) entre marcadores.
 *                       |predLocal - realLocal| + |predVisitante - realVisitante|.
 *                       0 = acierto exacto. Útil para comparar qué tan "cerca"
 *                       estaba el modelo cuando no acertó el marcador.
 *
 * @param {number} predLocal       Goles local predichos.
 * @param {number} predVisitante   Goles visitante predichos.
 * @param {number} realLocal       Goles local reales.
 * @param {number} realVisitante   Goles visitante reales.
 * @returns {{ acierto_exacto: boolean, acierto_signo: boolean, distancia_total: number }}
 */
export function distanciaMarcador(predLocal, predVisitante, realLocal, realVisitante) {
  validarNumericoPositivo(predLocal, 'predLocal', 'distanciaMarcador');
  validarNumericoPositivo(predVisitante, 'predVisitante', 'distanciaMarcador');
  validarNumericoPositivo(realLocal, 'realLocal', 'distanciaMarcador');
  validarNumericoPositivo(realVisitante, 'realVisitante', 'distanciaMarcador');

  const acierto_exacto = predLocal === realLocal && predVisitante === realVisitante;

  // Math.sign: 1 (local gana), 0 (empate), -1 (visitante gana)
  const signoPrediccion = Math.sign(predLocal - predVisitante);
  const signoReal       = Math.sign(realLocal - realVisitante);
  const acierto_signo   = signoPrediccion === signoReal;

  const distancia_total = Math.abs(predLocal - realLocal) + Math.abs(predVisitante - realVisitante);

  return { acierto_exacto, acierto_signo, distancia_total };
}

// ── Curva de calibración (bins) ──────────────────────────────────────────────

/**
 * Agrupa predicciones en bins de probabilidad y calcula el error de calibración.
 *
 * Un modelo bien calibrado tiene frecuencia_real ≈ prob_promedio en cada bin.
 * Por ejemplo: cuando el modelo asigna ~70% de probabilidad a un evento,
 * ese evento debería ocurrir ~70% de las veces en ese bin.
 *
 * Nota: con muestras pequeñas (< 50 por bin) los resultados son muy ruidosos.
 * Documentar `n` siempre al interpretar resultados.
 *
 * @param {{ prob: number, ocurrio: 0|1 }[]} observaciones
 *   Array de observaciones. Cada elemento tiene:
 *   - prob: probabilidad del modelo para este resultado en [0, 1]
 *   - ocurrio: 1 si el resultado ocurrió, 0 si no
 * @param {number} [anchoBin=0.1]  Ancho de cada bin. Debe ser en (0, 1].
 * @returns {{
 *   bin_inicio:       number,
 *   bin_fin:          number,
 *   n:                number,
 *   prob_promedio:    number|null,
 *   frecuencia_real:  number|null,
 *   error_calibracion: number|null,
 * }[]}
 *   Un objeto por bin. bins vacíos (n=0) tienen null en los campos derivados.
 */
export function calibrationBins(observaciones, anchoBin = 0.1) {
  if (!Array.isArray(observaciones) || observaciones.length === 0) {
    throw new Error('calibrationBins: se requiere un array no vacío de observaciones.');
  }
  if (typeof anchoBin !== 'number' || !isFinite(anchoBin) || anchoBin <= 0 || anchoBin > 1) {
    throw new Error(
      `calibrationBins: anchoBin debe ser un número en (0, 1]. Recibido: ${anchoBin}`
    );
  }

  const numBins = Math.round(1 / anchoBin);

  // Acumuladores por bin
  const acc = Array.from({ length: numBins }, (_, i) => ({
    bin_inicio:    parseFloat((i * anchoBin).toFixed(10)),
    bin_fin:       parseFloat(((i + 1) * anchoBin).toFixed(10)),
    n:             0,
    _sum_prob:     0,
    _sum_ocurrio:  0,
  }));

  for (const obs of observaciones) {
    if (typeof obs.prob !== 'number' || !isFinite(obs.prob) || obs.prob < 0 || obs.prob > 1) {
      throw new Error(`calibrationBins: obs.prob inválido: ${obs.prob}`);
    }
    if (obs.ocurrio !== 0 && obs.ocurrio !== 1) {
      throw new Error(`calibrationBins: obs.ocurrio debe ser 0 o 1. Recibido: ${obs.ocurrio}`);
    }
    // prob=1.0 va al último bin (clamp)
    const idx = Math.min(Math.floor(obs.prob / anchoBin), numBins - 1);
    acc[idx].n++;
    acc[idx]._sum_prob    += obs.prob;
    acc[idx]._sum_ocurrio += obs.ocurrio;
  }

  return acc.map(({ bin_inicio, bin_fin, n, _sum_prob, _sum_ocurrio }) => {
    const prob_promedio    = n > 0 ? _sum_prob    / n : null;
    const frecuencia_real  = n > 0 ? _sum_ocurrio / n : null;
    const error_calibracion = n > 0
      ? Math.abs(prob_promedio - frecuencia_real)
      : null;
    return { bin_inicio, bin_fin, n, prob_promedio, frecuencia_real, error_calibracion };
  });
}

/**
 * resultados.js — Persistencia de resultados reales de partidos.
 *
 * Colección: resultados/{matchId}
 *
 * Este módulo es la única puerta de entrada para escribir resultados en Firestore.
 * Los campos derivados (resultado_1x2, total_goles, over_under_result, btts_result)
 * se calculan siempre internamente — los valores que vengan en `datos` son ignorados
 * para esos campos, garantizando consistencia.
 */

import './init.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

// Líneas de Over/Under que replica el modelo Poisson (prob_over_under)
const LINEAS_OU = [1.5, 2.5, 3.5, 4.5];

// ── Validadores internos ─────────────────────────────────────────────────────

function validarGoles(v, nombre) {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(
      `guardarResultado: ${nombre} debe ser un entero >= 0. Recibido: ${JSON.stringify(v)}`
    );
  }
}

// ── Cálculo de derivados ─────────────────────────────────────────────────────

function calcularDerivados(golesLocal, golesVisitante) {
  const total_goles = golesLocal + golesVisitante;

  let resultado_1x2;
  if      (golesLocal > golesVisitante)  resultado_1x2 = 'local';
  else if (golesLocal === golesVisitante) resultado_1x2 = 'empate';
  else                                    resultado_1x2 = 'visitante';

  // Claves como string para compatibilidad con Firestore (no admite claves numéricas)
  const over_under_result = {};
  for (const linea of LINEAS_OU) {
    over_under_result[String(linea)] = total_goles > linea ? 'over' : 'under';
  }

  // btts = Both Teams To Score: ambos marcaron al menos 1 gol
  const btts_result = golesLocal > 0 && golesVisitante > 0;

  return { resultado_1x2, total_goles, over_under_result, btts_result };
}

// ── Funciones públicas ───────────────────────────────────────────────────────

/**
 * Guarda (o sobreescribe) el resultado real de un partido en resultados/{matchId}.
 *
 * Valida campos mínimos antes de escribir. Los campos derivados se calculan
 * siempre desde goles_local y goles_visitante — cualquier valor que venga en
 * `datos` para esos campos es ignorado.
 *
 * @param {number|string} matchId
 * @param {{
 *   goles_local:        number,   — entero >= 0
 *   goles_visitante:    number,   — entero >= 0
 *   fuente:             string,   — "fotmob" | "football_data" | "manual" | ...
 *   terminado:          true,     — solo se acepta exactamente true
 *   xg_local_real?:    number,   — opcional, null si no disponible
 *   xg_visitante_real?: number,  — opcional, null si no disponible
 *   capturado_en?:      any,      — opcional; si falta, se añade serverTimestamp()
 * }} datos
 * @returns {object} documento confirmado desde Firestore
 */
export async function guardarResultado(matchId, datos) {
  // ── Validaciones obligatorias ───────────────────────────────────────────────

  if (datos.terminado !== true) {
    throw new Error(
      `guardarResultado(${matchId}): terminado debe ser exactamente true. ` +
      `Recibido: ${JSON.stringify(datos.terminado)}`
    );
  }

  validarGoles(datos.goles_local,     'goles_local');
  validarGoles(datos.goles_visitante, 'goles_visitante');

  if (typeof datos.fuente !== 'string' || !datos.fuente.trim()) {
    throw new Error(
      `guardarResultado(${matchId}): fuente debe ser un string no vacío. ` +
      `Recibido: ${JSON.stringify(datos.fuente)}`
    );
  }

  // ── Derivados (recalculados siempre, nunca de afuera) ──────────────────────

  const derivados = calcularDerivados(datos.goles_local, datos.goles_visitante);

  // ── Construcción del documento ─────────────────────────────────────────────

  const documento = {
    matchId:            String(matchId),
    goles_local:        datos.goles_local,
    goles_visitante:    datos.goles_visitante,
    xg_local_real:      datos.xg_local_real     ?? null,
    xg_visitante_real:  datos.xg_visitante_real ?? null,
    fuente:             datos.fuente,
    terminado:          true,
    capturado_en:       datos.capturado_en ?? FieldValue.serverTimestamp(),
    ...derivados,
  };

  const docRef = db.collection('resultados').doc(String(matchId));
  await docRef.set(documento); // set sin merge = reemplazo completo

  const snap = await docRef.get();
  return snap.data();
}

/**
 * Lee el resultado de un partido desde resultados/{matchId}.
 *
 * @param {number|string} matchId
 * @returns {object|null} datos con `id` añadido, o null si no existe
 */
export async function leerResultado(matchId) {
  try {
    const docRef = db.collection('resultados').doc(String(matchId));
    const snap   = await docRef.get();
    if (!snap.exists) return null;
    return { id: String(matchId), ...snap.data() };
  } catch (err) {
    throw new Error(`leerResultado(${matchId}): ${err.message}`);
  }
}

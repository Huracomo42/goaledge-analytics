/**
 * analisisPsicologico.js — Persistencia de análisis psicodeportivo.
 *
 * Colección: analisis_psicologico/{matchId}
 *
 * Normaliza el input crudo (V1 o V2 directo) antes de escribir,
 * usando normalizarAnalisisPsicologico como única fuerta de verdad de esquema.
 *
 * NO escribe en predicciones/{matchId}.
 * NO llama APIs ni Claude.
 * Guard: rechaza matchId que empiece con "TEST_".
 */

import './init.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { normalizarAnalisisPsicologico } from '../core/psychology/normalizarAnalisisPsicologico.js';

const db = getFirestore();

// ── Funciones públicas ────────────────────────────────────────────────────────

/**
 * Normaliza y guarda un análisis psicodeportivo en analisis_psicologico/{matchId}.
 *
 * @param {string|number} matchId
 * @param {object}        input  — JSON crudo estilo V1 o formato directo/variables
 * @returns {object} documento confirmado desde Firestore (con warnings incluidos)
 */
export async function guardarAnalisisPsicologico(matchId, input) {
  const mId = String(matchId);

  if (!mId || !mId.trim()) {
    throw new Error('guardarAnalisisPsicologico: matchId es requerido.');
  }
  if (mId.startsWith('TEST_')) {
    throw new Error(
      `guardarAnalisisPsicologico: matchId "${mId}" empieza con TEST_ y está rechazado.`
    );
  }

  // Normalizar — añade matchId al input si no venía incluido
  const resultado = normalizarAnalisisPsicologico({ ...input, matchId: mId });

  if (!resultado.ok) {
    throw new Error(
      `guardarAnalisisPsicologico(${mId}): normalización falló — ${resultado.razon}`
    );
  }

  const documento = {
    ...resultado.analisis,
    matchId:     mId,
    warnings:    resultado.warnings,
    guardado_en: FieldValue.serverTimestamp(),
  };

  const docRef = db.collection('analisis_psicologico').doc(mId);
  await docRef.set(documento); // reemplazo completo

  const snap = await docRef.get();
  return { matchId: mId, ...snap.data() };
}

/**
 * Lee el análisis psicodeportivo de un partido.
 *
 * @param {string|number} matchId
 * @returns {object|null} documento con `matchId` añadido, o null si no existe
 */
export async function leerAnalisisPsicologico(matchId) {
  try {
    const mId    = String(matchId);
    const docRef = db.collection('analisis_psicologico').doc(mId);
    const snap   = await docRef.get();
    if (!snap.exists) return null;
    return { matchId: mId, ...snap.data() };
  } catch (err) {
    throw new Error(`leerAnalisisPsicologico(${matchId}): ${err.message}`);
  }
}

/**
 * Verifica si existe un análisis psicodeportivo para un partido.
 * Evita llamadas duplicadas a Claude sin necesidad de leer el documento completo.
 *
 * @param {string|number} matchId
 * @returns {boolean}
 */
export async function existeAnalisisPsicologico(matchId) {
  try {
    const mId    = String(matchId);
    const docRef = db.collection('analisis_psicologico').doc(mId);
    const snap   = await docRef.get();
    return snap.exists;
  } catch (err) {
    throw new Error(`existeAnalisisPsicologico(${matchId}): ${err.message}`);
  }
}

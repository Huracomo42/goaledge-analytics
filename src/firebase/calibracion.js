/**
 * calibracion.js — Persistencia de métricas de calibración.
 *
 * Colecciones:
 *   calibracion_partidos/{matchId}_{versionModelo}  — métricas por partido
 *   calibracion_runs/{runId}                         — resúmenes agregados de corridas
 *
 * Este módulo NO calcula métricas. Solo guarda y lee documentos.
 * Los cálculos viven en calibrationMath.js y buildCalibrationDataset.js.
 *
 * Guard: rechaza matchId que empiece con "TEST_".
 */

import './init.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

// ── Helpers de validación ─────────────────────────────────────────────────────

function validarMatchId(matchId, fn) {
  if (!matchId || !String(matchId).trim()) {
    throw new Error(`${fn}: matchId es requerido.`);
  }
  if (String(matchId).startsWith('TEST_')) {
    throw new Error(`${fn}: matchId "${matchId}" empieza con TEST_ y está rechazado.`);
  }
}

function validarVersionModelo(versionModelo, fn) {
  if (!versionModelo || !String(versionModelo).trim()) {
    throw new Error(`${fn}: versionModelo es requerido.`);
  }
}

function validarRunId(runId, fn) {
  if (!runId || !String(runId).trim()) {
    throw new Error(`${fn}: runId es requerido.`);
  }
}

function docIdPartido(matchId, versionModelo) {
  return `${String(matchId)}_${String(versionModelo)}`;
}

// ── calibracion_partidos ──────────────────────────────────────────────────────

/**
 * Guarda (o reemplaza) las métricas de calibración de un partido.
 *
 * Documento: calibracion_partidos/{matchId}_{versionModelo}
 *
 * @param {string|number} matchId
 * @param {string}        versionModelo  — p.ej. "2.0"
 * @param {object}        datos          — métricas calculadas externamente
 * @returns {object} documento confirmado desde Firestore
 */
export async function guardarCalibracionPartido(matchId, versionModelo, datos) {
  validarMatchId(matchId, 'guardarCalibracionPartido');
  validarVersionModelo(versionModelo, 'guardarCalibracionPartido');

  const docId = docIdPartido(matchId, versionModelo);

  const documento = {
    ...datos,
    matchId:        String(matchId),
    version_modelo: String(versionModelo),
    guardado_en:    FieldValue.serverTimestamp(),
  };

  const docRef = db.collection('calibracion_partidos').doc(docId);
  await docRef.set(documento); // reemplazo completo

  const snap = await docRef.get();
  return { docId, ...snap.data() };
}

/**
 * Lee las métricas de calibración de un partido.
 *
 * @param {string|number} matchId
 * @param {string}        versionModelo
 * @returns {object|null} documento con `docId` añadido, o null si no existe
 */
export async function leerCalibracionPartido(matchId, versionModelo) {
  try {
    const docId  = docIdPartido(matchId, versionModelo);
    const docRef = db.collection('calibracion_partidos').doc(docId);
    const snap   = await docRef.get();
    if (!snap.exists) return null;
    return { docId, ...snap.data() };
  } catch (err) {
    throw new Error(`leerCalibracionPartido(${matchId}, ${versionModelo}): ${err.message}`);
  }
}

// ── calibracion_runs ──────────────────────────────────────────────────────────

/**
 * Guarda (o reemplaza) el resumen de una corrida de calibración.
 *
 * Documento: calibracion_runs/{runId}
 *
 * @param {string} runId   — identificador de la corrida, p.ej. "v2.0_20260618"
 * @param {object} datos   — resumen agregado calculado externamente
 * @returns {object} documento confirmado desde Firestore
 */
export async function guardarCalibrationRun(runId, datos) {
  validarRunId(runId, 'guardarCalibrationRun');

  const documento = {
    ...datos,
    runId:       String(runId),
    guardado_en: FieldValue.serverTimestamp(),
  };

  const docRef = db.collection('calibracion_runs').doc(String(runId));
  await docRef.set(documento); // reemplazo completo

  const snap = await docRef.get();
  return { runId: String(runId), ...snap.data() };
}

/**
 * Lee el resumen de una corrida de calibración.
 *
 * @param {string} runId
 * @returns {object|null} documento con `runId` añadido, o null si no existe
 */
export async function leerCalibrationRun(runId) {
  try {
    const docRef = db.collection('calibracion_runs').doc(String(runId));
    const snap   = await docRef.get();
    if (!snap.exists) return null;
    return { runId: String(runId), ...snap.data() };
  } catch (err) {
    throw new Error(`leerCalibrationRun(${runId}): ${err.message}`);
  }
}

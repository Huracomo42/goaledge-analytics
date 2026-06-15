import './init.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Lee la predicción de un partido desde predicciones/{matchId}.
 *
 * @param {number|string} matchId — ID de football-data.org
 * @returns {object|null} datos del documento con `id` añadido, o null si no existe
 */
export async function leerPrediccion(matchId) {
  try {
    const docRef = db.collection('predicciones').doc(String(matchId));
    const snap   = await docRef.get();
    if (!snap.exists) return null;
    return { id: String(matchId), ...snap.data() };
  } catch (err) {
    throw new Error(`leerPrediccion(${matchId}): ${err.message}`);
  }
}

/**
 * Guarda (o sobreescribe) la predicción de un partido en predicciones/{matchId}.
 *
 * Se excluye matriz_marcadores porque Firestore no admite arrays de arrays;
 * el campo es derivable desde lambda_local y lambda_visitante si se necesita.
 *
 * @param {number} matchId         — ID de football-data.org
 * @param {object} datosPrediccion — resultado completo de predecirPartidoCompleto()
 * @returns {object} documento tal como quedó en Firestore (para confirmar escritura)
 */
export async function guardarPrediccion(matchId, datosPrediccion) {
  // eslint-disable-next-line no-unused-vars
  const { matriz_marcadores, ...datos } = datosPrediccion;

  // version_modelo, fuentes_p_disponibles y analisis_psicologico_ref vienen
  // de predecirPartidoCompleto() — no se hardcodean aquí.
  // ajustes_modelo se incluye si está presente en datos.
  const documento = {
    ...datos,
    version_modelo: datos.version_modelo ?? '2.0',
    generado_en:    FieldValue.serverTimestamp(),
  };

  const docRef = db.collection('predicciones').doc(String(matchId));
  await docRef.set(documento);

  // Leer de vuelta para confirmar que se escribió correctamente
  const snap = await docRef.get();
  return snap.data();
}

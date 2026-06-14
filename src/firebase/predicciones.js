import './init.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

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

  const documento = {
    ...datos,
    version_modelo:            '2.0',
    generado_en:               FieldValue.serverTimestamp(),
    fuentes_p_disponibles:     false,
    analisis_psicologico_ref:  null,
  };

  const docRef = db.collection('predicciones').doc(String(matchId));
  await docRef.set(documento);

  // Leer de vuelta para confirmar que se escribió correctamente
  const snap = await docRef.get();
  return snap.data();
}

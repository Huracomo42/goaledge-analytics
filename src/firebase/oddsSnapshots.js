import './init.js';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Guarda un snapshot de odds en odds_snapshots/{matchId}_{timestamp_compacto}.
 *
 * Usa setDoc: si el mismo docId se genera dos veces (poco probable dado que
 * el timestamp tiene precisión de segundo), el segundo sobreescribe al primero.
 *
 * @param {number|string} matchId  — ID de football-data.org
 * @param {object}        datos    — resultado de transformarRespuestaOddsApi()
 * @returns {{ id: string, data: object }}  ID del documento y datos confirmados
 */
export async function guardarOddsSnapshot(matchId, datos) {
  const ts    = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const docId = `${matchId}_${ts}`;

  const docRef = db.collection('odds_snapshots').doc(docId);
  await docRef.set(datos);

  const snap = await docRef.get();
  return { id: docId, data: snap.data() };
}

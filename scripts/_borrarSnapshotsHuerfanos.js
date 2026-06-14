/**
 * Borra snapshots huérfanos de odds_snapshots/ creados en corridas de prueba
 * de guardarOddsDelDia.js con partidos J1 (sin predicción asociada).
 *
 * Uso único — no reutilizar sin ajustar IDS.
 */

import { guardarOddsSnapshot } from '../src/firebase/oddsSnapshots.js'; // inicializa Firebase
import { getFirestore }        from 'firebase-admin/firestore';

const db = getFirestore();

const IDS = [
  '537357_20260614192718',  // Netherlands vs Japan — run 1 (crash)
  '537357_20260614192836',  // Netherlands vs Japan — run 2
  '537352_20260614192838',  // Ivory Coast vs Ecuador — run 2
];

console.log(`\nBorrando ${IDS.length} snapshots huérfanos de odds_snapshots/…\n`);

for (const id of IDS) {
  const ref = db.collection('odds_snapshots').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  ⚠ No existe: ${id} (ya borrado o ID incorrecto)`);
    continue;
  }
  await ref.delete();
  console.log(`  ✓ Borrado: ${id}`);
}

console.log('\nListo.\n');

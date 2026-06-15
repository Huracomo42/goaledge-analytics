/**
 * probarLecturasFirebase.js — Prueba de lectura de predicciones y odds_snapshots.
 *
 * Solo lectura: NO escribe, NO modifica, NO crea documentos en Firestore.
 *
 * Uso:
 *   node scripts/probarLecturasFirebase.js              → usa matchId por defecto (537352)
 *   node scripts/probarLecturasFirebase.js <matchId>    → usa el matchId indicado
 */

import 'dotenv/config';
import { leerPrediccion }   from '../src/firebase/predicciones.js';
import { leerOddsSnapshot } from '../src/firebase/oddsSnapshots.js';

const matchId = process.argv[2] ?? '537329'; // Czechia vs South Africa (J2 V2) como fallback

console.log('\n' + '═'.repeat(65));
console.log(`  probarLecturasFirebase — matchId: ${matchId}`);
console.log('  MODO SOLO LECTURA — 0 escrituras a Firestore');
console.log('═'.repeat(65));

// ── [1] Leer predicción ───────────────────────────────────────────────────────

console.log(`\n[1] Leyendo predicciones/${matchId}…`);

const prediccion = await leerPrediccion(matchId);

if (!prediccion) {
  console.log(`\n  ✗ No existe el documento predicciones/${matchId} en Firestore.`);
  console.log('  Verifica que el matchId sea correcto o que se haya ejecutado predecirJ2ConHistorial.js\n');
  process.exit(0);
}

console.log('\n  ✓ Documento encontrado.');

// Campos requeridos por el usuario
const version     = prediccion.version_modelo          ?? '(campo ausente)';
const lambdaL     = prediccion.lambda_local             ?? '(campo ausente)';
const lambdaV     = prediccion.lambda_visitante         ?? '(campo ausente)';
const tiene1x2    = prediccion.prob_1x2 != null         ? 'sí' : 'no';
const snapshotRef = prediccion.ultimo_odds_snapshot_id  ?? null;

console.log('\n  ── Campos requeridos ──');
console.log(`  version_modelo          : ${version}`);
console.log(`  lambda_local            : ${typeof lambdaL === 'number' ? lambdaL.toFixed(4) : lambdaL}`);
console.log(`  lambda_visitante        : ${typeof lambdaV === 'number' ? lambdaV.toFixed(4) : lambdaV}`);
console.log(`  tiene prob_1x2          : ${tiene1x2}`);
console.log(`  ultimo_odds_snapshot_id : ${snapshotRef ?? '(no existe — esperado antes de 18-jun)'}`);

// Campos adicionales de contexto
const local     = prediccion.nombreLocal      ?? '(ausente)';
const visitante = prediccion.nombreVisitante  ?? '(ausente)';
const fecha     = prediccion.fechaPartido     ?? '(ausente)';

console.log('\n  ── Contexto del partido ──');
console.log(`  partido   : ${local} vs ${visitante}`);
console.log(`  fecha     : ${fecha}`);

if (prediccion.prob_1x2) {
  const p1x2 = prediccion.prob_1x2;
  console.log('\n  ── prob_1x2 ──');
  console.log(`  local     : ${(p1x2.local     * 100).toFixed(1)}%`);
  console.log(`  empate    : ${(p1x2.empate    * 100).toFixed(1)}%`);
  console.log(`  visitante : ${(p1x2.visitante * 100).toFixed(1)}%`);
  console.log(`  suma      : ${((p1x2.local + p1x2.empate + p1x2.visitante) * 100).toFixed(2)}% (debe ser ≈100%)`);
}

if (prediccion.marcador_mas_probable) {
  const mmp = prediccion.marcador_mas_probable;
  const probMmp = mmp.prob ?? mmp.probabilidad; // campo guardado como "prob" en Firestore
  console.log(`\n  marcador_mas_probable : ${mmp.local}-${mmp.visitante}  (p=${probMmp != null ? (probMmp * 100).toFixed(2) + '%' : '(campo prob ausente)'})`);
}

if (prediccion.muestra_local && prediccion.muestra_visitante) {
  const ml = prediccion.muestra_local;
  const mv = prediccion.muestra_visitante;
  console.log(`\n  muestra_local     : n=${ml.n_partidos}  fuente=${ml.fuente}  pequeña=${ml.muestra_pequena}`);
  console.log(`  muestra_visitante : n=${mv.n_partidos}  fuente=${mv.fuente}  pequeña=${mv.muestra_pequena}`);
}

// ── [2] Leer odds snapshot (si existe) ──────────────────────────────────────

console.log('\n' + '─'.repeat(65));
console.log('\n[2] Odds snapshot…');

if (!snapshotRef) {
  console.log(`\n  Sin ultimo_odds_snapshot_id en predicciones/${matchId}.`);
  console.log('  Esperado: los snapshots de odds para J2 empiezan el 18-jun-2026.');
  console.log('  La función leerOddsSnapshot() está lista para cuando exista el ID.');
} else {
  console.log(`\n  Leyendo odds_snapshots/${snapshotRef}…`);
  const snapshot = await leerOddsSnapshot(snapshotRef);

  if (!snapshot) {
    console.log(`  ✗ No existe el documento odds_snapshots/${snapshotRef}.`);
    console.log('    (El ID está en predicciones pero el documento de snapshot no existe — posible inconsistencia)');
  } else {
    console.log(`  ✓ Snapshot encontrado.`);
    console.log(`\n  snapshotId    : ${snapshot.snapshotId}`);
    console.log(`  tipo_snapshot : ${snapshot.tipo_snapshot ?? '(ausente)'}`);
    console.log(`  capturado_en  : ${snapshot.capturado_en  ?? '(ausente)'}`);
    console.log(`  fuente_api    : ${snapshot.fuente_api    ?? '(ausente)'}`);
    console.log(`  region        : ${snapshot.region        ?? '(ausente)'}`);

    if (snapshot.mercados?.h2h) {
      const h2h = snapshot.mercados.h2h;
      console.log('\n  ── mercados.h2h ──');
      console.log(`  n_bookmakers  : ${h2h.n_bookmakers ?? '(ausente)'}`);
      console.log(`  odds_local    : ${h2h.odds_local    ?? '(ausente)'}`);
      console.log(`  odds_empate   : ${h2h.odds_empate   ?? '(ausente)'}`);
      console.log(`  odds_visitante: ${h2h.odds_visitante ?? '(ausente)'}`);
      console.log(`  overround_pct : ${h2h.overround_pct != null ? (h2h.overround_pct * 100).toFixed(2) + '%' : '(ausente)'}`);
    }

    if (snapshot.mercados?.totals) {
      const tot = snapshot.mercados.totals;
      console.log('\n  ── mercados.totals ──');
      console.log(`  linea         : ${tot.linea         ?? '(ausente)'}`);
      console.log(`  odds_over     : ${tot.odds_over     ?? '(ausente)'}`);
      console.log(`  odds_under    : ${tot.odds_under    ?? '(ausente)'}`);
    }
  }
}

// ── Fin ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  FIN — 0 escrituras realizadas en Firestore.');
console.log('═'.repeat(65) + '\n');

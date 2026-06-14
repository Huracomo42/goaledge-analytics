/**
 * guardarOddsDelDia.js — Snapshot de odds del día para los partidos del Mundial.
 *
 * Uso:
 *   node scripts/guardarOddsDelDia.js [YYYY-MM-DD]
 *   (sin argumento → usa la fecha de hoy en UTC)
 *
 * Flujo:
 *   1. Consulta predicciones/ en Firestore (where fechaPartido == fecha).
 *      Si 0 docs → sale sin llamar a The Odds API (0 créditos).
 *   2. Si hay N predicciones:
 *      - UNA sola llamada a /odds (markets=h2h,totals) → 2 créditos.
 *      - Para cada predicción: matchea contra la respuesta, transforma,
 *        guarda en odds_snapshots/ y actualiza predicciones/{matchId}
 *        con el snapshot ID via update() (nunca setDoc completo).
 */

import 'dotenv/config';
import { getFirestore }            from 'firebase-admin/firestore';
import { encontrarEvento,
         transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';
import { guardarOddsSnapshot }         from '../src/firebase/oddsSnapshots.js';

const API_KEY  = process.env.THE_ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com';
const SPORT    = 'soccer_fifa_world_cup';

// ── Fecha objetivo ────────────────────────────────────────────────────────────

const fechaArg = process.argv[2];
const fecha = fechaArg ?? new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
  console.error(`ERROR: Fecha inválida "${fecha}". Usa el formato YYYY-MM-DD.`);
  process.exit(1);
}

console.log('\n' + '═'.repeat(65));
console.log(`  guardarOddsDelDia — fecha objetivo: ${fecha}`);
console.log('═'.repeat(65));

// ── [1/3] Guard: predicciones en Firestore para esa fecha ─────────────────────
//
// Fuente de verdad: predicciones/ (no el fixture completo de football-data).
// Solo procesamos partidos para los que ya calculamos una predicción.

const db = getFirestore();

console.log('\n[1/3] Consultando predicciones/ en Firestore…');
const predSnap = await db.collection('predicciones')
  .where('fechaPartido', '==', fecha)
  .get();

if (predSnap.empty) {
  console.log(`\n  0 predicciones guardadas para ${fecha} — no se llama a The Odds API.`);
  console.log('  Créditos sin cambio. Saliendo.\n');
  process.exit(0);
}

const predicciones = predSnap.docs.map(doc => ({
  matchId:    Number(doc.id),
  fdHome:     doc.data().nombreLocal,
  fdAway:     doc.data().nombreVisitante,
  fechaDoc:   doc.data().fechaPartido,
}));

console.log(`  ${predicciones.length} predicción(es) encontradas:`);
for (const p of predicciones) {
  console.log(`    matchId=${p.matchId}  "${p.fdHome}" vs "${p.fdAway}"`);
}

// ── [2/3] UNA sola llamada a The Odds API ────────────────────────────────────

if (!API_KEY) {
  console.error('\nERROR: THE_ODDS_API_KEY no definida en .env');
  process.exit(1);
}

console.log('\n[2/3] Llamada a The Odds API…');
const url = `${BASE_URL}/v4/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
console.log(`  → GET ${url.replace(API_KEY, '***KEY***')}`);

const res = await fetch(url);

const hdrsRelevantes = ['x-requests-remaining', 'x-requests-used', 'x-requests-last'];
console.log('\n  Headers de créditos:');
for (const h of hdrsRelevantes) {
  console.log(`    ${h}: ${res.headers.get(h) ?? '(no presente)'}`);
}

if (!res.ok) {
  const txt = await res.text();
  console.error(`\n  HTTP ${res.status}: ${txt}`);
  process.exit(1);
}

const eventos = await res.json();
console.log(`\n  Eventos devueltos por la API: ${eventos.length}`);

// ── [3/3] Matchear → Transformar → Guardar ───────────────────────────────────

console.log('\n[3/3] Procesando predicciones de la fecha…');

let nGuardados = 0;
let nSinMatch  = 0;
const sinMatch = [];

for (const { matchId, fdHome, fdAway } of predicciones) {
  console.log(`\n  matchId=${matchId}  "${fdHome}" vs "${fdAway}"`);

  const evento = encontrarEvento(eventos, fdHome, fdAway);
  if (!evento) {
    console.log(`    ✗ Sin match en The Odds API — saltando.`);
    nSinMatch++;
    sinMatch.push({ matchId, fdHome, fdAway });
    continue;
  }

  console.log(`    ✓ Match: "${evento.home_team}" vs "${evento.away_team}"  (${evento.bookmakers?.length ?? 0} bookmakers)`);

  let snapshot;
  try {
    snapshot = transformarRespuestaOddsApi(
      eventos,
      matchId,
      fecha,
      { homeTeam: fdHome, awayTeam: fdAway, region: 'eu', tipoSnapshot: 'cierre' }
    );
  } catch (err) {
    console.log(`    ✗ Error en transformación: ${err.message}`);
    nSinMatch++;
    sinMatch.push({ matchId, fdHome, fdAway, error: err.message });
    continue;
  }

  const { id: snapshotId } = await guardarOddsSnapshot(matchId, snapshot);
  console.log(`    → Guardado en odds_snapshots/${snapshotId}`);

  // update() nunca setDoc — no debe pisar el resto de la predicción.
  // El documento existe porque pasó el guard (viene de predicciones/).
  const predRef = db.collection('predicciones').doc(String(matchId));
  try {
    await predRef.update({ ultimo_odds_snapshot_id: snapshotId });
    console.log(`    → predicciones/${matchId}.ultimo_odds_snapshot_id actualizado`);
  } catch (updErr) {
    // Muy improbable dado el guard, pero no es fatal.
    console.log(`    ⚠ Error al actualizar predicción: ${updErr.message}`);
  }

  nGuardados++;
}

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(65));
console.log(`  Predicciones esa fecha: ${predicciones.length}`);
console.log(`  Snapshots guardados   : ${nGuardados}`);
console.log(`  Sin match / error     : ${nSinMatch}`);

if (sinMatch.length > 0) {
  console.log('\n  Sin match:');
  for (const s of sinMatch) {
    const errStr = s.error ? ` (${s.error})` : '';
    console.log(`    matchId=${s.matchId}  "${s.fdHome}" vs "${s.fdAway}"${errStr}`);
  }
}

console.log('');

/**
 * guardarOddsPorMatchIds.js
 *
 * Captura odds para un conjunto fijo de matchIds en UNA sola llamada a
 * The Odds API, omitiendo los que ya tienen snapshot (a menos que --force).
 *
 * Uso:
 *   node scripts/guardarOddsPorMatchIds.js [--dry-run] [--write] [--force]
 *
 * Modos:
 *   --dry-run (default)  — lee Firestore, muestra plan, CERO llamadas a The Odds API
 *   --write              — una sola llamada real a The Odds API
 *   --write --force      — sobreescribe snapshots existentes
 *
 * Restricciones:
 *   - En dry-run: sin llamadas a The Odds API, sin escrituras Firestore.
 *   - En write: UNA sola llamada a The Odds API.
 *   - Solo update() en predicciones/ — nunca set().
 *   - NO modifica lambdas, probabilidades, resultados ni auditorías.
 *   - NO llama Claude API.
 */

import 'dotenv/config';
import { getFirestore } from 'firebase-admin/firestore';
import '../src/firebase/init.js';
import { encontrarEvento, transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';
import { guardarOddsSnapshot }                          from '../src/firebase/oddsSnapshots.js';

// ── Argumentos ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const WRITE   = args.includes('--write');
const DRY_RUN = !WRITE;
const FORCE   = args.includes('--force');

// ── MatchIds objetivo — J1 restante (los 3 del 15-jun ya tienen snapshot) ────

const TARGETS = [
  { matchId: 537364, local: 'Iran',         visitante: 'New Zealand' },
  { matchId: 537391, local: 'France',       visitante: 'Senegal'     },
  { matchId: 537392, local: 'Iraq',         visitante: 'Norway'      },
  { matchId: 537397, local: 'Argentina',    visitante: 'Algeria'     },
  { matchId: 537398, local: 'Austria',      visitante: 'Jordan'      },
  { matchId: 537403, local: 'Portugal',     visitante: 'Congo DR'    },
  { matchId: 537409, local: 'England',      visitante: 'Croatia'     },
  { matchId: 537410, local: 'Ghana',        visitante: 'Panama'      },
  { matchId: 537404, local: 'Uzbekistan',   visitante: 'Colombia'    },
];

const API_KEY  = process.env.THE_ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com';
const SPORT    = 'soccer_fifa_world_cup';

const db = getFirestore();

// ── Header ────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  GUARDAR ODDS POR MATCHIDS — J1 restante');
console.log(`  Modo     : ${DRY_RUN ? 'DRY-RUN (sin llamar The Odds API)' : 'WRITE'}`);
if (!DRY_RUN && FORCE) console.log('  FORCE    : sobreescribirá snapshots existentes');
console.log(`  Targets  : ${TARGETS.length} matchIds`);
console.log('═'.repeat(76));

// ── 1. Leer predicciones de Firestore (sin llamar API) ───────────────────────

console.log('\n  [1/3] Leyendo predicciones de Firestore...');

const predDocs = await Promise.all(
  TARGETS.map(async ({ matchId, local, visitante }) => {
    const snap = await db.collection('predicciones').doc(String(matchId)).get();
    if (!snap.exists) {
      return { matchId: String(matchId), local, visitante, existe: false };
    }
    const d = snap.data();
    return {
      matchId:            String(matchId),
      existe:             true,
      local:              d.nombreLocal     ?? local,
      visitante:          d.nombreVisitante ?? visitante,
      fechaPartido:       d.fechaPartido    ?? null,
      snapshotExistente:  d.ultimo_odds_snapshot_id ?? null,
    };
  })
);

// ── 2. Clasificar ─────────────────────────────────────────────────────────────

const sinPrediccion = predDocs.filter(p => !p.existe);
const yaConSnapshot = predDocs.filter(p => p.existe && p.snapshotExistente && !FORCE);
const necesitan     = predDocs.filter(p => p.existe && (!p.snapshotExistente || FORCE));

// ── 3. Mostrar estado por matchId ─────────────────────────────────────────────

console.log('\n  ESTADO POR MATCHID:');
console.log('  ' + '─'.repeat(74));

for (const p of predDocs) {
  const titulo = `${p.local} vs ${p.visitante}`;

  if (!p.existe) {
    console.log(`  ${p.matchId}  ${titulo}`);
    console.log(`    ✗ SIN PREDICCIÓN en Firestore — no se capturarán odds`);
    continue;
  }

  if (p.snapshotExistente && !FORCE) {
    console.log(`  ${p.matchId}  ${titulo}  [${p.fechaPartido ?? '?'}]`);
    console.log(`    → SKIP  snapshot existente: ${p.snapshotExistente}`);
  } else {
    const razon = FORCE && p.snapshotExistente
      ? `--force: sobreescribirá ${p.snapshotExistente}`
      : 'nuevo snapshot';
    console.log(`  ${p.matchId}  ${titulo}  [${p.fechaPartido ?? '?'}]`);
    console.log(`    → CAPTURAR  (${razon})`);
  }
}

// ── 4. Resumen del plan ───────────────────────────────────────────────────────

console.log('\n  ' + '─'.repeat(74));
console.log(`  Sin predicción en Firestore : ${sinPrediccion.length}`);
console.log(`  Con snapshot (SKIP)         : ${yaConSnapshot.length}`);
console.log(`  Necesitan snapshot nuevo    : ${necesitan.length}`);

if (sinPrediccion.length > 0) {
  console.log(`\n  ⚠  AVISO: los siguientes matchIds no tienen predicción en Firestore:`);
  for (const p of sinPrediccion) console.log(`     ${p.matchId}  ${p.local} vs ${p.visitante}`);
  console.log('     Ejecuta primero: node scripts/predecirJ1Restante.js --write');
}

// ── 5. Si dry-run: mostrar plan y salir SIN llamar The Odds API ──────────────

if (DRY_RUN) {
  console.log('\n  PLAN si ejecutas --write:');
  console.log('  ' + '─'.repeat(74));

  if (necesitan.length === 0) {
    console.log('  Todos los matchIds ya tienen snapshot.');
    console.log('  No se haría ninguna llamada a The Odds API.');
    console.log('  Usa --force para sobreescribir snapshots existentes.');
  } else {
    console.log(`  ⚠  Hará UNA sola llamada real a The Odds API (~2 créditos):`);
    console.log(`     GET /v4/sports/${SPORT}/odds?regions=eu&markets=h2h,totals`);
    console.log('');
    console.log(`  Matcheará estos ${necesitan.length} evento(s) en la respuesta:`);
    for (const p of necesitan) {
      console.log(`    ${p.matchId}  ${p.local} vs ${p.visitante}  [${p.fechaPartido ?? '?'}]`);
    }
    console.log('');
    console.log(`  Guardará hasta ${necesitan.length} documento(s) en odds_snapshots/{matchId}_{ts}.`);
    console.log('  Actualizará predicciones/{matchId}.ultimo_odds_snapshot_id.');
    console.log('  Mostrará créditos restantes de The Odds API.');
    console.log('');
    console.log('  Una vez guardados los snapshots, calcula señales con:');
    const fechas = [...new Set(necesitan.filter(p => p.fechaPartido).map(p => p.fechaPartido))].sort();
    for (const f of fechas) {
      console.log(`    node scripts/actualizarSenalesConOdds.js ${f} --write`);
    }
    if (fechas.length === 0) {
      console.log('    node scripts/actualizarSenalesConOdds.js YYYY-MM-DD --write');
    }
  }

  console.log('');
  console.log('  Comandos:');
  console.log('    node scripts/guardarOddsPorMatchIds.js --write');
  if (yaConSnapshot.length > 0) {
    console.log('    node scripts/guardarOddsPorMatchIds.js --write --force  (sobreescribir todos)');
  }
  console.log('═'.repeat(76));
  process.exit(0);
}

// ── 6. Guard: necesita algo para escribir ────────────────────────────────────

if (necesitan.length === 0) {
  console.log('\n  Nada que capturar. Todos los matchIds ya tienen snapshot.');
  console.log('  Usa --force para sobreescribir.\n');
  process.exit(0);
}

// ── 7. Validar API key ────────────────────────────────────────────────────────

if (!API_KEY) {
  console.error('\n  ERROR: THE_ODDS_API_KEY no está definida en .env');
  process.exit(1);
}

// ── 8. UNA sola llamada a The Odds API ───────────────────────────────────────

console.log('\n  [2/3] UNA llamada a The Odds API...');
const url = `${BASE_URL}/v4/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
console.log(`  → GET ${url.replace(API_KEY, '***KEY***')}`);

const res = await fetch(url);

console.log('\n  Créditos The Odds API:');
for (const h of ['x-requests-remaining', 'x-requests-used', 'x-requests-last']) {
  console.log(`    ${h}: ${res.headers.get(h) ?? '(no presente)'}`);
}

if (!res.ok) {
  console.error(`\n  ERROR HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const eventos = await res.json();
console.log(`  Eventos en la respuesta: ${eventos.length}`);

// ── 9. Matchear, transformar y guardar ───────────────────────────────────────

console.log('\n  [3/3] Matcheando y guardando...');
console.log('  ' + '─'.repeat(74));

let nGuardados = 0, nSkipped = 0, nSinMatch = 0;
const noMatcheados = [];

for (const p of predDocs) {
  const titulo = `${p.local} vs ${p.visitante}`;

  if (!p.existe) {
    console.log(`\n  SKIP  ${p.matchId}  ${titulo}  (sin predicción en Firestore)`);
    nSkipped++;
    continue;
  }

  if (p.snapshotExistente && !FORCE) {
    console.log(`\n  SKIP  ${p.matchId}  ${titulo}  (snapshot ya existe)`);
    nSkipped++;
    continue;
  }

  console.log(`\n  ${p.matchId}  ${titulo}`);

  // Buscar evento en la respuesta API
  const evento = encontrarEvento(eventos, p.local, p.visitante);
  if (!evento) {
    console.log(`    ✗ No encontrado en la respuesta de The Odds API`);
    nSinMatch++;
    noMatcheados.push({ matchId: p.matchId, titulo });
    continue;
  }

  console.log(`    ✓ Match: "${evento.home_team}" vs "${evento.away_team}"  (${evento.bookmakers?.length ?? 0} bookmakers)`);

  // Transformar
  let snapshot;
  try {
    snapshot = transformarRespuestaOddsApi(eventos, Number(p.matchId), p.fechaPartido, {
      homeTeam:     p.local,
      awayTeam:     p.visitante,
      region:       'eu',
      tipoSnapshot: 'cierre',
    });
  } catch (err) {
    console.log(`    ✗ Error al transformar: ${err.message}`);
    nSinMatch++;
    noMatcheados.push({ matchId: p.matchId, titulo, error: err.message });
    continue;
  }

  // Guardar snapshot
  const { id: snapshotId } = await guardarOddsSnapshot(p.matchId, snapshot);
  console.log(`    → odds_snapshots/${snapshotId}`);

  const h2h    = snapshot.mercados?.h2h;
  const totals = snapshot.mercados?.totals;
  if (h2h)    console.log(`    h2h   : L=${h2h.odds_local}  X=${h2h.odds_empate}  V=${h2h.odds_visitante}  (n_bk=${h2h.n_bookmakers} overround=${h2h.overround_pct}%)`);
  if (totals) console.log(`    totals: línea=${totals.linea}  over=${totals.odds_over}  under=${totals.odds_under}  (n_bk=${totals.n_bookmakers})`);
  if (!totals) console.log('    totals: no disponible en la respuesta');

  // Actualizar prediccion con update() — no toca lambdas ni probabilidades
  try {
    await db.collection('predicciones').doc(String(p.matchId)).update({
      ultimo_odds_snapshot_id: snapshotId,
    });
    console.log(`    → predicciones/${p.matchId}.ultimo_odds_snapshot_id actualizado`);
  } catch (updErr) {
    console.log(`    ⚠  Error al actualizar predicción: ${updErr.message}`);
  }

  nGuardados++;
}

// ── 10. Resumen ───────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN');
console.log(`    Snapshots guardados : ${nGuardados}`);
console.log(`    Omitidos (SKIP)     : ${nSkipped}`);
console.log(`    Sin match en API    : ${nSinMatch}`);

if (noMatcheados.length > 0) {
  console.log('\n  No matcheados (verificar nombres de equipo):');
  for (const m of noMatcheados) {
    const e = m.error ? `  (${m.error})` : '';
    console.log(`    ${m.matchId}  ${m.titulo}${e}`);
  }
}

if (nGuardados > 0) {
  const fechas = [...new Set(
    necesitan
      .filter(p => p.fechaPartido && !noMatcheados.find(nm => nm.matchId === p.matchId))
      .map(p => p.fechaPartido)
  )].sort();

  if (fechas.length > 0) {
    console.log('\n  Para calcular señales de valor:');
    for (const f of fechas) {
      console.log(`    node scripts/actualizarSenalesConOdds.js ${f} --write`);
    }
  }
}

console.log('═'.repeat(76));

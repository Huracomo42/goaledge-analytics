/**
 * Predicción J2 con historial pre-Mundial — corrida completa (24 partidos).
 * Usa calcularAtaqueDefensa actualizado (K=5, caché xG, status.finished guard).
 * Sobrescribe las 24 predicciones en Firestore vía setDoc.
 *
 * Flags de re-corrida: equipos cuyo J1 no había finalizado al momento de esta corrida
 * (14-jun-2026). Una vez completados esos J1, re-correr para incorporar ese xG.
 */

import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';
import { predecirPartidoCompleto } from '../src/core/prediction/predecirPartidoCompleto.js';
import { guardarPrediccion }        from '../src/firebase/predicciones.js';

// Equipos cuyo J1 estaba incompleto o no jugado el 14-jun-2026
const EQUIPOS_J1_PENDIENTE = new Set([
  'Japan',              // J1 hoy, no_iniciado al momento del dry-run
  'Cape Verde Islands', // J1 el 15-jun
  'Iran',               // J1 el 16-jun
  'New Zealand',        // J1 el 16-jun
  'Iraq',               // J1 el 16-jun
  'Jordan',             // J1 el 17-jun
  'Ghana',              // J1 el 17-jun
  'Uzbekistan',         // J1 el 18-jun
  'Germany',            // J1 en curso (entretiempo) al 14-jun
  'Curaçao',            // J1 en curso (entretiempo) al 14-jun
]);

const delay = ms => new Promise(r => setTimeout(r, ms));

const fixtures = await obtenerPartidosMundial();
const j2 = fixtures
  .filter(p => p.matchday === 2 && (p.status === 'TIMED' || p.status === 'SCHEDULED'))
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`\n${'═'.repeat(70)}`);
console.log(`  Predicciones J2 con historial → Firestore  (${j2.length} partidos)`);
console.log(`${'═'.repeat(70)}\n`);

if (j2.length === 0) {
  console.error('ERROR: 0 partidos J2 en estado TIMED/SCHEDULED. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const SEP = '─'.repeat(70);

let ok = 0, errores = 0;
const resumen = []; // para la tabla final

for (const p of j2) {
  const local = p.homeTeam?.name ?? '?';
  const visit = p.awayTeam?.name ?? '?';
  const fecha = p.utcDate?.slice(0, 10);
  const grupo = p.group ?? p.stage ?? '?';

  const flagRerun = EQUIPOS_J1_PENDIENTE.has(local) || EQUIPOS_J1_PENDIENTE.has(visit);

  process.stdout.write(`[${fecha}] ${grupo}  ${local} vs ${visit}\n  → calculando... `);

  try {
    const prediccion = await predecirPartidoCompleto(p.id);

    process.stdout.write('guardando en Firestore... ');
    const guardado = await guardarPrediccion(p.id, prediccion);
    process.stdout.write('✓\n');

    const nL = guardado.muestra_local?.n_partidos ?? 0;
    const nV = guardado.muestra_visitante?.n_partidos ?? 0;
    const fL = (guardado.muestra_local?.fuente ?? '').replace('fotmob_mundial_2026+historial','wc+hist').replace('fotmob_mundial_2026','wc').replace('default_mu_liga','default');
    const fV = (guardado.muestra_visitante?.fuente ?? '').replace('fotmob_mundial_2026+historial','wc+hist').replace('fotmob_mundial_2026','wc').replace('default_mu_liga','default');

    console.log(`  λ     : ${guardado.lambda_local?.toFixed(3)} — ${guardado.lambda_visitante?.toFixed(3)}`);
    console.log(`  1X2   : L ${pct(guardado.prob_1x2?.local)}  X ${pct(guardado.prob_1x2?.empate)}  V ${pct(guardado.prob_1x2?.visitante)}`);
    console.log(`  Local : n=${nL} (${fL})   Visit: n=${nV} (${fV})${flagRerun ? '  ⚑ RE-CORRER' : ''}`);
    console.log(`\n${SEP}\n`);

    resumen.push({ fecha, grupo, local, visit, nL, fL, nV, fV, rerun: flagRerun, matchId: p.id });
    ok++;
  } catch (err) {
    process.stdout.write('✗\n');
    console.error(`  ERROR: ${err.message}\n`);
    resumen.push({ fecha, grupo, local, visit, nL: '?', fL: 'error', nV: '?', fV: 'error', rerun: flagRerun, matchId: p.id });
    errores++;
  }
}

// ── Tabla resumen ─────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(80)}`);
console.log('TABLA RESUMEN J2 — n_partidos por equipo');
console.log(`${'═'.repeat(80)}`);
console.log(
  'Fecha'.padEnd(12) +
  'Grp'.padEnd(9) +
  'Local'.padEnd(22) +
  'nL'.padStart(3) +
  '  ' +
  'Visitante'.padEnd(22) +
  'nV'.padStart(3) +
  '  ' +
  'Re-correr?'
);
console.log('─'.repeat(80));

for (const r of resumen) {
  const flag = r.rerun ? '⚑ sí' : '';
  console.log(
    r.fecha.padEnd(12) +
    (r.grupo ?? '?').padEnd(9) +
    r.local.padEnd(22) +
    String(r.nL).padStart(3) +
    '  ' +
    r.visit.padEnd(22) +
    String(r.nV).padStart(3) +
    '  ' +
    flag
  );
}

// ── Equipos que necesitan re-corrida ─────────────────────────────────────────

const necesitanRerun = resumen.filter(r => r.rerun);
console.log(`\n${'═'.repeat(80)}`);
console.log(`PARTIDOS QUE CONVIENE RE-CORRER (${necesitanRerun.length} de ${resumen.length})`);
console.log('(al menos un equipo con J1 incompleto al momento de esta corrida)');
console.log('─'.repeat(80));
for (const r of necesitanRerun) {
  const flagL = EQUIPOS_J1_PENDIENTE.has(r.local) ? ' ⚑' : '';
  const flagV = EQUIPOS_J1_PENDIENTE.has(r.visit) ? ' ⚑' : '';
  console.log(`  [${r.fecha}] ${r.grupo}  ${r.local}${flagL} (n=${r.nL}) vs ${r.visit}${flagV} (n=${r.nV})`);
}

console.log(`\nCompletado: ${ok} guardados  |  ${errores} errores\n`);
process.exit(0);

import '../src/firebase/init.js';
import { getFirestore } from 'firebase-admin/firestore';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';
import { MU_LIGA } from '../src/core/prediction/poisson.js';

const db = getFirestore();

const fixtures = await obtenerPartidosMundial();
const j2 = fixtures
  .filter(p => p.matchday === 2 && (p.status === 'TIMED' || p.status === 'SCHEDULED'))
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

const filas = [];
for (const p of j2) {
  const snap = await db.collection('predicciones').doc(String(p.id)).get();
  if (!snap.exists) {
    filas.push({ local: p.homeTeam.name, visit: p.awayTeam.name, missing: true });
    continue;
  }
  const d = snap.data();
  filas.push({
    local: p.homeTeam.name,
    visit: p.awayTeam.name,
    nL: d.muestra_local?.n_partidos ?? '?',
    nV: d.muestra_visitante?.n_partidos ?? '?',
    fL: d.muestra_local?.fuente ?? '?',
    fV: d.muestra_visitante?.fuente ?? '?',
    lL: d.lambda_local,
    lV: d.lambda_visitante,
  });
}

console.log(`MU_LIGA = ${MU_LIGA}\n`);

// CHECK 1: n=0 → fuente debe ser default_mu_liga
console.log('CHECK 1 — Equipos n=0 (fuente debe ser default_mu_liga):');
console.log('─'.repeat(65));
const n0filas = filas.filter(f => !f.missing && (f.nL === 0 || f.nV === 0));
for (const f of n0filas) {
  if (f.nL === 0) {
    const ok = f.fL === 'default_mu_liga';
    console.log(`  ${f.local.padEnd(24)} n=0  fuente=${f.fL.padEnd(20)}  ${ok ? '✓' : '✗ ERROR'}`);
  }
  if (f.nV === 0) {
    const ok = f.fV === 'default_mu_liga';
    console.log(`  ${f.visit.padEnd(24)} n=0  fuente=${f.fV.padEnd(20)}  ${ok ? '✓' : '✗ ERROR'}`);
  }
}

// CHECK 2: lambdas — número > 0, finito, sin NaN
console.log('\nCHECK 2 — Validez de lambdas:');
console.log('─'.repeat(65));
let lambdaOk = true;
for (const f of filas) {
  if (f.missing) {
    console.log(`  ✗ ${f.local} vs ${f.visit}: DOCUMENTO AUSENTE`);
    lambdaOk = false;
    continue;
  }
  const lLok = typeof f.lL === 'number' && !isNaN(f.lL) && f.lL > 0 && isFinite(f.lL);
  const lVok = typeof f.lV === 'number' && !isNaN(f.lV) && f.lV > 0 && isFinite(f.lV);
  if (!lLok || !lVok) {
    console.log(`  ✗ ${f.local} vs ${f.visit}: λL=${f.lL} λV=${f.lV}`);
    lambdaOk = false;
  }
}
if (lambdaOk) console.log('  ✓ 48 lambdas — todos positivos, finitos, sin NaN.');

// Tabla visual completa
console.log('\nLambdas completos (referencia visual):');
console.log(`${'Local'.padEnd(22)} ${'Visit'.padEnd(22)} ${'nL'.padStart(2)} ${'nV'.padStart(2)}   λL       λV`);
console.log('─'.repeat(72));
for (const f of filas) {
  if (f.missing) { console.log(`✗ ${f.local} vs ${f.visit} — AUSENTE`); continue; }
  const flag = (f.nL === 0 || f.nV === 0) ? '  ←n=0' : '';
  console.log(
    f.local.padEnd(22) + ' ' + f.visit.padEnd(22) + ' ' +
    String(f.nL).padStart(2) + ' ' + String(f.nV).padStart(2) + '  ' +
    f.lL.toFixed(3).padEnd(9) + f.lV.toFixed(3) + flag
  );
}

process.exit(0);

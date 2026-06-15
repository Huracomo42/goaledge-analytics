/**
 * validarRankingsVsFixture.js — Audita cobertura de data/rankings.json contra el fixture real.
 *
 * Comprueba que cada equipo del fixture tenga un ranking numérico válido.
 * Sin Firestore, sin APIs de FotMob, sin escrituras.
 *
 * Ejecutar: node scripts/validarRankingsVsFixture.js
 */

import { readFileSync, existsSync } from 'fs';
import { resolve }                  from 'path';
import { obtenerPartidosMundial }   from '../src/data/pipeline/footballData.js';

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function check(desc, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${desc}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${desc}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`);
  if (!ok) errores++;
}
function checkVerdadero(desc, valor) {
  console.log(Boolean(valor) ? `${OK}  ${desc}` : `${FAIL}  ${desc}`);
  if (!valor) errores++;
}

// ── Leer rankings ─────────────────────────────────────────────────────────────

const RANKINGS_PATH = resolve('data/rankings.json');
checkVerdadero('data/rankings.json existe', existsSync(RANKINGS_PATH));

const rankings = JSON.parse(readFileSync(RANKINGS_PATH, 'utf-8'));
check('_rankings_fuente = "manual"', rankings._rankings_fuente, 'manual');

const equiposRanking = Object.entries(rankings)
  .filter(([k]) => !k.startsWith('_'))
  .map(([nombre, rank]) => ({ nombre, rank }));

console.log(`\n  Total entradas (teams + aliases): ${equiposRanking.length}`);

// Contar únicos por valor de ranking
const rankingNums = [...new Set(equiposRanking.map(e => e.rank))].sort((a,b)=>a-b);
console.log(`  Rankings únicos cubiertos: ${rankingNums.length} (del 1 al ${rankingNums.at(-1)})`);
checkVerdadero('todos los rankings son numéricos', equiposRanking.every(e => typeof e.rank === 'number'));

// ── Leer fixture real ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  Cargando fixture del Mundial 2026...');
console.log('═'.repeat(68));

const fixtures = await obtenerPartidosMundial();
const nombresFixture = new Set();
for (const p of fixtures) {
  if (p.homeTeam?.name) nombresFixture.add(p.homeTeam.name);
  if (p.awayTeam?.name) nombresFixture.add(p.awayTeam.name);
}
const equiposFixture = [...nombresFixture].sort();
console.log(`  Equipos únicos en fixture: ${equiposFixture.length}`);

// ── Validar cobertura ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  Cobertura: ¿cada equipo del fixture tiene ranking?');
console.log('═'.repeat(68));

const sinRanking = [];
const conRanking = [];

for (const nombre of equiposFixture) {
  const rank = rankings[nombre];
  if (typeof rank === 'number') {
    conRanking.push({ nombre, rank });
    console.log(`${OK}  ${nombre.padEnd(28)} → #${rank}`);
  } else {
    sinRanking.push(nombre);
    console.log(`${FAIL}  ${nombre.padEnd(28)} → SIN RANKING`);
    errores++;
  }
}

console.log(`\n  Con ranking   : ${conRanking.length}/${equiposFixture.length}`);
console.log(`  Sin ranking   : ${sinRanking.length}`);
if (sinRanking.length > 0) {
  console.log(`  → Faltantes   : ${sinRanking.join(', ')}`);
}

// ── Verificar aliases ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  Aliases definidos (nombres alternativos)');
console.log('═'.repeat(68));

const rankPorValor = {};
for (const [k, v] of Object.entries(rankings)) {
  if (k.startsWith('_')) continue;
  if (!rankPorValor[v]) rankPorValor[v] = [];
  rankPorValor[v].push(k);
}
const aliases = Object.entries(rankPorValor)
  .filter(([, nombres]) => nombres.length > 1)
  .sort(([a],[b]) => Number(a)-Number(b));

if (aliases.length === 0) {
  console.log('  (ningún alias definido)');
} else {
  for (const [rank, nombres] of aliases) {
    console.log(`  #${String(rank).padEnd(4)} ${nombres.join(' / ')}`);
  }
}

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log(`  RESULTADO: cobertura completa — ${conRanking.length}/${equiposFixture.length} equipos con ranking.`);
  console.log(`  rankings_fuente = "${rankings._rankings_fuente}" → ajuste por ranking activo sin bandera.`);
} else {
  console.log(`  RESULTADO: ${errores} problema(s) — revisar antes de correr predicciones.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

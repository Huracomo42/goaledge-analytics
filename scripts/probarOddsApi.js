/**
 * Test de transformarRespuestaOddsApi + integración con evaluateBet.
 * Sin llamadas HTTP reales ni Firestore.
 */

import { readFileSync } from 'fs';
import { resolve }      from 'path';
import { transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';
import { evaluateBet }                 from '../src/core/betting/bettingMath.js';

const ejemplo = JSON.parse(
  readFileSync(resolve('data/ejemplos/odds_api_ejemplo.json'), 'utf-8')
);

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1: transformación
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  PASO 1 — Transformación de respuesta The Odds API → odds_snapshots');
console.log('═'.repeat(65));

// Probamos con matchId del fixture FD de México vs Corea del Sur (J2)
// (del fixture real ya cargado anteriormente)
const MATCH_ID_FD = 4772415; // placeholder — el ID real lo asigna football-data.org

let snap;
try {
  snap = transformarRespuestaOddsApi(
    ejemplo,
    MATCH_ID_FD,
    '2026-06-19',
    { homeTeam: 'Mexico', awayTeam: 'South Korea', region: 'eu', tipoSnapshot: 'pre_partido' }
  );
} catch (e) {
  console.error('ERROR en transformación:', e.message);
  process.exit(1);
}

console.log('\nods_snapshots generado:');
console.log(JSON.stringify(snap, null, 2));

// Verificación de campos clave
console.log('\n── Verificaciones de estructura ──');
const checks = [
  ['matchId',                 snap.matchId === MATCH_ID_FD],
  ['fecha_partido',           snap.fecha_partido === '2026-06-19'],
  ['capturado_en es ISO',     /^\d{4}-\d{2}-\d{2}T/.test(snap.capturado_en)],
  ['fuente_api',              snap.fuente_api === 'the-odds-api-v4'],
  ['h2h presente',            snap.mercados?.h2h != null],
  ['totals presente',         snap.mercados?.totals != null],
  ['h2h.n_bookmakers = 5',    snap.mercados.h2h.n_bookmakers === 5],
  ['totals.linea = 2.5',      snap.mercados.totals.linea === 2.5],
  ['totals.n_bookmakers = 5', snap.mercados.totals.n_bookmakers === 5],
];
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}

// Verificación de medianas esperadas (calculadas a mano):
//
// h2h LOCAL: [2.08, 2.10, 2.12, 2.15, 2.20] → mediana = 2.12
// h2h DRAW:  [3.20, 3.25, 3.30, 3.35, 3.40] → mediana = 3.30
// h2h VISIT: [3.45, 3.50, 3.55, 3.60, 3.65] → mediana = 3.55
// overround h2h: 1/2.12 + 1/3.30 + 1/3.55 = 0.4717+0.3030+0.2817 = 1.0564 → 5.64%
//
// totals OVER:  [1.90, 1.93, 1.95, 1.95, 1.97] → mediana = 1.95
// totals UNDER: [1.88, 1.90, 1.90, 1.92, 1.95] → mediana = 1.90
// overround totals: 1/1.95 + 1/1.90 = 0.5128+0.5263 = 1.0391 → 3.91%

const h   = snap.mercados.h2h;
const tot = snap.mercados.totals;
console.log('\n── Medianas (verificadas contra cálculo manual) ──');
const mv = [
  ['h2h.odds_local    = 2.12', h.odds_local,       2.12],
  ['h2h.odds_empate   = 3.30', h.odds_empate,      3.30],
  ['h2h.odds_visitante= 3.55', h.odds_visitante,   3.55],
  ['h2h.overround_pct = 5.64', h.overround_pct,    5.64],
  ['tot.odds_over     = 1.95', tot.odds_over,       1.95],
  ['tot.odds_under    = 1.90', tot.odds_under,      1.90],
  ['tot.overround_pct = 3.91', tot.overround_pct,  3.91],
];
for (const [label, got, expected] of mv) {
  const ok = Math.abs(got - expected) < 0.005;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(30)} → obtenido: ${got}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2: integración con evaluateBet
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  PASO 2 — evaluateBet con probs Poisson reales + odds de ejemplo');
console.log('  Partido: México vs South Korea (predicción J2 de Firestore)');
console.log('  Probs Poisson: Local=47.0%  Empate=37.6%  Visitante=15.5%');
console.log('═'.repeat(65));

const probsModelo = { local: 0.470, empate: 0.376, visitante: 0.155 };
const oddsH2h = [h.odds_local, h.odds_empate, h.odds_visitante];

const fmt = n => (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
const fmtN = n => n.toFixed(4);

function printEval(label, resultado) {
  const ev    = resultado.expected_value;
  const edgev = resultado.edge;
  console.log(`\n  ${label}`);
  console.log(`  ${'─'.repeat(55)}`);
  console.log(`  model_prob        : ${(resultado.model_probability*100).toFixed(1)}%`);
  console.log(`  bookmaker_odds    : ${resultado.bookmaker_odds}`);
  console.log(`  implied_prob      : ${(resultado.implied_probability*100).toFixed(2)}%`);
  console.log(`  no_vig_prob       : ${(resultado.no_vig_probability*100).toFixed(2)}%`);
  console.log(`  fair_odds         : ${resultado.fair_odds.toFixed(4)}`);
  console.log(`  edge              : ${fmt(edgev)}`);
  console.log(`  expected_value    : ${fmtN(ev)}  (${ev > 0 ? 'EV+' : 'EV-'})`);
  console.log(`  is_value_bet      : ${resultado.is_value_bet}`);
}

printEval(
  `LOCAL (México) — odds=${h.odds_local}`,
  evaluateBet(probsModelo.local, h.odds_local, oddsH2h)
);

printEval(
  `EMPATE — odds=${h.odds_empate}`,
  evaluateBet(probsModelo.empate, h.odds_empate, oddsH2h)
);

printEval(
  `VISITANTE (South Korea) — odds=${h.odds_visitante}`,
  evaluateBet(probsModelo.visitante, h.odds_visitante, oddsH2h)
);

// Totals: Over 2.5
// Prob Poisson de over 2.5 ≈ 1 - P(0 goles) - P(1 gol) - P(2 goles)
// λ_local=0.917, λ_visitante=0.397, λ_total=1.314
// P(X≤2) con Poisson(1.314) = e^-1.314*(1 + 1.314 + 1.314²/2) = 0.2686*(1+1.314+0.863) = 0.2686*3.177 = 0.8533
// P(over 2.5) ≈ 1 - 0.8533 = 0.1467 — bajo (partido de baja intensidad goleadora)
// Nota: esto es una aproximación de goles totales con Poisson independiente;
//       el modelo real usa la distribución conjunta (ya calculada en Poisson)
const probOver25 = 0.147; // aproximación para el ejemplo

const oddsTotal = [tot.odds_over, tot.odds_under];
printEval(
  `OVER 2.5 — odds=${tot.odds_over}  (prob modelo ≈ ${(probOver25*100).toFixed(1)}%, aprox)`,
  evaluateBet(probOver25, tot.odds_over, oddsTotal)
);

console.log(`\n  [NOTA] La prob de Over 2.5 (${(probOver25*100).toFixed(1)}%) es una aproximación`);
console.log('  con Poisson marginal (λ_total=1.314). El modelo real la extrae de');
console.log('  prob_over_under que ya calcula predecirPartido() con la dist. conjunta.\n');

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3: test de robustez (nombres alternativos)
// ─────────────────────────────────────────────────────────────────────────────

console.log('═'.repeat(65));
console.log('  PASO 3 — Robustez: matching de nombres alternativos');
console.log('═'.repeat(65));

const nombres = [
  { h: 'México',    a: 'Korea',         label: 'México (tilde) / Korea (parcial)' },
  { h: 'MEXICO',    a: 'south korea',   label: 'MEXICO (mayúsculas) / south korea (minúsc.)' },
  { h: 'Mexico',    a: 'South Korea',   label: 'Mexico / South Korea (exacto)' },
];
for (const { h: ht, a: at, label } of nombres) {
  try {
    const s = transformarRespuestaOddsApi(ejemplo, 0, '2026-06-19', { homeTeam: ht, awayTeam: at });
    console.log(`  ✓ "${label}" → odds_local=${s.mercados.h2h.odds_local}`);
  } catch (e) {
    console.log(`  ✗ "${label}" → ERROR: ${e.message}`);
  }
}

// Error esperado: equipo no encontrado
try {
  transformarRespuestaOddsApi(ejemplo, 0, '2026-06-19', { homeTeam: 'Brazil', awayTeam: 'France' });
  console.log('  ✗ Brazil/France: debería haber lanzado error');
} catch (e) {
  console.log(`  ✓ Equipo no encontrado lanza error: ${e.message}`);
}

console.log('');

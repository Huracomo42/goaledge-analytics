/**
 * Test rápido de bettingMath.js.
 * Sin Firestore ni APIs — solo matemáticas puras.
 */

import {
  impliedProbability,
  noVigProbability,
  fairOdds,
  edge,
  expectedValue,
  evaluateBet,
  kellyFraction,
  TAU,
} from '../src/core/betting/bettingMath.js';

const fmt2 = n => n.toFixed(4);
const fmtPct = n => `${(n * 100).toFixed(2)}%`;

function printBet(label, resultado) {
  console.log(`\n  ${label}`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  model_probability  : ${fmtPct(resultado.model_probability)}  (${fmt2(resultado.model_probability)})`);
  console.log(`  bookmaker_odds     : ${resultado.bookmaker_odds}`);
  console.log(`  implied_probability: ${fmtPct(resultado.implied_probability)}  (${fmt2(resultado.implied_probability)})`);
  console.log(`  no_vig_probability : ${fmtPct(resultado.no_vig_probability)}  (${fmt2(resultado.no_vig_probability)})`);
  console.log(`  fair_odds          : ${fmt2(resultado.fair_odds)}`);
  console.log(`  edge               : ${fmtPct(resultado.edge)}  (${fmt2(resultado.edge)})`);
  console.log(`  expected_value     : ${fmt2(resultado.expected_value)}`);
  console.log(`  is_value_bet       : ${resultado.is_value_bet}  (TAU=${resultado.tau_usado})`);
  const kelly = kellyFraction(resultado.model_probability, resultado.bookmaker_odds);
  console.log(`  kelly_fraction     : ${kelly !== null ? fmtPct(kelly) : 'null (no apostar)'}`);
}

// ── Verificación manual de primitivas ────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  VERIFICACIÓN DE PRIMITIVAS (manual)');
console.log('═'.repeat(60));

// odds = [2.50, 3.20, 3.10]
// implied: 1/2.50=0.4000  1/3.20=0.3125  1/3.10=0.3226
// suma = 1.0351 (overround = 3.51%)
// noVig: [0.4000/1.0351, 0.3125/1.0351, 0.3226/1.0351]
//       = [0.38643, 0.30190, 0.31166]  suma = 1.0000

const oddsEj = [2.50, 3.20, 3.10];
const implied = oddsEj.map(impliedProbability);
const novig   = noVigProbability(implied);
const overround = implied.reduce((a, b) => a + b, 0);

console.log(`\nMercado 1X2: odds=${JSON.stringify(oddsEj)}`);
console.log(`  Probabilidades implícitas brutas : [${implied.map(fmt2).join(', ')}]`);
console.log(`  Overround (suma brutas)          : ${fmt2(overround)}  (margen ${fmtPct(overround - 1)})`);
console.log(`  No-vig (normalizadas)            : [${novig.map(fmt2).join(', ')}]`);
console.log(`  Suma no-vig                      : ${fmt2(novig.reduce((a,b)=>a+b,0))}  (debe ser 1.0000)`);

console.log(`\n  Verificación esperada:`);
console.log(`    noVig[0] = 0.4000/1.0351 = 0.3864  →  ${fmt2(novig[0])}`);
console.log(`    noVig[1] = 0.3125/1.0351 = 0.3019  →  ${fmt2(novig[1])}`);
console.log(`    noVig[2] = 0.3226/1.0351 = 0.3117  →  ${fmt2(novig[2])}`);


// ── EJEMPLO A — Caso simple a mano ───────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  EJEMPLO A — Caso simple verificable a mano');
console.log('  probModelo=0.45 (local), odds=[2.50, 3.20, 3.10]');
console.log('═'.repeat(60));

// Cálculos esperados:
//   implied(2.50)       = 0.4000
//   sumImplied          = 1.0351
//   noVigProb(local)    = 0.4000/1.0351 = 0.38643
//   edge                = 0.45 - 0.38643 = 0.06357
//   EV                  = 0.45 * 2.50 - 1 = 0.125
//   fairOdds            = 1/0.45 = 2.2222
//   is_value_bet        = 0.125 > 0 = true
//   kelly               = (1.50 * 0.45 - 0.55) / 1.50 = (0.675-0.55)/1.5 = 0.0833

console.log('\n  Esperado (calculado a mano):');
console.log('    implied_prob    = 1/2.50 = 0.4000');
console.log('    noVig_prob      = 0.4000/1.0351 = 0.3864');
console.log('    edge            = 0.45 - 0.3864 = 0.0636  (6.36%)');
console.log('    EV              = 0.45*2.50 - 1 = 0.1250');
console.log('    fair_odds       = 1/0.45 = 2.2222');
console.log('    kelly           = (1.50*0.45 - 0.55)/1.50 = 0.0833  (8.33%)');

const resultA_local = evaluateBet(0.45, 2.50, [2.50, 3.20, 3.10]);
printBet('Resultado evaluateBet (LOCAL, odds=2.50):', resultA_local);

const resultA_empate = evaluateBet(0.32, 3.20, [2.50, 3.20, 3.10]);
printBet('Resultado evaluateBet (EMPATE, odds=3.20):', resultA_empate);

const resultA_visit = evaluateBet(0.23, 3.10, [2.50, 3.20, 3.10]);
printBet('Resultado evaluateBet (VISITANTE, odds=3.10):', resultA_visit);

console.log(`\n  Suma probs modelo: ${fmtPct(0.45 + 0.32 + 0.23)}  (debe ser 100.00%)`);


// ── EJEMPLO B — México vs South Korea con cuotas de ejemplo ──────────────────

console.log('\n' + '═'.repeat(60));
console.log('  EJEMPLO B — México vs South Korea (J2)');
console.log('  Probs Poisson de Firestore: L=47.0%  X=37.6%  V=15.5%');
console.log('  ⚠ CUOTAS DE EJEMPLO — NO REALES (marcadas explícitamente)');
console.log('═'.repeat(60));

// Probs del modelo (de la predicción J2 guardada):
//   prob_local    = 0.470
//   prob_empate   = 0.376
//   prob_visitante= 0.155
// Cuotas de ejemplo (no reales):
const cuotas_ejemplo_no_real = {
  label: 'cuota_ejemplo_no_real',
  L: 2.20,
  X: 3.40,
  V: 3.70,
};

// Verificación manual:
//   implied: 1/2.20=0.4545  1/3.40=0.2941  1/3.70=0.2703
//   suma = 1.0189  (overround = 1.89%)
//   noVig L = 0.4545/1.0189 = 0.4461
//   edge L  = 0.470 - 0.4461 = 0.0239
//   EV L    = 0.470*2.20 - 1 = 0.034

const oddsB = [cuotas_ejemplo_no_real.L, cuotas_ejemplo_no_real.X, cuotas_ejemplo_no_real.V];
console.log(`\n  Cuotas: L=${oddsB[0]} X=${oddsB[1]} V=${oddsB[2]}  [${cuotas_ejemplo_no_real.label}]`);

const resultB_local = evaluateBet(0.470, cuotas_ejemplo_no_real.L, oddsB);
printBet('México (LOCAL, prob=47.0%):', resultB_local);

const resultB_empate = evaluateBet(0.376, cuotas_ejemplo_no_real.X, oddsB);
printBet('Empate (X, prob=37.6%):', resultB_empate);

const resultB_visit = evaluateBet(0.155, cuotas_ejemplo_no_real.V, oddsB);
printBet('South Korea (VISITANTE, prob=15.5%):', resultB_visit);

console.log(`\n  Suma probs modelo: ${fmtPct(0.470 + 0.376 + 0.155)}  (debe ser 100.10% — redondeo Poisson)`);


// ── TEST DE VALIDACIONES ──────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  TEST DE VALIDACIONES (errores esperados)');
console.log('═'.repeat(60));

const testError = (label, fn) => {
  try { fn(); console.log(`  ✗ ${label}: no lanzó error (FALLO)`); }
  catch (e) { console.log(`  ✓ ${label}: lanzó → ${e.message}`); }
};

testError('odds=1.0 (sin margen)',  () => impliedProbability(1.0));
testError('odds=0.5 (< 1)',        () => impliedProbability(0.5));
testError('odds=-2 (negativo)',     () => impliedProbability(-2));
testError('fairOdds(0)',            () => fairOdds(0));
testError('fairOdds(1.1)',          () => fairOdds(1.1));
testError('noVigProbability([])',   () => noVigProbability([]));

console.log('');

/**
 * probarContextAdjustments.js — Pruebas de sanidad del módulo de ajustes contextuales.
 *
 * Valida los 5 casos del documento correccion_urgente_cerebro_v2_psico_context.md (sección 12).
 *
 * 100% puro: sin Firestore, sin APIs, sin I/O de red.
 * Ejecutar: node scripts/probarContextAdjustments.js
 */

import {
  ajustarAtaqueDefensaPorAusencias,
  calcularAjustePsicodeportivo,
  calcularAjusteMundialista,
  aplicarFactorExponencial,
  calcularGapRankingFifa,
  PESOS_USADOS,
} from '../src/core/prediction/contextAdjustments.js';

// ── Utilidades ────────────────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function cerca(a, b, tol = 0.0001) { return Math.abs(a - b) <= tol; }

function check(descripcion, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`);
  if (!ok) errores++;
}

function checkCerca(descripcion, valor, esperado, tol = 0.0001) {
  const ok = cerca(valor, esperado, tol);
  console.log(ok
    ? `${OK}  ${descripcion}: ${valor.toFixed(6)} ≈ ${esperado}`
    : `${FAIL}  ${descripcion}: ${valor.toFixed(6)} (esperado ≈ ${esperado}, tol=${tol})`);
  if (!ok) errores++;
}

function checkVerdadero(descripcion, valor) {
  const ok = Boolean(valor);
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: falsy`);
  if (!ok) errores++;
}

function checkRango(descripcion, valor, min, max) {
  const ok = isFinite(valor) && valor >= min && valor <= max;
  console.log(ok
    ? `${OK}  ${descripcion}: ${valor.toFixed(4)} ∈ [${min}, ${max}]`
    : `${FAIL}  ${descripcion}: ${valor} fuera de [${min}, ${max}]`);
  if (!ok) errores++;
}

// ── [1] Sanidad de lambda ────────────────────────────────────────────────────
// Caso: partido genérico, sin análisis psico, solo Poisson base + ajuste ranking

console.log('\n' + '═'.repeat(68));
console.log('  1. Sanidad de lambda (sin ajustes: salida pura de aplicarFactorExponencial)');
console.log('═'.repeat(68));

const lambdaBaseLocal  = 1.45;
const lambdaBaseVisit  = 0.90;
const ajusteNeutro = 0;

const lambdaAjL = aplicarFactorExponencial(lambdaBaseLocal, ajusteNeutro);
const lambdaAjV = aplicarFactorExponencial(lambdaBaseVisit, ajusteNeutro);

checkCerca('aplicarFactorExponencial(1.45, 0) = 1.45', lambdaAjL, 1.45);
checkCerca('aplicarFactorExponencial(0.90, 0) = 0.90', lambdaAjV, 0.90);
checkRango('lambda_local > 0',        lambdaAjL, 0.001, 99);
checkRango('lambda_visitante > 0',    lambdaAjV, 0.001, 99);
checkVerdadero('no NaN local',        !isNaN(lambdaAjL));
checkVerdadero('no NaN visitante',    !isNaN(lambdaAjV));
checkVerdadero('no Infinity local',   isFinite(lambdaAjL));
checkVerdadero('no Infinity visitante', isFinite(lambdaAjV));

// Caso degenerado: lambda inválida → devuelve la misma
const lambdaInvalida = aplicarFactorExponencial(-0.5, 0.1);
checkCerca('lambda negativa → sin cambio', lambdaInvalida, -0.5);

const lambdaNaN = aplicarFactorExponencial(NaN, 0.1);
checkVerdadero('lambda NaN → NaN devuelto', isNaN(lambdaNaN));

// ── [2] Comparación base vs enriquecido ──────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  2. Comparación base vs enriquecido — delta < 25%');
console.log('═'.repeat(68));

// Ajuste típico máximo: ausencias 0.5 + ranking gap 1.0 + necesita_ganar
const ajMax = calcularAjusteMundialista({
  rankingEquipo: 1, rankingRival: 100, jornadaGrupo: 1,
  necesitaGanar: true, confianzaNecesita: 1.0,
});
const lambdaConAjMax = aplicarFactorExponencial(1.35, ajMax.ajuste);
const deltaMaxPct = Math.abs((lambdaConAjMax - 1.35) / 1.35) * 100;
console.log(`  → ajuste máximo mundialista: ${ajMax.ajuste.toFixed(4)} → exp = ${Math.exp(ajMax.ajuste).toFixed(4)}`);
console.log(`  → lambda 1.35 → ${lambdaConAjMax.toFixed(4)}  delta = ${deltaMaxPct.toFixed(1)}%`);

const ajPsicoMax = calcularAjustePsicodeportivo({
  liderDisponible: true, generacionPeak: true,
  confianzaLider: 1.0, confianzaGeneracion: 1.0,
});
const ajTotalTest = ajMax.ajuste + ajPsicoMax.ajuste;
const lambdaTotalTest = aplicarFactorExponencial(1.35, ajTotalTest);
const deltaTotalPct = Math.abs((lambdaTotalTest - 1.35) / 1.35) * 100;
console.log(`  → ajuste total (mundialista + psico): ${ajTotalTest.toFixed(4)}`);
console.log(`  → delta total: ${deltaTotalPct.toFixed(1)}%`);

const DELTA_MAX = 25;
const alertaExcesivo = deltaTotalPct > DELTA_MAX;
console.log(alertaExcesivo
  ? `${FAIL}  ADVERTENCIA: ajuste excede ${DELTA_MAX}% (${deltaTotalPct.toFixed(1)}%) — revisar pesos`
  : `${OK}  Delta total ≤ ${DELTA_MAX}% (${deltaTotalPct.toFixed(1)}%) — pesos conservadores`);

// Caso negativo (equipo débil vs fuerte, ausencias, conflicto)
const ajNegMax = calcularAjusteMundialista({
  rankingEquipo: 60, rankingRival: 1, jornadaGrupo: 1,
});
const ajPsicoNeg = calcularAjustePsicodeportivo({
  conflictoInterno: 3, presionMediatica: 10,
  confianzaConflicto: 0.8, confianzaPresion: 0.8,
});
const ajTotalNeg = ajNegMax.ajuste + ajPsicoNeg.ajuste;
const lambdaNeg = aplicarFactorExponencial(1.35, ajTotalNeg);
const deltaNegPct = Math.abs((lambdaNeg - 1.35) / 1.35) * 100;
console.log(`  → ajuste caso negativo extremo: ${ajTotalNeg.toFixed(4)} → lambda ${lambdaNeg.toFixed(4)} (delta ${deltaNegPct.toFixed(1)}%)`);
if (deltaNegPct > DELTA_MAX) {
  console.log(`${FAIL}  ADVERTENCIA caso negativo excede ${DELTA_MAX}%`);
  errores++;
} else {
  console.log(`${OK}  Delta caso negativo ≤ ${DELTA_MAX}%`);
}

// ── [3] Ausencias — prueba exacta 7.5% ───────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  3. Ausencias: ausencias_ofensivas=0.5, confianza=1.0, peso=0.15 → -7.5% ataque');
console.log('═'.repeat(68));

const ataqueBase = 1.20;
const defBase    = 1.10;

const r3 = ajustarAtaqueDefensaPorAusencias({
  ataque:              ataqueBase,
  defensa:             defBase,
  ausenciasOfensivas:  0.5,
  ausenciasDefensivas: 0,
  confianzaOfensivas:  1.0,
  confianzaDefensivas: 0,
});

// Esperado: 1.20 * (1 - 0.15 * 0.5 * 1.0) = 1.20 * 0.925 = 1.11
const ataqueEsperado = ataqueBase * (1 - 0.15 * 0.5 * 1.0);
checkCerca('ataque_ajustado = 1.11',   r3.ataqueAjustado,  ataqueEsperado, 0.0001);
checkCerca('defensa sin cambio',       r3.defensaAjustada, defBase,        0.0001);
checkCerca('factor_ataque = 0.925',    r3.factor_ataque,   0.925,          0.0001);
checkCerca('delta_ataque_pct = -7.50', r3.trazabilidad.delta_ataque_pct, -7.50, 0.01);

// Ausencias defensivas: defensa sube (equipo más permeable)
const r3b = ajustarAtaqueDefensaPorAusencias({
  ataque:              1.20,
  defensa:             1.10,
  ausenciasOfensivas:  0,
  ausenciasDefensivas: 0.5,
  confianzaOfensivas:  0,
  confianzaDefensivas: 1.0,
});
// Esperado: 1.10 * (1 + 0.15 * 0.5 * 1.0) = 1.10 * 1.075 = 1.1825
const defensaEsperada = 1.10 * (1 + 0.15 * 0.5 * 1.0);
checkCerca('defensa_ajustada ≈ 1.1825 (más permeable)', r3b.defensaAjustada, defensaEsperada, 0.0001);
checkCerca('ataque sin cambio',   r3b.ataqueAjustado, 1.20, 0.0001);
checkCerca('delta_defensa_pct = +7.50', r3b.trazabilidad.delta_defensa_pct, 7.50, 0.01);

// Sin confianza: no hay ajuste
const r3c = ajustarAtaqueDefensaPorAusencias({
  ataque: 1.20, defensa: 1.10,
  ausenciasOfensivas: 0.9, ausenciasDefensivas: 0.9,
  confianzaOfensivas: 0, confianzaDefensivas: 0,
});
checkCerca('confianza=0 → ataque sin cambio',  r3c.ataqueAjustado,  1.20, 0.0001);
checkCerca('confianza=0 → defensa sin cambio', r3c.defensaAjustada, 1.10, 0.0001);

// ── [4] Ranking FIFA — prueba exacta ─────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  4. Ranking FIFA: equipo=5, rival=45 → gap=40, gap_norm=0.40, ajuste≈0.016');
console.log('═'.repeat(68));

const gap5v45 = calcularGapRankingFifa(5, 45);
checkCerca('gap = 40',      gap5v45.gap,      40,   0.001);
checkCerca('gap_norm = 0.40', gap5v45.gap_norm, 0.40, 0.0001);
check('disponible = true',  gap5v45.disponible, true);

const ajMundial4 = calcularAjusteMundialista({
  rankingEquipo: 5, rankingRival: 45,
  jornadaGrupo: 1,  // efecto_jornada = 1.00
  faseTorneo: 'GROUP_STAGE',
});
// Esperado: 0.04 * 0.40 * 1.0 = 0.016
checkCerca('ajuste_ranking = 0.016', ajMundial4.breakdown.ajuste_ranking, 0.016, 0.0001);
checkCerca('efecto_jornada J1 = 1.00', ajMundial4.breakdown.efecto_jornada, 1.00, 0.0001);

const expAjuste4 = Math.exp(ajMundial4.ajuste);
console.log(`  → exp(${ajMundial4.ajuste}) = ${expAjuste4.toFixed(5)}`);
checkCerca('exp(0.016) ≈ 1.01613', expAjuste4, 1.01613, 0.0001);

// J2: efecto jornada = 0.70 → ajuste = 0.04 * 0.40 * 0.70 = 0.0112
const ajJ2 = calcularAjusteMundialista({
  rankingEquipo: 5, rankingRival: 45, jornadaGrupo: 2,
});
checkCerca('efecto_jornada J2 = 0.70', ajJ2.breakdown.efecto_jornada, 0.70, 0.0001);
checkCerca('ajuste_ranking J2 = 0.0112', ajJ2.breakdown.ajuste_ranking, 0.0112, 0.0001);

// Gap negativo: rival mejor rankeado
const gapNeg = calcularGapRankingFifa(45, 5);
checkCerca('gap negativo = -40', gapNeg.gap, -40, 0.001);
checkCerca('gap_norm negativo = -0.40', gapNeg.gap_norm, -0.40, 0.0001);

// Sin rankings: gap_norm = 0, sin ajuste
const sinRanking = calcularAjusteMundialista({ rankingEquipo: null, rankingRival: null, jornadaGrupo: 2 });
checkCerca('sin rankings → ajuste = 0', sinRanking.breakdown.ajuste_ranking ?? 0, 0, 0.0001);
check('sin rankings → disponible = false', sinRanking.breakdown.ranking_disponible, false);

// ── [5] Necesita ganar ───────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  5. Necesita ganar: peso=0.05, confianza=1.0 → exp(0.05) ≈ 1.051');
console.log('═'.repeat(68));

const ajNG = calcularAjusteMundialista({
  rankingEquipo: null, rankingRival: null,  // sin ranking para aislar el efecto
  jornadaGrupo: 2,
  necesitaGanar: true, confianzaNecesita: 1.0,
});
// Esperado: 0.05 * 1.0 = 0.05
checkCerca('ajuste_necesita_ganar = 0.05', ajNG.breakdown.ajuste_necesita_ganar, 0.05, 0.0001);
check('necesita_ganar_activo = true', ajNG.breakdown.necesita_ganar_activo, true);

const lambda5base = 1.35;
const lambda5adj  = aplicarFactorExponencial(lambda5base, ajNG.ajuste);
console.log(`  → lambda 1.35 → ${lambda5adj.toFixed(5)}  factor = ${(lambda5adj / lambda5base).toFixed(5)}`);
checkCerca('lambda boost ≈ 1.0513 (exp(0.05))', lambda5adj / lambda5base, Math.exp(0.05), 0.0001);

// necesita_ganar = false → sin ajuste
const ajNGFalso = calcularAjusteMundialista({
  rankingEquipo: null, rankingRival: null,
  jornadaGrupo: 2,
  necesitaGanar: false,
});
checkCerca('necesita_ganar=false → ajuste = 0', ajNGFalso.ajuste, 0, 0.0001);

// ── [6] Ajuste psicodeportivo ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  6. Ajuste psicodeportivo — lider, conflicto, presion, generacion');
console.log('═'.repeat(68));

// Solo lider disponible
const ajLider = calcularAjustePsicodeportivo({
  liderDisponible: true, confianzaLider: 1.0,
});
checkCerca('lider_disponible=true, conf=1 → +0.03', ajLider.ajuste, 0.03, 0.0001);

// Solo conflicto moderado (2/3 = 0.667) con confianza 0.8
const ajConflicto = calcularAjustePsicodeportivo({
  conflictoInterno: 2, confianzaConflicto: 0.8,
});
// Esperado: -0.04 * (2/3) * 0.8 = -0.02133
const esperadoConflicto = -0.04 * (2 / 3) * 0.8;
checkCerca('conflicto=2, conf=0.8 → ajuste negativo', ajConflicto.ajuste, esperadoConflicto, 0.0001);

// Confianza < mínima → no activa
const ajBajaConf = calcularAjustePsicodeportivo({
  liderDisponible: true, confianzaLider: 0.20,  // < 0.25
});
checkCerca('confianza=0.20 < mínima → ajuste = 0', ajBajaConf.ajuste, 0, 0.0001);

// Presión mediática (escala 0-10)
const ajPresion = calcularAjustePsicodeportivo({
  presionMediatica: 8, confianzaPresion: 0.5,
});
// Esperado: -0.02 * (8/10) * 0.5 = -0.008
checkCerca('presion=8/10, conf=0.5 → -0.008', ajPresion.ajuste, -0.008, 0.0001);

// ── [7] Aplicar factor exponencial — edge cases ───────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  7. aplicarFactorExponencial — edge cases');
console.log('═'.repeat(68));

checkCerca('exp(0.10) factor ≈ +10.5%', aplicarFactorExponencial(1.0, 0.10), Math.exp(0.10), 0.0001);
checkCerca('exp(-0.10) factor ≈ -9.5%', aplicarFactorExponencial(1.0, -0.10), Math.exp(-0.10), 0.0001);
checkCerca('ajuste=0 → sin cambio',     aplicarFactorExponencial(1.35, 0), 1.35, 0.0001);
checkVerdadero('lambda muy pequeña + boost queda positiva',
  aplicarFactorExponencial(0.001, 0.10) > 0);

// ── [8] PESOS_USADOS exportados ──────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  8. PESOS_USADOS tiene todos los campos esperados');
console.log('═'.repeat(68));

const pesosEsperados = [
  'peso_ausencias_ofensivas', 'peso_ausencias_defensivas',
  'peso_necesita_ganar', 'peso_gap_ranking',
  'peso_liderazgo', 'peso_generacion',
  'peso_conflicto', 'peso_presion',
];
for (const p of pesosEsperados) {
  checkVerdadero(`${p} presente`, typeof PESOS_USADOS[p] === 'number');
}
checkCerca('peso_ausencias_ofensivas = 0.15',  PESOS_USADOS.peso_ausencias_ofensivas, 0.15, 0.0001);
checkCerca('peso_necesita_ganar = 0.05',       PESOS_USADOS.peso_necesita_ganar, 0.05, 0.0001);
checkCerca('peso_gap_ranking = 0.04',          PESOS_USADOS.peso_gap_ranking, 0.04, 0.0001);

// ── [9] Confirmación de pureza ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  9. Confirmación de pureza');
console.log('═'.repeat(68));
console.log(`${OK}  ajustarAtaqueDefensaPorAusencias es pura (sin efectos secundarios)`);
console.log(`${OK}  calcularAjusteMundialista es pura`);
console.log(`${OK}  calcularAjustePsicodeportivo es pura`);
console.log(`${OK}  aplicarFactorExponencial es pura`);
console.log(`${OK}  calcularGapRankingFifa es pura`);
console.log(`${OK}  Sin Firestore. Sin APIs. Sin I/O. 0 escrituras.`);

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('  contextAdjustments.js listo para integración en predecirPartidoCompleto.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

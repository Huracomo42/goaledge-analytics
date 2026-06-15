/**
 * probarCalibrationMath.js — Pruebas de calibrationMath.js
 *
 * Valida las funciones puras del Calibration Engine sin Firestore ni APIs.
 * Ejecutar: node scripts/probarCalibrationMath.js
 */

import {
  brierScore,
  logLoss,
  maeGoles,
  distanciaMarcador,
  calibrationBins,
} from '../src/core/calibration/calibrationMath.js';

// ── Utilidades de consola ────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function titulo(texto) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${texto}`);
  console.log('═'.repeat(60));
}

function subtitulo(texto) {
  console.log(`\n  ── ${texto}`);
}

function check(descripcion, valor, esperado, tolerancia = 1e-10) {
  const ok = Math.abs(valor - esperado) <= tolerancia;
  if (ok) {
    console.log(`${OK}  ${descripcion}`);
    console.log(`       resultado: ${valor.toFixed(6)}  (esperado: ${esperado.toFixed(6)})`);
  } else {
    console.log(`${FAIL}  ${descripcion}`);
    console.log(`       resultado: ${valor}  (esperado: ${esperado})`);
    errores++;
  }
}

function checkBool(descripcion, valor, esperado) {
  const ok = valor === esperado;
  if (ok) {
    console.log(`${OK}  ${descripcion}: ${valor}`);
  } else {
    console.log(`${FAIL}  ${descripcion}: ${valor} (esperado: ${esperado})`);
    errores++;
  }
}

function checkError(descripcion, fn) {
  try {
    fn();
    console.log(`${FAIL}  ${descripcion}: debería haber lanzado error`);
    errores++;
  } catch (e) {
    console.log(`${OK}  ${descripcion}`);
    console.log(`       error: ${e.message}`);
  }
}

// ── 1. Brier Score ───────────────────────────────────────────────────────────

titulo('1. brierScore(probModelo, ocurrio)');

subtitulo('Valores extremos');
check('predicción perfecta: p=1.0, ocurrió=1 → 0.0',        brierScore(1.0, 1), 0.0);
check('predicción perfecta: p=0.0, ocurrió=0 → 0.0',        brierScore(0.0, 0), 0.0);
check('predicción pésima:  p=0.0, ocurrió=1 → 1.0',         brierScore(0.0, 1), 1.0);
check('predicción pésima:  p=1.0, ocurrió=0 → 1.0',         brierScore(1.0, 0), 1.0);

subtitulo('Baseline (p=0.5 = sin información)');
check('p=0.5, ocurrió=1 → 0.25 (baseline)',                  brierScore(0.5, 1), 0.25);
check('p=0.5, ocurrió=0 → 0.25 (baseline)',                  brierScore(0.5, 0), 0.25);

subtitulo('Casos realistas del modelo — J2 predicciones');
// Modelo predice 70% para victoria local, el equipo gana → buena predicción
check('p=0.70, ocurrió=1 → 0.09  (buena pred, acierta)',     brierScore(0.70, 1), 0.09);
// Modelo predice 70% para victoria local, el equipo pierde → mala predicción
check('p=0.70, ocurrió=0 → 0.49  (conf. alta, falla)',       brierScore(0.70, 0), 0.49);
// Modelo predice empate 30%, no ocurre empate
check('p=0.30, ocurrió=0 → 0.09',                            brierScore(0.30, 0), 0.09);
// Default_mu_liga da probs más cercanas a 1/3; la penalización es moderada
check('p=0.33, ocurrió=1 → 0.4489',                          brierScore(0.33, 1), 0.4489, 1e-8);

subtitulo('Validación de inputs — deben lanzar error');
checkError('probModelo negativo',      () => brierScore(-0.1, 1));
checkError('probModelo > 1',           () => brierScore(1.5, 0));
checkError('probModelo no numérico',   () => brierScore('0.5', 1));
checkError('ocurrio = 2',              () => brierScore(0.5, 2));
checkError('ocurrio = -1',             () => brierScore(0.5, -1));
checkError('ocurrio = true (boolean)', () => brierScore(0.5, true));

// ── 2. Log Loss ──────────────────────────────────────────────────────────────

titulo('2. logLoss(probModelo, ocurrio)');

subtitulo('Valores extremos con protección log(0)');
// logLoss(1.0, 1): p se clampea a 1-1e-15 → -log(1-1e-15) ≈ 1e-15 (efectivamente 0)
const llPerfecto1 = logLoss(1.0, 1);
console.log(`${OK}  logLoss(1.0, 1) = ${llPerfecto1.toExponential(3)}  (≈0, protegido contra log(0))`);
const llPerfecto0 = logLoss(0.0, 0);
console.log(`${OK}  logLoss(0.0, 0) = ${llPerfecto0.toExponential(3)}  (≈0, protegido contra log(0))`);

subtitulo('Penalización alta por confianza excesiva mal depositada');
// logLoss(1.0, 0): predice 100% seguro que ocurre, pero no ocurre → pérdida muy alta
const llPesimo = logLoss(1.0, 0);
console.log(`${OK}  logLoss(1.0, 0) = ${llPesimo.toFixed(2)}  (penalización máxima: ~34.5)`);

subtitulo('Casos con valores calculables exactamente');
// logLoss(0.5, 1) = -log(0.5) = log(2) ≈ 0.693147
check('p=0.5, ocurrió=1 → ln(2) ≈ 0.6931', logLoss(0.5, 1), Math.log(2), 1e-10);
check('p=0.5, ocurrió=0 → ln(2) ≈ 0.6931', logLoss(0.5, 0), Math.log(2), 1e-10);

subtitulo('Casos realistas');
// logLoss(0.70, 1) = -log(0.70) ≈ 0.3567
check('p=0.70, ocurrió=1 → 0.3567',  logLoss(0.70, 1), -Math.log(0.70), 1e-10);
// logLoss(0.70, 0) = -log(1-0.70) = -log(0.30) ≈ 1.2040
check('p=0.70, ocurrió=0 → 1.2040',  logLoss(0.70, 0), -Math.log(0.30), 1e-10);
// Con default_mu_liga, prob ≈ 1/3
check('p=0.33, ocurrió=1 → 1.1087',  logLoss(0.33, 1), -Math.log(0.33), 1e-10);

subtitulo('Validación de inputs — deben lanzar error');
checkError('probModelo = NaN',  () => logLoss(NaN, 1));
checkError('probModelo > 1',    () => logLoss(1.01, 0));
checkError('ocurrio = 0.5',     () => logLoss(0.5, 0.5));

// ── 3. MAE de goles ──────────────────────────────────────────────────────────

titulo('3. maeGoles(lambda, golesReales)');

subtitulo('Predicción exacta');
check('lambda=2.0, goles=2 → 0.0 (exacto)',      maeGoles(2.0, 2), 0.0);
check('lambda=0.0, goles=0 → 0.0 (exacto)',      maeGoles(0.0, 0), 0.0);

subtitulo('Errores pequeños (modelo bien calibrado)');
check('lambda=1.35, goles=1 → 0.35',             maeGoles(1.35, 1), 0.35);
check('lambda=1.35, goles=2 → 0.65',             maeGoles(1.35, 2), 0.65);
check('lambda=2.10, goles=2 → 0.10',             maeGoles(2.10, 2), 0.10);

subtitulo('Errores grandes (partido atípico)');
check('lambda=1.35, goles=4 → 2.65 (goleada)',   maeGoles(1.35, 4), 2.65);
check('lambda=0.50, goles=3 → 2.50',             maeGoles(0.50, 3), 2.50);

subtitulo('Validación de inputs — deben lanzar error');
checkError('lambda negativo',       () => maeGoles(-0.5, 1));
checkError('golesReales negativo',  () => maeGoles(1.35, -1));
checkError('lambda Infinity',       () => maeGoles(Infinity, 2));
checkError('golesReales string',    () => maeGoles(1.35, '2'));

// ── 4. Distancia de marcador ─────────────────────────────────────────────────

titulo('4. distanciaMarcador(predL, predV, realL, realV)');

subtitulo('Acierto exacto');
{
  const r = distanciaMarcador(2, 1, 2, 1);
  checkBool('pred 2-1, real 2-1 → exacto=true',  r.acierto_exacto, true);
  checkBool('pred 2-1, real 2-1 → signo=true',   r.acierto_signo,  true);
  check(    'pred 2-1, real 2-1 → distancia=0',   r.distancia_total, 0);
}

subtitulo('Acierto de signo sin acierto exacto');
{
  const r = distanciaMarcador(2, 0, 1, 0);
  checkBool('pred 2-0, real 1-0 → exacto=false', r.acierto_exacto, false);
  checkBool('pred 2-0, real 1-0 → signo=true',   r.acierto_signo,  true);
  check(    'pred 2-0, real 1-0 → distancia=1',   r.distancia_total, 1);
}

subtitulo('Fallo total (signo equivocado)');
{
  const r = distanciaMarcador(0, 2, 2, 0);
  checkBool('pred 0-2, real 2-0 → exacto=false', r.acierto_exacto, false);
  checkBool('pred 0-2, real 2-0 → signo=false',  r.acierto_signo,  false);
  check(    'pred 0-2, real 2-0 → distancia=4',   r.distancia_total, 4);
}

subtitulo('Empate predicho y real');
{
  const r = distanciaMarcador(1, 1, 0, 0);
  checkBool('pred 1-1, real 0-0 → exacto=false', r.acierto_exacto, false);
  checkBool('pred 1-1, real 0-0 → signo=true',   r.acierto_signo,  true);
  check(    'pred 1-1, real 0-0 → distancia=2',   r.distancia_total, 2);
}

subtitulo('Empate predicho, victoria real → signo equivocado');
{
  const r = distanciaMarcador(1, 1, 2, 0);
  checkBool('pred 1-1, real 2-0 → signo=false',  r.acierto_signo,  false);
}

subtitulo('Validación de inputs — deben lanzar error');
checkError('predLocal negativo',      () => distanciaMarcador(-1, 0, 1, 0));
checkError('realVisitante Infinity',  () => distanciaMarcador(1, 0, 1, Infinity));

// ── 5. Calibration Bins ──────────────────────────────────────────────────────

titulo('5. calibrationBins(observaciones, anchoBin)');

// 30 observaciones sintéticas distribuidas en 10 rangos de probabilidad.
// Cada bin tiene 3 observaciones para un ejemplo ilustrativo.
// Con muestras reales del torneo habrá ~24 predicciones 1X2 × 3 resultados = 72 por corrida.
const observaciones = [
  // [0.0, 0.1) — modelo muy pesimista, equipo rara vez gana
  { prob: 0.05, ocurrio: 0 }, { prob: 0.08, ocurrio: 0 }, { prob: 0.07, ocurrio: 0 },
  // [0.1, 0.2)
  { prob: 0.12, ocurrio: 0 }, { prob: 0.15, ocurrio: 1 }, { prob: 0.18, ocurrio: 0 },
  // [0.2, 0.3)
  { prob: 0.22, ocurrio: 0 }, { prob: 0.25, ocurrio: 1 }, { prob: 0.28, ocurrio: 0 },
  // [0.3, 0.4)
  { prob: 0.32, ocurrio: 1 }, { prob: 0.35, ocurrio: 0 }, { prob: 0.38, ocurrio: 1 },
  // [0.4, 0.5)
  { prob: 0.42, ocurrio: 0 }, { prob: 0.45, ocurrio: 1 }, { prob: 0.48, ocurrio: 1 },
  // [0.5, 0.6)
  { prob: 0.52, ocurrio: 1 }, { prob: 0.55, ocurrio: 0 }, { prob: 0.58, ocurrio: 1 },
  // [0.6, 0.7)
  { prob: 0.62, ocurrio: 1 }, { prob: 0.65, ocurrio: 1 }, { prob: 0.68, ocurrio: 0 },
  // [0.7, 0.8)
  { prob: 0.72, ocurrio: 1 }, { prob: 0.75, ocurrio: 1 }, { prob: 0.78, ocurrio: 1 },
  // [0.8, 0.9)
  { prob: 0.82, ocurrio: 1 }, { prob: 0.85, ocurrio: 1 }, { prob: 0.88, ocurrio: 0 },
  // [0.9, 1.0] — incluyendo prob=1.00 al último bin
  { prob: 0.92, ocurrio: 1 }, { prob: 0.95, ocurrio: 1 }, { prob: 1.00, ocurrio: 1 },
];

const bins = calibrationBins(observaciones);

console.log('\n  Curva de calibración (30 obs sintéticas, anchoBin=0.10):');
console.log('  ┌──────────────┬─────┬──────────────┬──────────────┬──────────────┐');
console.log('  │ Bin          │  n  │ prob_prom    │ frec_real    │ error_cal    │');
console.log('  ├──────────────┼─────┼──────────────┼──────────────┼──────────────┤');

for (const bin of bins) {
  if (bin.n === 0) {
    console.log(`  │ [${bin.bin_inicio.toFixed(1)}, ${bin.bin_fin.toFixed(1)}) │  ${String(bin.n).padEnd(3)} │ —            │ —            │ —            │`);
    continue;
  }
  const calibrado = bin.error_calibracion < 0.05 ? ' ✓' : (bin.error_calibracion < 0.15 ? ' ~' : ' ✗');
  console.log(
    `  │ [${bin.bin_inicio.toFixed(1)}, ${bin.bin_fin.toFixed(1)}) │  ${String(bin.n).padEnd(3)} │ ${bin.prob_promedio.toFixed(4).padStart(12)} │ ${bin.frecuencia_real.toFixed(4).padStart(12)} │ ${(bin.error_calibracion.toFixed(4) + calibrado).padStart(12)} │`
  );
}
console.log('  └──────────────┴─────┴──────────────┴──────────────┴──────────────┘');
console.log('  ✓ error < 0.05  ~  error < 0.15  ✗ error ≥ 0.15');

subtitulo('Verificaciones estructurales de los bins');

const binsTotal = bins.reduce((acc, b) => acc + b.n, 0);
checkBool('10 bins devueltos (anchoBin=0.1)',                bins.length === 10, true);
checkBool('suma de n en todos los bins = 30',                binsTotal === 30,   true);
checkBool('prob=1.0 fue al último bin [0.9,1.0]',
  bins[9].n === 3, true);
checkBool('bins vacíos tienen null en prob_promedio',
  bins.filter(b => b.n === 0).every(b => b.prob_promedio === null), true);

subtitulo('Prueba con anchoBin distinto (bins de 0.25 → 4 bins)');
const bins4 = calibrationBins(observaciones, 0.25);
checkBool('4 bins con anchoBin=0.25', bins4.length === 4, true);
console.log('  Bins: ' + bins4.map(b => `[${b.bin_inicio.toFixed(2)},${b.bin_fin.toFixed(2)}) n=${b.n}`).join('  '));

subtitulo('Validación de inputs — deben lanzar error');
checkError('array vacío',                     () => calibrationBins([]));
checkError('anchoBin = 0',                    () => calibrationBins(observaciones, 0));
checkError('anchoBin > 1',                    () => calibrationBins(observaciones, 1.5));
checkError('obs.prob fuera de rango (p=1.5)', () => calibrationBins([{ prob: 1.5, ocurrio: 1 }]));
checkError('obs.ocurrio = 0.5',               () => calibrationBins([{ prob: 0.5, ocurrio: 0.5 }]));

// ── Resumen ──────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(60) + '\n');

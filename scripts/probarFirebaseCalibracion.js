/**
 * probarFirebaseCalibracion.js — Prueba de calibracion.js (Fase 3.3 Firebase).
 *
 * Escribe documentos de prueba en:
 *   calibracion_partidos/CALIBRATION_TEST_001_2.0
 *   calibracion_runs/TEST_RUN_CALIBRATION
 *
 * Nota sobre el guard TEST_:
 *   guardarCalibracionPartido rechaza matchIds que empiecen con "TEST_".
 *   Los scripts reales de calibración ignorarán predicciones/resultados con matchId TEST_*,
 *   por lo que nunca intentarán escribir esos matchIds en calibracion_partidos.
 *   Por eso usamos CALIBRATION_TEST_001 para el partido de prueba.
 *   Los runs de prueba (TEST_RUN_CALIBRATION) no tienen ese guard en calibracion_runs.
 *
 * Ejecutar: node scripts/probarFirebaseCalibracion.js
 */

import 'dotenv/config';
import {
  guardarCalibracionPartido,
  leerCalibracionPartido,
  guardarCalibrationRun,
  leerCalibrationRun,
} from '../src/firebase/calibracion.js';

// ── Utilidades de consola ─────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function check(descripcion, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`
  );
  if (!ok) errores++;
}

function checkVerdadero(descripcion, valor) {
  const ok = Boolean(valor);
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: truthy)`
  );
  if (!ok) errores++;
}

async function checkError(descripcion, fn) {
  try {
    await fn();
    console.log(`${FAIL}  ${descripcion}: debería haber lanzado error`);
    errores++;
  } catch (err) {
    console.log(`${OK}  ${descripcion}`);
    console.log(`       error: ${err.message}`);
  }
}

// ── Datos de prueba ───────────────────────────────────────────────────────────

const MATCH_ID      = 'CALIBRATION_TEST_001';
const VERSION       = '2.0';
const RUN_ID        = 'TEST_RUN_CALIBRATION';

const METRICAS_PARTIDO = {
  brier_1x2_local:       0.1764,
  log_loss_1x2_local:    0.4780,
  mae_lambda_local:      0.25,
  mae_lambda_visitante:  0.18,
  tiene_odds:            false,
  n_warnings:            0,
};

const DATOS_RUN = {
  n_partidos:     1,
  version_modelo: '2.0',
  estado:         'test',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  probarFirebaseCalibracion — calibracion.js (Fase 3.3)');
console.log('═'.repeat(65));

// ── [1] Validaciones: deben rechazar ─────────────────────────────────────────

console.log('\n[1] Validaciones — deben rechazar la escritura\n');

await checkError('matchId vacío', () =>
  guardarCalibracionPartido('', VERSION, METRICAS_PARTIDO)
);

await checkError('matchId TEST_ rechazado', () =>
  guardarCalibracionPartido('TEST_537353', VERSION, METRICAS_PARTIDO)
);

await checkError('versionModelo vacío', () =>
  guardarCalibracionPartido(MATCH_ID, '', METRICAS_PARTIDO)
);

await checkError('runId vacío', () =>
  guardarCalibrationRun('', DATOS_RUN)
);

// ── [2] Guardar métricas de partido ──────────────────────────────────────────

console.log('\n[2] Guardar calibración de partido en Firestore\n');

console.log(`  matchId: ${MATCH_ID}  versionModelo: ${VERSION}`);
console.log(`  docId resultante: ${MATCH_ID}_${VERSION}`);
console.log(`  datos: ${JSON.stringify(METRICAS_PARTIDO)}\n`);

let docPartido;
try {
  docPartido = await guardarCalibracionPartido(MATCH_ID, VERSION, METRICAS_PARTIDO);
  console.log(`${OK}  Escritura confirmada en calibracion_partidos/${MATCH_ID}_${VERSION}`);
} catch (err) {
  console.log(`${FAIL}  Error al guardar: ${err.message}`);
  errores++;
  process.exit(1);
}

// ── [3] Leer y validar métricas de partido ────────────────────────────────────

console.log('\n[3] Leer calibración de partido y validar campos\n');

const leido = await leerCalibracionPartido(MATCH_ID, VERSION);

if (!leido) {
  console.log(`${FAIL}  leerCalibracionPartido devolvió null`);
  errores++;
  process.exit(1);
}
console.log(`${OK}  leerCalibracionPartido devolvió el documento.`);

check('docId',                  leido.docId,                 `${MATCH_ID}_${VERSION}`);
check('matchId',                leido.matchId,               MATCH_ID);
check('version_modelo',         leido.version_modelo,        VERSION);
check('brier_1x2_local',        leido.brier_1x2_local,       0.1764);
check('log_loss_1x2_local',     leido.log_loss_1x2_local,    0.4780);
check('mae_lambda_local',       leido.mae_lambda_local,      0.25);
check('mae_lambda_visitante',   leido.mae_lambda_visitante,  0.18);
check('tiene_odds',             leido.tiene_odds,            false);
check('n_warnings',             leido.n_warnings,            0);
checkVerdadero('guardado_en presente', leido.guardado_en);

// ── [4] Documento exacto leído ────────────────────────────────────────────────

console.log('\n[4] Documento completo calibracion_partidos\n');

const displayPartido = {
  ...leido,
  guardado_en: leido.guardado_en?.toDate?.()?.toISOString() ?? String(leido.guardado_en),
};
console.log(JSON.stringify(displayPartido, null, 4));

// ── [5] Guardar calibration run ───────────────────────────────────────────────

console.log('\n[5] Guardar calibration run en Firestore\n');

console.log(`  runId: ${RUN_ID}`);
console.log(`  datos: ${JSON.stringify(DATOS_RUN)}\n`);

let docRun;
try {
  docRun = await guardarCalibrationRun(RUN_ID, DATOS_RUN);
  console.log(`${OK}  Escritura confirmada en calibracion_runs/${RUN_ID}`);
} catch (err) {
  console.log(`${FAIL}  Error al guardar run: ${err.message}`);
  errores++;
  process.exit(1);
}

// ── [6] Leer y validar calibration run ───────────────────────────────────────

console.log('\n[6] Leer calibration run y validar campos\n');

const leidoRun = await leerCalibrationRun(RUN_ID);

if (!leidoRun) {
  console.log(`${FAIL}  leerCalibrationRun devolvió null`);
  errores++;
  process.exit(1);
}
console.log(`${OK}  leerCalibrationRun devolvió el documento.`);

check('runId',          leidoRun.runId,          RUN_ID);
check('n_partidos',     leidoRun.n_partidos,     1);
check('version_modelo', leidoRun.version_modelo, '2.0');
check('estado',         leidoRun.estado,         'test');
checkVerdadero('guardado_en presente', leidoRun.guardado_en);

// ── [7] Documento exacto leído ────────────────────────────────────────────────

console.log('\n[7] Documento completo calibracion_runs\n');

const displayRun = {
  ...leidoRun,
  guardado_en: leidoRun.guardado_en?.toDate?.()?.toISOString() ?? String(leidoRun.guardado_en),
};
console.log(JSON.stringify(displayRun, null, 4));

// ── [8] Null para doc inexistente ─────────────────────────────────────────────

console.log('\n[8] Documentos inexistentes deben devolver null\n');

const noExistePartido = await leerCalibracionPartido('999999', '2.0');
check('matchId inexistente → null', noExistePartido, null);

const noExisteRun = await leerCalibrationRun('RUN_INEXISTENTE_XYZ');
check('runId inexistente → null', noExisteRun, null);

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('\n  Documentos escritos en Firestore (no borrados):');
  console.log(`    calibracion_partidos/${MATCH_ID}_${VERSION}`);
  console.log(`    calibracion_runs/${RUN_ID}`);
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(65) + '\n');

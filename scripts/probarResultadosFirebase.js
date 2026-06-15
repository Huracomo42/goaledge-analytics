/**
 * probarResultadosFirebase.js — Prueba de guardarResultado y leerResultado.
 *
 * Escribe UN documento de prueba en resultados/TEST_CALIBRATION_RESULT.
 * El documento queda visible en Firestore para confirmación manual.
 * NO borra el documento al finalizar.
 *
 * Ejecutar: node scripts/probarResultadosFirebase.js
 */

import 'dotenv/config';
import { guardarResultado, leerResultado } from '../src/firebase/resultados.js';

const TEST_ID = 'TEST_CALIBRATION_RESULT';

// ── Utilidades de consola ────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function checkIgual(descripcion, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`
  );
  if (!ok) errores++;
}

function checkError(descripcion, fn) {
  return fn()
    .then(() => {
      console.log(`${FAIL}  ${descripcion}: debería haber lanzado error`);
      errores++;
    })
    .catch(err => {
      console.log(`${OK}  ${descripcion}`);
      console.log(`       error: ${err.message}`);
    });
}

console.log('\n' + '═'.repeat(65));
console.log(`  probarResultadosFirebase — doc: resultados/${TEST_ID}`);
console.log('═'.repeat(65));

// ── [1] Casos inválidos ──────────────────────────────────────────────────────

console.log('\n[1] Validaciones — deben rechazar la escritura\n');

await checkError('terminado: false', () =>
  guardarResultado(TEST_ID, {
    goles_local: 2, goles_visitante: 1, fuente: 'manual', terminado: false,
  })
);

await checkError('terminado: undefined', () =>
  guardarResultado(TEST_ID, {
    goles_local: 2, goles_visitante: 1, fuente: 'manual',
  })
);

await checkError('goles_local negativo', () =>
  guardarResultado(TEST_ID, {
    goles_local: -1, goles_visitante: 1, fuente: 'manual', terminado: true,
  })
);

await checkError('goles_local decimal (no entero)', () =>
  guardarResultado(TEST_ID, {
    goles_local: 1.5, goles_visitante: 1, fuente: 'manual', terminado: true,
  })
);

await checkError('goles_visitante string', () =>
  guardarResultado(TEST_ID, {
    goles_local: 2, goles_visitante: '1', fuente: 'manual', terminado: true,
  })
);

await checkError('fuente vacía', () =>
  guardarResultado(TEST_ID, {
    goles_local: 2, goles_visitante: 1, fuente: '', terminado: true,
  })
);

// ── [2] Escritura válida ─────────────────────────────────────────────────────

console.log('\n[2] Guardar resultado válido en Firestore\n');

const datosEntrada = {
  goles_local:       2,
  goles_visitante:   1,
  xg_local_real:     1.8,
  xg_visitante_real: 0.9,
  fuente:            'manual',
  terminado:         true,
};

console.log(`  Escribiendo en resultados/${TEST_ID}…`);
console.log(`  datos entrada: ${JSON.stringify(datosEntrada)}\n`);

let docConfirmado;
try {
  docConfirmado = await guardarResultado(TEST_ID, datosEntrada);
  console.log(`${OK}  Escritura confirmada por Firestore.`);
} catch (err) {
  console.log(`${FAIL}  Error al guardar: ${err.message}`);
  errores++;
  process.exit(1);
}

// ── [3] Lectura inmediata ────────────────────────────────────────────────────

console.log('\n[3] Leer resultado desde Firestore\n');

const resultado = await leerResultado(TEST_ID);

if (!resultado) {
  console.log(`${FAIL}  leerResultado devolvió null — el documento no se encontró.`);
  errores++;
  process.exit(1);
}

console.log(`${OK}  leerResultado devolvió el documento.`);

// ── [4] Verificar campos derivados ──────────────────────────────────────────

console.log('\n[4] Verificar campos derivados\n');

checkIgual('resultado_1x2',               resultado.resultado_1x2,                          'local');
checkIgual('total_goles',                 resultado.total_goles,                             3);
checkIgual('over_under_result["1.5"]',    resultado.over_under_result?.['1.5'],              'over');
checkIgual('over_under_result["2.5"]',    resultado.over_under_result?.['2.5'],              'over');
checkIgual('over_under_result["3.5"]',    resultado.over_under_result?.['3.5'],              'under');
checkIgual('over_under_result["4.5"]',    resultado.over_under_result?.['4.5'],              'under');
checkIgual('btts_result',                 resultado.btts_result,                             true);
checkIgual('terminado',                   resultado.terminado,                               true);
checkIgual('matchId en documento',        resultado.matchId,                                 TEST_ID);
checkIgual('fuente',                      resultado.fuente,                                  'manual');
checkIgual('goles_local',                 resultado.goles_local,                             2);
checkIgual('goles_visitante',             resultado.goles_visitante,                         1);
checkIgual('xg_local_real',              resultado.xg_local_real,                           1.8);
checkIgual('xg_visitante_real',          resultado.xg_visitante_real,                       0.9);
checkIgual('capturado_en presente',       resultado.capturado_en != null,                    true);

// ── [5] Documento exacto guardado ───────────────────────────────────────────

console.log('\n[5] Documento completo en Firestore\n');

// capturado_en viene como Firestore Timestamp; lo convertimos para mostrar
const docDisplay = {
  ...resultado,
  capturado_en: resultado.capturado_en?.toDate?.()?.toISOString()
    ?? String(resultado.capturado_en),
};
console.log(JSON.stringify(docDisplay, null, 4));

// ── [6] Caso empate y visitante ──────────────────────────────────────────────

console.log('\n[6] Verificar derivados para empate y victoria visitante\n');

// Empate 1-1
const empate = await guardarResultado('TEST_CALIBRATION_EMPATE', {
  goles_local: 1, goles_visitante: 1, fuente: 'manual', terminado: true,
});
checkIgual('[1-1] resultado_1x2',             empate.resultado_1x2,             'empate');
checkIgual('[1-1] total_goles',               empate.total_goles,               2);
checkIgual('[1-1] over_under_result["1.5"]',  empate.over_under_result?.['1.5'], 'over');
checkIgual('[1-1] over_under_result["2.5"]',  empate.over_under_result?.['2.5'], 'under');
checkIgual('[1-1] btts_result',               empate.btts_result,               true);

// Victoria visitante 0-1
const visita = await guardarResultado('TEST_CALIBRATION_VISIT', {
  goles_local: 0, goles_visitante: 1, fuente: 'manual', terminado: true,
});
checkIgual('[0-1] resultado_1x2',             visita.resultado_1x2,             'visitante');
checkIgual('[0-1] btts_result',               visita.btts_result,               false);
checkIgual('[0-1] over_under_result["1.5"]',  visita.over_under_result?.['1.5'], 'under');

// 0-0 — ninguno marcó
const cerosCero = await guardarResultado('TEST_CALIBRATION_0_0', {
  goles_local: 0, goles_visitante: 0, fuente: 'manual', terminado: true,
});
checkIgual('[0-0] resultado_1x2',  cerosCero.resultado_1x2,  'empate');
checkIgual('[0-0] total_goles',    cerosCero.total_goles,    0);
checkIgual('[0-0] btts_result',    cerosCero.btts_result,    false);

// Goleada 5-0 — todos los over/under deben ser 'over'
const goleada = await guardarResultado('TEST_CALIBRATION_GOLEADA', {
  goles_local: 5, goles_visitante: 0, fuente: 'manual', terminado: true,
});
checkIgual('[5-0] resultado_1x2',             goleada.resultado_1x2,              'local');
checkIgual('[5-0] total_goles',               goleada.total_goles,                5);
checkIgual('[5-0] over_under_result["4.5"]',  goleada.over_under_result?.['4.5'],  'over');
checkIgual('[5-0] btts_result',               goleada.btts_result,                false);

// ── Resumen ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('\n  Documentos escritos en Firestore (no borrados):');
  console.log('    resultados/TEST_CALIBRATION_RESULT');
  console.log('    resultados/TEST_CALIBRATION_EMPATE');
  console.log('    resultados/TEST_CALIBRATION_VISIT');
  console.log('    resultados/TEST_CALIBRATION_0_0');
  console.log('    resultados/TEST_CALIBRATION_GOLEADA');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(65) + '\n');

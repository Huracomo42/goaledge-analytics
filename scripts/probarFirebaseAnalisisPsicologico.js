/**
 * probarFirebaseAnalisisPsicologico.js — Prueba de analisisPsicologico.js (Fase 4.1)
 *
 * Escribe documentos de prueba en:
 *   analisis_psicologico/PSY_TEST_001
 *
 * Ejecutar: node scripts/probarFirebaseAnalisisPsicologico.js
 */

import 'dotenv/config';
import {
  guardarAnalisisPsicologico,
  leerAnalisisPsicologico,
  existeAnalisisPsicologico,
} from '../src/firebase/analisisPsicologico.js';

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
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)}`
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

// ── Input artificial estilo V1 ────────────────────────────────────────────────

const MATCH_ID = 'PSY_TEST_001';

const INPUT_V1 = {
  modelo:         'claude-haiku-4-5',
  webSearch:      true,
  version_modelo: '2.0',
  psicologico: {
    local: {
      necesita_ganar:      true,
      venganza_narrativa:  false,
      rival_maldito:       1,
      presion_mediatica:   6,
      lider_disponible:    true,
      conflicto_interno:   0,
      generacion_peak:     true,
      underdog:            false,
      clasifico_sufriendo: 'comodo',
      humillacion_previa:  false,
      ausencias_ofensivas: 0.1,
      ausencias_defensivas: 0.0,
    },
    visitante: {
      necesita_ganar:      true,
      venganza_narrativa:  true,
      rival_maldito:       3,
      presion_mediatica:   8,
      lider_disponible:    false,
      conflicto_interno:   2,
      generacion_peak:     false,
      underdog:            true,
      clasifico_sufriendo: 'ultimo',
      humillacion_previa:  true,
      ausencias_ofensivas: 0.5,
      ausencias_defensivas: 0.3,
    },
  },
  narrativa: 'España llega como favorita. Marruecos con baja de su capitán.',
  lesiones_destacadas: ['Mazraoui descartado por lesión'],
  fuentes: ['as.com', 'marca.com', 'bbc.co.uk'],
  timestamps: {
    evento_partido:         '2026-06-25T21:00:00Z',
    analisis_generado:      '2026-06-25T12:00:00Z',
    disponible_para_modelo: '2026-06-25T12:00:00Z',
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  probarFirebaseAnalisisPsicologico — Fase 4.1');
console.log('═'.repeat(68));

// ── [1] Validaciones — deben rechazar ────────────────────────────────────────

console.log('\n[1] Validaciones — deben rechazar la escritura\n');

await checkError('matchId vacío', () =>
  guardarAnalisisPsicologico('', INPUT_V1)
);

await checkError('matchId TEST_ rechazado', () =>
  guardarAnalisisPsicologico('TEST_537329', INPUT_V1)
);

await checkError('input sin matchId si falla normalizador', () =>
  // quitamos psicologico y matchId para que normalizarAnalisisPsicologico falle
  // (la función añade matchId en la llamada, así que esto NO debería fallar —
  //  el error viene del guard TEST_ o de matchId vacío, no de la normalización)
  guardarAnalisisPsicologico('TEST_FAIL', INPUT_V1)
);

// ── [2] existeAnalisisPsicologico antes de escribir ──────────────────────────

console.log('\n[2] existeAnalisisPsicologico — antes de escribir\n');

const existeAntes = await existeAnalisisPsicologico(MATCH_ID);
check('no existe antes de escribir', existeAntes, false);

// ── [3] Guardar análisis (input V1) ──────────────────────────────────────────

console.log('\n[3] Guardar análisis psicodeportivo (estilo V1)\n');

console.log(`  matchId: ${MATCH_ID}`);
console.log(`  formato input: psicologico.local / psicologico.visitante\n`);

let doc;
try {
  doc = await guardarAnalisisPsicologico(MATCH_ID, INPUT_V1);
  console.log(`${OK}  Escritura confirmada en analisis_psicologico/${MATCH_ID}`);
} catch (err) {
  console.log(`${FAIL}  Error al guardar: ${err.message}`);
  errores++;
  process.exit(1);
}

// ── [4] Leer y validar campos ─────────────────────────────────────────────────

console.log('\n[4] Leer y validar campos del documento guardado\n');

const leido = await leerAnalisisPsicologico(MATCH_ID);

if (!leido) {
  console.log(`${FAIL}  leerAnalisisPsicologico devolvió null`);
  errores++;
  process.exit(1);
}
console.log(`${OK}  leerAnalisisPsicologico devolvió el documento.`);

// Campos de identidad
check('matchId',        leido.matchId,        MATCH_ID);
check('estado',         leido.estado,         'completo');
check('version_modelo', leido.version_modelo, '2.0');
check('modelo',         leido.modelo,         'claude-haiku-4-5');
check('webSearch',      leido.webSearch,      true);

// 12 variables presentes
check('variables tiene 12 entradas', Object.keys(leido.variables ?? {}).length, 12);

// tipo_proxy críticos
check('underdog.tipo_proxy = market_bias_proxy',
  leido.variables?.underdog?.tipo_proxy, 'market_bias_proxy');
check('necesita_ganar.tipo_proxy = contextual_proxy',
  leido.variables?.necesita_ganar?.tipo_proxy, 'contextual_proxy');
check('conflicto_interno.tipo_proxy = team_performance_proxy',
  leido.variables?.conflicto_interno?.tipo_proxy, 'team_performance_proxy');
check('venganza_narrativa.tipo_proxy = media_narrative_proxy',
  leido.variables?.venganza_narrativa?.tipo_proxy, 'media_narrative_proxy');

// confianzas default (el input V1 no traía confianza)
check('conflicto_interno.confianza = 0.35 (default)',
  leido.variables?.conflicto_interno?.confianza, 0.35);
check('underdog.confianza = 0.50 (default)',
  leido.variables?.underdog?.confianza, 0.50);
check('necesita_ganar.confianza = 0.75 (default)',
  leido.variables?.necesita_ganar?.confianza, 0.75);
check('ausencias_ofensivas.confianza = 0.60 (default)',
  leido.variables?.ausencias_ofensivas?.confianza, 0.60);

// Valores de variables
check('underdog.local = false',          leido.variables?.underdog?.local,          false);
check('underdog.visitante = true',       leido.variables?.underdog?.visitante,      true);
check('necesita_ganar.local = true',     leido.variables?.necesita_ganar?.local,    true);
check('lider_disponible.local = true',   leido.variables?.lider_disponible?.local,  true);
check('lider_disponible.visitante = false', leido.variables?.lider_disponible?.visitante, false);
check('ausencias_ofensivas.local = 0.1', leido.variables?.ausencias_ofensivas?.local,  0.1);
check('ausencias_defensivas.visitante = 0.3', leido.variables?.ausencias_defensivas?.visitante, 0.3);

// Narrativa y fuentes preservadas
check('narrativa',           leido.narrativa, 'España llega como favorita. Marruecos con baja de su capitán.');
check('fuentes.length = 3',  leido.fuentes?.length, 3);
check('fuentes[0]',          leido.fuentes?.[0], 'as.com');
check('lesiones_destacadas[0]', leido.lesiones_destacadas?.[0], 'Mazraoui descartado por lesión');

// Timestamps preservados
check('timestamps.evento_partido',
  leido.timestamps?.evento_partido, '2026-06-25T21:00:00Z');
check('timestamps.analisis_generado',
  leido.timestamps?.analisis_generado, '2026-06-25T12:00:00Z');

// Metadata de persistencia
checkVerdadero('guardado_en presente', leido.guardado_en);
check('warnings es array', Array.isArray(leido.warnings), true);

// ── [5] warnings vacíos (V1 completo) ────────────────────────────────────────

console.log('\n[5] Warnings — V1 completo no debe generar warnings de variables\n');

check('warnings.length = 0 (V1 completo)', leido.warnings?.length, 0);

// ── [6] Guardar con variables faltantes → warnings en Firestore ───────────────

console.log('\n[6] Guardar con variables parciales → warnings presentes en Firestore\n');

const MATCH_PARCIAL = 'PSY_TEST_002';
const inputParcial = {
  modelo:         'claude-haiku-4-5',
  webSearch:      true,
  version_modelo: '2.0',
  // Solo 4 variables de 12
  necesita_ganar:   { local: true,  visitante: false },
  underdog:         { local: false, visitante: true  },
  lider_disponible: { local: true,  visitante: true  },
  generacion_peak:  { local: true,  visitante: false },
};

const docParcial = await guardarAnalisisPsicologico(MATCH_PARCIAL, inputParcial);
console.log(`${OK}  Escritura confirmada en analisis_psicologico/${MATCH_PARCIAL}`);

const leidoParcial = await leerAnalisisPsicologico(MATCH_PARCIAL);
const nWarnings = leidoParcial?.warnings?.length ?? 0;
check('warnings > 0 (variables faltantes)', nWarnings > 0, true);
console.log(`  → ${nWarnings} warning(s) guardados en Firestore`);
check('venganza_narrativa.local = null (ausente)',
  leidoParcial?.variables?.venganza_narrativa?.local, null);
check('venganza_narrativa.tipo_proxy presente aunque ausente',
  leidoParcial?.variables?.venganza_narrativa?.tipo_proxy, 'media_narrative_proxy');

// ── [7] existeAnalisisPsicologico después de escribir ────────────────────────

console.log('\n[7] existeAnalisisPsicologico — después de escribir\n');

const existeDespues = await existeAnalisisPsicologico(MATCH_ID);
check('existe después de escribir', existeDespues, true);

const existeParcial = await existeAnalisisPsicologico(MATCH_PARCIAL);
check('PSY_TEST_002 también existe', existeParcial, true);

const noExiste = await existeAnalisisPsicologico('99999_INEXISTENTE');
check('matchId inexistente → false', noExiste, false);

// ── [8] Confirmar que predicciones/{matchId} no fue tocado ───────────────────

console.log('\n[8] Confirmar que predicciones/{matchId} no fue modificado\n');

// Leer directamente de Firestore para confirmar
import('../src/firebase/init.js');
import { getFirestore as _gfs } from 'firebase-admin/firestore';
const _db  = _gfs();
const snapPred = await _db.collection('predicciones').doc(MATCH_ID).get();
check(`predicciones/${MATCH_ID} NO existe (no se tocó)`, snapPred.exists, false);

const snapPred2 = await _db.collection('predicciones').doc(MATCH_PARCIAL).get();
check(`predicciones/${MATCH_PARCIAL} NO existe (no se tocó)`, snapPred2.exists, false);

// ── [9] Documento completo guardado ──────────────────────────────────────────

console.log('\n[9] Documento completo analisis_psicologico/PSY_TEST_001\n');

const displayDoc = {
  ...leido,
  guardado_en: leido.guardado_en?.toDate?.()?.toISOString() ?? String(leido.guardado_en),
};
// Mostrar solo campos de identidad + variables resumidas para legibilidad
const resumen = {
  matchId:        displayDoc.matchId,
  estado:         displayDoc.estado,
  modelo:         displayDoc.modelo,
  version_modelo: displayDoc.version_modelo,
  guardado_en:    displayDoc.guardado_en,
  warnings:       displayDoc.warnings,
  fuentes:        displayDoc.fuentes,
  variables_count: Object.keys(displayDoc.variables ?? {}).length,
  muestra_variable: {
    underdog:          displayDoc.variables?.underdog,
    conflicto_interno: displayDoc.variables?.conflicto_interno,
    ausencias_ofensivas: displayDoc.variables?.ausencias_ofensivas,
  },
};
console.log(JSON.stringify(resumen, null, 4));

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('\n  Documentos escritos en Firestore (no borrados):');
  console.log(`    analisis_psicologico/${MATCH_ID}`);
  console.log(`    analisis_psicologico/${MATCH_PARCIAL}`);
  console.log('\n  NO se tocó predicciones/{matchId}. Sin APIs. Sin Claude.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

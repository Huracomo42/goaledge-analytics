/**
 * auditarCalibracion.js — Auditoría SOLO LECTURA para Calibration Engine (Fase 3.0).
 *
 * Para cada partido de J2 del fixture real:
 *   1. Lee predicciones/{matchId}  → valida si es V2 limpia con campos mínimos
 *   2. Lee resultados/{matchId}    → verifica si hay resultado real cargado
 *   3. Comprueba ultimo_odds_snapshot_id / odds_snapshot_id en predicciones
 *
 * Criterio de clasificación (en orden de precedencia):
 *   falta_prediccion         → no existe documento en predicciones/
 *   prediccion_no_v2         → existe pero es V1 o versión desconocida
 *   prediccion_incompleta    → es V2 pero le faltan campos mínimos para calibrar
 *   falta_resultado          → predicción V2 completa, sin resultado en resultados/
 *   listo_calibracion_partido   → predicción V2 + resultado, sin odds snapshot
 *   listo_calibracion_completa  → predicción V2 + resultado + odds snapshot
 *
 * Ignora matchIds que empiecen con "TEST_".
 * GARANTÍAS: zero escrituras en Firestore.
 *
 * Salida:
 *   - Tabla en consola
 *   - reports/auditoria_calibracion_YYYYMMDD_HHmmss.json
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const db = getFirestore();

// ── Detección V1 ──────────────────────────────────────────────────────────────
// Campos cuya presencia delata un documento de versión 1.0 (aunque version_modelo falte)

const V1_CAMPOS_DELATOR = [
  'apuestas', 'scores', 'pesos_usados',
  'scoreStat', 'scorePsico', 'boost',
  'score_local', 'score_visitante',
  'analisis_ia_cache',
];

// ── Campos mínimos para entrar a calibración ──────────────────────────────────
// Cada entrada: [nombre legible, función que valida el doc]

const CAMPOS_MINIMOS = [
  ['version_modelo',       d => d.version_modelo != null],
  ['lambda_local',         d => typeof d.lambda_local === 'number'],
  ['lambda_visitante',     d => typeof d.lambda_visitante === 'number'],
  ['prob_1x2.local',       d => d.prob_1x2?.local     != null],
  ['prob_1x2.empate',      d => d.prob_1x2?.empate    != null],
  ['prob_1x2.visitante',   d => d.prob_1x2?.visitante != null],
  ['prob_over_under',      d => d.prob_over_under     != null],
  ['prob_btts',            d => d.prob_btts           != null],
  ['marcador_mas_probable', d => d.marcador_mas_probable != null],
];

// ── Clasificación ─────────────────────────────────────────────────────────────

function analizarPrediccion(data) {
  if (!data) {
    return { estado: 'falta_prediccion', contaminado_v1: false, campos_faltantes: [] };
  }

  const esV1 = data.version_modelo === '1.0'
    || V1_CAMPOS_DELATOR.some(c => data[c] !== undefined);

  if (esV1) {
    const camposV1 = V1_CAMPOS_DELATOR.filter(c => data[c] !== undefined);
    return { estado: 'prediccion_no_v2', contaminado_v1: true, campos_v1: camposV1, campos_faltantes: [] };
  }

  if (data.version_modelo !== '2.0') {
    return { estado: 'prediccion_no_v2', contaminado_v1: false, campos_v1: [], campos_faltantes: [] };
  }

  const campos_faltantes = CAMPOS_MINIMOS
    .filter(([, fn]) => !fn(data))
    .map(([nombre]) => nombre);

  if (campos_faltantes.length > 0) {
    return { estado: 'prediccion_incompleta', contaminado_v1: false, campos_faltantes };
  }

  return { estado: 'prediccion_v2_completa', contaminado_v1: false, campos_faltantes: [] };
}

function clasificarPartido(analisisPred, tieneResultado, tieneOdds) {
  const { estado } = analisisPred;

  if (estado === 'falta_prediccion')   return 'falta_prediccion';
  if (estado === 'prediccion_no_v2')   return 'prediccion_no_v2';
  if (estado === 'prediccion_incompleta') return 'prediccion_incompleta';

  // prediccion_v2_completa — ahora depende del resultado y odds
  if (!tieneResultado) return 'falta_resultado';
  return tieneOdds ? 'listo_calibracion_completa' : 'listo_calibracion_partido';
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(74));
console.log('  AUDITORÍA CALIBRACIÓN — Fase 3.0  (solo lectura)');
console.log('═'.repeat(74));

// [1/3] Fixture J2 desde football-data.org (misma fuente que predecirJ2ConHistorial.js)

console.log('\n[1/3] Obteniendo fixture J2 desde football-data.org…');
const todos = await obtenerPartidosMundial();

const j2 = todos
  .filter(p => p.matchday === 2)  // sin filtro de status: captura los 24 aunque cambien de estado
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`  ${j2.length} partidos J2 en el fixture.\n`);

if (j2.length === 0) {
  console.error('ERROR: 0 partidos J2 encontrados. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// [2/3] Leer predicciones/ y resultados/ en Firestore

console.log('[2/3] Auditando predicciones/ y resultados/ en Firestore…\n');

const ICONO = {
  listo_calibracion_completa:  '✓✓',
  listo_calibracion_partido:   '✓·',
  falta_resultado:             '·○',
  falta_prediccion:            '○○',
  prediccion_no_v2:            '✗✗',
  prediccion_incompleta:       '✗·',
};

const filas         = [];
let   ignoradosTest = 0;

for (const partido of j2) {
  const matchId = String(partido.id);

  // Guard: ignorar TEST_* (nunca aparecen en fixture real, pero es seguridad explícita)
  if (matchId.startsWith('TEST_')) {
    ignoradosTest++;
    continue;
  }

  const nombreEquipos = `${partido.homeTeam?.name ?? '?'} vs ${partido.awayTeam?.name ?? '?'}`;
  const fechaPartido  = partido.utcDate?.slice(0, 10) ?? null;

  // Leer predicciones y resultados en paralelo (2 reads por partido)
  const [snapPred, snapResult] = await Promise.all([
    db.collection('predicciones').doc(matchId).get(),
    db.collection('resultados').doc(matchId).get(),
  ]);

  const dataPred   = snapPred.exists   ? snapPred.data()   : null;
  const dataResult = snapResult.exists ? snapResult.data() : null;

  // Analizar predicción
  const analisisPred = analizarPrediccion(dataPred);

  // Verificar odds: campo en predicciones (no lee odds_snapshots/ para no multiplicar reads)
  const snapshotId = dataPred?.ultimo_odds_snapshot_id ?? dataPred?.odds_snapshot_id ?? null;
  const tieneOdds  = snapshotId != null;

  const tieneResultado = dataResult != null;
  const clasificacion  = clasificarPartido(analisisPred, tieneResultado, tieneOdds);

  // Campos de diagnóstico
  const camposFaltantes = analisisPred.campos_faltantes ?? [];
  const camposV1        = analisisPred.campos_v1 ?? [];

  filas.push({
    matchId,
    nombre:                  nombreEquipos,
    fechaPartido,
    version_modelo:          dataPred?.version_modelo ?? null,
    clasificacion,
    contaminado_v1:          analisisPred.contaminado_v1,
    campos_faltantes:        camposFaltantes,
    campos_v1_hallados:      camposV1,
    tiene_resultado:         tieneResultado,
    tiene_odds:              tieneOdds,
    ultimo_odds_snapshot_id: snapshotId,
    lambda_local:            dataPred?.lambda_local    ?? null,
    lambda_visitante:        dataPred?.lambda_visitante ?? null,
  });

  // Log por línea
  const icono   = ICONO[clasificacion] ?? '??';
  const verStr  = dataPred?.version_modelo ? `v${dataPred.version_modelo}` : 'sin-ver';
  const resStr  = tieneResultado ? 'RES✓' : 'RES·';
  const oddsStr = tieneOdds      ? 'ODD✓' : 'ODD·';
  const extra   = camposFaltantes.length ? ` [falta: ${camposFaltantes.join(', ')}]`
    : camposV1.length ? ` [V1: ${camposV1.join(', ')}]`
    : '';

  console.log(
    `  ${icono} ${matchId.padEnd(8)}` +
    ` [${fechaPartido}]` +
    ` ${nombreEquipos.padEnd(42)}` +
    ` ${verStr.padEnd(6)}` +
    ` ${resStr}  ${oddsStr}` +
    extra
  );
}

// ── Conteos ───────────────────────────────────────────────────────────────────

const clasificaciones = [
  'listo_calibracion_completa',
  'listo_calibracion_partido',
  'falta_resultado',
  'falta_prediccion',
  'prediccion_no_v2',
  'prediccion_incompleta',
];

const conteo = Object.fromEntries(
  clasificaciones.map(c => [c, filas.filter(f => f.clasificacion === c).length])
);

const totalV2Limpios    = filas.filter(f =>
  ['listo_calibracion_completa', 'listo_calibracion_partido', 'falta_resultado'].includes(f.clasificacion)
).length;

const totalContaminados = filas.filter(f => f.contaminado_v1).length;
const totalFaltaOdds    = filas.filter(f => !f.tiene_odds && f.tiene_resultado).length;

// ── Resumen consola ───────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(74));
console.log('  RESUMEN');
console.log('─'.repeat(74));
console.log(`  Total revisados                 : ${filas.length}`);
if (ignoradosTest > 0) {
  console.log(`  Ignorados (TEST_*)              : ${ignoradosTest}`);
}
console.log(`  V2 limpios (version 2.0 válida) : ${totalV2Limpios}`);
console.log(`  Contaminados V1                 : ${totalContaminados}`);
console.log('');
console.log(`  listo_calibracion_completa      : ${conteo.listo_calibracion_completa}`);
console.log(`  listo_calibracion_partido       : ${conteo.listo_calibracion_partido}`);
console.log(`  falta_resultado                 : ${conteo.falta_resultado}`);
console.log(`  falta_prediccion                : ${conteo.falta_prediccion}`);
console.log(`  prediccion_no_v2                : ${conteo.prediccion_no_v2}`);
console.log(`  prediccion_incompleta           : ${conteo.prediccion_incompleta}`);
console.log(`  sin odds (falta_odds)           : ${totalFaltaOdds}`);

// Detalle de partidos que pueden calibrarse
const listosCalibracion = filas.filter(f =>
  f.clasificacion === 'listo_calibracion_completa' ||
  f.clasificacion === 'listo_calibracion_partido'
);
if (listosCalibracion.length > 0) {
  console.log('\n  Partidos listos para calibrar:');
  for (const f of listosCalibracion) {
    const oddsStr = f.tiene_odds ? ` [odds: ${f.ultimo_odds_snapshot_id}]` : ' [sin odds]';
    console.log(`    ${f.matchId}  ${f.nombre}${oddsStr}`);
  }
}

// Detalle de incompletos o no-V2
const conProblemas = filas.filter(f =>
  f.clasificacion === 'prediccion_no_v2' || f.clasificacion === 'prediccion_incompleta'
);
if (conProblemas.length > 0) {
  console.log('\n  Predicciones con problemas:');
  for (const f of conProblemas) {
    const detalle = f.contaminado_v1
      ? `[V1: ${f.campos_v1_hallados.join(', ')}]`
      : `[falta: ${f.campos_faltantes.join(', ')}]`;
    console.log(`    ${f.matchId}  ${f.nombre}  ${detalle}`);
  }
}

// [3/3] Guardar reporte JSON

console.log('\n[3/3] Guardando reporte JSON…');

const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const nombreArchivo = `auditoria_calibracion_${ts}.json`;
const rutaArchivo   = resolve(reportsDir, nombreArchivo);

const reporte = {
  generado_en:      new Date().toISOString(),
  fuente_matchIds:  'football-data.org matchday=2 (misma lógica que predecirJ2ConHistorial.js)',
  total_revisados:  filas.length,
  ignorados_test:   ignoradosTest,
  conteo,
  v2_limpios:       totalV2Limpios,
  contaminados_v1:  totalContaminados,
  falta_odds:       totalFaltaOdds,
  criterio_v2_limpia: {
    version_modelo:        '2.0 exacto',
    sin_campos_v1_delator: V1_CAMPOS_DELATOR,
    campos_minimos:        CAMPOS_MINIMOS.map(([n]) => n),
  },
  detalle: filas,
};

writeFileSync(rutaArchivo, JSON.stringify(reporte, null, 2), 'utf-8');
console.log(`  → reports/${nombreArchivo}`);
console.log('\n  Leyenda: ✓✓=completo  ✓·=sin odds  ·○=sin resultado  ○○=sin predicción  ✗·=incompleta  ✗✗=no V2');
console.log('\n  0 escrituras en Firestore.\n');

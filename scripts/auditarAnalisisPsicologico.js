/**
 * auditarAnalisisPsicologico.js — Auditoría SOLO LECTURA del análisis psicodeportivo (Fase 4.2).
 *
 * Para cada partido de J2 del fixture real:
 *   1. Lee analisis_psicologico/{matchId}
 *   2. Verifica presencia, estado, version_modelo, 12 variables, tipo_proxy, confianza,
 *      fuentes, timestamps y warnings
 *
 * Criterio de clasificación (en orden de precedencia):
 *   falta_analisis          → no existe documento en analisis_psicologico/
 *   version_no_v2           → existe pero version_modelo != "2.0"
 *   incompleto_variables    → V2, pero faltan variables, tipo_proxy o confianza inválida
 *   incompleto_metadata     → variables ok, pero faltan fuentes / timestamps / estado
 *   completo_v2             → todo presente y válido
 *   error_lectura           → excepción al leer Firestore
 *
 * Ignora matchIds que empiecen con "TEST_".
 * GARANTÍAS: zero escrituras en Firestore. Zero llamadas a Claude. Zero APIs.
 *
 * Salida:
 *   - Tabla en consola
 *   - reports/auditoria_analisis_psicologico_YYYYMMDD_HHmmss.json
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const db = getFirestore();

// ── 12 variables del bloque P (fuente: diccionario_variables_v2_bloque_P.md) ──

const VARIABLES_P = [
  'necesita_ganar',
  'venganza_narrativa',
  'rival_maldito',
  'presion_mediatica',
  'lider_disponible',
  'conflicto_interno',
  'generacion_peak',
  'underdog',
  'clasifico_sufriendo',
  'humillacion_previa',
  'ausencias_ofensivas',
  'ausencias_defensivas',
];

const TIPO_PROXY_ESPERADO = {
  necesita_ganar:       'contextual_proxy',
  venganza_narrativa:   'media_narrative_proxy',
  rival_maldito:        'media_narrative_proxy',
  presion_mediatica:    'media_narrative_proxy',
  lider_disponible:     'team_performance_proxy',
  conflicto_interno:    'team_performance_proxy',
  generacion_peak:      'team_performance_proxy',
  underdog:             'market_bias_proxy',
  clasifico_sufriendo:  'contextual_proxy',
  humillacion_previa:   'media_narrative_proxy',
  ausencias_ofensivas:  'team_performance_proxy',
  ausencias_defensivas: 'team_performance_proxy',
};

// ── Validación de análisis ────────────────────────────────────────────────────

function confianzaValida(c) {
  return typeof c === 'number' && isFinite(c) && c >= 0 && c <= 1;
}

/**
 * Valida variables, tipo_proxy y confianza.
 * Devuelve { ok, variables_presentes, variables_faltantes, errores_proxy, errores_confianza }.
 */
function analizarVariables(data) {
  const variables_faltantes  = [];
  const errores_proxy        = [];
  const errores_confianza    = [];
  let   variables_presentes  = 0;

  const vars = data.variables ?? {};

  for (const nombre of VARIABLES_P) {
    const v = vars[nombre];
    if (v === undefined || v === null) {
      variables_faltantes.push(nombre);
      continue;
    }
    variables_presentes++;

    // tipo_proxy correcto
    if (v.tipo_proxy !== TIPO_PROXY_ESPERADO[nombre]) {
      errores_proxy.push(`${nombre}: "${v.tipo_proxy}" (esperado "${TIPO_PROXY_ESPERADO[nombre]}")`);
    }

    // confianza válida (número entre 0 y 1)
    if (!confianzaValida(v.confianza)) {
      errores_confianza.push(`${nombre}: ${JSON.stringify(v.confianza)}`);
    }
  }

  return {
    ok:                   variables_faltantes.length === 0 && errores_proxy.length === 0 && errores_confianza.length === 0,
    variables_presentes,
    variables_faltantes,
    errores_proxy,
    errores_confianza,
  };
}

/**
 * Valida metadata: fuentes, timestamps, estado.
 * Devuelve { ok, campos_faltantes }.
 */
function analizarMetadata(data) {
  const campos_faltantes = [];

  if (!data.estado)                              campos_faltantes.push('estado');
  if (!Array.isArray(data.fuentes))              campos_faltantes.push('fuentes');
  if (!data.timestamps)                          campos_faltantes.push('timestamps');
  else {
    if (!data.timestamps.evento_partido)         campos_faltantes.push('timestamps.evento_partido');
    if (!data.timestamps.analisis_generado)      campos_faltantes.push('timestamps.analisis_generado');
    if (!data.timestamps.disponible_para_modelo) campos_faltantes.push('timestamps.disponible_para_modelo');
  }

  return { ok: campos_faltantes.length === 0, campos_faltantes };
}

/**
 * Clasifica un documento (o null) en una de las 6 categorías.
 * Devuelve el objeto de diagnóstico completo.
 */
function clasificarAnalisis(data, errorLectura = null) {
  if (errorLectura) {
    return { clasificacion: 'error_lectura', error: errorLectura };
  }

  if (!data) {
    return { clasificacion: 'falta_analisis' };
  }

  if (data.version_modelo !== '2.0') {
    return {
      clasificacion:  'version_no_v2',
      version_modelo: data.version_modelo ?? null,
    };
  }

  const analisisVars = analizarVariables(data);
  if (!analisisVars.ok) {
    return {
      clasificacion:      'incompleto_variables',
      variables_presentes: analisisVars.variables_presentes,
      variables_faltantes: analisisVars.variables_faltantes,
      errores_proxy:       analisisVars.errores_proxy,
      errores_confianza:   analisisVars.errores_confianza,
    };
  }

  const analisisMeta = analizarMetadata(data);
  if (!analisisMeta.ok) {
    return {
      clasificacion:    'incompleto_metadata',
      campos_faltantes: analisisMeta.campos_faltantes,
    };
  }

  return {
    clasificacion:    'completo_v2',
    variables_count:  analisisVars.variables_presentes,
    modelo:           data.modelo     ?? null,
    webSearch:        data.webSearch  ?? null,
    n_warnings:       Array.isArray(data.warnings) ? data.warnings.length : null,
    n_fuentes:        data.fuentes?.length ?? 0,
    estado:           data.estado,
    guardado_en:      data.guardado_en?.toDate?.()?.toISOString() ?? data.guardado_en ?? null,
    generado_en:      data.generado_en ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  AUDITORÍA ANÁLISIS PSICODEPORTIVO — Fase 4.2  (solo lectura)');
console.log('═'.repeat(76));

// [1/3] Fixture J2

console.log('\n[1/3] Obteniendo fixture J2 desde football-data.org…');
const todos = await obtenerPartidosMundial();

const j2 = todos
  .filter(p => p.matchday === 2)
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`  ${j2.length} partidos J2 en el fixture.\n`);

if (j2.length === 0) {
  console.error('ERROR: 0 partidos J2. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// [2/3] Leer analisis_psicologico/ en Firestore

console.log('[2/3] Auditando analisis_psicologico/ en Firestore…\n');

const ICONO = {
  completo_v2:           '✓✓',
  incompleto_metadata:   '✓·',
  incompleto_variables:  '·✗',
  version_no_v2:         '✗·',
  falta_analisis:        '○○',
  error_lectura:         '!!',
};

const filas         = [];
let   ignoradosTest = 0;

for (const partido of j2) {
  const matchId       = String(partido.id);
  const nombreEquipos = `${partido.homeTeam?.name ?? '?'} vs ${partido.awayTeam?.name ?? '?'}`;
  const fechaPartido  = partido.utcDate?.slice(0, 10) ?? null;

  if (matchId.startsWith('TEST_')) {
    ignoradosTest++;
    continue;
  }

  let data          = null;
  let errorLectura  = null;

  try {
    const snap = await db.collection('analisis_psicologico').doc(matchId).get();
    data = snap.exists ? snap.data() : null;
  } catch (err) {
    errorLectura = err.message;
  }

  const diagnostico   = clasificarAnalisis(data, errorLectura);
  const clasificacion = diagnostico.clasificacion;

  filas.push({
    matchId,
    nombre:        nombreEquipos,
    fechaPartido,
    clasificacion,
    version_modelo: data?.version_modelo ?? null,
    ...diagnostico,
  });

  // Línea de consola
  const icono    = ICONO[clasificacion] ?? '??';
  const verStr   = data?.version_modelo ? `v${data.version_modelo}` : 'sin-ver';
  const modStr   = data?.modelo         ? data.modelo.replace('claude-', '').slice(0, 12) : '·';
  const varsStr  = data?.variables      ? `${Object.keys(data.variables).length}/12 vars` : '0/12 vars';

  let extra = '';
  if (diagnostico.variables_faltantes?.length)
    extra = ` [falta: ${diagnostico.variables_faltantes.join(', ')}]`;
  else if (diagnostico.campos_faltantes?.length)
    extra = ` [meta: ${diagnostico.campos_faltantes.join(', ')}]`;
  else if (diagnostico.errores_proxy?.length)
    extra = ` [proxy: ${diagnostico.errores_proxy.length} error(s)]`;
  else if (errorLectura)
    extra = ` [${errorLectura.slice(0, 40)}]`;

  console.log(
    `  ${icono} ${matchId.padEnd(8)}` +
    ` [${fechaPartido}]` +
    ` ${nombreEquipos.padEnd(42)}` +
    ` ${verStr.padEnd(6)}` +
    ` ${varsStr.padEnd(10)}` +
    ` ${modStr}` +
    extra
  );
}

// ── Conteos ───────────────────────────────────────────────────────────────────

const CLASIFICACIONES = [
  'completo_v2',
  'incompleto_metadata',
  'incompleto_variables',
  'version_no_v2',
  'falta_analisis',
  'error_lectura',
];

const conteo = Object.fromEntries(
  CLASIFICACIONES.map(c => [c, filas.filter(f => f.clasificacion === c).length])
);

const costoEvitable = conteo.completo_v2 + conteo.incompleto_metadata;

// ── Resumen consola ───────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN');
console.log('─'.repeat(76));
console.log(`  Total revisados                 : ${filas.length}`);
if (ignoradosTest > 0)
  console.log(`  Ignorados (TEST_*)              : ${ignoradosTest}`);
console.log('');
console.log(`  completo_v2                     : ${conteo.completo_v2}`);
console.log(`  incompleto_metadata             : ${conteo.incompleto_metadata}`);
console.log(`  incompleto_variables            : ${conteo.incompleto_variables}`);
console.log(`  version_no_v2                   : ${conteo.version_no_v2}`);
console.log(`  falta_analisis                  : ${conteo.falta_analisis}`);
console.log(`  error_lectura                   : ${conteo.error_lectura}`);
console.log('');
console.log(`  costo_evitable_estimado         : ${costoEvitable} partido(s) ya tienen análisis — sin necesidad de nueva llamada a Claude`);

// Detalle de completos
const completos = filas.filter(f => f.clasificacion === 'completo_v2');
if (completos.length > 0) {
  console.log('\n  Partidos con análisis completo V2:');
  for (const f of completos) {
    const ws      = f.webSearch ? 'webSearch✓' : 'webSearch·';
    const warnStr = f.n_warnings != null ? `${f.n_warnings} warn` : '?warn';
    console.log(`    ${f.matchId}  ${f.nombre}  [${f.modelo ?? '?'}  ${ws}  ${f.n_fuentes} fuentes  ${warnStr}]`);
  }
}

// Detalle de problemas
const conProblemas = filas.filter(f =>
  ['incompleto_variables', 'incompleto_metadata', 'version_no_v2', 'error_lectura'].includes(f.clasificacion)
);
if (conProblemas.length > 0) {
  console.log('\n  Análisis con problemas:');
  for (const f of conProblemas) {
    const detalle = f.variables_faltantes?.length
      ? `[vars faltantes: ${f.variables_faltantes.join(', ')}]`
      : f.campos_faltantes?.length
      ? `[meta faltante: ${f.campos_faltantes.join(', ')}]`
      : f.error
      ? `[error: ${f.error.slice(0, 60)}]`
      : `[version: ${f.version_modelo}]`;
    console.log(`    ${f.matchId}  ${f.nombre}  ${detalle}`);
  }
}

// [3/3] Guardar reporte JSON

console.log('\n[3/3] Guardando reporte JSON…');

const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const nombreArchivo = `auditoria_analisis_psicologico_${ts}.json`;
const rutaArchivo   = resolve(reportsDir, nombreArchivo);

const reporte = {
  generado_en:    new Date().toISOString(),
  fuente_fixture: 'football-data.org matchday=2',
  total_revisados: filas.length,
  ignorados_test:  ignoradosTest,
  conteo,
  costo_evitable_estimado: costoEvitable,
  criterio_completo_v2: {
    version_modelo:    '2.0 exacto',
    variables_presentes: `las ${VARIABLES_P.length} variables del bloque P`,
    tipo_proxy:        'coincide con diccionario_variables_v2_bloque_P.md',
    confianza:         'número en [0, 1]',
    metadata_requerida: ['estado', 'fuentes (array)', 'timestamps.evento_partido', 'timestamps.analisis_generado', 'timestamps.disponible_para_modelo'],
  },
  variables_auditadas: VARIABLES_P,
  detalle: filas.map(f => {
    // limpiar Timestamps de Firestore que no serializan bien
    const { guardado_en, ...resto } = f;
    return { ...resto, guardado_en: typeof guardado_en === 'string' ? guardado_en : null };
  }),
};

writeFileSync(rutaArchivo, JSON.stringify(reporte, null, 2), 'utf-8');
console.log(`  → reports/${nombreArchivo}`);
console.log('\n  Leyenda: ✓✓=completo  ✓·=falta meta  ·✗=vars incompletas  ✗·=no V2  ○○=sin análisis  !!=error');
console.log('\n  0 escrituras en Firestore. 0 llamadas a Claude. 0 APIs.\n');

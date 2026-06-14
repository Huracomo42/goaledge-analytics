/**
 * auditarPrediccionesJ2.js — Auditoría SOLO LECTURA de predicciones J2 en Firestore.
 *
 * Obtiene los 24 matchIds de J2 con la misma fuente que predecirJ2ConHistorial.js
 * (obtenerPartidosMundial → matchday === 2), lee predicciones/{matchId} en Firestore
 * y clasifica cada documento.
 *
 * GARANTÍAS:
 *   - Zero escrituras: no usa setDoc, update, delete, batch ni commit.
 *   - Solo doc.get() y collection.doc().get() (métodos read-only).
 *
 * Salida:
 *   - Tabla en consola.
 *   - reports/auditoria_j2_predicciones_YYYYMMDD_HHmmss.json
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

// Inicializa Firebase Admin (side-effect import; guard interno en init.js)
import '../src/firebase/init.js';

import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

// ── Clasificación ─────────────────────────────────────────────────────────────

const V2_CAMPOS_REQUERIDOS = ['lambda_local', 'lambda_visitante', 'prob_1x2'];

// Campos cuya presencia delata un documento V1 (incluso si version_modelo falta)
const V1_CAMPOS_DELATOR = [
  'apuestas', 'scores', 'pesos_usados',
  'scoreStat', 'scorePsico', 'boost',
  'score_local', 'score_visitante',
  'analisis_ia_cache',  // patrón observado en predicciones/537352
];

function clasificar(data) {
  if (!data) return 'AUSENTE';

  const version = data.version_modelo;
  const tieneV2 = V2_CAMPOS_REQUERIDOS.every(c => data[c] !== undefined);
  const tieneV1 = V1_CAMPOS_DELATOR.some(c => data[c] !== undefined)
                  || version === '1.0';

  if (version === '2.0' && tieneV2) return 'V2_LIMPIO';
  if (tieneV1)                       return 'V1_CONTAMINADO';
  return 'INDETERMINADO';
}

// ── Timestamp más reciente entre campos candidatos ────────────────────────────

const TIMESTAMP_CAMPOS = [
  'generado_en', 'guardado_en', 'actualizado_en',
  'capturado_en', 'createdAt', 'updatedAt',
];

function extraerTimestamp(data) {
  let mejor = null, campoUsado = null;
  for (const campo of TIMESTAMP_CAMPOS) {
    const v = data[campo];
    if (v == null) continue;
    const d = v?.toDate?.()
           ?? (typeof v === 'string' ? new Date(v) : null);
    if (!d || isNaN(d.getTime())) continue;
    if (!mejor || d > mejor) { mejor = d; campoUsado = campo; }
  }
  return { timestamp: mejor?.toISOString() ?? null, campo: campoUsado };
}

// ── Nombre del partido ────────────────────────────────────────────────────────
// Preferimos el fixture (fuente de verdad); si no, campos del propio documento.

function nombrePartido(doc, fixtureEntry) {
  if (fixtureEntry) {
    return `${fixtureEntry.homeTeam?.name} vs ${fixtureEntry.awayTeam?.name}`;
  }
  if (!doc) return '(sin documento)';
  const local = doc.nombreLocal ?? doc.equipoLocal ?? doc.partido?.nombreLocal ?? '?';
  const visit = doc.nombreVisitante ?? doc.equipoVisitante ?? doc.partido?.nombreVisitante ?? '?';
  return `${local} vs ${visit}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const db = getFirestore();

console.log('\n' + '═'.repeat(72));
console.log('  AUDITORÍA J2 — predicciones/ en Firestore  (solo lectura)');
console.log('═'.repeat(72));

// Obtener fixture (misma fuente que predecirJ2ConHistorial.js)
console.log('\n[1/3] Obteniendo fixture J2 desde football-data.org…');
const todos = await obtenerPartidosMundial();

// matchday === 2, sin filtro de status para capturar los mismos 24
// independientemente de si el status cambió desde el run original.
const j2 = todos
  .filter(p => p.matchday === 2)
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`  ${j2.length} partidos J2 en el fixture.\n`);

if (j2.length === 0) {
  console.error('ERROR: 0 partidos J2 encontrados. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// Leer documentos Firestore (solo .get())
console.log('[2/3] Leyendo predicciones/ en Firestore…\n');

const filas = [];

for (const partido of j2) {
  const matchId = partido.id;
  const snap    = await db.collection('predicciones').doc(String(matchId)).get();

  const existe = snap.exists;
  const data   = existe ? snap.data() : null;

  const estado          = clasificar(data);
  const { timestamp,
          campo }       = existe ? extraerTimestamp(data) : { timestamp: null, campo: null };
  const nombre          = nombrePartido(data, partido);
  const versionModelo   = data?.version_modelo ?? null;

  // Campos extra para diagnóstico en V1_CONTAMINADO
  const camposV1Presentes = existe
    ? V1_CAMPOS_DELATOR.filter(c => data[c] !== undefined)
    : [];

  filas.push({
    matchId,
    nombre,
    fechaPartido:       partido.utcDate?.slice(0, 10) ?? null,
    version_modelo:     versionModelo,
    timestamp,
    campo_timestamp:    campo,
    estado,
    campos_v1_hallados: camposV1Presentes,
  });

  // Log por línea
  const icon = { V2_LIMPIO: '✓', V1_CONTAMINADO: '✗', AUSENTE: '○', INDETERMINADO: '?' }[estado];
  const ts   = timestamp ? timestamp.slice(0, 19).replace('T', ' ') : 'sin timestamp';
  const ver  = versionModelo ? `v${versionModelo}` : 'sin versión';
  console.log(
    `  ${icon} ${String(matchId).padEnd(10)}` +
    ` [${partido.utcDate?.slice(0, 10)}]` +
    ` ${nombre.padEnd(40)}` +
    ` ${ver.padEnd(6)}` +
    ` ${ts}` +
    (camposV1Presentes.length ? `  [V1: ${camposV1Presentes.join(', ')}]` : '')
  );
}

// ── Resumen ───────────────────────────────────────────────────────────────────

const conteo = {
  V2_LIMPIO:       filas.filter(f => f.estado === 'V2_LIMPIO').length,
  V1_CONTAMINADO:  filas.filter(f => f.estado === 'V1_CONTAMINADO').length,
  AUSENTE:         filas.filter(f => f.estado === 'AUSENTE').length,
  INDETERMINADO:   filas.filter(f => f.estado === 'INDETERMINADO').length,
};

const contaminados = filas.filter(f => f.estado === 'V1_CONTAMINADO');

console.log('\n' + '═'.repeat(72));
console.log('  RESUMEN');
console.log('─'.repeat(72));
console.log(`  Total auditados  : ${filas.length}`);
console.log(`  V2_LIMPIO        : ${conteo.V2_LIMPIO}`);
console.log(`  V1_CONTAMINADO   : ${conteo.V1_CONTAMINADO}`);
console.log(`  AUSENTE          : ${conteo.AUSENTE}`);
console.log(`  INDETERMINADO    : ${conteo.INDETERMINADO}`);

if (contaminados.length > 0) {
  console.log('\n  matchIds contaminados:');
  for (const f of contaminados) {
    console.log(`    ${f.matchId}  ${f.nombre}  [V1 campos: ${f.campos_v1_hallados.join(', ')}]`);
  }
}

// ── Guardar JSON ──────────────────────────────────────────────────────────────

console.log('\n[3/3] Guardando reporte…');

const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const nombreArchivo = `auditoria_j2_predicciones_${ts}.json`;
const rutaArchivo   = resolve(reportsDir, nombreArchivo);

const reporte = {
  generado_en:    new Date().toISOString(),
  fuente_matchIds: 'football-data.org matchday=2 (misma lógica que predecirJ2ConHistorial.js)',
  total:          filas.length,
  conteo,
  matchIds_contaminados: contaminados.map(f => f.matchId),
  detalle:        filas,
};

writeFileSync(rutaArchivo, JSON.stringify(reporte, null, 2), 'utf-8');
console.log(`  → Guardado en reports/${nombreArchivo}`);
console.log('\n  0 escrituras en Firestore.\n');

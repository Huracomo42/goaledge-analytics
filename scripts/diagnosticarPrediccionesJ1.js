/**
 * diagnosticarPrediccionesJ1.js — Solo lectura. Inspecciona campos reales
 * de los 7 documentos predicciones/{matchId} clasificados como "incompleta"
 * en la auditoría J1.
 *
 * 0 escrituras en Firestore.
 */

import 'dotenv/config';
import { getFirestore } from 'firebase-admin/firestore';
import '../src/firebase/init.js';

const INCOMPLETAS = [
  { matchId: '537333', nombre: 'Canada vs Bosnia-Herzegovina',   version_reportada: null    },
  { matchId: '537345', nombre: 'United States vs Paraguay',      version_reportada: '1.0'   },
  { matchId: '537334', nombre: 'Qatar vs Switzerland',           version_reportada: '1.0'   },
  { matchId: '537339', nombre: 'Brazil vs Morocco',              version_reportada: '1.0'   },
  { matchId: '537340', nombre: 'Haiti vs Scotland',              version_reportada: '1.0'   },
  { matchId: '537346', nombre: 'Australia vs Turkey',            version_reportada: '1.0'   },
  { matchId: '537352', nombre: 'Ivory Coast vs Ecuador',         version_reportada: '1.0'   },
];

// Campos que auditarPrediccionesJ1.js exige para calcular métricas
const CAMPOS_REQUERIDOS_V2 = [
  'lambda_local',
  'lambda_visitante',
  'prob_1x2',           // objeto { local, empate, visitante }
  'prob_over_under',    // objeto con claves "2.5", etc.
  'prob_btts',          // objeto { si, no }
  'marcador_mas_probable',
];

// Campos V1 conocidos que detectan esquema viejo
const V1_DELATOR = [
  'apuestas', 'scores', 'pesos_usados', 'scoreStat', 'scorePsico',
  'boost', 'score_local', 'score_visitante', 'analisis_ia_cache',
];

const db = getFirestore();

console.log('\n' + '═'.repeat(76));
console.log('  DIAGNÓSTICO — predicciones/{matchId} de J1 "incompletas"');
console.log('  Solo lectura. 0 escrituras Firestore.');
console.log('═'.repeat(76));

const resumenGlobal = [];

for (const { matchId, nombre, version_reportada } of INCOMPLETAS) {
  const snap = await db.collection('predicciones').doc(matchId).get();

  console.log('\n' + '─'.repeat(76));
  console.log(`  ${matchId}  ${nombre}  (versión reportada: ${version_reportada ?? 'null'})`);

  if (!snap.exists) {
    console.log('  ❌ Documento no existe en Firestore.');
    resumenGlobal.push({ matchId, nombre, existe: false, razon: 'sin_documento' });
    continue;
  }

  const data    = snap.data();
  const campos  = Object.keys(data).sort();
  const version = data.version_modelo ?? null;

  console.log(`\n  Campos presentes (${campos.length}):`);
  console.log(`    ${campos.join(', ')}`);

  // ── Verificar V1 delators ────────────────────────────────────────────────
  const v1Encontrados = V1_DELATOR.filter(c => data[c] !== undefined);
  if (v1Encontrados.length > 0) {
    console.log(`\n  Campos V1 detectados: ${v1Encontrados.join(', ')}`);
  }

  // ── Verificar campos requeridos V2 ───────────────────────────────────────
  console.log('\n  Campos V2 requeridos vs presencia:');
  const faltantes = [];
  for (const campo of CAMPOS_REQUERIDOS_V2) {
    const val      = data[campo];
    const presente = val != null;
    const tipo     = presente ? typeof val : '—';
    console.log(`    ${presente ? '✓' : '✗'}  ${campo.padEnd(24)} ${presente ? `(${tipo})` : 'AUSENTE'}`);
    if (!presente) faltantes.push(campo);
  }

  // ── Buscar equivalentes V1 para cada campo faltante ────────────────────
  const posiblesEquivalentes = {};

  if (faltantes.includes('prob_1x2')) {
    // V1 podría tener prob_local, prob_empate, prob_visitante a nivel raíz
    const altLocal     = data.prob_local     ?? data.probabilidad_local     ?? null;
    const altEmpate    = data.prob_empate    ?? data.probabilidad_empate    ?? null;
    const altVisitante = data.prob_visitante ?? data.probabilidad_visitante ?? null;
    if (altLocal != null || altEmpate != null || altVisitante != null) {
      posiblesEquivalentes['prob_1x2'] = { prob_local: altLocal, prob_empate: altEmpate, prob_visitante: altVisitante };
    }
  }

  if (faltantes.includes('lambda_local') || faltantes.includes('lambda_visitante')) {
    const altLambda = data.lambda ?? null;
    const altLL     = data.lambdaLocal ?? data.lambda_local_ajustado ?? null;
    const altLV     = data.lambdaVisitante ?? data.lambda_visitante_ajustado ?? null;
    if (altLambda != null) posiblesEquivalentes['lambda (único)'] = altLambda;
    if (altLL != null)     posiblesEquivalentes['lambdaLocal']     = altLL;
    if (altLV != null)     posiblesEquivalentes['lambdaVisitante'] = altLV;
  }

  if (faltantes.includes('prob_over_under')) {
    const alt = data.prob_over ?? data.over_under ?? data.over_2_5 ?? null;
    if (alt != null) posiblesEquivalentes['prob_over_under (alt)'] = alt;
  }

  if (faltantes.includes('prob_btts')) {
    const alt = data.btts ?? data.prob_btts_si ?? null;
    if (alt != null) posiblesEquivalentes['prob_btts (alt)'] = alt;
  }

  if (faltantes.includes('marcador_mas_probable')) {
    const alt = data.marcador_probable ?? data.marcadorMasProbable ?? data.score_mas_probable ?? null;
    if (alt != null) posiblesEquivalentes['marcador_mas_probable (alt)'] = alt;
  }

  // ── Mostrar equivalentes encontrados ────────────────────────────────────
  if (Object.keys(posiblesEquivalentes).length > 0) {
    console.log('\n  Posibles equivalentes V1 encontrados:');
    for (const [k, v] of Object.entries(posiblesEquivalentes)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  } else if (faltantes.length > 0) {
    console.log('\n  Sin equivalentes V1 para los campos faltantes.');
  }

  // ── Mostrar subclaves de campos complejos si existen ────────────────────
  for (const campo of ['prob_1x2', 'prob_over_under', 'prob_btts', 'marcador_mas_probable']) {
    if (data[campo] != null && typeof data[campo] === 'object') {
      console.log(`\n  Subclaves de ${campo}: ${Object.keys(data[campo]).join(', ')}`);
    }
  }

  // ── Diagnóstico por partido ──────────────────────────────────────────────
  let razon;
  if (version === '1.0' || v1Encontrados.length > 0) {
    razon = faltantes.length > 0 ? 'esquema_v1_campos_faltantes' : 'esquema_v1_campos_distintos';
  } else if (faltantes.includes('prob_1x2') && faltantes.includes('lambda_local')) {
    razon = 'falta_probabilidades_y_lambdas';
  } else if (faltantes.includes('prob_1x2')) {
    razon = 'falta_probabilidades_1x2';
  } else if (faltantes.includes('lambda_local') || faltantes.includes('lambda_visitante')) {
    razon = 'falta_lambdas';
  } else if (faltantes.includes('prob_over_under') || faltantes.includes('prob_btts')) {
    razon = 'falta_prediccion_mercados';
  } else {
    razon = 'incompleta_sin_clasificar';
  }

  console.log(`\n  → Diagnóstico: ${razon}`);

  resumenGlobal.push({
    matchId,
    nombre,
    existe:          true,
    version_modelo:  version,
    campos_totales:  campos.length,
    faltantes_v2:    faltantes,
    v1_detectados:   v1Encontrados,
    equivalentes:    Object.keys(posiblesEquivalentes),
    razon,
  });
}

// ── Resumen global ─────────────────────────────────────────────────────────

console.log('\n\n' + '═'.repeat(76));
console.log('  RESUMEN');
console.log('═'.repeat(76));

for (const r of resumenGlobal) {
  const auditable = r.faltantes_v2?.length === 0;
  const icono     = auditable ? '✓ auditable' : '✗ no auditable';
  console.log(`\n  ${r.matchId}  ${r.nombre}`);
  console.log(`    Razón           : ${r.razon}`);
  console.log(`    Campos V2 faltan: ${r.faltantes_v2?.join(', ') || 'ninguno'}`);
  console.log(`    V1 detectados   : ${r.v1_detectados?.join(', ') || 'ninguno'}`);
  console.log(`    Equivalentes    : ${r.equivalentes?.join(', ') || 'ninguno'}`);
  console.log(`    Estado          : ${icono}`);
}

console.log('\n' + '═'.repeat(76));
console.log('  0 escrituras en Firestore.\n');

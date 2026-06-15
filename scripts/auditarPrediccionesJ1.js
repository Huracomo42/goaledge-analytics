/**
 * auditarPrediccionesJ1.js — Auditoría de predicciones vs resultados reales de J1.
 *
 * Para cada partido de J1 lee predicciones/{matchId} y resultados/{matchId},
 * calcula métricas de acierto y guarda un reporte en reports/.
 *
 * Flags:
 *   (sin flags)   Solo lectura Firestore. Genera reporte JSON en reports/.
 *   --write       Además guarda auditoria_predicciones/{matchId} en Firestore.
 *
 * Métricas por partido:
 *   acierto_1x2        — ganador predicho (máxima prob) === resultado real
 *   acierto_ou25       — Over/Under 2.5 predicho correcto
 *   acierto_btts       — BTTS predicho correcto
 *   acierto_marcador   — marcador más probable exacto
 *   mae_goles          — (|λ_local - goles_local| + |λ_visit - goles_visit|) / 2
 *   brier_1x2          — ∑ (prob_i − indicador_i)²  para {local, empate, visitante}
 *
 * Clasificación de estado por partido:
 *   auditado        — predicción V2 + resultado disponibles, métricas calculadas
 *   sin_prediccion  — no hay documento en predicciones/{matchId}
 *   sin_resultado   — predicción V2 existe pero resultado aún no cargado
 *   incompleta      — predicción existe pero no es auditable; razon_incompleta explica por qué
 *
 * Razones de incompletitud:
 *   esquema_v1_no_compatible      — V1.0 score-based, sin Poisson (sin lambdas ni distribuciones)
 *   falta_probabilidades_y_lambdas — versión desconocida, faltan lambdas Y prob_1x2
 *   falta_probabilidades_1x2      — faltan prob_1x2 / prob_over_under / prob_btts
 *   falta_lambdas                 — faltan lambda_local o lambda_visitante
 *   falta_prediccion_mercados     — faltan prob_over_under o prob_btts
 *
 * Para V1, meta_v1 rescata datos descriptivos sin usarlos como métricas:
 *   favorito, diferencia, score_local_total, score_visit_total, apuestas (referencia)
 *
 * GARANTÍAS:
 *   - Sin --write: 0 escrituras Firestore.
 *   - Con --write: escribe solo en auditoria_predicciones/{matchId}.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const MODO_WRITE = process.argv.includes('--write');

const db = getFirestore();

// ── Campos mínimos en predicciones para poder auditar ────────────────────────

const CAMPOS_MINIMOS_PRED = [
  'lambda_local', 'lambda_visitante',
  'prob_1x2', 'prob_over_under', 'prob_btts',
  'marcador_mas_probable',
];

const V1_CAMPOS_DELATOR = [
  'apuestas', 'scores', 'pesos_usados', 'scoreStat', 'analisis_ia_cache',
];

/**
 * Clasifica el documento de predicción.
 * @returns {{ estado: string, razon: string|null, meta_v1: object|null }}
 */
function clasificarPrediccion(data) {
  if (!data) return { estado: 'sin_prediccion', razon: null, meta_v1: null };

  const esV1 = data.version_modelo === '1.0'
    || V1_CAMPOS_DELATOR.some(c => data[c] !== undefined);

  if (esV1) {
    // Rescate descriptivo de V1: solo como referencia, nunca para métricas
    const meta_v1 = {
      favorito:          data.scores?.favorito         ?? null,
      diferencia:        data.scores?.diferencia       ?? null,
      score_local_total: data.scores?.local?.total     ?? null,
      score_visit_total: data.scores?.visitante?.total ?? null,
      apuestas: Array.isArray(data.apuestas)
        ? data.apuestas.map(a => ({
            mercado:   a.mercado   ?? null,
            confianza: a.confianza ?? null,
            EV:        a.EV        ?? null,
          }))
        : null,
    };
    return { estado: 'incompleta', razon: 'esquema_v1_no_compatible', meta_v1 };
  }

  const faltantes = CAMPOS_MINIMOS_PRED.filter(c => data[c] == null);
  if (faltantes.length > 0) {
    let razon;
    if (faltantes.includes('lambda_local') && faltantes.includes('prob_1x2')) {
      razon = 'falta_probabilidades_y_lambdas';
    } else if (faltantes.includes('prob_1x2')) {
      razon = 'falta_probabilidades_1x2';
    } else if (faltantes.includes('lambda_local') || faltantes.includes('lambda_visitante')) {
      razon = 'falta_lambdas';
    } else {
      razon = 'falta_prediccion_mercados';
    }
    return { estado: 'incompleta', razon, meta_v1: null };
  }

  return { estado: 'ok', razon: null, meta_v1: null };
}

// ── Ganador predicho (mayor probabilidad 1X2) ─────────────────────────────────

function predGanador(prob_1x2) {
  const { local, empate, visitante } = prob_1x2;
  if (local >= empate && local >= visitante) return 'local';
  if (empate >= visitante)                   return 'empate';
  return 'visitante';
}

// ── Brier score para 1X2 ─────────────────────────────────────────────────────

function brierScore1x2(prob, resultado) {
  const i = { local: 0, empate: 0, visitante: 0 };
  i[resultado] = 1;
  return (prob.local    - i.local)    ** 2
       + (prob.empate   - i.empate)   ** 2
       + (prob.visitante - i.visitante) ** 2;
}

// ── Calcular métricas de un partido ──────────────────────────────────────────

function calcularMetricas(dataPred, dataResult) {
  const { prob_1x2, prob_over_under, prob_btts, marcador_mas_probable,
          lambda_local, lambda_visitante } = dataPred;

  const { goles_local, goles_visitante, resultado_1x2,
          over_under_result, btts_result } = dataResult;

  // Ganador predicho
  const pred_ganador = predGanador(prob_1x2);
  const acierto_1x2 = pred_ganador === resultado_1x2;

  // Over/Under 2.5
  const pred_ou25    = (prob_over_under?.['2.5']?.over ?? 0) > 0.5 ? 'over' : 'under';
  const real_ou25    = over_under_result?.['2.5'] ?? (goles_local + goles_visitante > 2.5 ? 'over' : 'under');
  const acierto_ou25 = pred_ou25 === real_ou25;

  // BTTS
  const pred_btts    = (prob_btts?.si ?? 0) > 0.5;
  const acierto_btts = pred_btts === btts_result;

  // Marcador exacto
  const marcador_pred = `${marcador_mas_probable.local}-${marcador_mas_probable.visitante}`;
  const marcador_real = `${goles_local}-${goles_visitante}`;
  const acierto_marcador_exacto = marcador_pred === marcador_real;

  // MAE goles
  const error_goles_local      = Math.abs((lambda_local      ?? 0) - goles_local);
  const error_goles_visitante  = Math.abs((lambda_visitante  ?? 0) - goles_visitante);
  const mae_goles              = (error_goles_local + error_goles_visitante) / 2;

  // Brier 1X2
  const brier_1x2 = brierScore1x2(prob_1x2, resultado_1x2);

  return {
    // Predicciones
    pred_1x2:           prob_1x2,
    pred_ganador_1x2:   pred_ganador,
    pred_ou25,
    pred_btts,
    pred_marcador:      marcador_pred,
    pred_lambda_local:  lambda_local  ?? null,
    pred_lambda_visitante: lambda_visitante ?? null,
    // Resultado
    real_goles_local:   goles_local,
    real_goles_visitante: goles_visitante,
    real_1x2:           resultado_1x2,
    real_ou25,
    real_btts:          btts_result,
    // Métricas
    acierto_1x2,
    acierto_ou25,
    acierto_btts,
    acierto_marcador_exacto,
    mae_goles:           parseFloat(mae_goles.toFixed(4)),
    error_goles_local:   parseFloat(error_goles_local.toFixed(4)),
    error_goles_visitante: parseFloat(error_goles_visitante.toFixed(4)),
    brier_1x2:           parseFloat(brier_1x2.toFixed(4)),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  AUDITORÍA J1 — predicciones vs resultados reales  (Cerebro V2.1)');
console.log('═'.repeat(76));

console.log('\n[1/3] Obteniendo fixture J1 desde football-data.org…');
const todos = await obtenerPartidosMundial();
const j1 = todos
  .filter(p => p.matchday === 1)
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`  ${j1.length} partidos J1 en fixture.\n`);

if (j1.length === 0) {
  console.error('ERROR: 0 partidos J1. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// [2/3] Leer predicciones y resultados
console.log('[2/3] Leyendo predicciones/ y resultados/ en Firestore…\n');

const filas = [];

for (const partido of j1) {
  const matchId     = String(partido.id);
  const nombre      = `${partido.homeTeam?.name} vs ${partido.awayTeam?.name}`;
  const fechaUTC    = partido.utcDate?.slice(0, 10) ?? null;

  const [snapPred, snapRes] = await Promise.all([
    db.collection('predicciones').doc(matchId).get(),
    db.collection('resultados').doc(matchId).get(),
  ]);

  const dataPred   = snapPred.exists ? snapPred.data() : null;
  const dataResult = snapRes.exists  ? snapRes.data()  : null;

  const clasif = clasificarPrediccion(dataPred);

  let estado, razon_incompleta, meta_v1, metricas;
  razon_incompleta = null;
  meta_v1          = null;
  metricas         = null;

  if (clasif.estado === 'sin_prediccion') {
    estado = 'sin_prediccion';
  } else if (clasif.estado === 'incompleta') {
    estado           = 'incompleta';
    razon_incompleta = clasif.razon;
    meta_v1          = clasif.meta_v1;
  } else if (!dataResult) {
    estado = 'sin_resultado';
  } else {
    estado   = 'auditado';
    metricas = calcularMetricas(dataPred, dataResult);
  }

  const version_modelo = dataPred?.version_modelo ?? null;

  // Log por línea
  const iconos = {
    auditado:       '✓',
    sin_prediccion: '○',
    sin_resultado:  '·',
    incompleta:     '✗',
  };
  const icon = iconos[estado] ?? '?';

  let lineaSufijo = '';
  if (estado === 'auditado') {
    const { acierto_1x2, acierto_ou25, acierto_btts, mae_goles,
            real_goles_local, real_goles_visitante } = metricas;
    lineaSufijo = ` ${real_goles_local}-${real_goles_visitante}`
      + `  1X2:${acierto_1x2 ? '✓' : '✗'}`
      + ` OU:${acierto_ou25 ? '✓' : '✗'}`
      + ` BTTS:${acierto_btts ? '✓' : '✗'}`
      + ` MAE:${mae_goles.toFixed(2)}`;
  } else if (estado === 'incompleta' && razon_incompleta) {
    lineaSufijo = `  [${razon_incompleta}]`;
  }

  console.log(
    `  ${icon} ${matchId.padEnd(10)}` +
    ` [${fechaUTC}]` +
    ` ${nombre.padEnd(38)}` +
    ` ${(version_modelo ? `v${version_modelo}` : 'sin-ver').padEnd(8)}` +
    lineaSufijo
  );

  filas.push({
    matchId,
    nombre,
    fechaUTC,
    version_modelo,
    estado,
    razon_incompleta,
    meta_v1,
    ...(metricas ?? {}),
  });
}

// ── Resumen global ────────────────────────────────────────────────────────────

const auditados      = filas.filter(f => f.estado === 'auditado');
const sinPrediccion  = filas.filter(f => f.estado === 'sin_prediccion');
const sinResultado   = filas.filter(f => f.estado === 'sin_resultado');
const incompletas    = filas.filter(f => f.estado === 'incompleta');

const n = auditados.length;

let resumenMetricas = null;
if (n > 0) {
  const pct      = v => `${(v * 100).toFixed(1)}%`;
  const promedio = campo => auditados.reduce((s, f) => s + (f[campo] ?? 0), 0) / n;

  const aciertos_1x2   = auditados.filter(f => f.acierto_1x2).length;
  const aciertos_ou25  = auditados.filter(f => f.acierto_ou25).length;
  const aciertos_btts  = auditados.filter(f => f.acierto_btts).length;
  const aciertos_marc  = auditados.filter(f => f.acierto_marcador_exacto).length;
  const mae_prom       = promedio('mae_goles');
  const brier_prom     = promedio('brier_1x2');

  resumenMetricas = {
    partidos_auditados:  n,
    aciertos_1x2:        aciertos_1x2,
    tasa_1x2:            parseFloat((aciertos_1x2 / n).toFixed(4)),
    aciertos_ou25:       aciertos_ou25,
    tasa_ou25:           parseFloat((aciertos_ou25 / n).toFixed(4)),
    aciertos_btts:       aciertos_btts,
    tasa_btts:           parseFloat((aciertos_btts / n).toFixed(4)),
    aciertos_marcador:   aciertos_marc,
    tasa_marcador:       parseFloat((aciertos_marc / n).toFixed(4)),
    mae_goles_promedio:  parseFloat(mae_prom.toFixed(4)),
    brier_1x2_promedio:  parseFloat(brier_prom.toFixed(4)),
  };

  console.log('\n' + '═'.repeat(76));
  console.log('  MÉTRICAS GLOBALES J1');
  console.log('─'.repeat(76));
  console.log(`  Partidos auditados : ${n} / ${filas.length}`);
  console.log(`  Sin predicción     : ${sinPrediccion.length}`);
  console.log(`  Sin resultado      : ${sinResultado.length}`);
  console.log(`  Incompletas        : ${incompletas.length}`);
  console.log('');
  console.log(`  Acierto 1X2        : ${aciertos_1x2}/${n}  (${pct(aciertos_1x2/n)})`);
  console.log(`  Acierto O/U 2.5    : ${aciertos_ou25}/${n}  (${pct(aciertos_ou25/n)})`);
  console.log(`  Acierto BTTS       : ${aciertos_btts}/${n}  (${pct(aciertos_btts/n)})`);
  console.log(`  Marcador exacto    : ${aciertos_marc}/${n}  (${pct(aciertos_marc/n)})`);
  console.log(`  MAE goles (prom)   : ${mae_prom.toFixed(3)}`);
  console.log(`  Brier 1X2 (prom)   : ${brier_prom.toFixed(3)}`);
}

// ── Guardar JSON en reports/ ──────────────────────────────────────────────────

console.log('\n[3/3] Guardando reporte…');

const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const nombreArchivo = `auditoria_j1_predicciones_${ts}.json`;
const rutaArchivo   = resolve(reportsDir, nombreArchivo);

const reporte = {
  generado_en:     new Date().toISOString(),
  jornada:         1,
  version_modelo_auditada: 'todas (sin filtro de versión)',
  total:           filas.length,
  conteo: {
    auditados:      n,
    sin_prediccion: sinPrediccion.length,
    sin_resultado:  sinResultado.length,
    incompletas:    incompletas.length,
  },
  metricas_globales: resumenMetricas,
  detalle:         filas,
};

writeFileSync(rutaArchivo, JSON.stringify(reporte, null, 2), 'utf-8');
console.log(`  → reports/${nombreArchivo}`);

// ── MODO WRITE: guardar auditoria_predicciones/{matchId} ─────────────────────

if (MODO_WRITE) {
  console.log('\n  Guardando auditoria_predicciones/{matchId} en Firestore…\n');

  let guardados = 0, errores_write = 0;

  for (const fila of filas) {
    const { matchId, estado } = fila;

    const documento = {
      matchId,
      jornada:              1,
      nombre:               fila.nombre,
      version_modelo:       fila.version_modelo   ?? null,
      estado,
      razon_incompleta:     fila.razon_incompleta ?? null,
      meta_v1:              fila.meta_v1          ?? null,
      // Predicción
      pred_1x2:             fila.pred_1x2             ?? null,
      pred_ganador_1x2:     fila.pred_ganador_1x2     ?? null,
      pred_ou25:            fila.pred_ou25             ?? null,
      pred_btts:            fila.pred_btts             ?? null,
      pred_marcador:        fila.pred_marcador         ?? null,
      pred_lambda_local:    fila.pred_lambda_local     ?? null,
      pred_lambda_visitante: fila.pred_lambda_visitante ?? null,
      // Resultado
      real_goles_local:     fila.real_goles_local      ?? null,
      real_goles_visitante: fila.real_goles_visitante  ?? null,
      real_1x2:             fila.real_1x2              ?? null,
      real_ou25:            fila.real_ou25             ?? null,
      real_btts:            fila.real_btts             ?? null,
      // Métricas
      acierto_1x2:          fila.acierto_1x2           ?? null,
      acierto_ou25:         fila.acierto_ou25          ?? null,
      acierto_btts:         fila.acierto_btts          ?? null,
      acierto_marcador_exacto: fila.acierto_marcador_exacto ?? null,
      mae_goles:            fila.mae_goles             ?? null,
      error_goles_local:    fila.error_goles_local     ?? null,
      error_goles_visitante: fila.error_goles_visitante ?? null,
      brier_1x2:            fila.brier_1x2             ?? null,
      // Metadata
      auditado_en:          FieldValue.serverTimestamp(),
      notas:                null,
    };

    try {
      await db.collection('auditoria_predicciones').doc(matchId).set(documento);
      console.log(`  ✓ auditoria_predicciones/${matchId}  (${estado})`);
      guardados++;
    } catch (err) {
      console.error(`  ✗ auditoria_predicciones/${matchId}: ${err.message}`);
      errores_write++;
    }
  }

  console.log(`\n  Guardados: ${guardados}   Errores: ${errores_write}`);
} else {
  console.log('\n  0 escrituras Firestore. Usa --write para guardar auditoria_predicciones/.');
}

console.log('\n' + '═'.repeat(76) + '\n');

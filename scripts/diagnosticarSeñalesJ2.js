/**
 * diagnosticarSeñalesJ2.js — Diagnóstico de señales_valor para los 24 partidos J2.
 *
 * SOLO LECTURA. Zero escrituras Firestore.
 *
 * Por cada matchId en config/j2_ids.json comprueba:
 *   1. predicciones/{matchId} — existencia y campos de señales/odds
 *   2. odds_snapshots/{matchId}_* — cuántos snapshots, qué mercados tienen
 *
 * Diagnósticos posibles:
 *   OK                       — tiene señales_valor
 *   SENALES_EN_CAMPO_DISTINTO — señales en otro campo (no señales_valor)
 *   ODDS_EXISTEN_PERO_NO_SENALES — snapshot con h2h/totals pero sin señales_valor
 *   PREDICCION_INCOMPLETA    — falta lambda_local o prob_1x2
 *   SIN_ODDS                 — sin snapshot asociado
 */

import 'dotenv/config';
import { readFileSync }  from 'fs';
import { resolve }       from 'path';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

import '../src/firebase/init.js';

const db = getFirestore();

// ── Campos donde podrían estar las señales ────────────────────────────────────

const CAMPOS_SENALES = [
  'señales_valor',
  'senales_valor',
  'señales',
  'senales',
  'recomendaciones',
  'comparacion_mercado',
  'señales_de_valor',
  'senales_de_valor',
  'valor_signals',
  'señales_protegidas',
  'senales_protegidas',
  'señales_valor_filtradas',
];

// ── Campos que confirman una predicción V2 completa ───────────────────────────

const CAMPOS_PREDICCION_COMPLETA = [
  'lambda_local',
  'lambda_visitante',
  'prob_1x2',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function diagnosticar({ prediccionExiste, prediccionCompleta, campoSenalesReal, oddsSnapshotsCount, snapshotTieneOdds }) {
  if (!prediccionExiste)                    return 'PREDICCION_AUSENTE';
  if (!prediccionCompleta)                  return 'PREDICCION_INCOMPLETA';
  if (campoSenalesReal === 'señales_valor') return 'OK';
  if (campoSenalesReal)                     return 'SENALES_EN_CAMPO_DISTINTO';
  if (oddsSnapshotsCount > 0 && snapshotTieneOdds) return 'ODDS_EXISTEN_PERO_NO_SENALES';
  return 'SIN_ODDS';
}

// ── Cargar config/j2_ids.json ─────────────────────────────────────────────────

const configPath = resolve('config', 'j2_ids.json');
const rawConfig  = JSON.parse(readFileSync(configPath, 'utf-8'));
const J2_IDS     = Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []);

if (J2_IDS.length === 0) {
  console.error('ERROR: config/j2_ids.json está vacío. Ejecuta primero generarConfigJ2Ids.js');
  process.exit(1);
}

// ── Cabecera ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  diagnosticarSeñalesJ2 — SOLO LECTURA');
console.log('═'.repeat(76));
console.log(`\n  ${J2_IDS.length} matchIds desde config/j2_ids.json\n`);

// ── Diagnóstico por partido ───────────────────────────────────────────────────

const filas = [];

for (const entrada of J2_IDS) {
  const matchId = String(entrada.matchId);
  const partido = `${entrada.local} vs ${entrada.visitante}`;

  // ── Leer predicciones/{matchId} ──────────────────────────────────────────

  const predSnap = await db.collection('predicciones').doc(matchId).get();
  const prediccionExiste = predSnap.exists;
  const pred = prediccionExiste ? predSnap.data() : null;

  // Completitud de la predicción (tiene lambdas + prob_1x2)
  const prediccionCompleta = prediccionExiste &&
    CAMPOS_PREDICCION_COMPLETA.every(c => pred[c] != null);

  // Versión del modelo
  const versionModelo = pred?.version_modelo ?? null;

  // Buscar campo donde están las señales
  let campoSenalesReal = null;
  let campoSenalesCount = 0;
  if (prediccionExiste) {
    for (const campo of CAMPOS_SENALES) {
      const val = pred[campo];
      if (Array.isArray(val) && val.length > 0) {
        campoSenalesReal  = campo;
        campoSenalesCount = val.length;
        break;
      }
    }
  }

  // ultimo_odds_snapshot_id
  const ultimoSnapshotId = pred?.ultimo_odds_snapshot_id ?? null;

  // Otros campos odds/señales presentes (para diagnóstico extra)
  const camposExtra = prediccionExiste
    ? Object.keys(pred).filter(k =>
        k.includes('odds') || k.includes('senal') || k.includes('señal') ||
        k.includes('mercado') || k.includes('recomend') || k.includes('snapshot')
      )
    : [];

  // ── Buscar odds_snapshots para este matchId ───────────────────────────────
  // IDs tienen formato: {matchId}_{YYYYMMDDHHmmss}
  // Usamos range query en document ID.

  const snapQuery = await db.collection('odds_snapshots')
    .where(FieldPath.documentId(), '>=', `${matchId}_`)
    .where(FieldPath.documentId(), '<',  `${matchId}_￿`)
    .get();

  const oddsSnapshotsCount = snapQuery.size;

  // Analizar el snapshot más reciente (ordenar IDs en JS: YYYYMMDDHHmmss → sort desc)
  let ultimoSnapshot        = null;
  let snapshotTieneH2h      = false;
  let snapshotTieneTotals   = false;
  let snapshotTieneSpreads  = false;
  let snapshotCapturadoEn   = null;

  if (oddsSnapshotsCount > 0) {
    const docsSorted = snapQuery.docs.slice().sort((a, b) => b.id.localeCompare(a.id));
    const docMasReciente = docsSorted[0];
    ultimoSnapshot       = docMasReciente.id;
    const sd             = docMasReciente.data();
    snapshotTieneH2h     = !!(sd.mercados?.h2h);
    snapshotTieneTotals  = !!(sd.mercados?.totals);
    snapshotTieneSpreads = !!(sd.mercados?.spreads);
    snapshotCapturadoEn  = sd.capturado_en ?? null;
  }

  const snapshotTieneOdds = snapshotTieneH2h || snapshotTieneTotals;

  // ── Diagnóstico ───────────────────────────────────────────────────────────

  const diag = diagnosticar({
    prediccionExiste,
    prediccionCompleta,
    campoSenalesReal,
    oddsSnapshotsCount,
    snapshotTieneOdds,
  });

  const icon = {
    'OK':                          '✓',
    'SENALES_EN_CAMPO_DISTINTO':   '~',
    'ODDS_EXISTEN_PERO_NO_SENALES':'!',
    'PREDICCION_INCOMPLETA':       '⚠',
    'PREDICCION_AUSENTE':          '✗',
    'SIN_ODDS':                    '○',
  }[diag] ?? '?';

  console.log(`  ${icon} ${matchId.padEnd(8)} ${partido}`);
  console.log(`    prediccion: ${prediccionExiste ? `existe (v${versionModelo ?? '?'})` : 'AUSENTE'}${prediccionCompleta ? '' : '  ← INCOMPLETA'}`);
  console.log(`    señales_valor: ${campoSenalesReal ? `campo="${campoSenalesReal}" (${campoSenalesCount} señales)` : 'AUSENTE'}`);
  console.log(`    ultimo_odds_snapshot_id: ${ultimoSnapshotId ?? '(no definido)'}`);
  console.log(`    odds_snapshots en Firestore: ${oddsSnapshotsCount}${ultimoSnapshot ? `  → último: ${ultimoSnapshot}` : ''}`);

  if (oddsSnapshotsCount > 0) {
    const mkt = [
      snapshotTieneH2h     ? 'h2h'     : null,
      snapshotTieneTotals  ? 'totals'  : null,
      snapshotTieneSpreads ? 'spreads' : null,
    ].filter(Boolean);
    console.log(`    mercados en último snapshot: ${mkt.length > 0 ? mkt.join(', ') : '(ninguno)'}${snapshotCapturadoEn ? `  @ ${snapshotCapturadoEn.slice(0, 16)}` : ''}`);
  }

  if (camposExtra.length > 0) {
    console.log(`    campos odds/señales en doc: ${camposExtra.join(', ')}`);
  }

  console.log(`    → DIAGNÓSTICO: ${diag}`);
  console.log('');

  filas.push({
    matchId,
    partido,
    prediccion_existe:          prediccionExiste,
    version_modelo:             versionModelo,
    prediccion_completa:        prediccionCompleta,
    tiene_senales_valor:        campoSenalesReal === 'señales_valor',
    campo_real_senales:         campoSenalesReal,
    count_senales:              campoSenalesCount,
    ultimo_odds_snapshot_id:    ultimoSnapshotId,
    odds_snapshots_count:       oddsSnapshotsCount,
    ultimo_snapshot_id:         ultimoSnapshot,
    snapshot_tiene_h2h:         snapshotTieneH2h,
    snapshot_tiene_totals:      snapshotTieneTotals,
    snapshot_tiene_spreads:     snapshotTieneSpreads,
    snapshot_capturado_en:      snapshotCapturadoEn,
    campos_extra_en_pred:       camposExtra,
    diagnostico:                diag,
  });
}

// ── Resumen ───────────────────────────────────────────────────────────────────

const conteo = {};
for (const f of filas) {
  conteo[f.diagnostico] = (conteo[f.diagnostico] ?? 0) + 1;
}

console.log('═'.repeat(76));
console.log('  RESUMEN');
console.log('─'.repeat(76));
console.log(`  Total J2                      : ${filas.length}`);
console.log(`  OK (tienen señales_valor)     : ${conteo['OK'] ?? 0}`);
console.log(`  SENALES_EN_CAMPO_DISTINTO     : ${conteo['SENALES_EN_CAMPO_DISTINTO'] ?? 0}`);
console.log(`  ODDS_EXISTEN_PERO_NO_SENALES  : ${conteo['ODDS_EXISTEN_PERO_NO_SENALES'] ?? 0}`);
console.log(`  PREDICCION_INCOMPLETA         : ${conteo['PREDICCION_INCOMPLETA'] ?? 0}`);
console.log(`  PREDICCION_AUSENTE            : ${conteo['PREDICCION_AUSENTE'] ?? 0}`);
console.log(`  SIN_ODDS                      : ${conteo['SIN_ODDS'] ?? 0}`);
console.log('─'.repeat(76));

const conSnapshots  = filas.filter(f => f.odds_snapshots_count > 0);
const sinSnapshots  = filas.filter(f => f.odds_snapshots_count === 0);
const conSnapshotId = filas.filter(f => f.ultimo_odds_snapshot_id);

console.log(`  Predicciones con ultimo_odds_snapshot_id : ${conSnapshotId.length}/24`);
console.log(`  Predicciones con odds_snapshots en BD    : ${conSnapshots.length}/24`);
console.log(`  Predicciones sin ningún snapshot         : ${sinSnapshots.length}/24`);

if (sinSnapshots.length > 0) {
  console.log('\n  Próximo paso sugerido:');
  console.log('    → node scripts/guardarSeñalesProtegidaJ2.js --write');
  console.log('       o');
  console.log('    → node scripts/actualizarSenalesConOdds.js --matchIds <ids> --write');
}

console.log('═'.repeat(76));
console.log('');

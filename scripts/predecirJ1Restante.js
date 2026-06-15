/**
 * predecirJ1Restante.js
 *
 * Genera predicciones V2.1-psico-context para los 12 partidos restantes de la
 * Jornada 1 del Mundial 2026.
 *
 * Modos:
 *   (sin flags) / --dry-run  — calcula y muestra predicciones, NO escribe Firestore
 *   --write                  — escribe en predicciones/{matchId}
 *   --write --force          — sobreescribe predicciones existentes
 *
 * Restricciones:
 *   - NO llama Claude API.
 *   - NO llama The Odds API automáticamente.
 *   - NO modifica Prediction Engine, poisson.js, contextAdjustments.js.
 *   - NO recalibra pesos.
 *   - Advierte si el partido ya está en juego o terminado.
 *   - NO sobreescribe predicciones existentes sin --force.
 */

import 'dotenv/config';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import '../src/firebase/init.js';
import { obtenerPartidosMundial }  from '../src/data/pipeline/footballData.js';
import { predecirPartidoCompleto } from '../src/core/prediction/predecirPartidoCompleto.js';
import { guardarPrediccion }       from '../src/firebase/predicciones.js';

// ── Argumentos ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const WRITE   = args.includes('--write');
const DRY_RUN = !WRITE;
const FORCE   = args.includes('--force');

// ── Partidos J1 restante ──────────────────────────────────────────────────────

const J1_RESTANTE = [
  { matchId: 537369, local: 'Spain',        visitante: 'Cape Verde Islands' },
  { matchId: 537363, local: 'Belgium',      visitante: 'Egypt'              },
  { matchId: 537370, local: 'Saudi Arabia', visitante: 'Uruguay'            },
  { matchId: 537364, local: 'Iran',         visitante: 'New Zealand'        },
  { matchId: 537391, local: 'France',       visitante: 'Senegal'            },
  { matchId: 537392, local: 'Iraq',         visitante: 'Norway'             },
  { matchId: 537397, local: 'Argentina',    visitante: 'Algeria'            },
  { matchId: 537398, local: 'Austria',      visitante: 'Jordan'             },
  { matchId: 537403, local: 'Portugal',     visitante: 'Congo DR'           },
  { matchId: 537409, local: 'England',      visitante: 'Croatia'            },
  { matchId: 537410, local: 'Ghana',        visitante: 'Panama'             },
  { matchId: 537404, local: 'Uzbekistan',   visitante: 'Colombia'           },
];

const db       = getFirestore();
const pct      = n  => (n  != null ? `${(n  * 100).toFixed(1)}%` : '—');
const fix3     = n  => (n  != null ? n.toFixed(3) : '—');
const deltaStr = d  => (d  != null ? `${d >= 0 ? '+' : ''}${d}%` : '');

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  PREDICCIONES J1 RESTANTE — V2.1-psico-context');
console.log(`  Modo     : ${DRY_RUN ? 'DRY-RUN (sin escrituras Firestore)' : 'WRITE'}`);
if (!DRY_RUN && FORCE) console.log('  FORCE    : sobreescribirá predicciones existentes');
console.log(`  Partidos : ${J1_RESTANTE.length}`);
console.log('═'.repeat(76));

// ── 1. Fixture del Mundial (status + kickoff) ─────────────────────────────────

console.log('\n  [football-data: leyendo fixture para status y kickoffs]');
const fixtures   = await obtenerPartidosMundial();
const fixtureMap = new Map(fixtures.map(f => [f.id, f]));

// ── 2. Leer predicciones existentes en Firestore (batch) ─────────────────────

console.log('  Leyendo predicciones existentes en Firestore...');
const predExistente = new Map();

await Promise.all(J1_RESTANTE.map(async ({ matchId }) => {
  const snap = await db.collection('predicciones').doc(String(matchId)).get();
  if (snap.exists) predExistente.set(matchId, snap.data());
}));

const nExistentes = predExistente.size;
console.log(`  Predicciones existentes en predicciones/: ${nExistentes} de ${J1_RESTANTE.length}`);

if (nExistentes > 0) {
  for (const [id, pred] of predExistente) {
    const ge = pred.generado_en?.toDate?.()?.toISOString?.() ?? pred.generado_en ?? '?';
    console.log(`    ${id}: versión=${pred.version_modelo ?? '?'}  generado_en=${ge}`);
  }
}

// ── 3. Generar predicciones ───────────────────────────────────────────────────

console.log('\n' + '─'.repeat(76));

const TIPO_CORRIDA               = 'prediccion_pre_partido';
const GENERADO_DESPUES_DEL_PARTIDO = false;

const resumen  = [];
let nOk = 0, nSkip = 0, nErr = 0;

for (const { matchId, local, visitante } of J1_RESTANTE) {
  const fixture = fixtureMap.get(matchId);
  const status  = fixture?.status ?? 'UNKNOWN';
  const kickoff = fixture?.utcDate ?? null;
  const grupo   = fixture?.group   ?? null;
  const ahoraMs = Date.now();
  const kickoffMs = kickoff ? new Date(kickoff).getTime() : null;
  const antesDel  = kickoffMs != null ? ahoraMs < kickoffMs : true;

  const titulo = `${local} vs ${visitante}`;
  console.log(`\n  ${matchId}  ${titulo}`);
  console.log(`    kickoff: ${kickoff?.slice(0, 16).replace('T', ' ')} UTC  |  grupo: ${grupo ?? '?'}  |  status: ${status}`);

  // ── Guard: no predecir partidos terminados ─────────────────────────────────
  if (status === 'FINISHED') {
    if (!FORCE) {
      console.log(`    SKIP  — partido FINISHED. Usa --force para forzar predicción post-partido.`);
      resumen.push({ matchId, titulo, accion: 'skip', motivo: 'FINISHED' });
      nSkip++;
      continue;
    }
    console.log(`    AVISO — partido FINISHED. --force activo, generando de todos modos.`);
  } else if (status === 'IN_PLAY' || status === 'PAUSED') {
    console.log(`    AVISO — partido ${status}. Predicción corresponde al estado pre-partido.`);
  }

  // ── Guard: predicción existente ────────────────────────────────────────────
  const predActual = predExistente.get(matchId);
  if (predActual && !FORCE) {
    if (DRY_RUN) {
      const ge = predActual.generado_en?.toDate?.()?.toISOString?.() ?? predActual.generado_en ?? '?';
      console.log(`    AVISO — ya existe predicciones/${matchId}  v=${predActual.version_modelo ?? '?'}  (${ge})`);
      console.log(`            con --write se omitiría (usar --write --force para sobreescribir)`);
    } else {
      const ge = predActual.generado_en?.toDate?.()?.toISOString?.() ?? predActual.generado_en ?? '?';
      console.log(`    SKIP  — ya existe predicciones/${matchId}  v=${predActual.version_modelo ?? '?'}  (${ge})`);
      console.log(`            usa --force para sobreescribir.`);
      resumen.push({ matchId, titulo, accion: 'skip', motivo: 'ya_existe' });
      nSkip++;
      continue;
    }
  }

  // ── Odds snapshot existente ────────────────────────────────────────────────
  const oddsSnapshotId = predActual?.ultimo_odds_snapshot_id ?? null;

  // ── Calcular predicción ────────────────────────────────────────────────────
  process.stdout.write(`    Calculando predicción...`);
  let pred;
  try {
    pred = await predecirPartidoCompleto(matchId);
    process.stdout.write(' ✓\n');
  } catch (err) {
    process.stdout.write(' ✗\n');
    console.error(`    ERROR: ${err.message}`);
    resumen.push({ matchId, titulo, accion: 'error', motivo: err.message });
    nErr++;
    continue;
  }

  // ── Extraer valores para mostrar ──────────────────────────────────────────
  const am            = pred.ajustes_modelo ?? {};
  const lbL           = am.lambda_base_local;
  const lbV           = am.lambda_base_visitante;
  const lfL           = am.lambda_final_local     ?? pred.lambda_local;
  const lfV           = am.lambda_final_visitante ?? pred.lambda_visitante;
  const dL            = am.delta_lambda_local_pct;
  const dV            = am.delta_lambda_visit_pct;
  const psicoActivo   = am.psicodeportivo_activo        ?? false;
  const rankingActivo = am.contexto_mundialista_activo  ?? false;
  const psicoRef      = pred.analisis_psicologico_ref   ?? null;
  const ou            = pred.prob_over_under ?? {};
  const mm            = pred.marcador_mas_probable ?? {};
  const btts          = pred.prob_btts ?? {};
  const p1x2          = pred.prob_1x2  ?? {};
  const nL            = pred.muestra_local?.n_partidos ?? 0;
  const nV            = pred.muestra_visitante?.n_partidos ?? 0;
  const fL            = (pred.muestra_local?.fuente ?? '').replace('fotmob_mundial_2026+historial','wc+hist').replace('fotmob_mundial_2026','wc').replace('default_mu_liga','default');
  const fV            = (pred.muestra_visitante?.fuente ?? '').replace('fotmob_mundial_2026+historial','wc+hist').replace('fotmob_mundial_2026','wc').replace('default_mu_liga','default');

  // ── Mostrar predicción ─────────────────────────────────────────────────────
  console.log(`    version_modelo         : 2.1-psico-context`);
  console.log(`    tipo_corrida           : ${TIPO_CORRIDA}`);
  console.log(`    generado_antes_del_partido : ${antesDel}`);
  console.log(`    generado_despues_del_partido: ${GENERADO_DESPUES_DEL_PARTIDO}`);
  console.log(`    psicodeportivo_activo  : ${psicoActivo}`);
  console.log(`    analisis_psicologico_ref : ${psicoRef ?? 'null'}`);
  console.log(`    ranking_ajuste_activo  : ${rankingActivo}`);
  console.log(`    muestra               : local n=${nL} (${fL}) | visit n=${nV} (${fV})`);
  console.log('');
  console.log(`    lambda_base_local      : ${fix3(lbL)}`);
  console.log(`    lambda_final_local     : ${fix3(lfL)}  (${deltaStr(dL)})`);
  console.log(`    lambda_base_visitante  : ${fix3(lbV)}`);
  console.log(`    lambda_final_visitante : ${fix3(lfV)}  (${deltaStr(dV)})`);
  console.log('');
  console.log(`    1X2  : L ${pct(p1x2.local)}  X ${pct(p1x2.empate)}  V ${pct(p1x2.visitante)}`);
  console.log(`    O/U 1.5 : over ${pct(ou['1.5']?.over)}  under ${pct(ou['1.5']?.under)}`);
  console.log(`    O/U 2.5 : over ${pct(ou['2.5']?.over)}  under ${pct(ou['2.5']?.under)}`);
  console.log(`    O/U 3.5 : over ${pct(ou['3.5']?.over)}  under ${pct(ou['3.5']?.under)}`);
  console.log(`    BTTS    : sí ${pct(btts.si)}  no ${pct(btts.no)}`);
  console.log(`    Marcador más probable  : ${mm.local ?? '?'}-${mm.visitante ?? '?'}  (prob ${pct(mm.prob)})`);
  console.log('');
  console.log(`    odds_snapshot_ref      : ${oddsSnapshotId ? `odds_snapshots/${oddsSnapshotId}` : 'sin odds snapshot'}`);
  console.log(`    apuestas/señales       : ${oddsSnapshotId ? 'posibles (hay odds)' : 'no calculables (sin odds)'}`);

  // ── Decisión de escritura ─────────────────────────────────────────────────
  let accion;
  if (DRY_RUN) {
    const yaExiste = !!predActual;
    accion = yaExiste ? 'dry-run (sobreescribiría con --force)' : 'dry-run (escribiría con --write)';
    console.log(`    → se guardaría: ${!yaExiste || FORCE ? 'SÍ' : 'NO (ya existe — requiere --force)'}`);
  } else {
    // Ya filtramos los SKIP arriba; si llegamos aquí, procedemos a escribir
    const datosAGuardar = {
      ...pred,
      tipo_corrida:               TIPO_CORRIDA,
      generado_antes_del_partido: antesDel,
      generado_despues_del_partido: GENERADO_DESPUES_DEL_PARTIDO,
      ...(oddsSnapshotId ? { odds_snapshot_ref: `odds_snapshots/${oddsSnapshotId}` } : {}),
    };

    try {
      process.stdout.write(`    Guardando en predicciones/${matchId}... `);
      await guardarPrediccion(matchId, datosAGuardar);
      process.stdout.write('✓\n');
      accion = 'guardado';
      nOk++;
    } catch (err) {
      process.stdout.write('✗\n');
      console.error(`    ERROR al guardar: ${err.message}`);
      accion = `error: ${err.message}`;
      nErr++;
    }
  }

  resumen.push({
    matchId,
    titulo,
    status,
    kickoff:      kickoff?.slice(0, 16).replace('T', ' '),
    psicoActivo,
    rankingActivo,
    lbL: fix3(lbL), lfL: fix3(lfL), dL: deltaStr(dL),
    lbV: fix3(lbV), lfV: fix3(lfV), dV: deltaStr(dV),
    pL: pct(p1x2.local), pE: pct(p1x2.empate), pV: pct(p1x2.visitante),
    marcador: `${mm.local ?? '?'}-${mm.visitante ?? '?'}`,
    ou25over: pct(ou['2.5']?.over),
    btts_si: pct(btts.si),
    odds: oddsSnapshotId ?? null,
    accion: DRY_RUN ? (predActual && !FORCE ? 'dry-run-skip' : 'dry-run-ok') : accion,
  });

}

// ── Tabla resumen ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  TABLA RESUMEN');
console.log('─'.repeat(76));
console.log(
  'matchId'.padEnd(8) +
  'Partido'.padEnd(32) +
  '1X2'.padEnd(18) +
  'Marcador'.padEnd(10) +
  'O/U2.5ov'.padEnd(10) +
  'Psico'.padEnd(6) +
  'Acción'
);
console.log('─'.repeat(76));

for (const r of resumen) {
  const ox2 = `${r.pL} ${r.pE} ${r.pV}`;
  const psico = r.psicoActivo ? 'sí' : 'no';
  console.log(
    String(r.matchId).padEnd(8) +
    r.titulo.slice(0, 30).padEnd(32) +
    ox2.padEnd(18) +
    (r.marcador ?? '?').padEnd(10) +
    (r.ou25over ?? '—').padEnd(10) +
    psico.padEnd(6) +
    (r.accion ?? '?')
  );
}

console.log('─'.repeat(76));
if (DRY_RUN) {
  console.log(`\n  DRY-RUN completado.`);
  console.log(`  Omitidos (status/existe): ${nSkip}  |  Errores: ${nErr}`);
  console.log('');
  console.log('  Para escribir en Firestore:');
  console.log('    node scripts/predecirJ1Restante.js --write');
  console.log('    node scripts/predecirJ1Restante.js --write --force  (sobreescribir existentes)');
  console.log('');
  console.log('  Para capturar odds después:');
  console.log('    node scripts/guardarOddsDelDia.js YYYY-MM-DD');
} else {
  console.log(`\n  Guardados: ${nOk}  |  Omitidos: ${nSkip}  |  Errores: ${nErr}`);
}

console.log('═'.repeat(76));

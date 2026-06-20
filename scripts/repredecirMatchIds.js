/**
 * repredecirMatchIds.js — Re-corre predicciones para matchIds específicos.
 *
 * Uso:
 *   node scripts/repredecirMatchIds.js --matchIds <id> [id...] [--dry-run]
 *   node scripts/repredecirMatchIds.js --matchIds 537353 537354 --write
 *
 * Modos:
 *   --dry-run (default)  — calcula predicción pero NO guarda en Firestore
 *   --write              — guarda en predicciones/{matchId} via setDoc
 *
 * A diferencia de predecirJ2ConHistorial.js, NO filtra por estado del partido
 * (TIMED/SCHEDULED/FINISHED). Util para re-correr partidos ya jugados o con
 * datos actualizados de J1.
 */

import 'dotenv/config';
import '../src/firebase/init.js';
import { obtenerPartidosMundial }      from '../src/data/pipeline/footballData.js';
import { predecirPartidoCompleto }     from '../src/core/prediction/predecirPartidoCompleto.js';
import { guardarPrediccion }           from '../src/firebase/predicciones.js';

const args     = process.argv.slice(2);
const WRITE    = args.includes('--write');
const DRY_RUN  = !WRITE;

const matchIdsFlagIdx = args.indexOf('--matchIds');
const matchIds = matchIdsFlagIdx !== -1
  ? args.slice(matchIdsFlagIdx + 1)
      .filter(a => !a.startsWith('--'))
      .flatMap(a => a.split(','))
      .filter(a => /^\d+$/.test(a))
  : [];

if (matchIds.length === 0) {
  console.error('\n  ERROR: debes pasar al menos un matchId.');
  console.error('  Uso: node scripts/repredecirMatchIds.js --matchIds 537353 537359 [--write]\n');
  process.exit(1);
}

const pct = n => `${(n * 100).toFixed(1)}%`;
const SEP = '─'.repeat(70);

console.log('\n' + '═'.repeat(70));
console.log(`  RE-PREDECIR matchIds específicos`);
console.log(`  Modo    : ${DRY_RUN ? 'DRY-RUN (sin escrituras Firestore)' : 'WRITE'}`);
console.log(`  MatchIds: ${matchIds.join(', ')}`);
console.log('═'.repeat(70) + '\n');

const fixtures = await obtenerPartidosMundial();

let ok = 0, errores = 0;

for (const matchId of matchIds) {
  const fixture = fixtures.find(p => String(p.id) === String(matchId));

  if (!fixture) {
    console.error(`  ✗  ${matchId}: no encontrado en el fixture del Mundial 2026\n${SEP}\n`);
    errores++;
    continue;
  }

  const local     = fixture.homeTeam?.name ?? '?';
  const visitante = fixture.awayTeam?.name ?? '?';
  const fecha     = fixture.utcDate?.slice(0, 10) ?? '?';
  const grupo     = fixture.group ?? fixture.stage ?? '?';
  const status    = fixture.status ?? '?';

  process.stdout.write(`[${fecha}] ${grupo}  ${local} vs ${visitante}  (status: ${status})\n  → calculando... `);

  try {
    const prediccion = await predecirPartidoCompleto(Number(matchId));

    const am          = prediccion.ajustes_modelo;
    const lambdaBaseL = am?.lambda_base_local?.toFixed(3) ?? '?';
    const lambdaBaseV = am?.lambda_base_visitante?.toFixed(3) ?? '?';
    const deltaL      = am?.delta_lambda_local_pct != null ? `${am.delta_lambda_local_pct > 0 ? '+' : ''}${am.delta_lambda_local_pct}%` : '';
    const deltaV      = am?.delta_lambda_visit_pct != null ? `${am.delta_lambda_visit_pct > 0 ? '+' : ''}${am.delta_lambda_visit_pct}%` : '';
    const psicoTag    = am?.psicodeportivo_activo ? ' [psico]' : '';

    if (WRITE) {
      process.stdout.write('guardando en Firestore... ');
      await guardarPrediccion(Number(matchId), prediccion);
      process.stdout.write('✓\n');
    } else {
      process.stdout.write('✓ (dry-run)\n');
    }

    console.log(`  λ base : ${lambdaBaseL} — ${lambdaBaseV}`);
    console.log(`  λ final: ${prediccion.lambda_local?.toFixed(3)} (${deltaL}) — ${prediccion.lambda_visitante?.toFixed(3)} (${deltaV})${psicoTag}`);
    console.log(`  1X2    : L ${pct(prediccion.prob_1x2?.local)}  X ${pct(prediccion.prob_1x2?.empate)}  V ${pct(prediccion.prob_1x2?.visitante)}`);
    console.log(`  OU2.5  : over ${pct(prediccion.prob_over_under?.['2.5']?.over)}  under ${pct(prediccion.prob_over_under?.['2.5']?.under)}`);
    console.log(`  MMP    : ${prediccion.marcador_mas_probable?.local}-${prediccion.marcador_mas_probable?.visitante}  (${pct(prediccion.marcador_mas_probable?.prob)})`);
    console.log(`  Versión: ${prediccion.version_modelo ?? '?'}\n${SEP}\n`);

    ok++;
  } catch (err) {
    process.stdout.write('✗\n');
    console.error(`  ERROR: ${err.message}\n${SEP}\n`);
    errores++;
  }
}

console.log('═'.repeat(70));
console.log(`  Completado: ${ok} OK  |  ${errores} errores`);
console.log(WRITE ? `  ${ok} predicciones actualizadas en Firestore.` : '  Modo dry-run — 0 escrituras.');
console.log('═'.repeat(70) + '\n');

process.exit(errores > 0 ? 1 : 0);

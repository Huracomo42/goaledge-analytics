/**
 * dryrunPrediccionUnica.js — Predicción completa sin escritura en Firestore.
 *
 * Muestra el resultado de predecirPartidoCompleto() incluyendo ajustes_modelo.
 * No escribe en predicciones/{matchId}.
 *
 * Uso: node scripts/dryrunPrediccionUnica.js [matchId]
 * Default: 537329 (Czechia vs South Africa, J2 GROUP_A)
 */

import { predecirPartidoCompleto } from '../src/core/prediction/predecirPartidoCompleto.js';

const matchId = Number(process.argv[2]) || 537329;

console.log('\n' + '═'.repeat(70));
console.log(`  DRY-RUN predicción — matchId ${matchId}  (0 escrituras Firestore)`);
console.log('═'.repeat(70));
console.log('  USAR_RANKING_FIFA env:', process.env.USAR_RANKING_FIFA ?? '(no definida)');
console.log('');

let resultado;
try {
  resultado = await predecirPartidoCompleto(matchId);
} catch (err) {
  console.error('ERROR en predecirPartidoCompleto:', err.message);
  process.exit(1);
}

const r  = resultado;
const am = r.ajustes_modelo;
const vc = am.variables_contexto_usadas;
const pct = n => `${(n * 100).toFixed(1)}%`;
const fmt = n => (n != null ? n.toFixed(4) : 'null');

console.log('─'.repeat(70));
console.log(`  Partido  : ${r.nombreLocal} vs ${r.nombreVisitante}`);
console.log(`  Fecha    : ${r.fechaPartido}   Grupo: ${r.grupo ?? '-'}   J${r.jornadaGrupo ?? '-'}`);
console.log(`  Versión  : ${r.version_modelo}`);
console.log('─'.repeat(70));

// ── Rankings ─────────────────────────────────────────────────────────────────
console.log('\n  BLOQUE RANKING FIFA');
console.log(`  rankings_fuente       : ${vc.ranking_fuente_estado}`);
console.log(`  ranking_ajuste_activo : ${vc.ranking_ajuste_activo}`);
console.log(`  ranking_fifa_local    : ${vc.ranking_fifa_local ?? 'null (no aplicado)'}`);
console.log(`  ranking_fifa_visitante: ${vc.ranking_fifa_visitante ?? 'null (no aplicado)'}`);
console.log(`  ajuste_ranking_local  : ${am.ajuste_contexto_local?.breakdown?.ajuste_ranking ?? 0}`);
console.log(`  ajuste_ranking_visit  : ${am.ajuste_contexto_visitante?.breakdown?.ajuste_ranking ?? 0}`);

// ── Lambda base vs final ──────────────────────────────────────────────────────
console.log('\n  LAMBDA BASE vs FINAL');
console.log(`  lambda_base_local     : ${fmt(am.lambda_base_local)}`);
console.log(`  lambda_final_local    : ${fmt(am.lambda_final_local)}   delta: ${am.delta_lambda_local_pct}%`);
console.log(`  lambda_base_visitante : ${fmt(am.lambda_base_visitante)}`);
console.log(`  lambda_final_visitante: ${fmt(am.lambda_final_visitante)}   delta: ${am.delta_lambda_visit_pct}%`);

// ── Probabilidades ────────────────────────────────────────────────────────────
console.log('\n  PROBABILIDADES (de la matriz Poisson ajustada)');
console.log(`  1X2  : L ${pct(r.prob_1x2.local)}  X ${pct(r.prob_1x2.empate)}  V ${pct(r.prob_1x2.visitante)}`);
console.log(`  O2.5 : Over ${pct(r.prob_over_under['2.5']?.over)}  Under ${pct(r.prob_over_under['2.5']?.under)}`);
console.log(`  BTTS : Sí ${pct(r.prob_btts.si)}  No ${pct(r.prob_btts.no)}`);
console.log(`  MMP  : ${r.marcador_mas_probable.local}-${r.marcador_mas_probable.visitante}  (${pct(r.marcador_mas_probable.prob)})`);

// ── Ajustes desagregados ──────────────────────────────────────────────────────
console.log('\n  AJUSTES APLICADOS');
console.log(`  psico_activo  : ${am.psicodeportivo_activo}`);
console.log(`  ranking_activo: ${am.contexto_mundialista_activo}`);
console.log(`  ajuste_total_local    : ${am.ajuste_total_local}  exp→ ${Math.exp(am.ajuste_total_local).toFixed(5)}`);
console.log(`  ajuste_total_visitante: ${am.ajuste_total_visitante}  exp→ ${Math.exp(am.ajuste_total_visitante).toFixed(5)}`);

// ── Muestra base ──────────────────────────────────────────────────────────────
console.log('\n  MUESTRA ESTADÍSTICA');
console.log(`  Local   : n=${r.muestra_local.n_partidos}  fuente=${r.muestra_local.fuente}  pequeña=${r.muestra_local.muestra_pequena}`);
console.log(`  Visitante: n=${r.muestra_visitante.n_partidos}  fuente=${r.muestra_visitante.fuente}  pequeña=${r.muestra_visitante.muestra_pequena}`);

// ── Objeto ajustes_modelo completo ────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('  OBJETO ajustes_modelo COMPLETO');
console.log('═'.repeat(70));
console.log(JSON.stringify(am, null, 2));

console.log('\n' + '═'.repeat(70));
console.log('  0 escrituras en Firestore.');
console.log('═'.repeat(70) + '\n');

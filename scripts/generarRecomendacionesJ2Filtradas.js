/**
 * @deprecated SCRIPT DEPRECADO — No usar en producción.
 *
 * Usa filtrarSenalesApuesta() (lógica legacy de bloqueo binario) y no implementa
 * la taxonomía post-J1 (VALUE_BET / PROTECTED_ONLY / WATCHLIST / NO_BET).
 *
 * PIPELINE OFICIAL: scripts/generarRecomendacionesJ2FinalConservador.js
 *
 * Si lo ejecutas con --force-deprecated podrás continuar, pero los resultados
 * no son comparables con los del pipeline oficial.
 */

import process from 'process';
if (!process.argv.includes('--force-deprecated')) {
  console.error('\n' + '═'.repeat(76));
  console.error('  ⛔  SCRIPT DEPRECADO — No usar en producción.');
  console.error('');
  console.error('  Este script usa filtrarSenalesApuesta() (legacy) y no implementa');
  console.error('  la taxonomía post-J1. Los resultados no son comparables con el');
  console.error('  pipeline oficial.');
  console.error('');
  console.error('  PIPELINE OFICIAL:');
  console.error('    node scripts/generarRecomendacionesJ2FinalConservador.js');
  console.error('');
  console.error('  Si necesitas ejecutar este script de todos modos (análisis histórico):');
  console.error('    node scripts/generarRecomendacionesJ2Filtradas.js --force-deprecated');
  console.error('═'.repeat(76) + '\n');
  process.exit(1);
}

/**
 * generarRecomendacionesJ2Filtradas.js — Recomendaciones J2 con filtros de fragilidad.
 * [DEPRECADO — ver cabecera]
 *
 * Lee predicciones J2 de Firestore, aplica filtrarSenalesApuesta() a cada señal_valor,
 * y genera reporte Markdown + JSON.
 *
 * Flags:
 *   (ninguno)  → dry-run: sin escrituras Firestore, genera reports/ locales
 *   --execute  → además escribe señales_valor_filtradas + metadatos en Firestore
 *
 * GARANTÍAS:
 *   - No modifica señales_valor, lambda_*, prob_*, version_modelo ni campos V2.1.
 *   - Solo update() — nunca set().
 *   - No recalcula predicciones ni llama The Odds API.
 *   - 0 escrituras Firestore en dry-run (default).
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial }   from '../src/data/pipeline/footballData.js';
import {
  filtrarSenalesApuesta,
  FRAGILIDAD,
  ETIQUETA,
} from '../src/core/betting/signalFilters.js';

const db = getFirestore();

// ── Argumentos ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const MODO    = EXECUTE ? 'EXECUTE' : 'DRY-RUN';

// ── Rutas de salida ───────────────────────────────────────────────────────────

const REPORTS_DIR = resolve('reports');
const JSON_PATH   = resolve(REPORTS_DIR, 'recomendaciones_j2_filtradas_dryrun.json');
const MD_PATH     = resolve(REPORTS_DIR, 'recomendaciones_j2_filtradas_dryrun.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

const pct   = (n, d) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
const fmtEV = ev => ev != null ? `${(ev * 100).toFixed(1)}%` : '—';

// ── Cabecera ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log(`  generarRecomendacionesJ2Filtradas — MODO: ${MODO}`);
console.log('═'.repeat(76));

// ── [1/3] Obtener fixture J2 ──────────────────────────────────────────────────

console.log('\n[1/3] Obteniendo fixture J2 desde football-data.org…');
const todos = await obtenerPartidosMundial();
const j2 = todos
  .filter(p => p.matchday === 2)
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

console.log(`  ${j2.length} partidos J2 encontrados.`);

if (j2.length === 0) {
  console.error('ERROR: 0 partidos J2. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// ── [2/3] Leer predicciones + aplicar filtros ─────────────────────────────────

console.log('\n[2/3] Leyendo predicciones y aplicando filtros…\n');

const resultados = [];

let totalSenalesOrig      = 0;
let totalAprobadas        = 0;
let totalBloqueadas       = 0;
let partSinSenales        = 0;
let partSinAprobadas      = 0;
const bloqueosPorRegla    = {};
const bloqueosPorEtiqueta = {};
const bloqueadosPorMercado = {};
let alertasLambdaExtrema  = 0;
let h2hDegradadas         = 0;
let bttsBloqueadas        = 0;

for (const partido of j2) {
  const matchId = String(partido.id);
  const nombre  = `${partido.homeTeam?.name} vs ${partido.awayTeam?.name}`;

  const snap = await db.collection('predicciones').doc(matchId).get();

  if (!snap.exists) {
    console.log(`  WARN  ${matchId} ${nombre}: sin predicción en Firestore`);
    resultados.push({
      matchId,
      partido:                    nombre,
      fecha:                      partido.utcDate?.slice(0, 10) ?? null,
      estado:                     'sin_prediccion',
      recomendaciones_originales: [],
      recomendaciones_aprobadas:  [],
      recomendaciones_bloqueadas: [],
      motivos_bloqueo:            [],
      advertencias:               ['Sin predicción en Firestore'],
      nivel_fragilidad_global:    FRAGILIDAD.NINGUNA,
    });
    partSinSenales++;
    continue;
  }

  const pred        = { ...snap.data(), matchId };
  const señalesValor = pred.señales_valor ?? [];

  if (señalesValor.length === 0) {
    console.log(`  WARN  ${matchId} ${nombre}: sin señales_valor en Firestore`);
    resultados.push({
      matchId,
      partido:                    nombre,
      fecha:                      partido.utcDate?.slice(0, 10) ?? null,
      estado:                     'sin_senales',
      lambda_local:               pred.lambda_local     ?? null,
      lambda_visitante:           pred.lambda_visitante ?? null,
      recomendaciones_originales: [],
      recomendaciones_aprobadas:  [],
      recomendaciones_bloqueadas: [],
      motivos_bloqueo:            [],
      advertencias:               ['Sin señales_valor en Firestore — falta snapshot de odds'],
      nivel_fragilidad_global:    FRAGILIDAD.NINGUNA,
    });
    partSinSenales++;
    continue;
  }

  const { senales_aprobadas, senales_bloqueadas, advertencias, nivel_fragilidad_global } =
    filtrarSenalesApuesta({
      prediccion: pred,
      senales:    señalesValor,
      contexto:   { tipo: 'individual' },
    });

  const senalesValorOrig = señalesValor.filter(s => s.is_value_bet === true);
  totalSenalesOrig += senalesValorOrig.length;
  totalAprobadas   += senales_aprobadas.length;
  totalBloqueadas  += senales_bloqueadas.length;

  if (senales_aprobadas.length === 0 && senalesValorOrig.length > 0) partSinAprobadas++;

  for (const b of senales_bloqueadas) {
    const regla = b.regla ?? 'desconocida';
    bloqueosPorRegla[regla]    = (bloqueosPorRegla[regla]    ?? 0) + 1;

    const etiqueta = b.etiqueta ?? 'desconocida';
    bloqueosPorEtiqueta[etiqueta] = (bloqueosPorEtiqueta[etiqueta] ?? 0) + 1;

    const mk = `${b.mercado}/${b.seleccion}`;
    bloqueadosPorMercado[mk] = (bloqueadosPorMercado[mk] ?? 0) + 1;

    if (etiqueta === ETIQUETA.LAMBDA_EXTREMA) alertasLambdaExtrema++;
    if (b.mercado === 'btts')                bttsBloqueadas++;
  }

  for (const a of senales_aprobadas) {
    if (a.fragilidad === 'alta' && a.mercado === 'h2h') h2hDegradadas++;
  }

  const motivos = [...new Set(senales_bloqueadas.map(b => b.etiqueta).filter(Boolean))];

  console.log(`  ── ${matchId}  ${nombre}`);
  console.log(`     λ=${pred.lambda_local?.toFixed(2)}/${pred.lambda_visitante?.toFixed(2)}  fragilidad=${nivel_fragilidad_global}`);
  console.log(`     señales_valor: ${senalesValorOrig.length}  aprobadas: ${senales_aprobadas.length}  bloqueadas: ${senales_bloqueadas.length}`);

  if (advertencias.length > 0) {
    for (const adv of advertencias) console.log(`     ⚠ ${adv}`);
  }
  for (const s of senales_aprobadas) {
    const frag = s.fragilidad ? ` [fragilidad=${s.fragilidad}]` : '';
    console.log(`     ✓ APROBADA  ${s.mercado}/${s.seleccion.padEnd(12)} EV=${fmtEV(s.expected_value)} odds=${s.bookmaker_odds}${frag}`);
  }
  for (const s of senales_bloqueadas) {
    console.log(`     ✗ BLOQUEADA ${s.mercado}/${s.seleccion.padEnd(12)} EV=${fmtEV(s.expected_value)} [${s.regla}/${s.etiqueta}]`);
    if (s.sugerencia) console.log(`       → ${s.sugerencia}`);
  }
  console.log('');

  resultados.push({
    matchId,
    partido:                    nombre,
    fecha:                      partido.utcDate?.slice(0, 10) ?? null,
    estado:                     'procesado',
    lambda_local:               pred.lambda_local     ?? null,
    lambda_visitante:           pred.lambda_visitante ?? null,
    nivel_fragilidad_global,
    advertencias,
    recomendaciones_originales: senalesValorOrig,
    recomendaciones_aprobadas:  senales_aprobadas,
    recomendaciones_bloqueadas: senales_bloqueadas,
    motivos_bloqueo:            motivos,
  });
}

// ── Resumen ───────────────────────────────────────────────────────────────────

const totalPartidos      = j2.length;
const partidosProcesados = resultados.filter(r => r.estado === 'procesado').length;

console.log('═'.repeat(76));
console.log('  RESUMEN J2 — Filtros de fragilidad aplicados');
console.log('─'.repeat(76));
console.log(`  Total partidos J2                         : ${totalPartidos}`);
console.log(`  Con predicción + señales                  : ${partidosProcesados}`);
console.log(`  Sin señales (omitidos)                    : ${partSinSenales}`);
console.log(`  Señales originales (is_value_bet)         : ${totalSenalesOrig}`);
console.log(`  Señales aprobadas                         : ${totalAprobadas}  (${pct(totalAprobadas, totalSenalesOrig)})`);
console.log(`  Señales bloqueadas                        : ${totalBloqueadas}  (${pct(totalBloqueadas, totalSenalesOrig)})`);
console.log(`  Partidos sin recomendaciones aprobadas    : ${partSinAprobadas}`);
console.log(`  Alertas λ extrema                         : ${alertasLambdaExtrema}`);
console.log(`  H2H degradadas (fragilidad=alta)          : ${h2hDegradadas}`);
console.log(`  BTTS bloqueadas                           : ${bttsBloqueadas}`);
console.log('─'.repeat(76));

if (Object.keys(bloqueosPorRegla).length > 0) {
  console.log('  Bloqueos por regla:');
  for (const [regla, cnt] of Object.entries(bloqueosPorRegla).sort()) {
    console.log(`    ${regla.padEnd(4)}: ${cnt}`);
  }
}

if (Object.keys(bloqueosPorEtiqueta).length > 0) {
  console.log('  Etiquetas de bloqueo:');
  for (const [etiq, cnt] of Object.entries(bloqueosPorEtiqueta).sort()) {
    console.log(`    ${etiq}: ${cnt}`);
  }
}

const topBloqueados = Object.entries(bloqueadosPorMercado)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
if (topBloqueados.length > 0) {
  console.log('  Mercados más bloqueados:');
  for (const [k, v] of topBloqueados) console.log(`    ${k}: ${v}`);
}
console.log('═'.repeat(76));

// ── [3/3] Guardar reportes ────────────────────────────────────────────────────

mkdirSync(REPORTS_DIR, { recursive: true });

const resumenGlobal = {
  generado_en:                              new Date().toISOString(),
  modo:                                     MODO,
  total_partidos_J2:                        totalPartidos,
  partidos_procesados:                      partidosProcesados,
  partidos_sin_senales:                     partSinSenales,
  total_senales_originales:                 totalSenalesOrig,
  total_aprobadas:                          totalAprobadas,
  total_bloqueadas:                         totalBloqueadas,
  partidos_sin_recomendaciones_aprobadas:   partSinAprobadas,
  bloqueos_por_regla:                       bloqueosPorRegla,
  bloqueos_por_etiqueta:                    bloqueosPorEtiqueta,
  mercados_mas_bloqueados:                  bloqueadosPorMercado,
  alertas_lambda_extrema:                   alertasLambdaExtrema,
  señales_H2H_degradadas:                   h2hDegradadas,
  señales_BTTS_bloqueadas:                  bttsBloqueadas,
};

writeFileSync(JSON_PATH, JSON.stringify({ resumen: resumenGlobal, partidos: resultados }, null, 2), 'utf-8');
console.log(`\n  JSON guardado: reports/recomendaciones_j2_filtradas_dryrun.json`);

// ── Generar Markdown ──────────────────────────────────────────────────────────

const lineas = [];
const fechaHoy = new Date().toISOString().slice(0, 10);

lineas.push(`# Recomendaciones J2 Filtradas — ${fechaHoy}`);
lineas.push('');
lineas.push(`> **Modo:** ${MODO} | **Modelo:** V2.1-psico-context (CONGELADO) | **Filtros:** signalFilters-v1`);
lineas.push('');
lineas.push('---');
lineas.push('');
lineas.push('## Resumen ejecutivo');
lineas.push('');
lineas.push('| Métrica | Valor |');
lineas.push('|---|---|');
lineas.push(`| Total partidos J2 | ${totalPartidos} |`);
lineas.push(`| Con predicción + señales | ${partidosProcesados} |`);
lineas.push(`| Sin señales (omitidos) | ${partSinSenales} |`);
lineas.push(`| Señales originales (is_value_bet) | ${totalSenalesOrig} |`);
lineas.push(`| Señales aprobadas | ${totalAprobadas} (${pct(totalAprobadas, totalSenalesOrig)}) |`);
lineas.push(`| Señales bloqueadas | ${totalBloqueadas} (${pct(totalBloqueadas, totalSenalesOrig)}) |`);
lineas.push(`| Partidos sin recomendaciones aprobadas | ${partSinAprobadas} |`);
lineas.push(`| Alertas λ extrema | ${alertasLambdaExtrema} |`);
lineas.push(`| H2H degradadas (fragilidad=alta) | ${h2hDegradadas} |`);
lineas.push(`| BTTS bloqueadas | ${bttsBloqueadas} |`);
lineas.push('');

if (Object.keys(bloqueosPorRegla).length > 0) {
  lineas.push('### Bloqueos por regla');
  lineas.push('');
  lineas.push('| Regla | Bloqueos |');
  lineas.push('|---|---|');
  for (const [regla, cnt] of Object.entries(bloqueosPorRegla).sort()) {
    lineas.push(`| ${regla} | ${cnt} |`);
  }
  lineas.push('');
}

if (topBloqueados.length > 0) {
  lineas.push('### Mercados más bloqueados');
  lineas.push('');
  lineas.push('| Mercado/Selección | Bloqueos |');
  lineas.push('|---|---|');
  for (const [k, v] of topBloqueados) {
    lineas.push(`| ${k} | ${v} |`);
  }
  lineas.push('');
}

lineas.push('---');
lineas.push('');
lineas.push('## Detalle por partido');
lineas.push('');

for (const r of resultados) {
  const lambdaStr = r.lambda_local != null
    ? `λ=${r.lambda_local.toFixed(2)}/${r.lambda_visitante?.toFixed(2)}`
    : '';

  lineas.push(`### ${r.partido} \`${r.matchId}\``);
  lineas.push('');
  lineas.push(`**Fecha:** ${r.fecha ?? '?'} | **Fragilidad:** \`${r.nivel_fragilidad_global}\` | ${lambdaStr}`);
  lineas.push('');

  if (r.estado === 'sin_prediccion') {
    lineas.push('> ⚠ Sin predicción en Firestore — partido omitido.');
    lineas.push('');
    continue;
  }
  if (r.estado === 'sin_senales') {
    lineas.push('> ⚠ Sin señales_valor en Firestore — falta snapshot de odds.');
    lineas.push('');
    continue;
  }

  if (r.advertencias?.length > 0) {
    for (const adv of r.advertencias) lineas.push(`> ⚠ ${adv}`);
    lineas.push('');
  }

  if (r.recomendaciones_aprobadas.length > 0) {
    lineas.push('**Señales aprobadas:**');
    lineas.push('');
    lineas.push('| Mercado | Selección | EV | Odds | prob_modelo | Nivel | Fragilidad |');
    lineas.push('|---|---|---|---|---|---|---|');
    for (const s of r.recomendaciones_aprobadas) {
      const frag = s.fragilidad ?? '—';
      lineas.push(`| ${s.mercado} | ${s.seleccion} | ${fmtEV(s.expected_value)} | ${s.bookmaker_odds} | ${(s.prob_modelo * 100).toFixed(1)}% | ${s.nivel_valor} | ${frag} |`);
    }
    lineas.push('');
  } else {
    lineas.push('> Sin recomendaciones aprobadas para este partido.');
    lineas.push('');
  }

  if (r.recomendaciones_bloqueadas.length > 0) {
    lineas.push('**Señales bloqueadas:**');
    lineas.push('');
    lineas.push('| Mercado | Selección | EV | Regla | Motivo | Sugerencia |');
    lineas.push('|---|---|---|---|---|---|');
    for (const s of r.recomendaciones_bloqueadas) {
      const sug = s.sugerencia ?? '—';
      lineas.push(`| ${s.mercado} | ${s.seleccion} | ${fmtEV(s.expected_value)} | ${s.regla} | ${s.etiqueta} | ${sug} |`);
    }
    lineas.push('');
  }

  lineas.push('---');
  lineas.push('');
}

writeFileSync(MD_PATH, lineas.join('\n'), 'utf-8');
console.log(`  MD  guardado: reports/recomendaciones_j2_filtradas_dryrun.md`);

// ── [Opcional] Escribir Firestore ─────────────────────────────────────────────

if (EXECUTE) {
  console.log('\n[EXECUTE] Escribiendo señales_valor_filtradas en Firestore…');
  let escritas = 0;
  let errores  = 0;

  for (const r of resultados) {
    if (r.estado !== 'procesado') continue;
    try {
      await db.collection('predicciones').doc(r.matchId).update({
        señales_valor_filtradas: r.recomendaciones_aprobadas,
        filtrado_en:             new Date().toISOString(),
        filtrado_version:        'signalFilters-v1',
        filtrado_aprobadas:      r.recomendaciones_aprobadas.length,
        filtrado_bloqueadas:     r.recomendaciones_bloqueadas.length,
        filtrado_fragilidad:     r.nivel_fragilidad_global,
      });
      escritas++;
      console.log(`  OK    ${r.matchId}  ${r.partido}  (${r.recomendaciones_aprobadas.length} aprobadas)`);
    } catch (err) {
      errores++;
      console.error(`  ERR   ${r.matchId}: ${err.message}`);
    }
  }

  console.log(`\n  Escrituras Firestore: ${escritas} OK, ${errores} errores.`);
} else {
  console.log('\n  DRY-RUN completo.');
  console.log('  Para escribir Firestore: node scripts/generarRecomendacionesJ2Filtradas.js --execute');
}

console.log('\n  Listo.\n');

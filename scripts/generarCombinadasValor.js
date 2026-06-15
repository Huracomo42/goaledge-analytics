/**
 * generarCombinadasValor.js
 *
 * Genera combinadas de valor (2 selecciones de partidos distintos) a partir
 * de señales_valor ya guardadas en predicciones/{matchId}.
 *
 * Solo lectura Firestore. 0 escrituras Firestore. 0 llamadas a APIs externas.
 *
 * Uso:
 *   node scripts/generarCombinadasValor.js --jornada 1 --dry-run
 *   node scripts/generarCombinadasValor.js --jornada 2 --dry-run
 *   node scripts/generarCombinadasValor.js --matchIds 537363,537369,537370 --dry-run
 *
 * Salida:
 *   reports/combinadas_j{N}_dryrun.md   (modo --jornada)
 *   reports/combinadas_custom_dryrun.md  (modo --matchIds)
 *
 * Restricciones:
 *   - Solo combos de 2 selecciones (primera versión).
 *   - No combina señales del mismo partido.
 *   - Excluye señales con recomendacion = "observar".
 *   - No llama The Odds API ni Claude API.
 *   - No modifica Prediction Engine ni pesos.
 *   - No escribe en Firestore.
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFirestore } from 'firebase-admin/firestore';
import '../src/firebase/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Argumentos ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const jornadaArg = (() => {
  const idx = args.indexOf('--jornada');
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')
    ? args[idx + 1]
    : null;
})();

const matchIdsFlagIdx = args.indexOf('--matchIds');
const matchIdsArg = matchIdsFlagIdx !== -1
  ? args.slice(matchIdsFlagIdx + 1)
      .filter(a => !a.startsWith('--'))
      .flatMap(a => a.split(','))
      .filter(a => /^\d+$/.test(a))
  : [];

if (!jornadaArg && matchIdsArg.length === 0) {
  console.error('\n  ERROR: debes pasar --jornada N o --matchIds <id,...>');
  console.error('  Ejemplos:');
  console.error('    node scripts/generarCombinadasValor.js --jornada 1 --dry-run');
  console.error('    node scripts/generarCombinadasValor.js --matchIds 537363,537369 --dry-run\n');
  process.exit(1);
}

const HOY   = new Date().toISOString().slice(0, 10);
const LABEL = matchIdsArg.length > 0 ? 'custom' : `j${jornadaArg}`;

// ── Umbrales de clasificación ─────────────────────────────────────────────────
//
// CONSERVADORA — ambas selecciones deben cumplir TODOS:
//   · cuota_combinada <= 3.50
//   · prob_combinada >= 35%
//   · ninguna selección es empate
//   · ninguna cuota individual > 2.20
//   · ninguna prob_modelo < 45%
//
// MODERADA — cuando no llega a conservadora, pero cumple TODOS:
//   · cuota_combinada > 3.50 y <= 7.00
//   · prob_combinada >= 20%
//   · máximo 1 selección de empate o underdog (cuota > 2.50)
//   · ninguna cuota individual > 5.00
//   · ninguna prob_modelo individual < 25%
//
// ESPECULATIVA — todo lo demás.

const CONS_CUOTA_MAX     = 3.50;
const CONS_PROB_MIN      = 0.35;
const CONS_ODDS_IND_MAX  = 2.20;
const CONS_PROB_IND_MIN  = 0.45;

const MOD_CUOTA_MIN      = 3.50;   // exclusivo (>)
const MOD_CUOTA_MAX      = 7.00;
const MOD_PROB_MIN       = 0.20;
const MOD_ODDS_IND_MAX   = 5.00;
const MOD_PROB_IND_MIN   = 0.25;
const MOD_EMPATE_UNDER_MAX = 1;    // máx. 1 empate/underdog por combinada

const UNDERDOG_THRESHOLD = 2.50;   // cuota > 2.50 → se cuenta como underdog

// Excluir señales 'observar' (leve, EV 0-5%) y 'pasar' (sin valor)
const RECOMENDACIONES_VALIDAS = new Set(['apostar', 'considerar']);

// ── J1 matchIds fijos ─────────────────────────────────────────────────────────

const J1_MATCH_IDS = [
  '537369', '537363', '537370', '537364',
  '537391', '537392', '537397', '537398',
  '537403', '537409', '537410', '537404',
];

// J2 rango de fechas aproximado (Mundial 2026)
const J2_FECHA_DESDE = '2026-06-19';
const J2_FECHA_HASTA = '2026-06-30';

// ── Helpers ───────────────────────────────────────────────────────────────────

const pct  = n => n != null ? `${(n * 100).toFixed(1)}%` : '—';
const fix2 = n => n != null ? n.toFixed(2) : '—';

function labelCorto(s) {
  if (s.mercado === 'h2h') {
    if (s.seleccion === 'local')     return `${s.partido_local} W`;
    if (s.seleccion === 'visitante') return `${s.partido_visitante} W`;
    return `Empate (${s.partido_local.slice(0, 3)}/${s.partido_visitante.slice(0, 3)})`;
  }
  const lineTxt = s.seleccion.replace('_', ' ');
  return `${s.partido_local.slice(0, 3)}/${s.partido_visitante.slice(0, 3)} ${lineTxt}`;
}

function labelMercadoLargo(s) {
  if (s.mercado === 'h2h') {
    if (s.seleccion === 'local')     return `H2H Local (${s.partido_local})`;
    if (s.seleccion === 'visitante') return `H2H Visitante (${s.partido_visitante})`;
    return 'H2H Empate';
  }
  return s.seleccion;
}

// ── Clasificación de combinadas ───────────────────────────────────────────────

function clasificarCombinada(s1, s2, prob_combinada, cuota_combinada) {
  const esEmpate  = s => s.mercado === 'h2h' && s.seleccion === 'empate';
  const esUnder   = s => s.bookmaker_odds > UNDERDOG_THRESHOLD;

  const s1Empate = esEmpate(s1);
  const s2Empate = esEmpate(s2);
  const s1Under  = esUnder(s1);
  const s2Under  = esUnder(s2);

  // Advertencias de reporte (independientes de categoría)
  const advertencias = [];
  if (s1Empate || s2Empate) {
    const cuales = [s1Empate && labelCorto(s1), s2Empate && labelCorto(s2)].filter(Boolean);
    advertencias.push(`Contiene empate: ${cuales.join(', ')}`);
  }
  if (s1Under || s2Under) {
    const cuales = [
      s1Under && `${labelCorto(s1)} (cuota ${s1.bookmaker_odds})`,
      s2Under && `${labelCorto(s2)} (cuota ${s2.bookmaker_odds})`,
    ].filter(Boolean);
    advertencias.push(`Contiene underdog (cuota > ${UNDERDOG_THRESHOLD}): ${cuales.join(', ')}`);
  }

  // ─── Conservadora ─────────────────────────────────────────────────────────
  const failCons = [];
  if (cuota_combinada > CONS_CUOTA_MAX)
    failCons.push(`cuota_combinada ${fix2(cuota_combinada)} > ${CONS_CUOTA_MAX}`);
  if (prob_combinada < CONS_PROB_MIN)
    failCons.push(`prob_combinada ${pct(prob_combinada)} < ${pct(CONS_PROB_MIN)}`);
  if (s1Empate) failCons.push(`${labelCorto(s1)} es empate`);
  if (s2Empate) failCons.push(`${labelCorto(s2)} es empate`);
  if (s1.bookmaker_odds > CONS_ODDS_IND_MAX)
    failCons.push(`cuota ${s1.bookmaker_odds} (${labelCorto(s1)}) > ${CONS_ODDS_IND_MAX}`);
  if (s2.bookmaker_odds > CONS_ODDS_IND_MAX)
    failCons.push(`cuota ${s2.bookmaker_odds} (${labelCorto(s2)}) > ${CONS_ODDS_IND_MAX}`);
  if (s1.prob_modelo < CONS_PROB_IND_MIN)
    failCons.push(`prob ${pct(s1.prob_modelo)} (${labelCorto(s1)}) < ${pct(CONS_PROB_IND_MIN)}`);
  if (s2.prob_modelo < CONS_PROB_IND_MIN)
    failCons.push(`prob ${pct(s2.prob_modelo)} (${labelCorto(s2)}) < ${pct(CONS_PROB_IND_MIN)}`);

  if (failCons.length === 0) {
    return {
      categoria:           'conservadora',
      nivel_riesgo:        'conservador',
      razon_clasificacion: `cuota_combinada=${fix2(cuota_combinada)} (≤${CONS_CUOTA_MAX}) · prob=${pct(prob_combinada)} (≥${pct(CONS_PROB_MIN)}) · sin empates · cuotas ind. ≤${CONS_ODDS_IND_MAX} · probs ind. ≥${pct(CONS_PROB_IND_MIN)}`,
      advertencias,
    };
  }

  // ─── Moderada ─────────────────────────────────────────────────────────────
  const nEmpateUnder = [s1, s2].filter(s => esEmpate(s) || esUnder(s)).length;
  const failMod = [];

  if (cuota_combinada <= MOD_CUOTA_MIN)
    failMod.push(`cuota_combinada ${fix2(cuota_combinada)} ≤ ${MOD_CUOTA_MIN} (moderada requiere ${MOD_CUOTA_MIN}–${MOD_CUOTA_MAX})`);
  else if (cuota_combinada > MOD_CUOTA_MAX)
    failMod.push(`cuota_combinada ${fix2(cuota_combinada)} > ${MOD_CUOTA_MAX}`);
  if (prob_combinada < MOD_PROB_MIN)
    failMod.push(`prob_combinada ${pct(prob_combinada)} < ${pct(MOD_PROB_MIN)}`);
  if (nEmpateUnder > MOD_EMPATE_UNDER_MAX)
    failMod.push(`${nEmpateUnder} selecciones de empate/underdog (máx. ${MOD_EMPATE_UNDER_MAX})`);
  if (s1.bookmaker_odds > MOD_ODDS_IND_MAX)
    failMod.push(`cuota ${s1.bookmaker_odds} (${labelCorto(s1)}) > ${MOD_ODDS_IND_MAX}`);
  if (s2.bookmaker_odds > MOD_ODDS_IND_MAX)
    failMod.push(`cuota ${s2.bookmaker_odds} (${labelCorto(s2)}) > ${MOD_ODDS_IND_MAX}`);
  if (s1.prob_modelo < MOD_PROB_IND_MIN)
    failMod.push(`prob ${pct(s1.prob_modelo)} (${labelCorto(s1)}) < ${pct(MOD_PROB_IND_MIN)}`);
  if (s2.prob_modelo < MOD_PROB_IND_MIN)
    failMod.push(`prob ${pct(s2.prob_modelo)} (${labelCorto(s2)}) < ${pct(MOD_PROB_IND_MIN)}`);

  if (failMod.length === 0) {
    const razonNoCons = failCons.slice(0, 2).join(' · ');
    return {
      categoria:           'moderada',
      nivel_riesgo:        'moderado',
      razon_clasificacion: `cuota_combinada=${fix2(cuota_combinada)} (${MOD_CUOTA_MIN}–${MOD_CUOTA_MAX}) · prob=${pct(prob_combinada)} (≥${pct(MOD_PROB_MIN)}) · no conservadora: ${razonNoCons}`,
      advertencias,
    };
  }

  // ─── Especulativa ─────────────────────────────────────────────────────────
  return {
    categoria:            'especulativa',
    nivel_riesgo:         'especulativo',
    razon_clasificacion:  `especulativa: ${failMod.slice(0, 3).join(' · ')}`,
    razones_especulativa: failMod,
    advertencias,
  };
}

// ── Serialización de combo a JSON ─────────────────────────────────────────────

function buildComboJson(combo, categoria, rank) {
  const [s1, s2] = combo.señales;
  return {
    id_combinada:                      `${LABEL}_${categoria}_${String(rank).padStart(3, '0')}`,
    jornada:                           jornadaArg ?? 'custom',
    categoria_riesgo:                  categoria,
    rank_en_categoria:                 rank,
    selecciones:                       2,
    matchIds:                          combo.partidos,
    partidos:                          combo.señales.map(s => `${s.partido_local} vs ${s.partido_visitante}`),
    fechas:                            combo.fechas,
    mercados:                          combo.señales.map(s => s.mercado),
    seleccion_detalle: combo.señales.map(s => ({
      matchId:      s.matchId,
      partido:      `${s.partido_local} vs ${s.partido_visitante}`,
      fecha:        s.fechaPartido,
      mercado:      s.mercado,
      seleccion:    s.seleccion,
      equipo:       s.equipo ?? null,
      nivel_valor:  s.nivel_valor,
      recomendacion: s.recomendacion,
    })),
    cuotas_individuales:               combo.señales.map(s => s.bookmaker_odds),
    probabilidades_modelo_individuales: combo.señales.map(s => +s.prob_modelo.toFixed(4)),
    EV_individuales:                   combo.señales.map(s => +s.expected_value.toFixed(4)),
    cuota_combinada:                   +combo.cuota_combinada.toFixed(4),
    probabilidad_modelo_combinada:     +combo.prob_combinada.toFixed(4),
    EV_combinado:                      +combo.ev_combinado.toFixed(4),
    razon_clasificacion:               combo.razon_clasificacion,
    advertencias:                      combo.advertencias ?? [],
    razones_especulativa:              combo.razones_especulativa ?? [],
    generado_en:                       HOY,
  };
}

// ── Firestore ─────────────────────────────────────────────────────────────────

const db = getFirestore();

// ── Header consola ────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  GENERAR COMBINADAS DE VALOR — solo lectura Firestore');
if (jornadaArg)         console.log(`  Jornada  : ${jornadaArg}`);
if (matchIdsArg.length) console.log(`  MatchIds : ${matchIdsArg.join(', ')}`);
console.log('  Modo     : DRY-RUN — escribe .md local, 0 escrituras Firestore');
console.log('  Combos   : 2 selecciones de partidos distintos');
console.log('═'.repeat(76));

// ── 1. Cargar predicciones ────────────────────────────────────────────────────

console.log('\n  [1/4] Cargando predicciones...');

let rawDocs;

if (matchIdsArg.length > 0) {
  rawDocs = await Promise.all(
    matchIdsArg.map(id => db.collection('predicciones').doc(String(id)).get())
  );
} else if (jornadaArg === '1') {
  rawDocs = await Promise.all(
    J1_MATCH_IDS.map(id => db.collection('predicciones').doc(id).get())
  );
} else {
  const snap = await db.collection('predicciones')
    .where('fechaPartido', '>=', J2_FECHA_DESDE)
    .where('fechaPartido', '<=', J2_FECHA_HASTA)
    .get();
  rawDocs = snap.docs;
}

const predicciones = rawDocs
  .filter(d => d.exists)
  .map(d => ({ ...d.data(), matchId: d.id }));

console.log(`  ${predicciones.length} predicción(es) encontradas.`);

if (predicciones.length === 0) {
  console.log('\n  Sin predicciones. Saliendo.');
  process.exit(0);
}

// ── 2. Extraer señales válidas ────────────────────────────────────────────────

console.log('\n  [2/4] Extrayendo señales válidas...');

const señalesValidas   = [];
const señalesExcluidas = [];

for (const pred of predicciones) {
  const sinSnap = !Array.isArray(pred.señales_valor) || pred.señales_valor.length === 0;

  if (sinSnap) {
    señalesExcluidas.push({
      tipo:  'partido',
      matchId: pred.matchId,
      desc:  `${pred.nombreLocal ?? '?'} vs ${pred.nombreVisitante ?? '?'}`,
      razón: 'sin señales_valor en la predicción (ejecutar actualizarSenalesConOdds.js primero)',
    });
    continue;
  }

  for (const s of pred.señales_valor) {
    const señal = {
      ...s,
      matchId:           pred.matchId,
      partido_local:     pred.nombreLocal    ?? '?',
      partido_visitante: pred.nombreVisitante ?? '?',
      fechaPartido:      pred.fechaPartido   ?? '?',
    };

    if (!señal.is_value_bet) continue;

    if (!RECOMENDACIONES_VALIDAS.has(señal.recomendacion)) {
      señalesExcluidas.push({
        tipo:  'señal',
        matchId: pred.matchId,
        desc:  `${labelCorto(señal)} (${pred.nombreLocal} vs ${pred.nombreVisitante})`,
        razón: `recomendacion="${señal.recomendacion}" — EV ${pct(señal.expected_value)} (umbral mínimo: considerar)`,
      });
      continue;
    }

    señalesValidas.push(señal);
  }
}

const porPartido = new Map();
for (const s of señalesValidas) {
  if (!porPartido.has(s.matchId)) porPartido.set(s.matchId, []);
  porPartido.get(s.matchId).push(s);
}

console.log(`  ${señalesValidas.length} señal(es) válidas de ${porPartido.size} partido(s).`);
console.log(`  ${señalesExcluidas.length} señal(es)/partido(s) excluidos.`);

if (señalesValidas.length < 2) {
  console.log('\n  Menos de 2 señales válidas — no es posible generar combinadas de 2.');
  console.log('  Verifica que existan predicciones con señales_valor guardadas.');
  process.exit(0);
}

// ── 3. Generar combinadas de 2 ────────────────────────────────────────────────

console.log('\n  [3/4] Generando combinadas de 2 selecciones...');

const conservadoras = [];
const moderadas     = [];
const especulativas = [];

for (let i = 0; i < señalesValidas.length; i++) {
  for (let j = i + 1; j < señalesValidas.length; j++) {
    const s1 = señalesValidas[i];
    const s2 = señalesValidas[j];

    if (s1.matchId === s2.matchId) continue;

    const prob_combinada  = s1.prob_modelo * s2.prob_modelo;
    const cuota_combinada = s1.bookmaker_odds * s2.bookmaker_odds;
    const ev_combinado    = prob_combinada * cuota_combinada - 1;

    const clasificacion = clasificarCombinada(s1, s2, prob_combinada, cuota_combinada);

    const combo = {
      selecciones:   2,
      partidos:      [s1.matchId, s2.matchId],
      fechas:        [...new Set([s1.fechaPartido, s2.fechaPartido])],
      señales:       [s1, s2],
      prob_combinada,
      cuota_combinada,
      ev_combinado,
      ...clasificacion,
      justificacion: `${labelCorto(s1)} (EV ${pct(s1.expected_value)} ${s1.nivel_valor.toUpperCase()}) + ${labelCorto(s2)} (EV ${pct(s2.expected_value)} ${s2.nivel_valor.toUpperCase()})`,
    };

    switch (clasificacion.categoria) {
      case 'conservadora': conservadoras.push(combo); break;
      case 'moderada':     moderadas.push(combo);     break;
      default:             especulativas.push(combo);  break;
    }
  }
}

const byEv = (a, b) => b.ev_combinado - a.ev_combinado;
conservadoras.sort(byEv);
moderadas.sort(byEv);
especulativas.sort(byEv);

const TOP = 10;
const topC = conservadoras.slice(0, TOP);
const topM = moderadas.slice(0, TOP);
const topE = especulativas.slice(0, TOP);

const totalCombos = conservadoras.length + moderadas.length + especulativas.length;
console.log(`  Conservadoras : ${conservadoras.length}  (mostrando top ${Math.min(conservadoras.length, TOP)})`);
console.log(`  Moderadas     : ${moderadas.length}  (mostrando top ${Math.min(moderadas.length, TOP)})`);
console.log(`  Especulativas : ${especulativas.length}  (mostrando top ${Math.min(especulativas.length, TOP)})`);
console.log(`  Total         : ${totalCombos}`);

// ── Preview consola ───────────────────────────────────────────────────────────

if (topC.length > 0) {
  console.log('\n  Top 3 conservadoras:');
  for (const c of topC.slice(0, 3)) {
    console.log(`    ${c.justificacion}`);
    console.log(`    cuota=${fix2(c.cuota_combinada)}  prob=${pct(c.prob_combinada)}  EV=${pct(c.ev_combinado)}`);
  }
}
if (topM.length > 0) {
  console.log('\n  Top moderada:');
  const c = topM[0];
  console.log(`    ${c.justificacion}`);
  console.log(`    cuota=${fix2(c.cuota_combinada)}  prob=${pct(c.prob_combinada)}  EV=${pct(c.ev_combinado)}`);
}

// ── 4. Generar Markdown ───────────────────────────────────────────────────────

console.log('\n  [4/4] Generando Markdown...');

const L = [];

const tipoLabel = jornadaArg ? `Jornada ${jornadaArg}` : 'matchIds custom';
L.push(`# Combinadas de Valor — ${tipoLabel} · Mundial 2026`);
L.push(``);
L.push(`**Generado:** ${HOY}  `);
if (jornadaArg) L.push(`**Jornada:** ${jornadaArg}  `);
L.push(`**Modelo:** V2.1-psico-context  `);
L.push(`**Modo:** DRY-RUN — solo análisis. Sin escritura en Firestore.  `);
L.push(`**Combinadas:** 2 selecciones · partidos distintos · señales con EV > 0  `);
L.push(``);

// ── §1 Universo ───────────────────────────────────────────────────────────────

L.push(`## 1. Universo de partidos leídos`);
L.push(``);
L.push(`| matchId | Fecha | Local | Visitante | Señales válidas |`);
L.push(`|---------|-------|-------|-----------|-----------------|`);
for (const pred of predicciones) {
  const nVal = porPartido.get(pred.matchId)?.length ?? 0;
  const nota = !Array.isArray(pred.señales_valor) || pred.señales_valor.length === 0
    ? ' _(sin señales)_' : '';
  L.push(`| ${pred.matchId} | ${pred.fechaPartido ?? '?'} | ${pred.nombreLocal ?? '?'} | ${pred.nombreVisitante ?? '?'} | ${nVal}${nota} |`);
}
L.push(``);

// ── §2 Señales usadas ─────────────────────────────────────────────────────────

L.push(`## 2. Señales usadas (${señalesValidas.length})`);
L.push(``);
L.push(`_Filtro: is\\_value\\_bet = true y recomendacion ∈ {apostar, considerar}._  `);
L.push(`_⚠️ = cuota individual > ${UNDERDOG_THRESHOLD} (underdog) o es empate._`);
L.push(``);
L.push(`| # | Partido | Mercado | Selección | Prob modelo | Cuota | EV | Nivel | ⚠️ |`);
L.push(`|---|---------|---------|-----------|------------|-------|-----|-------|----|`);
for (let i = 0; i < señalesValidas.length; i++) {
  const s = señalesValidas[i];
  const esEmpate = s.mercado === 'h2h' && s.seleccion === 'empate';
  const esUnder  = s.bookmaker_odds > UNDERDOG_THRESHOLD;
  const flags = [esEmpate && 'empate', esUnder && 'underdog'].filter(Boolean).join('/');
  L.push(`| ${i + 1} | ${s.partido_local} vs ${s.partido_visitante} | ${s.mercado} | ${labelMercadoLargo(s)} | ${pct(s.prob_modelo)} | ${s.bookmaker_odds} | **${pct(s.expected_value)}** | ${s.nivel_valor} | ${flags || ''} |`);
}
L.push(``);

// ── §3 Señales excluidas ──────────────────────────────────────────────────────

L.push(`## 3. Señales / partidos excluidos (${señalesExcluidas.length})`);
L.push(``);
if (señalesExcluidas.length === 0) {
  L.push(`_Ninguna señal excluida por reglas adicionales._`);
} else {
  L.push(`| Tipo | Descripción | Razón |`);
  L.push(`|------|-------------|-------|`);
  for (const e of señalesExcluidas) {
    L.push(`| ${e.tipo} | ${e.desc} | ${e.razón} |`);
  }
}
L.push(``);

// ── Helper: sección de combinadas ─────────────────────────────────────────────

function seccionCombinadas(num, titulo, combos, total, nota) {
  L.push(`## ${num}. ${titulo} (top ${Math.min(combos.length, TOP)} de ${total})`);
  L.push(``);
  if (nota) { L.push(`> ${nota}`); L.push(``); }

  if (combos.length === 0) {
    L.push(`_Ninguna combinada en esta categoría con los partidos disponibles._`);
    L.push(``);
    return;
  }

  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const [s1, s2] = c.señales;

    L.push(`### ${i + 1}. ${c.justificacion}`);
    L.push(``);

    L.push(`| Campo | Valor |`);
    L.push(`|-------|-------|`);
    L.push(`| Partidos | ${s1.partido_local} vs ${s1.partido_visitante} · ${s2.partido_local} vs ${s2.partido_visitante} |`);
    L.push(`| Fechas | ${c.fechas.join(' · ')} |`);
    L.push(`| Cuota combinada | **${fix2(c.cuota_combinada)}** |`);
    L.push(`| Prob modelo combinada | **${pct(c.prob_combinada)}** |`);
    L.push(`| EV combinado | **${pct(c.ev_combinado)}** |`);
    L.push(`| Nivel riesgo | ${c.nivel_riesgo} |`);
    L.push(`| Razón clasificación | ${c.razon_clasificacion} |`);
    L.push(``);

    L.push(`| Selección | Partido | Prob modelo | Cuota | EV individual | Nivel |`);
    L.push(`|-----------|---------|------------|-------|---------------|-------|`);
    for (const s of c.señales) {
      L.push(`| ${labelMercadoLargo(s)} | ${s.partido_local} vs ${s.partido_visitante} | ${pct(s.prob_modelo)} | ${s.bookmaker_odds} | ${pct(s.expected_value)} | ${s.nivel_valor} |`);
    }
    L.push(``);

    // Advertencias (empate / underdog)
    if (c.advertencias?.length > 0) {
      for (const a of c.advertencias) L.push(`_⚠️ ${a}_`);
      L.push(``);
    }

    // Razones especulativas detalladas
    if (c.razones_especulativa?.length > 0) {
      L.push(`**Por qué es especulativa:**`);
      for (const r of c.razones_especulativa) L.push(`- ${r}`);
      L.push(``);
    }
  }
}

seccionCombinadas(
  4, 'Combinadas conservadoras',
  topC, conservadoras.length,
  `Ambas selecciones superan los filtros más estrictos: cuota_combinada ≤ ${CONS_CUOTA_MAX}, prob_combinada ≥ ${pct(CONS_PROB_MIN)}, ningún empate, cuotas individuales ≤ ${CONS_ODDS_IND_MAX}, probs individuales ≥ ${pct(CONS_PROB_IND_MIN)}.`
);

seccionCombinadas(
  5, 'Combinadas moderadas',
  topM, moderadas.length,
  `cuota_combinada ${MOD_CUOTA_MIN}–${MOD_CUOTA_MAX}, prob_combinada ≥ ${pct(MOD_PROB_MIN)}, máx. 1 empate/underdog, cuotas ind. ≤ ${MOD_ODDS_IND_MAX}, probs ind. ≥ ${pct(MOD_PROB_IND_MIN)}. No pasa el filtro conservador.`
);

seccionCombinadas(
  6, 'Combinadas especulativas',
  topE, especulativas.length,
  '⚠️ No alcanza los criterios de conservadora ni moderada. Puede incluir cuotas altas, empates dobles, underdogs fuertes, probabilidades bajas o combinada > 7.00. Solo contexto analítico.'
);

// ── §7 Resumen ────────────────────────────────────────────────────────────────

L.push(`## 7. Resumen`);
L.push(``);
L.push(`| Categoría | Total generadas | En reporte |`);
L.push(`|-----------|----------------|------------|`);
L.push(`| Conservadoras | ${conservadoras.length} | ${topC.length} |`);
L.push(`| Moderadas | ${moderadas.length} | ${topM.length} |`);
L.push(`| Especulativas | ${especulativas.length} | ${topE.length} |`);
L.push(`| **Total** | **${totalCombos}** | **${topC.length + topM.length + topE.length}** |`);
L.push(``);
L.push(`**Señales usadas:** ${señalesValidas.length}  `);
L.push(`**Partidos con señales:** ${porPartido.size} de ${predicciones.length}  `);
L.push(``);

// ── §8 Umbrales aplicados ─────────────────────────────────────────────────────

L.push(`## 8. Umbrales aplicados`);
L.push(``);
L.push(`### Conservadora — todos deben cumplirse`);
L.push(``);
L.push(`| Criterio | Umbral |`);
L.push(`|----------|--------|`);
L.push(`| cuota_combinada | ≤ ${CONS_CUOTA_MAX} |`);
L.push(`| prob_combinada | ≥ ${pct(CONS_PROB_MIN)} |`);
L.push(`| Empate | Ninguna selección puede ser empate |`);
L.push(`| cuota individual | Ninguna > ${CONS_ODDS_IND_MAX} |`);
L.push(`| prob_modelo individual | Ninguna < ${pct(CONS_PROB_IND_MIN)} |`);
L.push(``);
L.push(`### Moderada — todos deben cumplirse (si no llegó a conservadora)`);
L.push(``);
L.push(`| Criterio | Umbral |`);
L.push(`|----------|--------|`);
L.push(`| cuota_combinada | > ${MOD_CUOTA_MIN} y ≤ ${MOD_CUOTA_MAX} |`);
L.push(`| prob_combinada | ≥ ${pct(MOD_PROB_MIN)} |`);
L.push(`| Empates/underdogs (cuota > ${UNDERDOG_THRESHOLD}) | Máx. ${MOD_EMPATE_UNDER_MAX} selección |`);
L.push(`| cuota individual | Ninguna > ${MOD_ODDS_IND_MAX} |`);
L.push(`| prob_modelo individual | Ninguna < ${pct(MOD_PROB_IND_MIN)} |`);
L.push(``);
L.push(`### Especulativa`);
L.push(``);
L.push(`_Todo lo que no califica como conservadora ni moderada._`);
L.push(``);
L.push(`| Criterio típico | Ejemplo |`);
L.push(`|-----------------|---------|`);
L.push(`| cuota_combinada > ${MOD_CUOTA_MAX} | Combo de 2 underdogs o 2 empates |`);
L.push(`| cuota_combinada ≤ ${MOD_CUOTA_MIN} con fallo conservadora | Cuota individual excede 2.20 y combo bajo 3.50 |`);
L.push(`| prob_modelo individual < ${pct(MOD_PROB_IND_MIN)} | Pronóstico muy incierto |`);
L.push(`| Dos empates o dos underdogs | nEmpate/underdog > ${MOD_EMPATE_UNDER_MAX} |`);
L.push(``);

// ── §9 Advertencias metodológicas ────────────────────────────────────────────

L.push(`## 9. Advertencias metodológicas`);
L.push(``);
L.push(`1. **Independencia asumida.** EV combinado = p1 × p2 × o1 × o2 − 1. Los resultados de fútbol no son totalmente independientes; el EV real puede diferir.`);
L.push(``);
L.push(`2. **Modelo sin calibrar.** V2.1-psico-context usa pesos iniciales. Sin backtest contra resultados reales, los valores de EV son estimaciones del modelo, no promedios estadísticos validados.`);
L.push(``);
L.push(`3. **"Conservadora" no significa segura.** La etiqueta refleja que la combinada cumple todos los criterios estructurales más estrictos (cuotas bajas, probs altas, sin empates). No garantiza resultado positivo.`);
L.push(``);
L.push(`4. **BTTS no evaluado.** Los snapshots solo incluyen H2H y Totals. El mercado BTTS no está disponible en esta versión.`);
L.push(``);
L.push(`5. **Cuotas pueden moverse.** Las cuotas capturadas son de The Odds API en el momento del snapshot. Las cuotas de cierre pueden diferir.`);
L.push(``);
L.push(`6. **EV alto en moderadas.** Combos moderados pueden mostrar EV más alto que conservadores porque incluyen selecciones con mayor cuota. Esto no significa menor riesgo: refleja mayor varianza.`);
L.push(``);

// ── §10 Nota importante ───────────────────────────────────────────────────────

L.push(`## 10. Nota importante`);
L.push(``);
L.push(`> **Este reporte es únicamente análisis cuantitativo del modelo V2.1-psico-context.** No constituye recomendación de apuesta garantizada. El fútbol tiene alta varianza inherente; ningún modelo puede eliminar ese riesgo. El propósito es registrar predicciones previas al partido para compararlas con los resultados reales y calibrar el modelo en el futuro.`);
L.push(``);
L.push(`---`);
L.push(``);
L.push(`_Generado con scripts/generarCombinadasValor.js · Modelo V2.1-psico-context · ${HOY}_`);

// ── Escribir archivo ──────────────────────────────────────────────────────────

const OUT = path.join(__dirname, '..', 'reports', `combinadas_${LABEL}_dryrun.md`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');

// ── Exportar JSON ─────────────────────────────────────────────────────────────

const todasOrdenadas = [
  ...conservadoras.map((c, i) => buildComboJson(c, 'conservadora', i + 1)),
  ...moderadas.map((c, i)     => buildComboJson(c, 'moderada',     i + 1)),
  ...especulativas.map((c, i) => buildComboJson(c, 'especulativa', i + 1)),
];

const jsonOutput = {
  meta: {
    jornada:          jornadaArg ?? 'custom',
    generado_en:      HOY,
    modelo:           'V2.1-psico-context',
    partidos_leidos:  predicciones.length,
    señales_usadas:   señalesValidas.length,
    total_combinadas: totalCombos,
    resumen: {
      conservadoras: conservadoras.length,
      moderadas:     moderadas.length,
      especulativas: especulativas.length,
    },
    umbrales: {
      conservadora: {
        cuota_combinada_max:  CONS_CUOTA_MAX,
        prob_combinada_min:   CONS_PROB_MIN,
        cuota_individual_max: CONS_ODDS_IND_MAX,
        prob_individual_min:  CONS_PROB_IND_MIN,
        empate_permitido:     false,
      },
      moderada: {
        cuota_combinada_min:    MOD_CUOTA_MIN,
        cuota_combinada_max:    MOD_CUOTA_MAX,
        prob_combinada_min:     MOD_PROB_MIN,
        cuota_individual_max:   MOD_ODDS_IND_MAX,
        prob_individual_min:    MOD_PROB_IND_MIN,
        max_empate_underdog:    MOD_EMPATE_UNDER_MAX,
        underdog_threshold:     UNDERDOG_THRESHOLD,
      },
    },
  },
  combinadas: todasOrdenadas,
};

const OUT_JSON = OUT.replace(/\.md$/, '.json');
fs.writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), 'utf8');

console.log(`\n  ✓ Markdown : ${OUT}`);
console.log(`  ✓ JSON     : ${OUT_JSON}`);
console.log(`  Líneas MD  : ${L.length}`);
console.log(`  Combos JSON: ${todasOrdenadas.length} total (${conservadoras.length} cons + ${moderadas.length} mod + ${especulativas.length} esp)`);
console.log(`  Combos MD  : top ${topC.length} cons + top ${topM.length} mod + top ${topE.length} esp`);
console.log('═'.repeat(76));

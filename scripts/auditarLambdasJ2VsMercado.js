/**
 * auditarLambdasJ2VsMercado.js — Auditoría de lambdas J2 contra el mercado.
 *
 * SOLO LECTURA. Zero escrituras. Zero llamadas API.
 *
 * Compara probabilidades del modelo Poisson (prob_1x2) con probabilidades
 * no-vig del mercado (H2H de bookmakers) para detectar predicciones absurdas
 * antes de generar señales_valor o combinadas.
 *
 * Fuentes:
 *   - config/j2_ids.json
 *   - predicciones/{matchId} en Firestore
 *   - reports/odds_j2_raw.json  (raw API eventos)
 *     fallback: reports/odds_j2_h2h_totals_spreads_raw.json (pre-transformado)
 *
 * Genera:
 *   - reports/auditoria_lambdas_j2_vs_mercado.json
 *   - reports/auditoria_lambdas_j2_vs_mercado.md
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve }       from 'path';
import { getFirestore }  from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { transformarRespuestaOddsApi }    from '../src/data/pipeline/oddsApi.js';
import { impliedProbability, noVigProbability } from '../src/core/betting/bettingMath.js';

const db = getFirestore();

// ── Rutas ─────────────────────────────────────────────────────────────────────

const CONFIG_PATH    = resolve('config', 'j2_ids.json');
const RAW_PATH       = resolve('reports', 'odds_j2_raw.json');
const PRE_PATH       = resolve('reports', 'odds_j2_h2h_totals_spreads_raw.json');
const OUT_DIR        = resolve('reports');
const JSON_OUT       = resolve(OUT_DIR, 'auditoria_lambdas_j2_vs_mercado.json');
const MD_OUT         = resolve(OUT_DIR, 'auditoria_lambdas_j2_vs_mercado.md');

// ── Umbrales (de la especificación) ──────────────────────────────────────────

const TH = {
  MODELO_INVERTIDO_MIN_DIFF:         0.25,
  FAVORITO_GRANDE_MERCADO:           0.75,
  FAVORITO_GRANDE_MODELO_MAX:        0.60,
  UNDERDOG_SOBRESTIMADO_MODELO_MIN:  0.30,
  UNDERDOG_SOBRESTIMADO_MERCADO_MAX: 0.15,
  LAMBDA_ALTA:                       3.00,
  LAMBDA_BAJA:                       0.30,
  GAP_MERCADO_ALTO:                  0.20,
};

// ── Flags / recomendaciones ───────────────────────────────────────────────────

const FLAGS = {
  MODELO_INVERTIDO:             'MODELO_INVERTIDO',
  FAVORITO_GRANDE_SUBESTIMADO:  'FAVORITO_GRANDE_SUBESTIMADO',
  UNDERDOG_SOBRESTIMADO:        'UNDERDOG_SOBRESTIMADO',
  LAMBDA_EXTREMA:               'LAMBDA_EXTREMA',
  GAP_MERCADO_ALTO:             'GAP_MERCADO_ALTO',
  OK:                           'OK',
};

const REC = {
  A: 'A — USABLE: señales_valor + filtros normales',
  B: 'B — SOLO_MERCADOS_PROTEGIDOS: evitar H2H directo',
  C: 'C — BLOQUEAR_APUESTAS: divergencia severa modelo vs mercado',
  D: 'D — RECALCULAR_PREDICCION: posible error datos u orientación',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const p1  = n => (n != null && isFinite(n)) ? `${(n * 100).toFixed(1)}%` : '—';
const p2  = n => (n != null && isFinite(n)) ? `${(n * 100).toFixed(2)}%` : '—';
const f2  = n => (n != null && isFinite(n)) ? n.toFixed(2) : '—';
const sgn = n => n >= 0 ? `+${p2(n)}` : p2(n);
const marcadorStr = m => !m ? '?' : (typeof m === 'object' ? `${m.local ?? '?'}-${m.visitante ?? '?'}` : String(m));

function computeNoVig(h2h) {
  try {
    const tieneEmpate = h2h.odds_empate != null && h2h.odds_empate > 1;
    const oddsArr = tieneEmpate
      ? [h2h.odds_local, h2h.odds_empate, h2h.odds_visitante]
      : [h2h.odds_local, h2h.odds_visitante];
    const implArr = oddsArr.map(o => impliedProbability(o));
    const nvArr   = noVigProbability(implArr);
    return tieneEmpate
      ? { local: nvArr[0], empate: nvArr[1], visitante: nvArr[2] }
      : { local: nvArr[0], empate: null,     visitante: nvArr[1] };
  } catch {
    return null;
  }
}

function favoritoKey(obj) {
  // Devuelve 'local' | 'empate' | 'visitante' según mayor probabilidad
  let best = 'local', bestP = obj.local ?? 0;
  if ((obj.empate ?? 0) > bestP)     { best = 'empate';    bestP = obj.empate; }
  if ((obj.visitante ?? 0) > bestP)  { best = 'visitante'; bestP = obj.visitante; }
  return best;
}

function underdogKey(obj) {
  let worst = 'local', worstP = obj.local ?? 1;
  if ((obj.empate ?? 1) < worstP)    { worst = 'empate';    worstP = obj.empate; }
  if ((obj.visitante ?? 1) < worstP) { worst = 'visitante'; worstP = obj.visitante; }
  return worst;
}

function evaluarFlags(modelo, mercado, lambdaL, lambdaV) {
  const flags  = [];
  const detail = [];

  const favM  = favoritoKey(mercado);
  const favP  = favoritoKey(modelo);

  const diffLocal     = (modelo.local     ?? 0) - (mercado.local     ?? 0);
  const diffEmpate    = (modelo.empate    ?? 0) - (mercado.empate    ?? 0);
  const diffVisitante = (modelo.visitante ?? 0) - (mercado.visitante ?? 0);
  const maxAbsDiff    = Math.max(Math.abs(diffLocal), Math.abs(diffEmpate), Math.abs(diffVisitante));
  const cambioFavorito = favM !== favP;

  // F1 — MODELO_INVERTIDO
  if (cambioFavorito && maxAbsDiff >= TH.MODELO_INVERTIDO_MIN_DIFF) {
    flags.push(FLAGS.MODELO_INVERTIDO);
    detail.push(`favorito_modelo=${favP} (${p1(modelo[favP])}) ≠ favorito_mercado=${favM} (${p1(mercado[favM])}), max_diff=${p1(maxAbsDiff)}`);
  }

  // F2 — FAVORITO_GRANDE_SUBESTIMADO
  if (!cambioFavorito &&
      (mercado[favM] ?? 0) >= TH.FAVORITO_GRANDE_MERCADO &&
      (modelo[favM]  ?? 0) <= TH.FAVORITO_GRANDE_MODELO_MAX) {
    flags.push(FLAGS.FAVORITO_GRANDE_SUBESTIMADO);
    detail.push(`mercado[${favM}]=${p1(mercado[favM])} vs modelo[${favM}]=${p1(modelo[favM])}`);
  }

  // F3 — UNDERDOG_SOBRESTIMADO
  const undM = underdogKey(mercado);
  if ((modelo[undM] ?? 0) >= TH.UNDERDOG_SOBRESTIMADO_MODELO_MIN &&
      (mercado[undM] ?? 0) <= TH.UNDERDOG_SOBRESTIMADO_MERCADO_MAX) {
    flags.push(FLAGS.UNDERDOG_SOBRESTIMADO);
    detail.push(`modelo[${undM}]=${p1(modelo[undM])} vs mercado[${undM}]=${p1(mercado[undM])}`);
  }

  // F4 — LAMBDA_EXTREMA
  if (lambdaL > TH.LAMBDA_ALTA || lambdaV > TH.LAMBDA_ALTA ||
      lambdaL < TH.LAMBDA_BAJA || lambdaV < TH.LAMBDA_BAJA) {
    flags.push(FLAGS.LAMBDA_EXTREMA);
    detail.push(`λ_local=${f2(lambdaL)}, λ_visitante=${f2(lambdaV)}`);
  }

  // F5 — GAP_MERCADO_ALTO (solo si no hay flags más graves)
  if (maxAbsDiff >= TH.GAP_MERCADO_ALTO &&
      !flags.includes(FLAGS.MODELO_INVERTIDO) &&
      !flags.includes(FLAGS.FAVORITO_GRANDE_SUBESTIMADO)) {
    flags.push(FLAGS.GAP_MERCADO_ALTO);
    detail.push(`max_abs_diff=${p1(maxAbsDiff)}`);
  }

  if (flags.length === 0) flags.push(FLAGS.OK);

  // Recomendación
  let rec;
  if (flags.includes(FLAGS.MODELO_INVERTIDO)) {
    rec = 'D';
  } else if (flags.includes(FLAGS.FAVORITO_GRANDE_SUBESTIMADO) ||
             (flags.includes(FLAGS.LAMBDA_EXTREMA) && maxAbsDiff >= 0.30)) {
    rec = 'C';
  } else if (flags.includes(FLAGS.UNDERDOG_SOBRESTIMADO) ||
             flags.includes(FLAGS.GAP_MERCADO_ALTO)) {
    rec = 'B';
  } else {
    rec = 'A';
  }

  return {
    flags,
    detail_flags: detail,
    diff_local:     +diffLocal.toFixed(4),
    diff_empate:    +diffEmpate.toFixed(4),
    diff_visitante: +diffVisitante.toFixed(4),
    max_abs_diff:   +maxAbsDiff.toFixed(4),
    cambio_favorito: cambioFavorito,
    favorito_modelo: favP,
    favorito_mercado: favM,
    recomendacion:  rec,
  };
}

// ── Cargar config + odds ──────────────────────────────────────────────────────

const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const J2_IDS    = Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []);

// Fuente de odds: preferir raw (permite re-procesar), fallback a pre-transformado
let eventosBrutos = null;
let partidesCachePre = null;

if (existsSync(RAW_PATH)) {
  const d = JSON.parse(readFileSync(RAW_PATH, 'utf-8'));
  eventosBrutos = d.eventos_completos ?? [];
  console.log(`\n  Odds (raw): ${RAW_PATH.split('\\').pop()}  (${eventosBrutos.length} eventos)`);
} else if (existsSync(PRE_PATH)) {
  const d = JSON.parse(readFileSync(PRE_PATH, 'utf-8'));
  partidesCachePre = d.partidos ?? {};
  console.log(`\n  Odds (pre-transformado): ${PRE_PATH.split('\\').pop()}`);
} else {
  console.error('ERROR: no se encontró reports/odds_j2_raw.json ni el fallback.');
  process.exit(1);
}

// ── Cargar predicciones en paralelo ──────────────────────────────────────────

console.log('═'.repeat(76));
console.log('  auditarLambdasJ2VsMercado — SOLO LECTURA');
console.log('═'.repeat(76));
console.log(`\n  ${J2_IDS.length} partidos desde config/j2_ids.json`);
console.log('  Cargando predicciones desde Firestore...\n');

const snaps = await Promise.all(
  J2_IDS.map(e => db.collection('predicciones').doc(String(e.matchId)).get())
);

// ── Procesar cada partido ─────────────────────────────────────────────────────

const partidos_out = [];

for (let i = 0; i < J2_IDS.length; i++) {
  const entrada = J2_IDS[i];
  const matchId = String(entrada.matchId);
  const partido = `${entrada.local} vs ${entrada.visitante}`;
  const snap    = snaps[i];

  if (!snap.exists) {
    partidos_out.push({ matchId, partido, error: 'sin_prediccion' });
    continue;
  }

  const pred = snap.data();
  const { lambda_local, lambda_visitante, prob_1x2, marcador_mas_probable, version_modelo } = pred;

  // Extraer h2h odds
  let h2h = null;
  try {
    if (eventosBrutos) {
      const oddsData = transformarRespuestaOddsApi(eventosBrutos, Number(matchId),
        entrada.fecha ?? pred.fechaPartido ?? null,
        { homeTeam: entrada.local, awayTeam: entrada.visitante });
      h2h = oddsData?.mercados?.h2h ?? null;
    } else if (partidesCachePre) {
      h2h = partidesCachePre[matchId]?.odds?.mercados?.h2h
         ?? partidesCachePre[Number(matchId)]?.odds?.mercados?.h2h
         ?? null;
    }
  } catch (err) {
    partidos_out.push({ matchId, partido, error: `odds_parse: ${err.message}` });
    continue;
  }

  if (!h2h) {
    partidos_out.push({ matchId, partido, error: 'sin_h2h_en_odds' });
    continue;
  }

  // Probabilidades no-vig del mercado
  const noVig = computeNoVig(h2h);
  if (!noVig) {
    partidos_out.push({ matchId, partido, error: 'novig_fallido' });
    continue;
  }

  const modelo = {
    local:     prob_1x2?.local     ?? null,
    empate:    prob_1x2?.empate    ?? null,
    visitante: prob_1x2?.visitante ?? null,
  };

  // Evaluar flags
  const eval_ = evaluarFlags(modelo, noVig, lambda_local, lambda_visitante);

  const fila = {
    matchId,
    partido,
    version_modelo,
    // Modelo
    lambda_local,
    lambda_visitante,
    marcador_mas_probable: marcadorStr(marcador_mas_probable),
    prob_modelo: modelo,
    // Mercado
    n_bookmakers_h2h:    h2h.n_bookmakers,
    overround_pct:       h2h.overround_pct,
    odds_h2h: {
      local:     h2h.odds_local,
      empate:    h2h.odds_empate,
      visitante: h2h.odds_visitante,
    },
    prob_mercado_novig: noVig,
    // Evaluación
    ...eval_,
    recomendacion_label: REC[eval_.recomendacion],
  };

  partidos_out.push(fila);
}

// ── Ordenar por severidad (D > C > B > A) ────────────────────────────────────

const recOrd = { D: 0, C: 1, B: 2, A: 3 };
const ordenados = [...partidos_out]
  .filter(r => !r.error)
  .sort((a, b) => (recOrd[a.recomendacion] ?? 9) - (recOrd[b.recomendacion] ?? 9)
               || (b.max_abs_diff ?? 0) - (a.max_abs_diff ?? 0));

// ── Imprimir en consola ───────────────────────────────────────────────────────

for (const r of ordenados) {
  if (r.error) continue;
  const icon = { A: '✓', B: '~', C: '!', D: '✗' }[r.recomendacion] ?? '?';
  console.log(`  ${icon} [${r.recomendacion}] ${r.matchId}  ${r.partido}`);
  console.log(`       λ=${f2(r.lambda_local)}/${f2(r.lambda_visitante)}  marcador=${marcadorStr(r.marcador_mas_probable)}  v=${r.version_modelo}`);
  console.log(`       Modelo  : L=${p1(r.prob_modelo.local)} X=${p1(r.prob_modelo.empate)} V=${p1(r.prob_modelo.visitante)}  → ${r.favorito_modelo}`);
  console.log(`       Mercado : L=${p1(r.prob_mercado_novig.local)} X=${p1(r.prob_mercado_novig.empate)} V=${p1(r.prob_mercado_novig.visitante)}  → ${r.favorito_mercado}  (${r.n_bookmakers_h2h} bks, ${r.overround_pct}% OR)`);
  console.log(`       Diffs   : ΔL=${sgn(r.diff_local)} ΔX=${sgn(r.diff_empate)} ΔV=${sgn(r.diff_visitante)}  max_abs=${p1(r.max_abs_diff)}`);
  console.log(`       Flags   : ${r.flags.join(', ')}`);
  if (r.detail_flags.length > 0) {
    for (const d of r.detail_flags) console.log(`         · ${d}`);
  }
  console.log('');
}

// ── Resumen de flags ──────────────────────────────────────────────────────────

const conteoRec   = { A: 0, B: 0, C: 0, D: 0 };
const conteoFlags = {};
for (const r of partidos_out.filter(r => !r.error)) {
  conteoRec[r.recomendacion] = (conteoRec[r.recomendacion] ?? 0) + 1;
  for (const f of r.flags) conteoFlags[f] = (conteoFlags[f] ?? 0) + 1;
}

console.log('═'.repeat(76));
console.log('  RESUMEN');
console.log('─'.repeat(76));
console.log(`  A — USABLE                  : ${conteoRec.A}`);
console.log(`  B — SOLO_MERCADOS_PROTEGIDOS: ${conteoRec.B}`);
console.log(`  C — BLOQUEAR_APUESTAS       : ${conteoRec.C}`);
console.log(`  D — RECALCULAR_PREDICCION   : ${conteoRec.D}`);
console.log('─'.repeat(76));
console.log('  Flags:');
for (const [f, n] of Object.entries(conteoFlags).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${f.padEnd(35)}: ${n}`);
}
console.log('─'.repeat(76));
console.log('  Ranking partidos más problemáticos:');
for (const r of ordenados.slice(0, 8)) {
  if (r.error) continue;
  console.log(`    [${r.recomendacion}] ${r.matchId.padEnd(8)} ${r.partido.padEnd(32)} max_diff=${p1(r.max_abs_diff)}  flags=${r.flags.filter(f => f !== FLAGS.OK).join('+')||'OK'}`);
}
console.log('═'.repeat(76));

// ── Generar JSON ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(JSON_OUT, JSON.stringify({
  generado_en: new Date().toISOString(),
  umbrales:    TH,
  resumen: {
    total:            partidos_out.length,
    por_recomendacion: conteoRec,
    por_flag:          conteoFlags,
  },
  ranking_problematicos: ordenados.slice(0, 8).map(r => ({
    matchId: r.matchId, partido: r.partido, recomendacion: r.recomendacion,
    flags: r.flags, max_abs_diff: r.max_abs_diff, cambio_favorito: r.cambio_favorito,
  })),
  partidos: ordenados,
}, null, 2), 'utf-8');

console.log(`\n  JSON: reports/auditoria_lambdas_j2_vs_mercado.json`);

// ── Generar Markdown ──────────────────────────────────────────────────────────

const md = [];
const hoy = new Date().toISOString().slice(0, 10);

md.push(`# Auditoría Lambdas J2 vs Mercado — ${hoy}`);
md.push('');
md.push('> **Modo:** solo lectura | **Modelo:** V2.1-psico-context (CONGELADO)');
md.push('');
md.push('---');
md.push('');
md.push('## Resumen ejecutivo');
md.push('');
md.push('| Recomendación | Partidos | Descripción |');
md.push('|---|---|---|');
md.push(`| ✓ A — USABLE | ${conteoRec.A} | Modelo y mercado alineados — señales con filtros normales |`);
md.push(`| ~ B — SOLO_PROTEGIDOS | ${conteoRec.B} | Gap relevante — evitar H2H directo, usar AH/DC |`);
md.push(`| ! C — BLOQUEAR | ${conteoRec.C} | Divergencia severa — no generar señales H2H |`);
md.push(`| ✗ D — RECALCULAR | ${conteoRec.D} | Favorito invertido o datos erróneos — regenerar predicción |`);
md.push('');
md.push('### Flags detectados');
md.push('');
md.push('| Flag | Partidos |');
md.push('|---|---|');
for (const [f, n] of Object.entries(conteoFlags).sort((a, b) => b[1] - a[1])) {
  md.push(`| \`${f}\` | ${n} |`);
}
md.push('');
md.push('---');
md.push('');
md.push('## Tabla de 24 partidos (ordenado por severidad)');
md.push('');
md.push('| Rec | matchId | Partido | λL/λV | Marcador | FavMod | FavMkt | MaxDiff | Flags |');
md.push('|---|---|---|---|---|---|---|---|---|');

for (const r of ordenados) {
  if (r.error) {
    md.push(`| ERR | ${r.matchId} | ${r.partido} | — | — | — | — | — | ${r.error} |`);
    continue;
  }
  const recIcon = { A: '✓A', B: '~B', C: '!C', D: '✗D' }[r.recomendacion] ?? r.recomendacion;
  const flagsStr = r.flags.filter(f => f !== FLAGS.OK).join(', ') || 'OK';
  md.push(`| **${recIcon}** | ${r.matchId} | ${r.partido} | ${f2(r.lambda_local)}/${f2(r.lambda_visitante)} | ${r.marcador_mas_probable ?? '?'} | ${r.favorito_modelo} | ${r.favorito_mercado} | ${p1(r.max_abs_diff)} | \`${flagsStr}\` |`);
}

md.push('');
md.push('---');
md.push('');
md.push('## Detalle por partido (problemáticos primero)');
md.push('');

for (const r of ordenados) {
  if (r.error) continue;
  const recLabel = { A: '✓ A — USABLE', B: '~ B — SOLO PROTEGIDOS', C: '! C — BLOQUEAR', D: '✗ D — RECALCULAR' }[r.recomendacion];

  md.push(`### ${r.partido} \`${r.matchId}\`  →  ${recLabel}`);
  md.push('');
  md.push(`**λ:** ${f2(r.lambda_local)}/${f2(r.lambda_visitante)} | **Marcador esperado:** ${r.marcador_mas_probable ?? '?'} | **Versión:** ${r.version_modelo}`);
  md.push('');
  md.push('| | Local | Empate | Visitante |');
  md.push('|---|---|---|---|');
  md.push(`| **Modelo** | ${p1(r.prob_modelo.local)} | ${p1(r.prob_modelo.empate)} | ${p1(r.prob_modelo.visitante)} |`);
  md.push(`| **Mercado no-vig** | ${p1(r.prob_mercado_novig.local)} | ${p1(r.prob_mercado_novig.empate)} | ${p1(r.prob_mercado_novig.visitante)} |`);
  md.push(`| **Odds (mediana)** | ${f2(r.odds_h2h.local)} | ${f2(r.odds_h2h.empate)} | ${f2(r.odds_h2h.visitante)} |`);
  md.push(`| **Diferencia** | ${sgn(r.diff_local)} | ${sgn(r.diff_empate)} | ${sgn(r.diff_visitante)} |`);
  md.push('');

  md.push(`**Flags:** ${r.flags.map(f => `\`${f}\``).join(' ')}`);
  if (r.detail_flags.length > 0) {
    for (const d of r.detail_flags) md.push(`- ${d}`);
  }
  md.push('');
  md.push(`**Recomendación:** ${r.recomendacion_label}`);
  if (r.recomendacion === 'D') {
    md.push('> ⚠ Verificar orientación local/visitante y fuentes de lambda antes de generar señales.');
  } else if (r.recomendacion === 'C') {
    md.push('> ⚠ Modelo y mercado difieren severamente. No generar H2H directo. Usar AH como alternativa.');
  } else if (r.recomendacion === 'B') {
    md.push('> Usar señales de totals u over/under si EV es positivo. Evitar H2H.');
  }
  md.push('');
}

md.push('---');
md.push('');
md.push('## Umbrales aplicados');
md.push('');
md.push('| Umbral | Valor |');
md.push('|---|---|');
for (const [k, v] of Object.entries(TH)) {
  md.push(`| ${k} | ${v} |`);
}
md.push('');

writeFileSync(MD_OUT, md.join('\n'), 'utf-8');
console.log(`  MD:   reports/auditoria_lambdas_j2_vs_mercado.md\n`);

process.exit(0);

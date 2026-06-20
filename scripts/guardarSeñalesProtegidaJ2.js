/**
 * guardarSeñalesProtegidaJ2.js — V2.2 Señales Protegidas para J2
 *
 * Flags:
 *   (ninguno)  → dry-run: 1 llamada API, 0 escrituras Firestore, 3 archivos locales
 *   --write    → dry-run completo + update() solo campo señales_protegidas en Firestore
 *   --force    → ignora caché local y re-llama The Odds API
 *
 * Requisitos previos:
 *   1. Llenar config/j2_ids.json con los matchIds J2 de football-data.org.
 *   2. Tener predicciones V2.1 generadas en Firestore para cada matchId.
 *
 * GARANTÍAS:
 *   - Markets: h2h, totals, spreads únicamente.
 *   - NO usa double_chance, draw_no_bet, alternate_spreads ni alternate_totals.
 *   - update() solo toca: señales_protegidas, v2_2_version, v2_2_generado_en.
 *   - NUNCA sobreescribe: señales_valor, lambda_*, prob_*, version_modelo ni otros campos V2.1.
 *   - Genera reportes locales antes de cualquier escritura Firestore.
 *   - 0 escrituras Firestore en dry-run (default).
 */

import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve }          from 'path';
import { getFirestore }     from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';
import {
  deriveAllProtectedMarkets,
  mapBaseSignalToProtectedMarkets,
  classifyProtectedMarketRisk,
  evConPush,
  evSimple,
} from '../src/betting/protectionMarkets.js';

const db = getFirestore();

// ── Argumentos ────────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const FORCE = args.includes('--force');

// ── Constantes ─────────────────────────────────────────────────────────────────

const API_KEY   = process.env.THE_ODDS_API_KEY;
const BASE_URL  = 'https://api.the-odds-api.com';
const SPORT     = 'soccer_fifa_world_cup';
const MARKETS   = 'h2h,totals,spreads';
const EXCLUIDOS = ['double_chance', 'draw_no_bet', 'alternate_spreads', 'alternate_totals'];
const HOY       = new Date().toISOString().slice(0, 10);

const OUT_DIR      = resolve('reports');
const CACHE_PATH   = resolve(OUT_DIR, 'odds_j2_raw.json');
const RAW_PATH     = resolve(OUT_DIR, 'odds_j2_h2h_totals_spreads_raw.json');
const JSON_PATH    = resolve(OUT_DIR, 'senales_protegidas_j2_dryrun.json');
const MD_PATH      = resolve(OUT_DIR, 'senales_protegidas_j2_dryrun.md');

// ── Encabezado ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  V2.2 — SEÑALES PROTEGIDAS J2');
console.log(`  Modo: ${WRITE ? '🟡 WRITE (escribe en Firestore)' : '🟢 DRY-RUN (0 escrituras)'}`);
console.log('═'.repeat(70));
console.log(`  Fecha  : ${HOY}`);
console.log(`  Markets: ${MARKETS}`);
console.log(`  Excl.  : ${EXCLUIDOS.join(', ')}\n`);

// ── Paso 1: Leer config/j2_ids.json ──────────────────────────────────────────

const configPath = resolve('config', 'j2_ids.json');
if (!existsSync(configPath)) {
  console.error(`  ERROR: No se encontró ${configPath}`);
  console.error(`  Crear el archivo con los matchIds J2 antes de ejecutar.`);
  process.exit(1);
}

const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
const J2_PARTIDOS = Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []);

if (J2_PARTIDOS.length === 0) {
  console.error(`  ERROR: config/j2_ids.json tiene 0 partidos.`);
  console.error(`  Agregar los matchIds J2 antes de ejecutar.`);
  console.error(`\n  Formato esperado:`);
  console.error(`    { "matchId": "537500", "local": "Brazil", "visitante": "Germany" }`);
  process.exit(1);
}

const J2_IDS = J2_PARTIDOS.map(p => String(p.matchId));
console.log(`[1/5] Config J2: ${J2_PARTIDOS.length} partidos\n`);
J2_PARTIDOS.forEach(p => console.log(`  ${p.matchId} — ${p.local} vs ${p.visitante}`));
console.log('');

// ── Paso 2: Leer predicciones V2.1 desde Firestore ───────────────────────────

console.log('[2/5] Leyendo predicciones V2.1 desde Firestore...');
const snaps = await Promise.all(
  J2_IDS.map(id => db.collection('predicciones').doc(id).get())
);

const predicciones = [];
for (const snap of snaps) {
  if (!snap.exists) {
    console.log(`  ✗ ${snap.id} — NO encontrado en Firestore. ¿Se generó la predicción V2.1?`);
    continue;
  }
  const d = snap.data();
  predicciones.push({ matchId: snap.id, ...d });
  console.log(`  ✓ ${snap.id} — ${d.nombreLocal} vs ${d.nombreVisitante}`);
}

if (predicciones.length === 0) {
  console.error(`\n  ERROR: Ninguna predicción V2.1 encontrada en Firestore.`);
  console.error(`  Generar predicciones J2 antes de ejecutar este script.`);
  process.exit(1);
}

console.log(`\n  ${predicciones.length}/${J2_PARTIDOS.length} predicciones cargadas\n`);

// ── Paso 3: Obtener odds (caché o API) ────────────────────────────────────────

console.log('[3/5] Obteniendo odds de The Odds API...');

if (!API_KEY) {
  console.error('  ERROR: THE_ODDS_API_KEY no definida en .env');
  process.exit(1);
}

const url     = `${BASE_URL}/v4/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=eu&markets=${MARKETS}&oddsFormat=decimal`;
const urlSafe = url.replace(API_KEY, '***KEY***');

let eventos, creditos;

const usarCache = existsSync(CACHE_PATH) && !FORCE;

if (usarCache) {
  console.log(`  → Usando caché local: ${CACHE_PATH}`);
  console.log(`  → Usar --force para re-llamar The Odds API\n`);
  const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  eventos  = cached.eventos_completos;
  creditos = cached.meta.creditos;
  console.log(`  Caché generado: ${cached.meta.generado_en}`);
  console.log(`  Eventos en caché: ${eventos.length}\n`);
} else {
  if (FORCE && existsSync(CACHE_PATH)) {
    console.log(`  → --force activo: ignorando caché existente\n`);
  }
  console.log(`  URL: ${urlSafe}`);
  console.log(`  Ejecutando llamada API...\n`);

  const apiRes = await fetch(url);

  creditos = {
    last_call:  apiRes.headers.get('x-requests-last'),
    remaining:  apiRes.headers.get('x-requests-remaining'),
    used:       apiRes.headers.get('x-requests-used'),
  };

  console.log(`  HTTP ${apiRes.status}`);
  console.log(`  x-requests-last     : ${creditos.last_call}`);
  console.log(`  x-requests-remaining: ${creditos.remaining}`);
  console.log(`  x-requests-used     : ${creditos.used}\n`);

  if (!apiRes.ok) {
    const body = await apiRes.text();
    console.error(`  ERROR HTTP ${apiRes.status}: ${body}`);
    process.exit(1);
  }

  eventos = await apiRes.json();
  console.log(`  Eventos en respuesta: ${eventos.length}`);

  // Guardar caché ANTES de cualquier procesamiento
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    CACHE_PATH,
    JSON.stringify({
      meta: {
        generado_en: new Date().toISOString(),
        markets: MARKETS,
        url_safe: urlSafe,
        creditos,
      },
      eventos_completos: eventos,
    }, null, 2),
    'utf8'
  );
  console.log(`  ✓ Caché guardado: ${CACHE_PATH}\n`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolverMercadoProtegido(id, mercados, nL, nV) {
  const dc  = mercados.double_chance;
  const dnb = mercados.draw_no_bet;
  const ah  = mercados.asian_handicap;
  const tot = mercados.totales_protegidos;
  const tt  = mercados.team_totals;

  switch (id) {
    case 'DC_1X':  return { descripcion: `${nL} gana o empate`,   fuente: 'double_chance', prob_modelo: dc['1X'] };
    case 'DC_X2':  return { descripcion: `Empate o ${nV} gana`,   fuente: 'double_chance', prob_modelo: dc['X2'] };
    case 'DC_12':  return { descripcion: `${nL} o ${nV} gana`,    fuente: 'double_chance', prob_modelo: dc['12'] };

    case 'DNB_local':
      return { descripcion: `${nL} DNB`, fuente: 'draw_no_bet', tiene_push: true,
               prob_modelo: dnb.local_dnb.prob_win, prob_push: dnb.local_dnb.prob_push, prob_loss: dnb.local_dnb.prob_loss };
    case 'DNB_visitante':
      return { descripcion: `${nV} DNB`, fuente: 'draw_no_bet', tiene_push: true,
               prob_modelo: dnb.visitante_dnb.prob_win, prob_push: dnb.visitante_dnb.prob_push, prob_loss: dnb.visitante_dnb.prob_loss };

    case 'AH_local_+0.5':     return { descripcion: `${nL} +0.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_+0.5']?.prob_win,     prob_loss: ah['AH_local_+0.5']?.prob_loss };
    case 'AH_local_+1.0':     return { descripcion: `${nL} +1.0`, fuente: 'asian_handicap', tiene_push: true,  prob_modelo: ah['AH_local_+1.0']?.prob_win,     prob_loss: ah['AH_local_+1.0']?.prob_loss, prob_push: ah['AH_local_+1.0']?.prob_push };
    case 'AH_local_+1.5':     return { descripcion: `${nL} +1.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_+1.5']?.prob_win,     prob_loss: ah['AH_local_+1.5']?.prob_loss };
    case 'AH_local_-0.5':     return { descripcion: `${nL} -0.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_local_-0.5']?.prob_win,     prob_loss: ah['AH_local_-0.5']?.prob_loss };
    case 'AH_visitante_+0.5': return { descripcion: `${nV} +0.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_+0.5']?.prob_win, prob_loss: ah['AH_visitante_+0.5']?.prob_loss };
    case 'AH_visitante_+1.0': return { descripcion: `${nV} +1.0`, fuente: 'asian_handicap', tiene_push: true,  prob_modelo: ah['AH_visitante_+1.0']?.prob_win, prob_loss: ah['AH_visitante_+1.0']?.prob_loss, prob_push: ah['AH_visitante_+1.0']?.prob_push };
    case 'AH_visitante_+1.5': return { descripcion: `${nV} +1.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_+1.5']?.prob_win, prob_loss: ah['AH_visitante_+1.5']?.prob_loss };
    case 'AH_visitante_-0.5': return { descripcion: `${nV} -0.5`, fuente: 'asian_handicap', tiene_push: false, prob_modelo: ah['AH_visitante_-0.5']?.prob_win, prob_loss: ah['AH_visitante_-0.5']?.prob_loss };

    case 'over_1.5':           return { descripcion: 'Over 1.5',        fuente: 'totales_protegidos', prob_modelo: tot.over_1_5  };
    case 'over_2.5':           return { descripcion: 'Over 2.5',        fuente: 'totales_protegidos', prob_modelo: tot.over_2_5  };
    case 'under_3.5':          return { descripcion: 'Under 3.5',       fuente: 'totales_protegidos', prob_modelo: tot.under_3_5 };
    case 'team_home_over_0_5': return { descripcion: `${nL} ≥1 gol`,   fuente: 'team_totals',        prob_modelo: tt.home_over_0_5 };
    case 'team_away_over_0_5': return { descripcion: `${nV} ≥1 gol`,   fuente: 'team_totals',        prob_modelo: tt.away_over_0_5 };
    default: return null;
  }
}

function calcularEV(prob_modelo, tiene_push, prob_loss, cuota_real) {
  if (!cuota_real || !prob_modelo || cuota_real <= 1) return { ev: null, edge: null };
  const ev   = (tiene_push && prob_loss != null)
    ? evConPush(prob_modelo, prob_loss, cuota_real)
    : evSimple(prob_modelo, cuota_real);
  const edge = +(prob_modelo - 1 / cuota_real).toFixed(4);
  return { ev, edge };
}

// ── Paso 4: Calcular señales protegidas ──────────────────────────────────────

console.log('[4/5] Calculando señales protegidas...\n');

const resultados = [];
const rawOdds    = {};

const qc = {
  partidos_procesados: 0, partidos_con_spreads: 0, partidos_sin_odds_api: 0,
  total_bks_spreads: 0, total_lineas_oficiales: 0, total_lineas_cuarto: 0,
  senales_activas: 0, mercados_protegidos_totales: 0,
  mercados_apostables: 0, mercados_calculable_no_apostable: 0, mercados_no_recomendados: 0,
  ev_positivo: 0, ev_negativo: 0, ev_cero: 0,
};

for (const pred of predicciones) {
  const {
    matchId, nombreLocal, nombreVisitante, fechaPartido,
    lambda_local, lambda_visitante, prob_1x2, prob_over_under, señales_valor,
  } = pred;

  qc.partidos_procesados++;
  const nombre = `${nombreLocal} vs ${nombreVisitante}`;

  // Mercados protegidos matemáticos desde Poisson
  const mercados = deriveAllProtectedMarkets(
    lambda_local, lambda_visitante, prob_1x2, prob_over_under
  );

  if (!mercados.calculable) {
    console.log(`  ✗ ${matchId} ${nombre} — ${mercados.error}`);
    resultados.push({ matchId, nombre, error: mercados.error });
    continue;
  }

  // Buscar evento en respuesta API
  let oddsSnapshot = null, spreads_data = null;
  try {
    oddsSnapshot = transformarRespuestaOddsApi(eventos, matchId, fechaPartido ?? HOY, {
      homeTeam: nombreLocal,
      awayTeam: nombreVisitante,
    });
    spreads_data = oddsSnapshot?.mercados?.spreads ?? null;
    rawOdds[matchId] = { matchId, nombreLocal, nombreVisitante, fechaPartido, odds: oddsSnapshot };

    if (spreads_data) {
      qc.partidos_con_spreads++;
      qc.total_bks_spreads      += spreads_data.n_bookmakers_spreads ?? 0;
      qc.total_lineas_oficiales += spreads_data.n_lineas_oficiales   ?? 0;
      qc.total_lineas_cuarto    += spreads_data.n_lineas_cuarto      ?? 0;
    }
  } catch (err) {
    console.log(`  ⚠  ${matchId} ${nombre} — API: ${err.message}`);
    qc.partidos_sin_odds_api++;
    rawOdds[matchId] = { matchId, nombreLocal, nombreVisitante, fechaPartido, odds: null, error: err.message };
  }

  // Señales V2.1 activas (no se modifican)
  const senalesActivas = (señales_valor ?? []).filter(s =>
    s.is_value_bet === true &&
    (s.recomendacion === 'apostar' || s.recomendacion === 'considerar')
  );
  qc.senales_activas += senalesActivas.length;

  // Mapear señales → mercados protegidos
  const mapeo_señales        = [];      // para reportes (estructura anidada)
  const señales_protegidas_fs = [];     // para Firestore (estructura plana)

  for (const señal of senalesActivas) {
    const contexto = {
      prob_1x2,
      prob_modelo:    señal.prob_modelo,
      bookmaker_odds: señal.bookmaker_odds,
    };

    const sugerencias = mapBaseSignalToProtectedMarkets(señal.mercado, señal.seleccion, contexto);
    const detalle     = [];

    for (const { id, razon_mapeo } of sugerencias) {

      if (id === 'proteccion_no_recomendada') {
        qc.mercados_no_recomendados++;
        qc.mercados_protegidos_totales++;
        const item = { id, razon_mapeo, estado: 'no_recomendada', cuota_real: null, ev: null, edge: null };
        detalle.push(item);
        // No se incluye en Firestore (no_recomendada no es señal apostable)
        continue;
      }

      const resolved = resolverMercadoProtegido(id, mercados, nombreLocal, nombreVisitante);
      if (!resolved) continue;

      // Cuota real: solo AH desde spreads
      let cuota_real = null, n_bks_cuota = null, estado = 'calculable_no_apostable';
      if (id.startsWith('AH_') && spreads_data?.lineas_oficiales?.[id]) {
        const entry = spreads_data.lineas_oficiales[id];
        cuota_real   = entry.mediana;
        n_bks_cuota  = entry.n_bookmakers;
        estado       = 'apostable';
        qc.mercados_apostables++;
      } else {
        qc.mercados_calculable_no_apostable++;
      }

      const { ev, edge } = calcularEV(
        resolved.prob_modelo, resolved.tiene_push ?? false, resolved.prob_loss, cuota_real
      );
      const tipo_proteccion = resolved.prob_modelo != null
        ? classifyProtectedMarketRisk(resolved.prob_modelo)
        : null;

      if (ev !== null) {
        if (ev > 0.001) qc.ev_positivo++;
        else if (ev < -0.001) qc.ev_negativo++;
        else qc.ev_cero++;
      }

      qc.mercados_protegidos_totales++;

      const item = {
        id,
        descripcion:    resolved.descripcion,
        razon_mapeo,
        tipo_proteccion,
        fuente_prob:    resolved.fuente,
        prob_modelo:    resolved.prob_modelo,
        tiene_push:     resolved.tiene_push  ?? false,
        prob_push:      resolved.prob_push   ?? null,
        prob_loss:      resolved.prob_loss   ?? null,
        cuota_real,
        n_bks_cuota,
        market_key_api: cuota_real ? 'spreads' : null,
        ev,
        edge,
        estado,
        señal_base: {
          mercado:        señal.mercado,
          seleccion:      señal.seleccion,
          prob_modelo:    señal.prob_modelo,
          bookmaker_odds: señal.bookmaker_odds,
        },
      };

      detalle.push(item);
      señales_protegidas_fs.push(item); // estructura plana para Firestore
    }

    mapeo_señales.push({
      señal_base: {
        mercado:        señal.mercado,
        seleccion:      señal.seleccion,
        prob_modelo:    señal.prob_modelo,
        bookmaker_odds: señal.bookmaker_odds,
      },
      n_protegidas:        detalle.length,
      mercados_protegidos: detalle,
    });
  }

  const mejores_ev = mapeo_señales
    .flatMap(m => m.mercados_protegidos)
    .filter(p => p.ev !== null)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 3);

  const nApostable = señales_protegidas_fs.filter(p => p.estado === 'apostable').length;
  const nEvPos     = señales_protegidas_fs.filter(p => (p.ev ?? -1) > 0).length;

  console.log(`  ✓ ${String(matchId).padEnd(7)} ${nombre.padEnd(35)} señales=${senalesActivas.length}  AH=${nApostable}  ev+=${nEvPos}  bks=${spreads_data?.n_bookmakers_spreads ?? 0}`);

  resultados.push({
    matchId, nombre, fechaPartido,
    n_senales_activas:        senalesActivas.length,
    spreads_disponible:       spreads_data !== null,
    n_bks_spreads:            spreads_data?.n_bookmakers_spreads ?? 0,
    n_lineas_oficiales:       spreads_data?.n_lineas_oficiales   ?? 0,
    n_lineas_cuarto:          spreads_data?.n_lineas_cuarto      ?? 0,
    lineas_cuarto_info:       Object.keys(spreads_data?.lineas_cuarto ?? {}),
    mapeo_señales,
    mejores_ev,
    // Campo para Firestore (solo en --write)
    _señales_protegidas_fs:   señales_protegidas_fs,
  });
}

// ── Paso 5: Generar reportes locales ─────────────────────────────────────────

console.log('\n[5/5] Generando reportes...\n');
mkdirSync(OUT_DIR, { recursive: true });

const top10EV = resultados
  .flatMap(r => (r.mapeo_señales ?? [])
    .flatMap(m => m.mercados_protegidos.map(p => ({ ...p, partido: r.nombre }))))
  .filter(p => p.ev !== null)
  .sort((a, b) => b.ev - a.ev)
  .slice(0, 10);

// ── Archivo 1: odds raw ───────────────────────────────────────────────────────

writeFileSync(RAW_PATH, JSON.stringify({
  meta: {
    generado_en: new Date().toISOString(),
    fecha_ejecucion: HOY,
    markets_usados: MARKETS.split(','),
    markets_excluidos: EXCLUIDOS,
    n_partidos_consultados: predicciones.length,
    n_partidos_con_odds: Object.values(rawOdds).filter(v => v.odds).length,
    escrituras_firestore: 0,
    desde_cache: usarCache,
    url_safe: usarCache ? '(desde caché)' : urlSafe,
    creditos,
  },
  partidos: rawOdds,
}, null, 2), 'utf8');
console.log(`  ✓ ${RAW_PATH}`);

// ── Archivo 2: dryrun JSON ────────────────────────────────────────────────────

writeFileSync(JSON_PATH, JSON.stringify({
  meta: {
    version: 'V2.2-spreads-j2',
    generado_en: new Date().toISOString(),
    markets_usados: MARKETS.split(','),
    markets_excluidos: EXCLUIDOS,
    escrituras_firestore: WRITE ? resultados.filter(r => !r.error).length : 0,
    senales_valor_modificadas: false,
    llamadas_api: usarCache ? 0 : 1,
    desde_cache: usarCache,
    creditos,
    control_calidad: qc,
    top_10_ev: top10EV.map(({ partido, id, descripcion, prob_modelo, cuota_real, ev, edge, tipo_proteccion, estado }) =>
      ({ partido, id, descripcion, prob_modelo, cuota_real, ev, edge, tipo_proteccion, estado })
    ),
  },
  partidos: resultados.map(r => {
    const { _señales_protegidas_fs, ...rest } = r;
    return rest;
  }),
}, null, 2), 'utf8');
console.log(`  ✓ ${JSON_PATH}`);

// ── Archivo 3: dryrun MD ──────────────────────────────────────────────────────

const fmt_pct   = v => v != null ? `${(v * 100).toFixed(1)}%` : 'N/D';
const fmt_ev    = v => v != null ? (v > 0 ? `**+${(v*100).toFixed(2)}%**` : `${(v*100).toFixed(2)}%`) : 'N/D';
const fmt_cuota = v => v != null ? v.toFixed(3) : 'N/D';
const fmt_edge  = v => v != null ? (v > 0 ? `+${v.toFixed(3)}` : v.toFixed(3)) : 'N/D';

const md = [];
md.push(`# V2.2 Señales Protegidas J2 — Spreads Reales`);
md.push(`**${HOY}** | Markets: \`${MARKETS}\` | Modo: **${WRITE ? 'WRITE' : 'DRY-RUN'}** | Escrituras FS: ${WRITE ? resultados.filter(r => !r.error).length : 0}`);
md.push('');

md.push(`## Resumen Ejecutivo`);
md.push('');
md.push(`| Métrica | Valor |`);
md.push(`|---------|-------|`);
md.push(`| Partidos J2 en config | ${J2_PARTIDOS.length} |`);
md.push(`| Con predicción V2.1 | ${predicciones.length} |`);
md.push(`| Partidos con spreads | ${qc.partidos_con_spreads} |`);
md.push(`| Señales V2.1 activas | ${qc.senales_activas} |`);
md.push(`| Mercados protegidos totales | ${qc.mercados_protegidos_totales} |`);
md.push(`| Mercados apostables (AH con cuota) | **${qc.mercados_apostables}** |`);
md.push(`| EV positivo | **${qc.ev_positivo}** |`);
md.push(`| EV negativo | ${qc.ev_negativo} |`);
md.push(`| Llamadas API | ${usarCache ? 0 : 1} (${usarCache ? 'desde caché' : 'nueva llamada'}) |`);
md.push(`| Escrituras Firestore | ${WRITE ? resultados.filter(r => !r.error).length : '**0**'} |`);
md.push('');

md.push(`## Control de Calidad V2.2`);
md.push('');
md.push(`| Check | Resultado |`);
md.push(`|-------|-----------|`);
md.push(`| Partidos procesados | ${qc.partidos_procesados}/${J2_PARTIDOS.length} |`);
md.push(`| Partidos con spreads | ${qc.partidos_con_spreads} |`);
md.push(`| Total bks con spreads | ${qc.total_bks_spreads} |`);
md.push(`| Líneas AH oficiales | ${qc.total_lineas_oficiales} |`);
md.push(`| Líneas cuarto info | ${qc.total_lineas_cuarto} |`);
md.push(`| Señales protegidas | ${qc.mercados_protegidos_totales} |`);
md.push(`| EV+ | **${qc.ev_positivo}** |`);
md.push(`| EV− | ${qc.ev_negativo} |`);
md.push(`| \`double_chance\` usado | ❌ No |`);
md.push(`| \`draw_no_bet\` usado | ❌ No |`);
md.push(`| \`señales_valor\` modificadas | ❌ No |`);
md.push(`| Escrituras Firestore | ${WRITE ? '⚠️ ' + resultados.filter(r=>!r.error).length : '❌ 0'} |`);
md.push('');

if (WRITE) {
  md.push(`> ⚠️ **Modo WRITE activo.** Los campos \`señales_protegidas\`, \`v2_2_version\` y \`v2_2_generado_en\` fueron actualizados en Firestore.`);
  md.push(`> No se modificaron \`señales_valor\`, \`lambda_*\`, \`prob_*\` ni ningún campo V2.1.`);
  md.push('');
}

if (top10EV.length > 0) {
  md.push(`## Top 10 Señales Protegidas por EV`);
  md.push('');
  md.push(`| # | Partido | Market | Prob | Cuota | EV | Tipo |`);
  md.push(`|---|---------|--------|------|-------|----|------|`);
  top10EV.forEach((p, i) => {
    md.push(`| ${i+1} | ${p.partido} | \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${p.tipo_proteccion ?? ''} |`);
  });
  md.push('');
}

md.push(`## Partidos Consultados`);
md.push('');
md.push(`| matchId | Partido | Fecha | Spreads | Bks | Líneas | EV+ |`);
md.push(`|---------|---------|-------|---------|-----|--------|-----|`);
for (const r of resultados) {
  if (r.error) { md.push(`| ${r.matchId} | ${r.nombre} | — | ❌ error | 0 | 0 | 0 |`); continue; }
  const nEVPos = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => (p.ev ?? -1) > 0).length;
  md.push(`| ${r.matchId} | ${r.nombre} | ${r.fechaPartido ?? '?'} | ${r.spreads_disponible ? '✅' : '❌'} | ${r.n_bks_spreads} | ${r.n_lineas_oficiales} | **${nEVPos}** |`);
}
md.push('');

md.push(`## Análisis por Partido`);
md.push('');

for (const r of resultados) {
  if (r.error) {
    md.push(`### ${r.matchId} — ${r.nombre} ⚠`);
    md.push(`> \`${r.error}\``);
    md.push('');
    continue;
  }

  const nApost  = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => p.estado === 'apostable').length;
  const nEvPos  = (r.mapeo_señales ?? []).flatMap(m => m.mercados_protegidos).filter(p => (p.ev ?? -1) > 0).length;

  md.push(`### ${r.matchId} — ${r.nombre}`);
  md.push(`**Fecha:** ${r.fechaPartido ?? '?'} | **Señales activas:** ${r.n_senales_activas} | **AH apostables:** ${nApost} | **EV+:** ${nEvPos}`);
  md.push('');

  if (r.n_bks_spreads > 0) {
    md.push(`**Spreads:** ${r.n_bks_spreads} bks | ${r.n_lineas_oficiales} líneas oficiales | ${r.n_lineas_cuarto} cuartos`);
    if (r.lineas_cuarto_info?.length > 0) {
      md.push(`- Líneas cuarto (informativas): \`${r.lineas_cuarto_info.join('`, `')}\``);
    }
    md.push('');
  } else {
    md.push(`> ⚠️ Sin spreads para este partido.`);
    md.push('');
  }

  if (r.mejores_ev?.length > 0) {
    md.push(`**Top AH:**`);
    md.push('');
    md.push(`| Market | Prob | Cuota | EV | Edge | Tipo |`);
    md.push(`|--------|------|-------|----|------|------|`);
    for (const p of r.mejores_ev) {
      md.push(`| \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${fmt_edge(p.edge)} | ${p.tipo_proteccion ?? ''} |`);
    }
    md.push('');
  }

  for (const mapeo of (r.mapeo_señales ?? [])) {
    const s = mapeo.señal_base;
    md.push(`#### \`${s.mercado}/${s.seleccion}\` | prob=${fmt_pct(s.prob_modelo)} | cuota=${fmt_cuota(s.bookmaker_odds)}`);
    md.push('');
    md.push(`| Mercado protegido | Prob | Cuota | EV | Edge | Estado |`);
    md.push(`|-------------------|------|-------|----|------|--------|`);
    for (const p of mapeo.mercados_protegidos) {
      md.push(`| \`${p.id}\` | ${fmt_pct(p.prob_modelo)} | ${fmt_cuota(p.cuota_real)} | ${fmt_ev(p.ev)} | ${fmt_edge(p.edge)} | ${p.estado} |`);
    }
    md.push('');
  }
}

md.push(`## Advertencias Metodológicas`);
md.push('');
md.push(`1. **Cuotas AH = mediana de bookmakers.** No elimina el vig.`);
md.push(`2. **Líneas cuarto (${qc.total_lineas_cuarto})** en JSON raw pero excluidas como señal oficial.`);
md.push(`3. **DC y DNB sin cuota real** — calculados desde modelo, EV = null hasta contar con endpoint.`);
md.push(`4. **TAU = 0** — EV indicativo, sin calibración histórica. No usar para apuestas significativas.`);
md.push(`5. **V2.1 intacta** — \`señales_valor\` y todos los campos de predicción no fueron modificados.`);
md.push('');
md.push(`---`);
md.push(`*Generado ${HOY} | V2.2-spreads-j2 | ${WRITE ? 'WRITE' : 'DRY-RUN'} | V2.1 sin modificar*`);

writeFileSync(MD_PATH, md.join('\n'), 'utf8');
console.log(`  ✓ ${MD_PATH}\n`);

// ── Escritura Firestore (solo si --write) ─────────────────────────────────────

let escrituras_ok = 0, escrituras_error = 0;

if (WRITE) {
  console.log('  ⚠️  MODO WRITE — actualizando Firestore...\n');

  for (const r of resultados) {
    if (r.error || !r._señales_protegidas_fs) continue;

    try {
      await db.collection('predicciones').doc(String(r.matchId)).update({
        señales_protegidas:  r._señales_protegidas_fs,
        v2_2_version:        'V2.2-spreads-j2',
        v2_2_generado_en:    new Date().toISOString(),
        // CAMPOS V2.1 NO TOCADOS:
        // señales_valor, lambda_local, lambda_visitante, prob_1x2,
        // prob_over_under, prob_btts, marcador_mas_probable,
        // odds_evaluadas, ajustes_modelo, version_modelo
      });
      escrituras_ok++;
      console.log(`    ✓ ${r.matchId} — ${r.nombre} (${r._señales_protegidas_fs.length} señales protegidas)`);
    } catch (err) {
      escrituras_error++;
      console.error(`    ✗ ${r.matchId} — ${r.nombre} — ERROR: ${err.message}`);
    }
  }

  console.log(`\n  Escrituras OK   : ${escrituras_ok}`);
  console.log(`  Escrituras ERROR: ${escrituras_error}`);
  console.log('');
}

// ── Reporte final en consola ──────────────────────────────────────────────────

console.log('═'.repeat(70));
console.log(`  REPORTE FINAL — Modo: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
console.log('─'.repeat(70));
console.log('');
console.log('  Archivos generados:');
console.log(`    reports/odds_j2_raw.json                 (caché API)`);
console.log(`    reports/odds_j2_h2h_totals_spreads_raw.json`);
console.log(`    reports/senales_protegidas_j2_dryrun.json`);
console.log(`    reports/senales_protegidas_j2_dryrun.md`);
console.log('');
console.log(`  Llamadas API         : ${usarCache ? 0 : 1}  (${usarCache ? 'desde caché' : `${creditos.last_call} créditos`})`);
console.log(`  Markets usados       : ${MARKETS}`);
console.log(`  Markets excluidos    : ${EXCLUIDOS.join(', ')}`);
console.log('');
console.log(`  Señales protegidas   : ${qc.mercados_protegidos_totales}`);
console.log(`  Apostables (con AH)  : ${qc.mercados_apostables}`);
console.log(`  EV positivo          : ${qc.ev_positivo}`);
console.log(`  EV negativo          : ${qc.ev_negativo}`);
console.log(`  Sin cuota (calc)     : ${qc.mercados_calculable_no_apostable}`);
console.log('');

if (top10EV.length > 0) {
  console.log('  TOP 10 EV:');
  top10EV.forEach((p, i) => {
    const evStr = p.ev > 0 ? `+${(p.ev*100).toFixed(2)}%` : `${(p.ev*100).toFixed(2)}%`;
    console.log(`    ${String(i+1).padStart(2)}. ${p.partido.padEnd(32)} ${p.id.padEnd(22)} EV=${evStr.padStart(8)}  cuota=${fmt_cuota(p.cuota_real)}`);
  });
  console.log('');
}

console.log(`  señales_valor modificadas: ❌ No`);
console.log(`  Escrituras Firestore     : ${WRITE ? escrituras_ok + ' (señales_protegidas únicamente)' : '❌ 0'}`);
if (escrituras_error > 0) {
  console.log(`  Escrituras con ERROR     : ⚠️  ${escrituras_error}`);
}
console.log('');
console.log(`  Para escribir en Firestore:`);
console.log(`    node scripts/guardarSeñalesProtegidaJ2.js --write`);
console.log(`  Para re-llamar The Odds API:`);
console.log(`    node scripts/guardarSeñalesProtegidaJ2.js --force`);
console.log('\n' + '═'.repeat(70) + '\n');

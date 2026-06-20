/**
 * syncResultadosJ1V21.js — Ingesta de resultados reales para los 12 partidos V2.1 de J1.
 *
 * Los 12 matchIds V2.1 tienen predicciones en Firestore pero carecen de resultado.
 *
 * Fuente primaria : FotMob  (score + xG + corners + tarjetas)
 * Fuente fallback : football-data.org (score únicamente)
 *
 * Modos:
 *   node scripts/syncResultadosJ1V21.js            → dry-run (DEFAULT, 0 escrituras)
 *   node scripts/syncResultadosJ1V21.js --execute  → escribe en Firestore
 *
 * GARANTÍAS:
 *   - Sin --execute: 0 escrituras Firestore.
 *   - Solo escribe en resultados/{matchId}. No toca predicciones/.
 *   - Solo escribe documentos con terminado: true.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';
import {
  obtenerPartidosFotmobPorFecha,
  obtenerDetallePartido,
} from '../src/data/pipeline/fotmob.js';

const db = getFirestore();

// ── Flags CLI ─────────────────────────────────────────────────────────────────

const EXECUTE = process.argv.includes('--execute');

// ── MatchIds V2.1 a completar ────────────────────────────────────────────────

const MATCH_IDS_V21 = [
  537369, 537363, 537370, 537364,
  537391, 537392, 537397, 537398,
  537403, 537409, 537410, 537404,
];

// ── Derivados ─────────────────────────────────────────────────────────────────

function calcularDerivados(gl, gv) {
  const total_goles = gl + gv;
  const resultado_1x2 = gl > gv ? 'local' : gl === gv ? 'empate' : 'visitante';
  const over_under_result = {
    '1.5': total_goles > 1.5 ? 'over' : 'under',
    '2.5': total_goles > 2.5 ? 'over' : 'under',
    '3.5': total_goles > 3.5 ? 'over' : 'under',
    '4.5': total_goles > 4.5 ? 'over' : 'under',
  };
  return {
    resultado_1x2,
    total_goles,
    over_under_result,  // backward compat con auditarPrediccionesJ1.js
    over_05: total_goles > 0,
    over_15: total_goles > 1,
    over_25: total_goles > 2,
    over_35: total_goles > 3,
    btts_result: gl > 0 && gv > 0,
  };
}

// ── Fuzzy-match de nombres ────────────────────────────────────────────────────

function normalizar(nombre) {
  return (nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function simNombres(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const shared = wa.filter(w => wb.has(w)).length;
  return shared > 0 ? 0.5 + 0.1 * shared : 0;
}

// ── Buscar partido en FotMob schedule ────────────────────────────────────────

async function buscarMatchFotmob(utcDate, nombreLocalFD, nombreVisitanteFD) {
  if (!utcDate) return null;
  const fechaFotmob = utcDate.slice(0, 10).replace(/-/g, '');
  let datos;
  try {
    datos = await obtenerPartidosFotmobPorFecha(fechaFotmob);
  } catch {
    return null;
  }

  let mejor = null;
  let mejorScore = -1;
  let mejorSwap = false;

  for (const liga of (datos.leagues ?? [])) {
    for (const match of (liga.matches ?? [])) {
      const hName = match.home?.name ?? '';
      const aName = match.away?.name ?? '';

      const sNormal = simNombres(hName, nombreLocalFD) + simNombres(aName, nombreVisitanteFD);
      const sSwap   = simNombres(hName, nombreVisitanteFD) + simNombres(aName, nombreLocalFD);

      if (sNormal >= sSwap && sNormal > mejorScore) {
        mejorScore = sNormal;
        mejorSwap  = false;
        mejor = {
          fotmobMatchId: Number(match.id),
          scoreStr:      match.status?.scoreStr ?? null,
          finished:      match.status?.finished === true,
          fotmobHomeId:  Number(match.home?.id),
          fotmobAwayId:  Number(match.away?.id),
        };
      } else if (sSwap > sNormal && sSwap > mejorScore) {
        mejorScore = sSwap;
        mejorSwap  = true;
        // swapped: el equipo FD-local corresponde al FotMob-away
        mejor = {
          fotmobMatchId: Number(match.id),
          scoreStr:      match.status?.scoreStr ?? null,
          finished:      match.status?.finished === true,
          fotmobHomeId:  Number(match.away?.id),  // FD-local está del lado away en FotMob
          fotmobAwayId:  Number(match.home?.id),
        };
      }
    }
  }

  if (!mejor || mejorScore < 0.5) return null;
  return { ...mejor, swapped: mejorSwap, scoreMatch: mejorScore };
}

// ── Parsear scoreStr "H - A" ──────────────────────────────────────────────────

function parsearScore(scoreStr, swapped) {
  if (!scoreStr) return null;
  const partes = scoreStr.split(' - ');
  if (partes.length !== 2) return null;
  const hG = parseInt(partes[0], 10);
  const aG = parseInt(partes[1], 10);
  if (isNaN(hG) || isNaN(aG)) return null;
  return swapped
    ? { golesLocal: aG, golesVisitante: hG }
    : { golesLocal: hG, golesVisitante: aG };
}

// ── Extraer stat numérico de FotMob detail ────────────────────────────────────

/**
 * Retorna { local, visitante } o null.
 * La estructura de FotMob es: statsArr[i].stats[j] donde statsArr[i] son categorías
 * (top_stats, shots, discipline…) y statsArr[i].stats[j] son stats individuales.
 * fotmobLocalId: FotMob team ID del equipo "local" desde perspectiva FD.
 */
function extraerStat(detalle, key, fotmobLocalId) {
  const statsArr = detalle?.content?.stats?.Periods?.All?.stats;
  if (!statsArr) return null;

  // Buscar en todas las categorías el primer item con este key que tenga valores no-null
  let subItem = null;
  for (const categoria of statsArr) {
    const found = categoria.stats?.find(s =>
      s.key === key &&
      Array.isArray(s.stats) &&
      s.stats[0] != null &&
      s.stats[1] != null
    );
    if (found) { subItem = found; break; }
  }
  if (!subItem) return null;

  const vH = Number(subItem.stats[0]);
  const vA = Number(subItem.stats[1]);
  if (!isFinite(vH) || !isFinite(vA)) return null;

  // ¿El home del detalle FotMob coincide con el local FD?
  const detHomeId = Number(detalle?.general?.homeTeam?.id ?? 0);
  const esLocalHome = detHomeId === fotmobLocalId;

  return esLocalHome
    ? { local: vH, visitante: vA }
    : { local: vA, visitante: vH };
}

// ── Fallback score desde football-data ───────────────────────────────────────

function scoresDesdeFD(partido) {
  const ft = partido?.score?.fullTime;
  if (!ft) return null;
  const gl = ft.home ?? null;
  const gv = ft.away ?? null;
  if (gl == null || gv == null) return null;
  if (!Number.isInteger(gl) || !Number.isInteger(gv)) return null;
  return { golesLocal: gl, golesVisitante: gv };
}

// ── Delay de cortesía entre calls FotMob ─────────────────────────────────────

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log(`  syncResultadosJ1V21${EXECUTE ? '  [MODO ESCRITURA]' : '  [DRY-RUN — 0 escrituras]'}`);
console.log('═'.repeat(72));

// [1/4] Fixture J1 desde football-data
console.log('\n[1/4] Obteniendo fixture desde football-data.org…');
const todosFixtures = await obtenerPartidosMundial();
const fixtureMap = Object.fromEntries(todosFixtures.map(p => [String(p.id), p]));

const j1Fixtures = MATCH_IDS_V21.map(id => {
  const p = fixtureMap[String(id)];
  return p ?? {
    id,
    status: 'UNKNOWN',
    homeTeam: { name: '?' },
    awayTeam: { name: '?' },
    utcDate: null,
    score: null,
  };
});

const finalizados = j1Fixtures.filter(p => p.status === 'FINISHED');
const noFinalizados = j1Fixtures.filter(p => p.status !== 'FINISHED');

console.log(`  MatchIds V2.1 : ${MATCH_IDS_V21.length}`);
console.log(`  FINISHED      : ${finalizados.length}`);
console.log(`  No FINISHED   : ${noFinalizados.length}`);
if (noFinalizados.length > 0) {
  for (const p of noFinalizados) {
    const nombre = `${p.homeTeam?.name} vs ${p.awayTeam?.name}`;
    console.log(`    ⏳ ${p.id}  ${nombre}  (${p.status})`);
  }
}

// [2/4] Verificar existentes en Firestore
console.log('\n[2/4] Verificando resultados ya existentes en Firestore…');
const yaExistentes = [];
const candidatos = [];

for (const p of finalizados) {
  const snap = await db.collection('resultados').doc(String(p.id)).get();
  if (snap.exists && snap.data()?.terminado === true) {
    yaExistentes.push(p);
    console.log(`  ✓ ya existe: ${p.id}  ${p.homeTeam?.name} vs ${p.awayTeam?.name}`);
  } else {
    candidatos.push(p);
  }
}

console.log(`  Ya en Firestore : ${yaExistentes.length}`);
console.log(`  Candidatos      : ${candidatos.length}`);

// [3/4] Fetch FotMob para cada candidato
console.log('\n[3/4] Consultando FotMob…\n');

const resultados = [];
let cntSinXg = 0;
let cntSinStats = 0;
let cntErrorFuente = 0;

for (const partido of candidatos) {
  const matchId = partido.id;
  const nombreLocal = partido.homeTeam?.name ?? '?';
  const nombreVisit = partido.awayTeam?.name ?? '?';
  const fechaStr    = partido.utcDate?.slice(0, 10) ?? '????-??-??';

  console.log(`  ── ${matchId}  ${nombreLocal} vs ${nombreVisit}  [${fechaStr}]`);

  // === Buscar en FotMob schedule ===
  const fotmob = await buscarMatchFotmob(partido.utcDate, nombreLocal, nombreVisit);

  let golesLocal, golesVisitante, fuenteScore;

  if (!fotmob) {
    console.log(`    ⚠ No encontrado en FotMob schedule. Intentando football-data score…`);
    const fd = scoresDesdeFD(partido);
    if (!fd) {
      console.log(`    ✗ Sin score en football-data. Omitiendo.`);
      cntErrorFuente++;
      resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'error_sin_score' });
      continue;
    }
    golesLocal     = fd.golesLocal;
    golesVisitante = fd.golesVisitante;
    fuenteScore    = 'football_data';
  } else {
    console.log(`    FotMob match: ${fotmob.fotmobMatchId}  score="${fotmob.scoreStr}"  finished=${fotmob.finished}  similarity=${fotmob.scoreMatch.toFixed(2)}`);

    if (!fotmob.finished) {
      console.log(`    ⚠ FotMob: no finalizado. Omitiendo.`);
      resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'no_finalizado_fotmob' });
      continue;
    }

    const score = parsearScore(fotmob.scoreStr, fotmob.swapped);
    if (!score) {
      console.log(`    ⚠ scoreStr inválido "${fotmob.scoreStr}". Fallback football-data…`);
      const fd = scoresDesdeFD(partido);
      if (!fd) {
        console.log(`    ✗ Sin score. Omitiendo.`);
        cntErrorFuente++;
        resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'error_sin_score' });
        continue;
      }
      golesLocal     = fd.golesLocal;
      golesVisitante = fd.golesVisitante;
      fuenteScore    = 'football_data_fallback';
    } else {
      golesLocal     = score.golesLocal;
      golesVisitante = score.golesVisitante;
      fuenteScore    = 'fotmob';
    }
  }

  console.log(`    score: ${golesLocal}-${golesVisitante}  (fuente: ${fuenteScore})`);

  // === Detalle FotMob: xG + corners + tarjetas ===
  let xg_local_real = null, xg_visitante_real = null;
  let corners_local = null, corners_visitante = null;
  let amarillas_local = null, amarillas_visitante = null;
  let rojas_local = null, rojas_visitante = null;
  let fotmobMatchId = null;

  if (fotmob) {
    fotmobMatchId = fotmob.fotmobMatchId;
    await delay(400);
    try {
      const detalle = await obtenerDetallePartido(fotmob.fotmobMatchId);
      const localId = fotmob.fotmobHomeId;  // FotMob ID del equipo "local" (FD perspective)

      const xgData = extraerStat(detalle, 'expected_goals', localId);
      if (xgData) {
        xg_local_real     = parseFloat(xgData.local.toFixed(2));
        xg_visitante_real = parseFloat(xgData.visitante.toFixed(2));
      } else {
        cntSinXg++;
      }

      const cornersData = extraerStat(detalle, 'corners', localId);
      if (cornersData) {
        corners_local     = Math.round(cornersData.local);
        corners_visitante = Math.round(cornersData.visitante);
      } else {
        cntSinStats++;
      }

      const amarillasData = extraerStat(detalle, 'yellow_cards', localId);
      if (amarillasData) {
        amarillas_local     = Math.round(amarillasData.local);
        amarillas_visitante = Math.round(amarillasData.visitante);
      }

      const rojasData = extraerStat(detalle, 'red_cards', localId);
      if (rojasData) {
        rojas_local     = Math.round(rojasData.local);
        rojas_visitante = Math.round(rojasData.visitante);
      }

      console.log(`    xG: ${xg_local_real ?? 'null'}/${xg_visitante_real ?? 'null'}`);
      console.log(`    corners: ${corners_local ?? '?'}/${corners_visitante ?? '?'}  amarillas: ${amarillas_local ?? '?'}/${amarillas_visitante ?? '?'}  rojas: ${rojas_local ?? '?'}/${rojas_visitante ?? '?'}`);
    } catch (err) {
      console.log(`    ⚠ Error detalle FotMob: ${err.message}`);
      cntSinXg++;
    }
  } else {
    cntSinXg++;
  }

  const derivados = calcularDerivados(golesLocal, golesVisitante);

  const documento = {
    matchId:               String(matchId),
    goles_local:           golesLocal,
    goles_visitante:       golesVisitante,
    xg_local_real,
    xg_visitante_real,
    corners_local,
    corners_visitante,
    amarillas_local,
    amarillas_visitante,
    rojas_local,
    rojas_visitante,
    fuente:                fuenteScore,
    fuente_resultado_partido: 'football_data',
    fotmob_match_id:       fotmobMatchId,
    terminado:             true,
    ...derivados,
  };

  resultados.push({
    matchId,
    nombre: `${nombreLocal} vs ${nombreVisit}`,
    fechaPartido: fechaStr,
    estado: 'pendiente_escritura',
    documento,
  });
}

// ── Preview table ─────────────────────────────────────────────────────────────

const listos = resultados.filter(r => r.documento);

console.log('\n' + '═'.repeat(80));
console.log('  PREVIEW — documentos a escribir en resultados/{matchId}');
console.log('─'.repeat(80));
console.log(
  `  ${'matchId'.padEnd(8)} ${'Partido'.padEnd(36)} ${'Score'.padEnd(6)} ` +
  `${'1X2'.padEnd(10)} ${'xG'.padEnd(11)} ${'Corn'.padEnd(7)} Tarj`
);
console.log('─'.repeat(80));

for (const r of resultados) {
  if (!r.documento) {
    console.log(`  ${String(r.matchId).padEnd(8)} ${r.nombre.padEnd(36)} [${r.estado}]`);
    continue;
  }
  const d = r.documento;
  const score   = `${d.goles_local}-${d.goles_visitante}`;
  const xg      = d.xg_local_real != null ? `${d.xg_local_real}/${d.xg_visitante_real}` : 'null/null';
  const corners = d.corners_local != null  ? `${d.corners_local}/${d.corners_visitante}` : '?/?';
  const tarj    = d.amarillas_local != null
    ? `A:${d.amarillas_local}/${d.amarillas_visitante} R:${d.rojas_local}/${d.rojas_visitante}`
    : '?';

  console.log(
    `  ${String(d.matchId).padEnd(8)} ${r.nombre.padEnd(36)} ${score.padEnd(6)} ` +
    `${d.resultado_1x2.padEnd(10)} ${xg.padEnd(11)} ${corners.padEnd(7)} ${tarj}`
  );
}

console.log('─'.repeat(80));
console.log(`  Listos para escribir : ${listos.length}`);
console.log(`  Con errores/omitidos : ${resultados.length - listos.length}`);
console.log(`  Sin xG               : ${cntSinXg}`);
console.log(`  Sin corners/stats    : ${cntSinStats}`);

if (!EXECUTE) {
  console.log('\n  [DRY-RUN] 0 escrituras en Firestore.');
  console.log('  Para ejecutar: node scripts/syncResultadosJ1V21.js --execute\n');
}

// ── Escritura Firestore ───────────────────────────────────────────────────────

let escritos = 0;
let erroresEscritura = 0;

if (EXECUTE) {
  console.log('\n[ESCRITURA] Guardando en Firestore…\n');

  for (const r of listos) {
    const docData = {
      ...r.documento,
      capturado_en: FieldValue.serverTimestamp(),
    };

    try {
      await db.collection('resultados').doc(String(r.matchId)).set(docData);
      const d = r.documento;
      console.log(`  ✓ resultados/${r.matchId}  ${r.nombre}  ${d.goles_local}-${d.goles_visitante}  (${d.resultado_1x2})`);
      r.estado = 'escrito';
      escritos++;
    } catch (err) {
      console.log(`  ✗ resultados/${r.matchId}  ERROR: ${err.message}`);
      r.estado = 'error_escritura';
      erroresEscritura++;
    }
  }
}

// ── Resumen final ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('  RESUMEN');
console.log('─'.repeat(72));
console.log(`  total_matchIds_v21       : ${MATCH_IDS_V21.length}`);
console.log(`  finished_detectados      : ${finalizados.length}`);
console.log(`  no_finished_omitidos     : ${noFinalizados.length}`);
console.log(`  ya_existentes_firestore  : ${yaExistentes.length}`);
console.log(`  candidatos_procesados    : ${candidatos.length}`);
console.log(`  listos_para_escribir     : ${listos.length}`);
console.log(`  sin_xg                   : ${cntSinXg}`);
console.log(`  sin_corners_stats        : ${cntSinStats}`);
console.log(`  errores_fuente           : ${cntErrorFuente}`);
if (EXECUTE) {
  console.log(`  escritos_en_firestore    : ${escritos}`);
  console.log(`  errores_escritura        : ${erroresEscritura}`);
} else {
  console.log(`  escritos_en_firestore    : 0  (dry-run)`);
}
console.log('═'.repeat(72) + '\n');

// ── Guardar reporte JSON ──────────────────────────────────────────────────────

const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const reportFileName = `sync_resultados_j1_v21_${ts}.json`;
const reportPath     = resolve(reportsDir, reportFileName);

writeFileSync(reportPath, JSON.stringify({
  generado_en:              new Date().toISOString(),
  modo:                     EXECUTE ? 'execute' : 'dry-run',
  total_matchIds_v21:       MATCH_IDS_V21.length,
  finished_detectados:      finalizados.length,
  no_finished_omitidos:     noFinalizados.length,
  ya_existentes_firestore:  yaExistentes.length,
  candidatos_procesados:    candidatos.length,
  listos_para_escribir:     listos.length,
  escritos_en_firestore:    escritos,
  errores_escritura:        erroresEscritura,
  sin_xg:                   cntSinXg,
  sin_corners_stats:        cntSinStats,
  errores_fuente:           cntErrorFuente,
  detalle:                  resultados,
}, null, 2), 'utf-8');

console.log(`  Reporte guardado: reports/${reportFileName}\n`);

/**
 * guardarResultadosFinales.js — Ingesta de resultados reales desde FotMob.
 *
 * Mapeo de IDs:
 *   football-data matchId → usado en predicciones/{matchId} y resultados/{matchId}
 *   FotMob matchId        → obtenido del schedule FotMob por fecha + fuzzy-match de nombres
 *   Los dos sistemas de IDs son independientes; no hay tabla de mapeo fija.
 *
 * Fuente de score : match.status.scoreStr en el schedule FotMob ("H - A")
 * Fuente de xG    : obtenerDetallePartido(fotmobMatchId) → content.stats
 *
 * Modos:
 *   node scripts/guardarResultadosFinales.js              → dry-run (DEFAULT, NO escribe)
 *   node scripts/guardarResultadosFinales.js --write      → escribe en Firestore
 *   node scripts/guardarResultadosFinales.js --write --force → sobrescribe resultados existentes
 *
 * GARANTÍAS en dry-run:
 *   - Llama a FotMob para mostrar qué guardaría (el valor del dry-run es exactamente ese)
 *   - Zero escrituras en Firestore
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial }        from '../src/data/pipeline/footballData.js';
import { obtenerPartidosFotmobPorFecha,
         obtenerDetallePartido }         from '../src/data/pipeline/fotmob.js';
import { guardarResultado, leerResultado } from '../src/firebase/resultados.js';

const db = getFirestore();

// ── Flags CLI ────────────────────────────────────────────────────────────────

const args    = new Set(process.argv.slice(2));
const DRY_RUN = !args.has('--write');
const FORCE   = args.has('--force') && !DRY_RUN; // --force sin --write es ignorado

// ── Utilidades de nombre ──────────────────────────────────────────────────────
// Mismo algoritmo que predecirPartidoCompleto.js y _verificarScores.js

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
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb)  return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const shared = wa.filter(w => wb.has(w)).length;
  return shared > 0 ? 0.5 + 0.1 * shared : 0;
}

// ── Búsqueda de partido en FotMob por fecha + nombres ────────────────────────

/**
 * Obtiene el schedule FotMob para la fecha del partido y encuentra el match
 * que mejor coincide con los nombres de football-data.org.
 *
 * @returns {{
 *   fotmobMatchId: number,
 *   scoreStr: string,         — "H - A" en perspectiva FotMob home/away
 *   finished: boolean,
 *   fotmobHomeId: number,
 *   fotmobAwayId: number,
 *   swapped: boolean,         — true si FD homeTeam coincide con FotMob awayTeam
 *   scoreMatch: number,       — score de similitud del match
 * } | null}
 */
async function buscarMatchFotmob(utcDate, nombreLocalFD, nombreVisitanteFD) {
  const fechaFotmob = utcDate.slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  let datos;
  try {
    datos = await obtenerPartidosFotmobPorFecha(fechaFotmob);
  } catch (err) {
    return null; // FotMob inaccesible para esta fecha
  }

  let mejor      = null;
  let mejorScore = -1;
  let mejorSwap  = false;

  for (const liga of (datos.leagues ?? [])) {
    for (const match of (liga.matches ?? [])) {
      const hName = match.home?.name ?? '';
      const aName = match.away?.name ?? '';

      const scoreNormal = simNombres(hName, nombreLocalFD) + simNombres(aName, nombreVisitanteFD);
      const scoreSwap   = simNombres(hName, nombreVisitanteFD) + simNombres(aName, nombreLocalFD);

      if (scoreNormal >= scoreSwap && scoreNormal > mejorScore) {
        mejorScore = scoreNormal;
        mejorSwap  = false;
        mejor = {
          fotmobMatchId: Number(match.id),
          scoreStr:      match.status?.scoreStr ?? null,
          finished:      match.status?.finished === true,
          fotmobHomeId:  Number(match.home?.id),
          fotmobAwayId:  Number(match.away?.id),
        };
      } else if (scoreSwap > scoreNormal && scoreSwap > mejorScore) {
        mejorScore = scoreSwap;
        mejorSwap  = true;
        mejor = {
          fotmobMatchId: Number(match.id),
          scoreStr:      match.status?.scoreStr ?? null,
          finished:      match.status?.finished === true,
          fotmobHomeId:  Number(match.away?.id), // swapped: FD local = FotMob away
          fotmobAwayId:  Number(match.home?.id),
        };
      }
    }
  }

  if (!mejor || mejorScore < 0.5) return null;

  return { ...mejor, swapped: mejorSwap, scoreMatch: mejorScore };
}

// ── Parsing de score ──────────────────────────────────────────────────────────

/**
 * Convierte "2 - 0" (FotMob home/away) a {golesLocal, golesVisitante}
 * considerando si los equipos están swapped respecto a football-data.
 *
 * @param {string|null} scoreStr
 * @param {boolean} swapped
 * @returns {{ golesLocal: number, golesVisitante: number } | null}
 */
function parsearScore(scoreStr, swapped) {
  if (!scoreStr) return null;
  const partes = scoreStr.split(' - ');
  if (partes.length !== 2) return null;
  const hGoals = parseInt(partes[0], 10);
  const aGoals = parseInt(partes[1], 10);
  if (isNaN(hGoals) || isNaN(aGoals)) return null;
  return swapped
    ? { golesLocal: aGoals, golesVisitante: hGoals }
    : { golesLocal: hGoals, golesVisitante: aGoals };
}

// ── Extracción de xG del detalle ──────────────────────────────────────────────

/**
 * Extrae xG local y visitante desde el detalle de FotMob.
 * Usa general.homeTeam.id para determinar perspectiva local/visitante
 * en relación al football-data homeTeam (fotmobHomeId).
 *
 * @param {object} detalle         — respuesta de obtenerDetallePartido()
 * @param {number} fotmobLocalId   — FotMob ID del equipo local (FD home)
 * @returns {{ xg_local_real: number, xg_visitante_real: number } | null}
 */
function extraerXg(detalle, fotmobLocalId) {
  const statsArr = detalle?.content?.stats?.Periods?.All?.stats;
  if (!statsArr) return null;

  const xgBloque = statsArr.find(s => s.key === 'expected_goals');
  const dblBlock = xgBloque?.stats?.find(s => s.format === 'double');
  const rawH = dblBlock?.stats?.[0]; // siempre home en FotMob
  const rawA = dblBlock?.stats?.[1]; // siempre away en FotMob

  if (rawH == null || rawA == null) return null;

  const xgH = Number(rawH);
  const xgA = Number(rawA);

  if (!isFinite(xgH) || !isFinite(xgA)) return null;

  // ¿el FotMob home coincide con el FD local?
  const fotmobDetalleHomeId = Number(detalle?.general?.homeTeam?.id ?? 0);
  const esLocalHome = fotmobDetalleHomeId === fotmobLocalId;

  return esLocalHome
    ? { xg_local_real: xgH, xg_visitante_real: xgA }
    : { xg_local_real: xgA, xg_visitante_real: xgH };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log(`  guardarResultadosFinales${DRY_RUN ? '  [DRY-RUN — no escribe en Firestore]' : '  [MODO ESCRITURA]'}${FORCE ? '  +FORCE' : ''}`);
console.log('═'.repeat(70));

// [1/4] Fixture completo del Mundial

console.log('\n[1/4] Obteniendo fixture del Mundial desde football-data.org…');
const fixtures = await obtenerPartidosMundial();

// Filtro J2 — los únicos matchIds que tienen predicciones V2
const j2Fixtures = fixtures.filter(p => p.matchday === 2);

// Partidos J2 finalizados según football-data
const finalizados = j2Fixtures.filter(p => p.status === 'FINISHED');
const noFinalizados = j2Fixtures.filter(p => p.status !== 'FINISHED');

console.log(`  J2 total            : ${j2Fixtures.length}`);
console.log(`  J2 finalizados      : ${finalizados.length}`);
console.log(`  J2 no finalizados   : ${noFinalizados.length}`);

if (finalizados.length === 0) {
  const minFecha = j2Fixtures.map(p => p.utcDate?.slice(0,10)).sort()[0];
  console.log(`\n  Sin partidos J2 finalizados.`);
  console.log(`  J2 empieza el ${minFecha ?? 'fecha desconocida'} — vuelve a correr cuando finalice cada partido.`);
}

// [2/4] Verificar estado en Firestore (ya existentes)

console.log('\n[2/4] Verificando resultados ya existentes en Firestore…');
const estadoFirestore = {};
for (const p of finalizados) {
  const existing = await leerResultado(p.id);
  estadoFirestore[p.id] = existing;
}
const yaExistentes = finalizados.filter(p => estadoFirestore[p.id]?.terminado === true);
const pendientes   = finalizados.filter(p => estadoFirestore[p.id] == null ||
                                              estadoFirestore[p.id]?.terminado !== true);
const omitidosPorExistir = FORCE ? [] : yaExistentes;
const candidatos          = FORCE ? finalizados : pendientes;

console.log(`  Ya en Firestore (terminado:true) : ${yaExistentes.length}`);
if (!FORCE && yaExistentes.length > 0) {
  console.log(`  (omitidos salvo --force)         : ${yaExistentes.length}`);
}
console.log(`  Candidatos a procesar            : ${candidatos.length}`);

// [3/4] Fetch FotMob + extraer datos

console.log('\n[3/4] Consultando FotMob para partidos candidatos…\n');

const resultados = [];
let errores = 0;

const delay = ms => new Promise(r => setTimeout(r, ms));

for (const partido of candidatos) {
  const matchId     = partido.id;
  const nombreLocal = partido.homeTeam?.name ?? '?';
  const nombreVisit = partido.awayTeam?.name ?? '?';
  const fechaStr    = partido.utcDate?.slice(0, 10);

  // Guard: ignorar TEST_*
  if (String(matchId).startsWith('TEST_')) continue;

  process.stdout.write(`  [${fechaStr}] ${nombreLocal} vs ${nombreVisit}\n`);

  // Buscar en FotMob por fecha + nombres
  const fotmob = await buscarMatchFotmob(partido.utcDate, nombreLocal, nombreVisit);

  if (!fotmob) {
    console.log(`    ✗ No encontrado en FotMob schedule. Saltando.`);
    errores++;
    resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'error_fotmob_no_encontrado' });
    continue;
  }

  if (!fotmob.finished) {
    // Debería no ocurrir (ya filtramos por FINISHED en football-data), pero por seguridad
    console.log(`    ⚠ FotMob reporta partido no finalizado. Saltando.`);
    resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'no_finalizado_fotmob' });
    continue;
  }

  console.log(`    ✓ FotMob matchId: ${fotmob.fotmobMatchId}  score: "${fotmob.scoreStr}"  swap: ${fotmob.swapped}`);

  // Parsear score
  const score = parsearScore(fotmob.scoreStr, fotmob.swapped);
  if (!score) {
    console.log(`    ✗ scoreStr inválido: "${fotmob.scoreStr}". Saltando.`);
    errores++;
    resultados.push({ matchId, nombre: `${nombreLocal} vs ${nombreVisit}`, estado: 'error_score_invalido', scoreStr: fotmob.scoreStr });
    continue;
  }

  console.log(`    → goles_local: ${score.golesLocal}  goles_visitante: ${score.golesVisitante}`);

  // Detalle FotMob para xG
  await delay(400); // rate-limit cortés
  let xgData = null;
  try {
    const detalle = await obtenerDetallePartido(fotmob.fotmobMatchId);
    // Verificar que el partido esté marcado como finalizado en el detalle
    if (!detalle?.general?.finished) {
      console.log(`    ⚠ detalle FotMob: general.finished=false. xG no disponible.`);
    } else {
      xgData = extraerXg(detalle, fotmob.fotmobHomeId);
    }
  } catch (err) {
    console.log(`    ⚠ Error al obtener detalle FotMob: ${err.message}. xG no disponible.`);
  }

  if (xgData) {
    console.log(`    → xg_local_real: ${xgData.xg_local_real.toFixed(2)}  xg_visitante_real: ${xgData.xg_visitante_real.toFixed(2)}`);
  } else {
    console.log(`    → xG no disponible — se guardará null`);
  }

  const datosResultado = {
    goles_local:       score.golesLocal,
    goles_visitante:   score.golesVisitante,
    xg_local_real:     xgData?.xg_local_real     ?? null,
    xg_visitante_real: xgData?.xg_visitante_real ?? null,
    fuente:            'fotmob',
    terminado:         true,
    fotmob_match_id:   fotmob.fotmobMatchId, // trazabilidad: ID FotMob del partido
  };

  resultados.push({
    matchId,
    nombre:     `${nombreLocal} vs ${nombreVisit}`,
    fechaPartido: fechaStr,
    estado:     DRY_RUN ? 'pendiente_escritura' : 'escrito',
    datos:      datosResultado,
  });

  // [Escritura] — solo si --write
  if (!DRY_RUN) {
    try {
      await guardarResultado(matchId, datosResultado);
      console.log(`    ✓ Guardado en resultados/${matchId}`);
    } catch (err) {
      console.log(`    ✗ Error al guardar en Firestore: ${err.message}`);
      errores++;
      resultados[resultados.length - 1].estado = 'error_escritura';
    }
  }
}

// ── Resumen ───────────────────────────────────────────────────────────────────

const escritos = DRY_RUN ? 0 : resultados.filter(r => r.estado === 'escrito').length;

console.log('\n' + '═'.repeat(70));
console.log('  RESUMEN');
console.log('─'.repeat(70));
console.log(`  Total J2 en fixture             : ${j2Fixtures.length}`);
console.log(`  Finalizados detectados          : ${finalizados.length}`);
console.log(`  No finalizados (omitidos)       : ${noFinalizados.length}`);
console.log(`  Ya existentes en Firestore      : ${yaExistentes.length}`);
console.log(`  Candidatos procesados           : ${candidatos.length}`);
console.log(`  Errores (FotMob / score / fs)   : ${errores}`);
if (DRY_RUN) {
  console.log(`  Escritos en Firestore           : 0  (dry-run)`);
  if (candidatos.length > 0) {
    console.log('\n  → Para escribir, ejecuta con --write:');
    console.log('    node scripts/guardarResultadosFinales.js --write');
  }
} else {
  console.log(`  Escritos en Firestore           : ${escritos}`);
}

// [4/4] Guardar reporte JSON

console.log('\n[4/4] Guardando reporte JSON…');

const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const nombreArchivo = `resultados_finales_${ts}.json`;
const rutaArchivo   = resolve(reportsDir, nombreArchivo);

const reporte = {
  generado_en:            new Date().toISOString(),
  modo:                   DRY_RUN ? 'dry-run' : 'write',
  force:                  FORCE,
  mapeo_ids:              'football-data matchId → FotMob matchId via schedule FotMob (fuzzy-match de nombres)',
  total_j2_fixture:       j2Fixtures.length,
  finalizados_detectados: finalizados.length,
  no_finalizados:         noFinalizados.length,
  ya_existentes:          yaExistentes.length,
  candidatos_procesados:  candidatos.length,
  errores,
  escritos,
  detalle: resultados,
};

writeFileSync(rutaArchivo, JSON.stringify(reporte, null, 2), 'utf-8');
console.log(`  → reports/${nombreArchivo}`);
console.log(`\n  ${DRY_RUN ? '0 escrituras en Firestore (dry-run).' : `${escritos} resultado(s) guardado(s) en Firestore.`}\n`);

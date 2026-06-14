/**
 * Dry-run de cobertura del historial pre-Mundial para los 48 equipos.
 * Solo lectura — no toca Firestore ni modifica ningún documento.
 *
 * Salida:
 *  · Tabla por equipo: nombre | n | fuente | torneos del historial
 *  · Resumen: cuántos equipos con n=5, n=2-4, n=1, n=0
 *
 * Tiempo estimado primera ejecución: 8-15 min (FotMob rate-limit + 400ms delay entre
 * llamadas pre-WC + 500ms entre equipos). Ejecuciones posteriores: ~2 min (todo cacheado).
 */

import { obtenerPartidosMundial }       from '../src/data/pipeline/footballData.js';
import { obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';
import { calcularAtaqueDefensa }         from '../src/data/pipeline/equipoStats.js';

const DELAY_ENTRE_EQUIPOS = 500; // ms

// ── Fuzzy matching (idéntico a resolverIdsFotmob) ────────────────────────────

function normalizar(nombre) {
  return (nombre ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
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

// Solo se necesitan overrides cuando el nombre en FD y FotMob no comparten
// palabras de 3+ caracteres. Confirmados desde el schedule WC de FotMob:
//   "United States" (FD) → FotMob usa "USA"     → sin palabras comunes → override
//   "Turkey"        (FD) → FotMob usa "Turkiye"  → sin palabras comunes → override
// Los demás 46 equipos matchean correctamente solo con las ligas "World Cup".
const FOTMOB_OVERRIDES = {
  'United States': 6713,  // FotMob: "USA"
  'Turkey':        6595,  // FotMob: "Turkiye"
};

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Fase 0: Fixture del Mundial ───────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('  Cobertura historial pre-Mundial — 48 equipos (dry-run)');
console.log('═'.repeat(72) + '\n');

console.log('Fase 0: Descargando fixture de football-data.org…');
const fixtures = await obtenerPartidosMundial();

const j1 = fixtures.filter(p => p.matchday === 1);
const j2 = fixtures.filter(p => p.matchday === 2);

if (j1.length === 0) {
  console.error('ERROR: no se encontraron partidos de J1 en el fixture. Verifica FOOTBALL_DATA_TOKEN.');
  process.exit(1);
}

// Mapa fdTeamId → info del equipo
const equiposPorFdId = new Map();
for (const m of j1) {
  const grupo = m.group ?? m.stage ?? '?';
  for (const side of ['homeTeam', 'awayTeam']) {
    const t = m[side];
    if (!equiposPorFdId.has(t.id)) {
      equiposPorFdId.set(t.id, { nombre: t.name, grupo, fdId: t.id, fotmobId: null, j2Fecha: null });
    }
  }
}

// J2 fecha por equipo
for (const m of j2) {
  const fecha = m.utcDate.slice(0, 10);
  for (const side of ['homeTeam', 'awayTeam']) {
    const eq = equiposPorFdId.get(m[side].id);
    if (eq && !eq.j2Fecha) eq.j2Fecha = fecha;
  }
}

console.log(`  ${equiposPorFdId.size} equipos en J1, ${j2.length} partidos en J2.\n`);

// ── Fase 1: Construcción del mapa FD → FotMob ID ─────────────────────────────

console.log('Fase 1: Descubriendo FotMob IDs desde schedules de J1…');

// Aplicar overrides conocidos
for (const eq of equiposPorFdId.values()) {
  if (FOTMOB_OVERRIDES[eq.nombre]) {
    eq.fotmobId = FOTMOB_OVERRIDES[eq.nombre];
    eq.idFuente = 'override';
  }
}

// Fechas únicas de J1
const j1Dates = [...new Set(j1.map(m => m.utcDate.slice(0, 10).replace(/-/g, '')))].sort();
console.log(`  Fechas J1 a escanear: ${j1Dates.join(', ')}`);

// Recopilamos todos los partidos WC (filtrando por nombre de liga) antes de matchear,
// para evitar falsos positivos con equipos sub-20, clubes o ligas con nombres similares.
const wcMatchesFotmob = [];
for (const fechaStr of j1Dates) {
  let diaData;
  try { diaData = await obtenerPartidosFotmobPorFecha(fechaStr); }
  catch (e) { console.warn(`  ⚠ Schedule ${fechaStr}: ${e.message}`); continue; }

  for (const liga of (diaData.leagues ?? [])) {
    if (!(liga.name ?? '').toLowerCase().includes('world cup')) continue;
    for (const fMatch of (liga.matches ?? [])) {
      wcMatchesFotmob.push({
        fHomeName: fMatch.home?.name ?? '',
        fAwayName: fMatch.away?.name ?? '',
        fHomeId:   Number(fMatch.home?.id),
        fAwayId:   Number(fMatch.away?.id),
      });
    }
  }
}
console.log(`  Partidos WC encontrados en FotMob: ${wcMatchesFotmob.length}`);

// Matching contra partidos WC únicamente
for (const eq of equiposPorFdId.values()) {
  if (eq.fotmobId) continue;  // ya resuelto (override)
  let best = 0, bestId = null;
  for (const wm of wcMatchesFotmob) {
    const sHome = simNombres(wm.fHomeName, eq.nombre);
    const sAway = simNombres(wm.fAwayName, eq.nombre);
    if (sHome > best) { best = sHome; bestId = wm.fHomeId; }
    if (sAway > best) { best = sAway; bestId = wm.fAwayId; }
  }
  if (best >= 0.5) {
    eq.fotmobId = bestId;
    eq.idFuente = `fuzzy(${best.toFixed(2)})`;
  }
}

const sinId = [...equiposPorFdId.values()].filter(e => !e.fotmobId);
const conId = equiposPorFdId.size - sinId.length;
console.log(`  IDs resueltos: ${conId}/${equiposPorFdId.size}`);
if (sinId.length > 0) {
  console.log(`  ⚠ Sin FotMob ID: ${sinId.map(e => e.nombre).join(', ')}`);
  console.log('    → Estos equipos obtendrán n_partidos=0 (default_mu_liga).\n');
} else {
  console.log('  ✓ Todos los equipos tienen FotMob ID.\n');
}

// ── Fase 2: Test de cobertura ─────────────────────────────────────────────────

console.log('Fase 2: Calculando cobertura para cada equipo (secuencial, ~8-15 min)…\n');

// Ordenar por grupo y nombre para salida legible
const equiposOrdenados = [...equiposPorFdId.values()]
  .sort((a, b) => (a.grupo ?? '').localeCompare(b.grupo ?? '') || a.nombre.localeCompare(b.nombre));

const resultados = [];

for (let i = 0; i < equiposOrdenados.length; i++) {
  const eq = equiposOrdenados[i];
  process.stdout.write(`  [${String(i + 1).padStart(2)}/${equiposOrdenados.length}] ${eq.nombre.padEnd(28)} `);

  if (!eq.fotmobId || !eq.j2Fecha) {
    process.stdout.write('⚠ sin ID o sin fecha J2\n');
    resultados.push({ ...eq, n: 0, fuente: 'sin_datos', torneos: '—' });
    continue;
  }

  let stats;
  try {
    stats = await calcularAtaqueDefensa(eq.fotmobId, eq.j2Fecha);
  } catch (e) {
    process.stdout.write(`✗ ERROR: ${e.message}\n`);
    resultados.push({ ...eq, n: 0, fuente: 'error', torneos: '—' });
    if (i < equiposOrdenados.length - 1) await delay(DELAY_ENTRE_EQUIPOS);
    continue;
  }

  // Torneos únicos del historial (solo partidos pre-WC)
  const torneosSet = new Set(
    (stats.partidos_usados ?? [])
      .filter(p => p.fuente_partido === 'historial' && p.tournament)
      .map(p => p.tournament)
  );
  const torneos = torneosSet.size > 0 ? [...torneosSet].join(' / ') : 'ninguno';

  process.stdout.write(`n=${stats.n_partidos}  ${stats.fuente === 'default_mu_liga' ? '(sin xG)' : '✓'}\n`);
  resultados.push({ ...eq, n: stats.n_partidos, fuente: stats.fuente, torneos });

  if (i < equiposOrdenados.length - 1) await delay(DELAY_ENTRE_EQUIPOS);
}

// ── Tabla final ───────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(90));
console.log('TABLA DE COBERTURA — TODOS LOS EQUIPOS');
console.log('═'.repeat(90));
console.log(
  'Grupo'.padEnd(8) +
  'Equipo'.padEnd(28) +
  'n'.padStart(3) +
  '  ' +
  'Fuente'.padEnd(34) +
  'Torneos historial'
);
console.log('─'.repeat(90));

let grupoActual = null;
for (const r of resultados) {
  if (r.grupo !== grupoActual) {
    if (grupoActual !== null) console.log('');
    grupoActual = r.grupo;
  }
  const nStr = r.n === 0 ? ' 0' : String(r.n);
  const fStr = (r.fuente ?? '—').replace('fotmob_mundial_2026+historial', 'wc+hist').replace('fotmob_mundial_2026', 'wc').replace('default_mu_liga', 'default');
  console.log(
    (r.grupo ?? '?').padEnd(8) +
    r.nombre.padEnd(28) +
    nStr.padStart(3) +
    '  ' +
    fStr.padEnd(34) +
    r.torneos
  );
}

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('RESUMEN');
console.log('═'.repeat(72));

const n5    = resultados.filter(r => r.n === 5).length;
const n2a4  = resultados.filter(r => r.n >= 2 && r.n <= 4).length;
const n1    = resultados.filter(r => r.n === 1).length;
const n0    = resultados.filter(r => r.n === 0).length;
const total = resultados.length;

console.log(`  n=5 (historial completo)  : ${String(n5).padStart(3)} equipos  (${(n5/total*100).toFixed(0)}%)`);
console.log(`  n=2-4 (historial parcial) : ${String(n2a4).padStart(3)} equipos  (${(n2a4/total*100).toFixed(0)}%)`);
console.log(`  n=1 (solo partido WC)     : ${String(n1).padStart(3)} equipos  (${(n1/total*100).toFixed(0)}%)`);
console.log(`  n=0 (default_mu_liga)     : ${String(n0).padStart(3)} equipos  (${(n0/total*100).toFixed(0)}%)`);
console.log(`  Total procesados          : ${String(total).padStart(3)} equipos`);

if (n0 > 0) {
  console.log('\n  Equipos con n=0:');
  for (const r of resultados.filter(r => r.n === 0)) {
    console.log(`    · ${r.nombre} (${r.grupo ?? '?'}) — ${r.fuente}`);
  }
}

console.log('');

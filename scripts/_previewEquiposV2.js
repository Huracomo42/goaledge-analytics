// Versión corregida: solo lee ligas con "World Cup" en el nombre del schedule de FotMob
import { obtenerPartidosMundial }       from '../src/data/pipeline/footballData.js';
import { obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';

function normalizar(n) {
  return (n ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function sim(a, b) {
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const sh = wa.filter(w => wb.has(w)).length;
  return sh > 0 ? 0.5 + 0.1 * sh : 0;
}

const fixtures = await obtenerPartidosMundial();
const j1 = fixtures.filter(p => p.matchday === 1);
const j2 = fixtures.filter(p => p.matchday === 2);

const eqs = new Map();
for (const m of j1) {
  const g = m.group ?? m.stage ?? '?';
  for (const side of ['homeTeam', 'awayTeam']) {
    const t = m[side];
    if (!eqs.has(t.id))
      eqs.set(t.id, { nombre: t.name, grupo: g, fdId: t.id, fotmobId: null, fuente: null, j2Fecha: null, fmNombre: null });
  }
}
for (const m of j2) {
  for (const side of ['homeTeam', 'awayTeam']) {
    const eq = eqs.get(m[side].id);
    if (eq && !eq.j2Fecha) eq.j2Fecha = m.utcDate.slice(0, 10);
  }
}

const j1Dates = [...new Set(j1.map(m => m.utcDate.slice(0, 10).replace(/-/g, '')))].sort();
process.stdout.write(`Escaneando ${j1Dates.length} fechas J1 (solo liga "World Cup")...\n`);

// Acumular todos los partidos WC de FotMob antes de hacer el matching
const wcMatches = []; // { fhName, faName, fhId, faId }
for (const d of j1Dates) {
  let dia; try { dia = await obtenerPartidosFotmobPorFecha(d); } catch { continue; }
  for (const liga of (dia.leagues ?? [])) {
    if (!(liga.name ?? '').toLowerCase().includes('world cup')) continue;
    for (const fm of (liga.matches ?? [])) {
      wcMatches.push({
        fhName: fm.home?.name ?? '', faName: fm.away?.name ?? '',
        fhId:   Number(fm.home?.id), faId: Number(fm.away?.id),
      });
    }
  }
}

console.log(`  Partidos WC encontrados en FotMob schedule: ${wcMatches.length} (esperado 24 para J1)\n`);

// Matching exclusivamente contra partidos WC
for (const eq of eqs.values()) {
  let best = 0, bestId = null, bestName = null;
  for (const wm of wcMatches) {
    const sh = sim(wm.fhName, eq.nombre);
    const sa = sim(wm.faName, eq.nombre);
    if (sh > best) { best = sh; bestId = wm.fhId; bestName = wm.fhName; }
    if (sa > best) { best = sa; bestId = wm.faId; bestName = wm.faName; }
  }
  if (best >= 0.5) {
    eq.fotmobId = bestId; eq.fuente = `fuzzy(${best.toFixed(2)})`; eq.fmNombre = bestName;
  }
}

const sorted = [...eqs.values()].sort(
  (a, b) => (a.grupo ?? '').localeCompare(b.grupo ?? '') || a.nombre.localeCompare(b.nombre)
);

console.log('Grupo    Equipo FD               FotmobId   Score   Nombre FotMob          FechaJ2');
console.log('─'.repeat(90));
let g = null;
for (const eq of sorted) {
  if (eq.grupo !== g) { if (g !== null) console.log(''); g = eq.grupo; }
  const idStr = eq.fotmobId ? String(eq.fotmobId) : '   ???';
  const fn    = eq.fmNombre ?? 'SIN ID';
  const ok    = eq.fotmobId ? '✓' : '✗';
  console.log(
    ok + ' ' +
    (eq.grupo ?? '?').padEnd(8) +
    eq.nombre.padEnd(24) +
    idStr.padStart(8) + '   ' +
    (eq.fuente ?? 'SIN ID').padEnd(13) +
    fn.padEnd(24) +
    (eq.j2Fecha ?? '???')
  );
}

const sinId = [...eqs.values()].filter(e => !e.fotmobId);
console.log(`\nTotal: ${eqs.size} | Con ID: ${eqs.size - sinId.length} | Sin ID: ${sinId.length}`);
if (sinId.length) console.log('SIN ID:', sinId.map(e => `${e.nombre} (${e.grupo})`).join(', '));

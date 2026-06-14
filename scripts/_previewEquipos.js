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

const OVERRIDES = {
  'United States': 6713, 'Mexico': 6710, 'South Africa': 6316,
  'Japan': 6715, 'Korea Republic': 7804, 'Colombia': 8258,
  'Ecuador': 6707, 'Australia': 6716, 'Uruguay': 5796,
  'Portugal': 8361, 'Belgium': 8263, 'Serbia': 8205, 'Saudi Arabia': 7795,
};

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

for (const eq of eqs.values()) {
  if (OVERRIDES[eq.nombre]) { eq.fotmobId = OVERRIDES[eq.nombre]; eq.fuente = 'override'; }
}

const j1Dates = [...new Set(j1.map(m => m.utcDate.slice(0, 10).replace(/-/g, '')))].sort();
process.stdout.write(`Escaneando ${j1Dates.length} fechas J1 en FotMob: ${j1Dates.join(', ')}...\n`);
for (const d of j1Dates) {
  let dia; try { dia = await obtenerPartidosFotmobPorFecha(d); } catch { continue; }
  for (const liga of (dia.leagues ?? [])) {
    for (const fm of (liga.matches ?? [])) {
      const fh = fm.home?.name ?? '', fa = fm.away?.name ?? '';
      const fhId = Number(fm.home?.id), faId = Number(fm.away?.id);
      for (const eq of eqs.values()) {
        if (eq.fotmobId) continue;
        const sh = sim(fh, eq.nombre), sa = sim(fa, eq.nombre);
        const best = Math.max(sh, sa);
        if (best >= 0.5) {
          eq.fotmobId  = sh >= sa ? fhId : faId;
          eq.fuente    = `fuzzy(${best.toFixed(2)})`;
          eq.fmNombre  = sh >= sa ? fh : fa;
        }
      }
    }
  }
}

const sorted = [...eqs.values()].sort(
  (a, b) => (a.grupo ?? '').localeCompare(b.grupo ?? '') || a.nombre.localeCompare(b.nombre)
);

console.log('\nGrupo   Equipo FD               FotmobId   Fuente ID       Nombre FotMob        FechaJ2');
console.log('─'.repeat(94));
let g = null;
for (const eq of sorted) {
  if (eq.grupo !== g) { if (g !== null) console.log(''); g = eq.grupo; }
  const idStr = eq.fotmobId ? String(eq.fotmobId) : '   ???';
  const fn    = eq.fmNombre ?? (eq.fotmobId ? '(override)' : 'SIN ID');
  console.log(
    (eq.grupo ?? '?').padEnd(8) +
    eq.nombre.padEnd(24) +
    idStr.padStart(8) + '   ' +
    (eq.fuente ?? 'SIN ID').padEnd(16) +
    fn.padEnd(22) +
    (eq.j2Fecha ?? '???')
  );
}

const sinId = [...eqs.values()].filter(e => !e.fotmobId);
console.log(`\nTotal: ${eqs.size} equipos | Con ID: ${eqs.size - sinId.length} | Sin ID: ${sinId.length}`);
if (sinId.length) console.log('SIN FotMob ID:', sinId.map(e => `${e.nombre} (${e.grupo})`).join(', '));

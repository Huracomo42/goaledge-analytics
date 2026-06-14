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

const CASOS = [
  'Bosnia-Herzegovina',
  'Cape Verde Islands',
  'Congo DR',
  'Curaçao',
];

// Recopilar todos los nombres FotMob de partidos WC
const j1Dates = ['20260611','20260612','20260613','20260614','20260615','20260616','20260617','20260618'];
const candidatos = []; // { nombre, id }
for (const d of j1Dates) {
  let dia; try { dia = await obtenerPartidosFotmobPorFecha(d); } catch { continue; }
  for (const liga of (dia.leagues ?? [])) {
    if (!(liga.name ?? '').toLowerCase().includes('world cup')) continue;
    for (const m of (liga.matches ?? [])) {
      if (m.home?.name) candidatos.push({ nombre: m.home.name, id: Number(m.home.id) });
      if (m.away?.name) candidatos.push({ nombre: m.away.name, id: Number(m.away.id) });
    }
  }
}
// Deduplicar
const uniq = [...new Map(candidatos.map(c => [c.id, c])).values()];
console.log(`Candidatos únicos en el pool WC: ${uniq.length}\n`);

for (const fdNombre of CASOS) {
  // Calcular score contra todos los candidatos y ordenar
  const scores = uniq
    .map(c => ({ fmNombre: c.nombre, id: c.id, score: sim(fdNombre, c.nombre) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  console.log(`FD: "${fdNombre}"`);
  if (scores.length === 0) {
    console.log('  ✗ NINGÚN candidato con score > 0\n');
    continue;
  }
  const ganador = scores[0];
  const segundo = scores[1];
  console.log(`  1º ${ganador.score.toFixed(2)}  "${ganador.fmNombre}" (id=${ganador.id})`);
  if (segundo) {
    console.log(`  2º ${segundo.score.toFixed(2)}  "${segundo.fmNombre}" (id=${segundo.id})`);
  } else {
    console.log(`  2º — (único candidato con score > 0)`);
  }
  const margen = segundo ? ganador.score - segundo.score : ganador.score;
  const ok = ganador.score >= 0.5 && margen >= 0.1;
  console.log(`  → score=${ganador.score.toFixed(2)}  margen=${margen.toFixed(2)}  ${ok ? '✓ OK' : '⚠ REVISAR'}\n`);
}

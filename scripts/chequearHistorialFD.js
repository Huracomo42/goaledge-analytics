import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const BASE  = 'https://api.football-data.org/v4';
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const CORTE = '2026-06-11'; // primer partido del Mundial

async function getTeamMatches(teamId) {
  const res = await fetch(`${BASE}/teams/${teamId}/matches?limit=10`, {
    headers: { 'X-Auth-Token': TOKEN }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} — ${txt.slice(0, 120)}`);
  }
  return res.json();
}

function buscarEquipo(fixtures, query) {
  const q = query.toLowerCase();
  for (const p of fixtures) {
    for (const side of ['homeTeam', 'awayTeam']) {
      if (p[side]?.name?.toLowerCase().includes(q)) {
        return { id: p[side].id, name: p[side].name };
      }
    }
  }
  return null;
}

const fixtures = await obtenerPartidosMundial();

const argentina  = buscarEquipo(fixtures, 'argentina');
const mexico     = buscarEquipo(fixtures, 'mexico');
// Equipo menor: prueba en orden hasta encontrar uno en el fixture
const menor = buscarEquipo(fixtures, 'cura')        // Curaçao
           ?? buscarEquipo(fixtures, 'zealand')      // New Zealand
           ?? buscarEquipo(fixtures, 'panama')
           ?? buscarEquipo(fixtures, 'guinea');

const targets = [argentina, mexico, menor].filter(Boolean);

if (targets.length < 3) {
  const disponibles = [...new Map(
    fixtures.flatMap(p => [[p.homeTeam?.id, p.homeTeam?.name], [p.awayTeam?.id, p.awayTeam?.name]])
  ).values()].filter(Boolean).sort();
  console.log('No se encontraron los 3 equipos. Equipos en fixture:');
  console.log(disponibles.join(', '));
  process.exit(1);
}

const SEP = '─'.repeat(62);

for (const equipo of targets) {
  console.log(`\n${SEP}`);
  console.log(`${equipo.name}  (ID football-data: ${equipo.id})`);
  console.log(`GET /v4/teams/${equipo.id}/matches?limit=10  (sin status, sin competitions)`);
  console.log(SEP);

  try {
    const data  = await getTeamMatches(equipo.id);
    const todos = data.matches ?? [];

    const anteriores = todos.filter(m => (m.utcDate ?? '').slice(0, 10) < CORTE);

    console.log(`  Total devueltos : ${todos.length}`);
    console.log(`  Anteriores al ${CORTE} (sin leakage): ${anteriores.length}`);

    if (anteriores.length > 0) {
      console.log('\n  Partidos utilizables:');
      for (const m of anteriores) {
        const fecha    = m.utcDate?.slice(0, 10) ?? '?';
        const comp     = m.competition?.name ?? '—';
        const loc      = m.homeTeam?.name ?? '?';
        const vis      = m.awayTeam?.name ?? '?';
        const gl       = m.score?.fullTime?.home;
        const gv       = m.score?.fullTime?.away;
        const marcador = (gl != null) ? `${gl}-${gv}` : '?-?';
        const estado   = m.status ?? '?';
        console.log(`    ${fecha}  ${loc} ${marcador} ${vis}  [${comp}]  (${estado})`);
      }
    } else {
      const comps = [...new Set(todos.map(m => m.competition?.name).filter(Boolean))];
      console.log(`\n  Sin partidos anteriores al Mundial.`);
      if (comps.length) console.log(`  Competiciones en la respuesta: ${comps.join(', ')}`);
    }

  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  // Pausa mínima para respetar rate-limit del tier gratuito
  await new Promise(r => setTimeout(r, 600));
}

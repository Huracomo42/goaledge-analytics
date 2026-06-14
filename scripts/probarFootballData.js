import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const partidos = await obtenerPartidosMundial();

console.log(`\nTotal de partidos del Mundial 2026: ${partidos.length}\n`);
console.log('--- Primeros 3 partidos ---');
for (const p of partidos.slice(0, 3)) {
  console.log(`[${p.status}] ${p.utcDate?.slice(0, 10)}  ${p.homeTeam?.name} vs ${p.awayTeam?.name}`);
}
console.log();

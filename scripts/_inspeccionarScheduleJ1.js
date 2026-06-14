// Inspecciona qué liga/league aparece en el schedule de FotMob para el día J1
// para identificar el nombre/ID de la liga del Mundial y usarlo como filtro.
import { obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';

const dia = await obtenerPartidosFotmobPorFecha('20260611');

console.log('\n── Ligas en el schedule de FotMob para 2026-06-11 ──\n');
for (const liga of (dia.leagues ?? [])) {
  const nMatches = liga.matches?.length ?? 0;
  // Mostrar todas las ligas con sus campos identificadores
  console.log(`id=${String(liga.id ?? '?').padEnd(8)} name="${(liga.name ?? '').padEnd(30)}" matches=${nMatches}`);
  // Si tiene "World" o "FIFA" en el nombre, mostrar los equipos
  if ((liga.name ?? '').toLowerCase().includes('world') || (liga.name ?? '').toLowerCase().includes('fifa')) {
    for (const m of (liga.matches ?? [])) {
      console.log(`  → matchId=${m.id}  ${m.home?.name} (${m.home?.id}) vs ${m.away?.name} (${m.away?.id})`);
    }
  }
}

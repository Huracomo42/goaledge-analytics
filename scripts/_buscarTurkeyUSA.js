// Busca los 27 partidos WC encontrados en J1 para identificar Turkey y USA
import { obtenerPartidosFotmobPorFecha } from '../src/data/pipeline/fotmob.js';

const j1Dates = ['20260611','20260612','20260613','20260614','20260615','20260616','20260617','20260618'];

console.log('\nTodos los partidos en ligas "World Cup" del schedule J1:\n');
for (const d of j1Dates) {
  let dia; try { dia = await obtenerPartidosFotmobPorFecha(d); } catch { continue; }
  for (const liga of (dia.leagues ?? [])) {
    if (!(liga.name ?? '').toLowerCase().includes('world cup')) continue;
    for (const m of (liga.matches ?? [])) {
      console.log(`${d}  liga="${liga.name}"  ${m.home?.name}(${m.home?.id}) vs ${m.away?.name}(${m.away?.id})`);
    }
  }
}

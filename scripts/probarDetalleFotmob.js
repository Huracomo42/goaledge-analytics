import { obtenerDetallePartido } from '../src/data/pipeline/fotmob.js';

// Mexico vs South Africa — matchId encontrado en probarFotmob.js
const MATCH_ID = 4667751;

console.log(`\nConsultando detalle FotMob — matchId ${MATCH_ID}...\n`);

const data = await obtenerDetallePartido(MATCH_ID);

// --- Verificar si la ruta de V1 existe ---
const content = data?.content;
if (!content) {
  console.log('data.content no existe. Keys de nivel superior:');
  console.log(Object.keys(data));
  process.exit(0);
}

const statsBlock = content?.stats?.Periods?.All?.stats;

if (!statsBlock) {
  console.log('Ruta V1 (content.stats.Periods.All.stats) NO encontrada.\n');
  console.log('Keys de content:');
  console.log(Object.keys(content));
  if (content.stats) {
    console.log('\nKeys de content.stats:');
    console.log(Object.keys(content.stats));
  }
  process.exit(0);
}

console.log('Ruta V1 (content.stats.Periods.All.stats) ENCONTRADA.\n');

// Buscar el bloque de expected_goals
const xgBloque = statsBlock.find(s => s.key === 'expected_goals');

if (!xgBloque) {
  console.log('Bloque "expected_goals" NO encontrado en stats.');
  console.log('\nKeys disponibles en stats:');
  console.log(statsBlock.map(s => s.key));
} else {
  console.log('Bloque "expected_goals" ENCONTRADO:');
  console.log(JSON.stringify(xgBloque, null, 2));
}

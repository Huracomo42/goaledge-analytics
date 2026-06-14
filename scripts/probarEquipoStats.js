import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';
import { calcularAtaqueDefensa } from '../src/data/pipeline/equipoStats.js';

// México — FotMob ID confirmado en probarFotmob.js (campo home.id del JSON)
const MEXICO_FOTMOB_ID = 6710;

// ── Encontrar la fecha de J2 de México desde los fixtures de football-data.org ──
const fixtures = await obtenerPartidosMundial();

const partidosMexico = fixtures
  .filter(p =>
    p.homeTeam?.name?.toLowerCase().includes('mexico') ||
    p.awayTeam?.name?.toLowerCase().includes('mexico')
  )
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

if (partidosMexico.length < 2) {
  console.log(`Solo ${partidosMexico.length} partido(s) de México en el fixture.`);
  console.log('Partidos encontrados:', partidosMexico.map(p => `${p.utcDate?.slice(0, 10)} vs ${p.homeTeam?.name === 'Mexico' ? p.awayTeam?.name : p.homeTeam?.name}`));
  process.exit(1);
}

const j1 = partidosMexico[0];
const j2 = partidosMexico[1];

const fechaJ1    = j1.utcDate?.slice(0, 10);
const fechaJ2    = j2.utcDate?.slice(0, 10);
const rivalJ1    = j1.homeTeam?.name === 'Mexico' ? j1.awayTeam?.name  : j1.homeTeam?.name;
const rivalJ2    = j2.homeTeam?.name === 'Mexico' ? j2.awayTeam?.name  : j2.homeTeam?.name;

console.log(`\nPartidos de México en el fixture:`);
console.log(`  J1: ${fechaJ1} vs ${rivalJ1}  [estado: ${j1.status}]`);
console.log(`  J2: ${fechaJ2} vs ${rivalJ2}  [estado: ${j2.status}]`);
console.log(`\nfechaCorte = ${fechaJ2}  (se usarán solo partidos ANTERIORES a esta fecha)`);
console.log(`\nCalculando ataque/defensa de México (FotMob ID ${MEXICO_FOTMOB_ID})...\n`);

const resultado = await calcularAtaqueDefensa(MEXICO_FOTMOB_ID, fechaJ2);

console.log('── Resultado ────────────────────────────────────');
console.log(`  ataque         : ${resultado.ataque.toFixed(4)}   (E001 — xG generado)`);
console.log(`  defensa        : ${resultado.defensa.toFixed(4)}   (E002 — xG concedido)`);
console.log(`  n_partidos     : ${resultado.n_partidos}`);
console.log(`  muestra_pequena: ${resultado.muestra_pequena}`);
console.log(`  fuente         : ${resultado.fuente}`);
console.log('─────────────────────────────────────────────────');

// Referencia para validar: del script probarDetalleFotmob.js sabemos que
// México generó xG=1.46 y concedió xG=0.07 contra Sudáfrica (matchId 4667751)
console.log('\nReferencia esperada (de probarDetalleFotmob.js):');
console.log('  ataque  → ~1.46 (xG de México vs Sudáfrica)');
console.log('  defensa → ~0.07 (xG de Sudáfrica vs México)');

import { calcularAtaqueDefensa } from '../src/data/pipeline/equipoStats.js';

// México: fotmobTeamId = 6710
// fechaCorte = fecha de J2 de México vs Corea del Sur (2026-06-19)
const TEAM_ID    = 6710;
const FECHA_J2   = '2026-06-19';

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Historial pre-Mundial — México (id=6710) | fechaCorte=' + FECHA_J2);
console.log('══════════════════════════════════════════════════════════════\n');

console.log('Calculando... (puede tardar ~3-5 seg por llamadas a FotMob)\n');

const resultado = await calcularAtaqueDefensa(TEAM_ID, FECHA_J2);

console.log(`Ataque  (E001): ${resultado.ataque.toFixed(4)}`);
console.log(`Defensa (E002): ${resultado.defensa.toFixed(4)}`);
console.log(`N partidos    : ${resultado.n_partidos}`);
console.log(`Muestra pequeña: ${resultado.muestra_pequena}`);
console.log(`Fuente        : ${resultado.fuente}`);

if (resultado.partidos_usados?.length) {
  console.log('\n── Partidos usados (más reciente → más antiguo) ──');
  for (const p of resultado.partidos_usados) {
    const peso = String(p.peso_pct).padStart(5);
    const atk  = p.xg_ataque.toFixed(3).padStart(7);
    const def  = p.xg_defensa.toFixed(3).padStart(7);
    const tag  = p.fuente_partido === 'mundial' ? '[WC]' : '[PRE]';
    console.log(`  ${tag} ${p.fecha}  matchId=${p.matchId}  xGatk=${atk}  xGdef=${def}  w=${peso}%`);
  }
}

console.log('');

import { obtenerPartidosMundial }        from '../src/data/pipeline/footballData.js';
import { predecirPartidoCompleto }        from '../src/core/prediction/predecirPartidoCompleto.js';

const fixtures = await obtenerPartidosMundial();

const j2 = fixtures
  .filter(p => p.matchday === 2 && (p.status === 'TIMED' || p.status === 'SCHEDULED'))
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

const pct  = n  => `${(n * 100).toFixed(1)}%`;
const pad2 = s  => String(s).padEnd(2);
const SEP  = '─'.repeat(63);

console.log(`\n${'═'.repeat(63)}`);
console.log(`  Predicciones Jornada 2 — FIFA World Cup 2026`);
console.log(`  ${j2.length} partidos  |  hoy: ${new Date().toISOString().slice(0, 10)}`);
console.log(`${'═'.repeat(63)}\n`);

let ok = 0, errores = 0;

for (const p of j2) {
  const local = p.homeTeam?.name ?? '?';
  const visit = p.awayTeam?.name ?? '?';
  const fecha = p.utcDate?.slice(0, 10);

  process.stdout.write(`[${fecha}]  ${local} vs ${visit} ... `);

  try {
    const r = await predecirPartidoCompleto(p.id);

    const advertL = r.muestra_local.muestra_pequena    ? ' ⚠' : '';
    const advertV = r.muestra_visitante.muestra_pequena ? ' ⚠' : '';

    process.stdout.write('✓\n');
    console.log(`${SEP}`);
    console.log(`  λ     : ${r.lambda_local.toFixed(4)} — ${r.lambda_visitante.toFixed(4)}`);
    console.log(`  1X2   : Local ${pct(r.prob_1x2.local)}  Empate ${pct(r.prob_1x2.empate)}  Visitante ${pct(r.prob_1x2.visitante)}`);
    console.log(`  O/U   : 2.5 → Over ${pct(r.prob_over_under['2.5'].over)}  Under ${pct(r.prob_over_under['2.5'].under)}`);
    console.log(`  BTTS  : Sí ${pct(r.prob_btts.si)}  No ${pct(r.prob_btts.no)}`);
    console.log(`  Marcador probable: ${r.marcador_mas_probable.local}-${r.marcador_mas_probable.visitante} (${pct(r.marcador_mas_probable.prob)})`);
    console.log(`  Muestra: Local n=${r.muestra_local.n_partidos}${advertL}  Visitante n=${r.muestra_visitante.n_partidos}${advertV}`);
    console.log(`${SEP}\n`);
    ok++;
  } catch (err) {
    process.stdout.write('✗\n');
    console.log(`  ERROR: ${err.message}\n`);
    errores++;
  }
}

console.log(`Completado: ${ok} predicciones  |  ${errores} errores\n`);

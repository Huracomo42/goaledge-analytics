import { obtenerPartidosMundial }   from '../src/data/pipeline/footballData.js';
import { predecirPartidoCompleto }   from '../src/core/prediction/predecirPartidoCompleto.js';
import { guardarPrediccion }         from '../src/firebase/predicciones.js';

// ── Pon MAX_PARTIDOS = 24 después de confirmar que el primer partido se guardó bien ──
const MAX_PARTIDOS = 24;

const fixtures = await obtenerPartidosMundial();

const j2 = fixtures
  .filter(p => p.matchday === 2 && (p.status === 'TIMED' || p.status === 'SCHEDULED'))
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate))
  .slice(0, MAX_PARTIDOS);

const pct = n => `${(n * 100).toFixed(1)}%`;
const SEP = '─'.repeat(63);

console.log(`\n${'═'.repeat(63)}`);
console.log(`  Predicciones J2 → Firestore  (${MAX_PARTIDOS} de 24 partidos)`);
console.log(`${'═'.repeat(63)}\n`);

let ok = 0, errores = 0;

for (const p of j2) {
  const local = p.homeTeam?.name ?? '?';
  const visit = p.awayTeam?.name ?? '?';
  const fecha = p.utcDate?.slice(0, 10);

  process.stdout.write(`[${fecha}]  ${local} vs ${visit}\n  → calculando... `);

  try {
    const prediccion = await predecirPartidoCompleto(p.id);

    process.stdout.write('guardando en Firestore... ');
    const guardado = await guardarPrediccion(p.id, prediccion);

    process.stdout.write('✓\n\n');

    // Resumen en consola
    console.log(`  matchId     : ${guardado.matchId}`);
    console.log(`  λ           : ${guardado.lambda_local?.toFixed(4)} — ${guardado.lambda_visitante?.toFixed(4)}`);
    console.log(`  1X2         : Local ${pct(guardado.prob_1x2?.local)}  Empate ${pct(guardado.prob_1x2?.empate)}  Visitante ${pct(guardado.prob_1x2?.visitante)}`);
    console.log(`  O/U 2.5     : Over ${pct(guardado.prob_over_under?.['2.5']?.over)}  Under ${pct(guardado.prob_over_under?.['2.5']?.under)}`);
    console.log(`  BTTS        : Sí ${pct(guardado.prob_btts?.si)}`);
    console.log(`  Marcador    : ${guardado.marcador_mas_probable?.local}-${guardado.marcador_mas_probable?.visitante} (${pct(guardado.marcador_mas_probable?.prob)})`);
    console.log(`  version     : ${guardado.version_modelo}`);
    console.log(`  fuentes_P   : ${guardado.fuentes_p_disponibles}`);
    console.log(`  generado_en : ${guardado.generado_en?.toDate?.()?.toISOString() ?? '(timestamp servidor)'}`);
    console.log(`  muestra     : Local n=${guardado.muestra_local?.n_partidos} (${guardado.muestra_local?.fuente})`);
    console.log(`              : Visitante n=${guardado.muestra_visitante?.n_partidos} (${guardado.muestra_visitante?.fuente})`);
    console.log(`\n${SEP}\n`);

    ok++;
  } catch (err) {
    process.stdout.write('✗\n');
    console.log(`  ERROR: ${err.message}\n`);
    errores++;
  }
}

console.log(`Completado: ${ok} guardados  |  ${errores} errores\n`);
process.exit(0); // firebase-admin mantiene el proceso vivo sin esto

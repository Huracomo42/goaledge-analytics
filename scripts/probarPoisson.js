// Ejemplo de verificación: Argentina vs Arabia Saudita
// Valores de la sección 3.3 de especificacion_modulo_poisson.md
import { predecirPartido } from '../src/core/prediction/poisson.js';

const r = predecirPartido({
  ataque_local:      1.9,
  defensa_local:     0.7,
  ataque_visitante:  0.9,
  defensa_visitante: 1.8
});

const pct = (n) => (n * 100).toFixed(1) + '%';

console.log('\n=== Argentina (local) vs Arabia Saudita ===\n');
console.log(`λ_local       ${r.lambda_local.toFixed(4)}   (esperado ≈ 2.79)`);
console.log(`λ_visitante   ${r.lambda_visitante.toFixed(4)}   (esperado ≈ 0.44)\n`);
console.log('--- 1X2 ---');
console.log(`Local gana:   ${pct(r.prob_1x2.local)}`);
console.log(`Empate:       ${pct(r.prob_1x2.empate)}`);
console.log(`Visitante:    ${pct(r.prob_1x2.visitante)}`);
console.log(`Suma:         ${pct(r.prob_1x2.local + r.prob_1x2.empate + r.prob_1x2.visitante)}\n`);
console.log('--- Over/Under ---');
for (const [linea, { over, under }] of Object.entries(r.prob_over_under)) {
  console.log(`O/U ${linea}:    Over ${pct(over)}  |  Under ${pct(under)}`);
}
console.log(`\nBTTS:         Sí ${pct(r.prob_btts.si)}  |  No ${pct(r.prob_btts.no)}`);
console.log(`Marcador +probable: ${r.marcador_mas_probable.local}-${r.marcador_mas_probable.visitante}  (${pct(r.marcador_mas_probable.prob)})`);
console.log(`\notros (7+ goles):  ${(r.otros * 100).toFixed(3)}%`);
console.log(`Modelo v${r.metadata.version_modelo}  |  clamps: ${r.metadata.clamps_activados.length === 0 ? 'ninguno' : r.metadata.clamps_activados.join(', ')}\n`);

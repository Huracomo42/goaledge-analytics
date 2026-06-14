// Parámetros fijos — sección 2.1 de especificacion_modulo_poisson.md
const VERSION_MODELO = '2.0';
export const MU_LIGA = 1.35;   // promedio goles/equipo en Mundiales recientes
const FACTOR_LOCAL   = 1.10;   // ventaja local conservadora (torneo corto/neutral)
const FACTOR_VISIT   = 0.95;   // desventaja visitante complementaria
const LAMBDA_MIN     = 0.15;   // clamp inferior — sección 3.4
const LAMBDA_MAX     = 4.5;    // clamp superior — sección 3.4
const MAX_GOLES      = 6;      // matriz 7×7, g y h de 0 a 6
const LINEAS_OU      = [1.5, 2.5, 3.5, 4.5];

// PMF de Poisson: P(G = g | λ) = e^(-λ) · λ^g / g!
function poissonPMF(lambda, g) {
  let factorial = 1;
  for (let i = 2; i <= g; i++) factorial *= i;
  return Math.exp(-lambda) * Math.pow(lambda, g) / factorial;
}

/**
 * Predice un partido a partir de las covariables E001/E002 de cada equipo.
 *
 * Entrada: { ataque_local, defensa_local, ataque_visitante, defensa_visitante }
 *   — ataque_i  = xg_promedio ponderado por recencia (E001)
 *   — defensa_i = xg_concedido_promedio ponderado por recencia (E002)
 *
 * Salida: sección 8 de especificacion_modulo_poisson.md
 */
export function predecirPartido({ ataque_local, defensa_local, ataque_visitante, defensa_visitante }) {
  const clamps_activados = [];

  // — Sección 3.1: cálculo de lambdas —
  let lambda_local = (ataque_local * defensa_visitante / MU_LIGA) * FACTOR_LOCAL;
  let lambda_visit = (ataque_visitante * defensa_local / MU_LIGA) * FACTOR_VISIT;

  // — Sección 3.4: clamp —
  if (lambda_local < LAMBDA_MIN) { lambda_local = LAMBDA_MIN; clamps_activados.push('lambda_local_min'); }
  if (lambda_local > LAMBDA_MAX) { lambda_local = LAMBDA_MAX; clamps_activados.push('lambda_local_max'); }
  if (lambda_visit < LAMBDA_MIN) { lambda_visit = LAMBDA_MIN; clamps_activados.push('lambda_visitante_min'); }
  if (lambda_visit > LAMBDA_MAX) { lambda_visit = LAMBDA_MAX; clamps_activados.push('lambda_visitante_max'); }

  // — Sección 4.2: matriz conjunta 7×7 —
  const matriz = [];
  let suma_matriz = 0;
  for (let g = 0; g <= MAX_GOLES; g++) {
    matriz[g] = [];
    for (let h = 0; h <= MAX_GOLES; h++) {
      const p = poissonPMF(lambda_local, g) * poissonPMF(lambda_visit, h);
      matriz[g][h] = p;
      suma_matriz += p;
    }
  }
  // "otros" = todos los marcadores con 7+ goles en algún equipo
  const otros = Math.max(0, 1 - suma_matriz);

  // — Sección 5.1: 1X2 —
  // "otros" se distribuye proporcionalmente (suma_matriz ≈ 1 para λ razonables)
  let p_local = 0, p_empate = 0, p_visit = 0;
  for (let g = 0; g <= MAX_GOLES; g++) {
    for (let h = 0; h <= MAX_GOLES; h++) {
      if      (g > h) p_local  += matriz[g][h];
      else if (g === h) p_empate += matriz[g][h];
      else              p_visit  += matriz[g][h];
    }
  }
  p_local  /= suma_matriz;
  p_empate /= suma_matriz;
  p_visit  /= suma_matriz;

  // — Sección 5.2: Over/Under —
  // "otros" (g+h ≥ 7) cae siempre en Over para las cuatro líneas
  const prob_over_under = {};
  for (const linea of LINEAS_OU) {
    let under = 0;
    for (let g = 0; g <= MAX_GOLES; g++) {
      for (let h = 0; h <= MAX_GOLES; h++) {
        if (g + h <= linea) under += matriz[g][h];
      }
    }
    prob_over_under[linea.toFixed(1)] = { over: 1 - under, under };
  }

  // — Sección 5.3: BTTS (inclusión-exclusión) —
  const p0L = poissonPMF(lambda_local, 0);
  const p0V = poissonPMF(lambda_visit, 0);
  const btts_si = 1 - p0L - p0V + p0L * p0V;

  // — Sección 5.4: marcador más probable —
  let marcador_mas_probable = { local: 0, visitante: 0, prob: 0 };
  for (let g = 0; g <= MAX_GOLES; g++) {
    for (let h = 0; h <= MAX_GOLES; h++) {
      if (matriz[g][h] > marcador_mas_probable.prob) {
        marcador_mas_probable = { local: g, visitante: h, prob: matriz[g][h] };
      }
    }
  }

  return {
    lambda_local,
    lambda_visitante: lambda_visit,
    matriz_marcadores: matriz,
    otros,
    prob_1x2:        { local: p_local, empate: p_empate, visitante: p_visit },
    prob_over_under,
    prob_btts:       { si: btts_si, no: 1 - btts_si },
    marcador_mas_probable,
    metadata: {
      mu_liga:          MU_LIGA,
      factor_local:     FACTOR_LOCAL,
      factor_visitante: FACTOR_VISIT,
      version_modelo:   VERSION_MODELO,
      clamps_activados
    }
  };
}

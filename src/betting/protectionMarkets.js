/**
 * protectionMarkets.js — V2.2 Protection Markets Engine (funciones puras).
 *
 * Calcula mercados protegidos a partir de lambdas Poisson y probabilidades 1X2/O-U
 * ya guardadas en Firestore. NO modifica el Prediction Engine V2.1.
 *
 * Principios:
 *   - Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 *   - La matriz de marcadores se reconstruye desde (lambda_local, lambda_visitante).
 *   - Si no hay cuota real, los campos EV/edge son null — nunca inventados.
 *   - EV de mercados con push usa fórmula correcta: prob_win*(cuota-1) - prob_loss.
 *
 * No llamar a ninguna función de este módulo que escriba en Firestore.
 * Estado: calculable_no_apostable → prob calculada, sin cuota real.
 *         apostable              → prob + cuota real + EV calculado.
 */

// ── Constantes (sincronizadas con poisson.js — solo lectura) ─────────────────
const MAX_GOLES = 6;

// ── Utilidades Poisson ────────────────────────────────────────────────────────

function poissonPMF(lambda, g) {
  let f = 1;
  for (let i = 2; i <= g; i++) f *= i;
  return Math.exp(-lambda) * Math.pow(lambda, g) / f;
}

// ── Reconstrucción de matriz ──────────────────────────────────────────────────

/**
 * Reconstruye la matriz de marcadores 7×7 normalizada desde los lambdas finales.
 *
 * La normalización (dividir por suma_original) replica exactamente el tratamiento
 * que hace poisson.js para calcular prob_1x2: `p_local /= suma_matriz`.
 * Con lambdas razonables (≤4.5), suma_original ≈ 0.9999.
 *
 * @returns {{ matriz: number[][], suma_original: number, valid: boolean }}
 */
export function buildScoreMatrix(lambda_local, lambda_visitante) {
  if (!lambda_local || !lambda_visitante || lambda_local <= 0 || lambda_visitante <= 0) {
    return { matriz: null, suma_original: 0, valid: false };
  }

  const m = [];
  let suma = 0;

  for (let g = 0; g <= MAX_GOLES; g++) {
    m[g] = [];
    for (let h = 0; h <= MAX_GOLES; h++) {
      const p = poissonPMF(lambda_local, g) * poissonPMF(lambda_visitante, h);
      m[g][h] = p;
      suma += p;
    }
  }

  if (suma <= 0) return { matriz: m, suma_original: suma, valid: false };

  for (let g = 0; g <= MAX_GOLES; g++)
    for (let h = 0; h <= MAX_GOLES; h++)
      m[g][h] /= suma;

  return { matriz: m, suma_original: +suma.toFixed(6), valid: true };
}

// ── Double Chance ─────────────────────────────────────────────────────────────

/**
 * Calcula los tres mercados de Doble Oportunidad desde prob_1x2 ya calculada.
 * No requiere matriz — derivable directamente de las probabilidades almacenadas.
 *
 * @param {{ local: number, empate: number, visitante: number }} prob_1x2
 * @returns {{ '1X': number, 'X2': number, '12': number }}
 */
export function calculateDoubleChance(prob_1x2) {
  return {
    '1X': +(prob_1x2.local    + prob_1x2.empate    ).toFixed(4),
    'X2': +(prob_1x2.empate   + prob_1x2.visitante ).toFixed(4),
    '12': +(prob_1x2.local    + prob_1x2.visitante ).toFixed(4),
  };
}

// ── Draw No Bet ───────────────────────────────────────────────────────────────

/**
 * Draw No Bet — el empate es "push" (apuesta devuelta).
 *
 * La probabilidad relevante para EV es prob_win = P(equipo gana),
 * no la probabilidad condicional excluido el empate.
 * fair_odds = 1 / prob_win (el empate no penaliza, solo el revés).
 *
 * EV con cuota real: prob_win * (cuota - 1) - prob_loss
 * (usar evConPush() de este módulo para calcular EV cuando haya cuota)
 *
 * @param {{ local: number, empate: number, visitante: number }} prob_1x2
 */
export function calculateDrawNoBet(prob_1x2) {
  return {
    local_dnb: {
      prob_win:   +prob_1x2.local.toFixed(4),
      prob_push:  +prob_1x2.empate.toFixed(4),
      prob_loss:  +prob_1x2.visitante.toFixed(4),
      fair_odds:  prob_1x2.local > 0 ? +(1 / prob_1x2.local).toFixed(3) : null,
    },
    visitante_dnb: {
      prob_win:   +prob_1x2.visitante.toFixed(4),
      prob_push:  +prob_1x2.empate.toFixed(4),
      prob_loss:  +prob_1x2.local.toFixed(4),
      fair_odds:  prob_1x2.visitante > 0 ? +(1 / prob_1x2.visitante).toFixed(3) : null,
    },
  };
}

// ── Asian Handicap ────────────────────────────────────────────────────────────

/**
 * Asian Handicap con soporte de push.
 *
 * Regla: diff = (score_side - score_rival) + line
 *   diff > 0  → win
 *   diff = 0  → push (devolución; ocurre solo en líneas enteras: ±1.0)
 *   diff < 0  → loss
 *
 * Líneas soportadas: ±0.5, ±1.0, ±1.5 para local y visitante.
 * EV con cuota real: usar evConPush() → prob_win*(cuota-1) - prob_loss.
 *
 * @param {number[][]} matriz  - Matriz 7×7 normalizada (de buildScoreMatrix)
 * @param {number} line        - Línea del hándicap (+0.5, +1.0, +1.5, -0.5, -1.0, -1.5)
 * @param {'local'|'visitante'} side
 */
export function calculateAsianHandicap(matriz, line, side) {
  let prob_win = 0, prob_push = 0, prob_loss = 0;

  for (let g = 0; g <= MAX_GOLES; g++) {
    for (let h = 0; h <= MAX_GOLES; h++) {
      const p    = matriz[g][h];
      const diff = (side === 'local' ? g - h : h - g) + line;

      if      (Math.abs(diff) < 1e-9) prob_push += p;
      else if (diff > 0)              prob_win  += p;
      else                            prob_loss += p;
    }
  }

  // Líneas enteras (0, ±1, ±2) tienen push; líneas .5 no.
  const tiene_push = Math.round(Math.abs(line) * 10) % 10 === 0;

  // Siempre un decimal (1.0, 0.5, 1.5) — evita que JS formatee 1.0 como "1"
  const absStr  = Math.abs(line).toFixed(1);
  const signo   = line >= 0 ? '+' : '-';

  return {
    mercado:    `AH_${side}_${signo}${absStr}`,
    side,
    line,
    prob_win:   +prob_win.toFixed(4),
    prob_push:  +prob_push.toFixed(4),
    prob_loss:  +prob_loss.toFixed(4),
    fair_odds:  prob_win > 0 ? +(1 / prob_win).toFixed(3) : null,
    tiene_push,
    calculable: true,
  };
}

// ── Totales protegidos ────────────────────────────────────────────────────────

/**
 * Over 1.5 y Under 3.5 — directamente disponibles en prob_over_under almacenada.
 * No requieren reconstrucción de matriz.
 *
 * @param {object} prob_over_under - Campo tal como está en Firestore
 */
export function calculateProtectedTotals(prob_over_under) {
  return {
    over_1_5:  prob_over_under?.['1.5']?.over  ?? null,
    under_3_5: prob_over_under?.['3.5']?.under ?? null,
    over_2_5:  prob_over_under?.['2.5']?.over  ?? null,
    under_2_5: prob_over_under?.['2.5']?.under ?? null,
  };
}

// ── Team Totals ───────────────────────────────────────────────────────────────

/**
 * Totales por equipo desde distribuciones marginales de Poisson.
 * Independientes del rival — se calculan directamente del lambda de cada equipo.
 *
 * P(equipo ≥ 1) = 1 - e^(-λ)
 * P(equipo ≥ 2) = 1 - e^(-λ) - λ·e^(-λ)
 */
export function calculateTeamTotals(lambda_local, lambda_visitante) {
  const p0L = Math.exp(-lambda_local);
  const p1L = lambda_local * p0L;
  const p0V = Math.exp(-lambda_visitante);
  const p1V = lambda_visitante * p0V;

  return {
    home_over_0_5:  +(1 - p0L).toFixed(4),
    home_over_1_5:  +(1 - p0L - p1L).toFixed(4),
    home_under_1_5: +(p0L + p1L).toFixed(4),
    away_over_0_5:  +(1 - p0V).toFixed(4),
    away_over_1_5:  +(1 - p0V - p1V).toFixed(4),
    away_under_1_5: +(p0V + p1V).toFixed(4),
  };
}

// ── Clasificación de riesgo ───────────────────────────────────────────────────

/**
 * Clasifica el nivel de protección de un mercado según su prob_modelo.
 * No usa EV (no hay cuota en dry-run).
 *
 * alta_proteccion    : prob ≥ 0.75 — muy improbable perder
 * proteccion_moderada: prob 0.55–0.75 — protege pero sigue siendo apuesta real
 * proteccion_limitada: prob < 0.55 — poca protección adicional vs señal base
 */
export function classifyProtectedMarketRisk(prob_modelo) {
  if (prob_modelo >= 0.75) return 'alta_proteccion';
  if (prob_modelo >= 0.55) return 'proteccion_moderada';
  return 'proteccion_limitada';
}

// ── EV helpers ────────────────────────────────────────────────────────────────

/** EV para mercados con push: prob_win*(cuota-1) - prob_loss */
export function evConPush(prob_win, prob_loss, cuota) {
  if (!cuota || cuota <= 1) return null;
  return +(prob_win * (cuota - 1) - prob_loss).toFixed(4);
}

/** EV estándar sin push: prob*cuota - 1 */
export function evSimple(prob, cuota) {
  if (!cuota || cuota <= 1) return null;
  return +(prob * cuota - 1).toFixed(4);
}

// ── Mapeo señal base → mercados protegidos sugeridos ─────────────────────────

/**
 * Mapeo conceptualmente correcto de señal V2.1 → mercados protegidos V2.2.
 *
 * Reglas:
 *   h2h/local favorito   → DNB_local, DC_1X, team_home_over_0_5
 *   h2h/local underdog   → AH_local_+1.5, AH_local_+1.0, AH_local_+0.5, DC_1X
 *   h2h/visitante fav.   → DNB_visitante, DC_X2, team_away_over_0_5
 *   h2h/visitante under. → AH_visitante_+1.5, AH_visitante_+1.0, AH_visitante_+0.5, DC_X2
 *   h2h/empate equilib.  → under_3.5, DC (lado mayor prob), DC (alternativa)
 *   h2h/empate desequil. → proteccion_no_recomendada (explicado en razon_mapeo)
 *   totals/over_3.5      → over_2.5, over_1.5
 *   totals/over_2.5      → over_1.5
 *   totals/under_2.5     → under_3.5
 *
 * No incluir:
 *   DC_12 como protección de favorito local (incluye victoria del rival)
 *   AH -0.5 como protección de underdog (equivale a exigir la victoria)
 *   DNB como protección de empate (excluye empates → contradice la hipótesis)
 *
 * @param {string} mercado    - 'h2h' | 'totals'
 * @param {string} seleccion  - 'local' | 'visitante' | 'empate' | 'over_2.5' | etc.
 * @param {object} contexto
 *   @param {object} [contexto.prob_1x2]       - { local, empate, visitante } del modelo
 *   @param {number} [contexto.prob_modelo]     - prob del modelo para esta selección
 *   @param {number} [contexto.bookmaker_odds]  - cuota del bookmaker para esta selección
 *
 * @returns {Array<{ id: string, razon_mapeo: string }>}
 */
export function mapBaseSignalToProtectedMarkets(mercado, seleccion, contexto = {}) {
  const { prob_1x2 = null, prob_modelo = null, bookmaker_odds = null } = contexto;

  // Underdog si cuota ≥ 2.50 (umbral estándar) o prob modelo ≤ 40%
  // Favorito si cuota < 2.50 o prob modelo > 55%
  const esUnderdog = bookmaker_odds != null
    ? bookmaker_odds >= 2.50
    : (prob_modelo != null ? prob_modelo <= 0.40 : true); // sin datos → tratar como underdog (más seguro)

  const cuotaStr  = bookmaker_odds != null ? `cuota ${bookmaker_odds}` : `prob ${prob_modelo != null ? (prob_modelo * 100).toFixed(0) + '%' : 'N/D'}`;
  const probStr   = prob_modelo != null ? `${(prob_modelo * 100).toFixed(0)}%` : 'N/D';

  if (mercado === 'h2h') {

    // ── Local ──────────────────────────────────────────────────────────────────
    if (seleccion === 'local') {
      if (esUnderdog) {
        return [
          { id: 'AH_local_+1.5', razon_mapeo: `Local underdog (${cuotaStr}): +1.5 cubre victoria, empate y derrota por 1 — máxima protección sin excluir ningún resultado favorable` },
          { id: 'AH_local_+1.0', razon_mapeo: `Local underdog: +1.0 protege con devolución si pierde por 1 exacto` },
          { id: 'AH_local_+0.5', razon_mapeo: `Local underdog: +0.5 cubre victoria y empate — sin push` },
          { id: 'DC_1X',         razon_mapeo: `Local underdog: DC 1X cubre victoria + empate directamente desde prob_1x2` },
        ];
      }
      // Favorito local
      return [
        { id: 'DNB_local',            razon_mapeo: `Favorito local (prob ${probStr}): DNB devuelve stake si empata, solo pierde si cae — versión protegida de "local gana"` },
        { id: 'DC_1X',                razon_mapeo: `Favorito local: DC 1X amplía la cobertura al empate — protege contra sorpresa táctica sin exponer al rival` },
        { id: 'team_home_over_0_5',   razon_mapeo: `Favorito local: al menos 1 gol del equipo refuerza la hipótesis ofensiva del modelo` },
      ];
    }

    // ── Visitante ──────────────────────────────────────────────────────────────
    if (seleccion === 'visitante') {
      if (esUnderdog) {
        return [
          { id: 'AH_visitante_+1.5', razon_mapeo: `Visitante underdog (${cuotaStr}): +1.5 cubre victoria, empate y derrota por 1 — máxima protección` },
          { id: 'AH_visitante_+1.0', razon_mapeo: `Visitante underdog: +1.0 protege con devolución si pierde por 1 exacto` },
          { id: 'AH_visitante_+0.5', razon_mapeo: `Visitante underdog: +0.5 cubre victoria y empate — sin push` },
          { id: 'DC_X2',             razon_mapeo: `Visitante underdog: DC X2 cubre victoria + empate directamente desde prob_1x2` },
        ];
      }
      // Favorito visitante
      return [
        { id: 'DNB_visitante',       razon_mapeo: `Favorito visitante (prob ${probStr}): DNB devuelve stake si empata — versión protegida de "visitante gana"` },
        { id: 'DC_X2',               razon_mapeo: `Favorito visitante: DC X2 amplía la cobertura al empate sin exponer al local` },
        { id: 'team_away_over_0_5',  razon_mapeo: `Favorito visitante: al menos 1 gol del equipo refuerza la hipótesis ofensiva` },
      ];
    }

    // ── Empate ─────────────────────────────────────────────────────────────────
    if (seleccion === 'empate') {
      const pL = prob_1x2?.local     ?? 0;
      const pV = prob_1x2?.visitante ?? 0;
      const pX = prob_1x2?.empate ?? prob_modelo ?? 0;
      const dif = Math.abs(pL - pV);

      // Partido equilibrado: diferencia L-V ≤ 10pp, o prob empate ≥ 28%
      const equilibrado = dif <= 0.10 || pX >= 0.28;

      if (!equilibrado) {
        return [{
          id: 'proteccion_no_recomendada',
          razon_mapeo: `Empate en partido desequilibrado (dif L-V=${(dif * 100).toFixed(0)}%, pX=${(pX * 100).toFixed(0)}%): cubrir el empate expone a la victoria del favorito. No existe protección natural sin contradecir la hipótesis del modelo.`,
        }];
      }

      // Equilibrado: proteger en la dirección de mayor prob entre local/visitante
      const ladoMayor = pL >= pV ? 'local' : 'visitante';
      const dc_principal  = ladoMayor === 'local' ? 'DC_1X' : 'DC_X2';
      const dc_secundaria = ladoMayor === 'local' ? 'DC_X2' : 'DC_1X';
      const ladoProbStr   = `${(Math.max(pL, pV) * 100).toFixed(0)}%`;

      return [
        { id: 'under_3.5',    razon_mapeo: `Empate equilibrado (pX=${(pX * 100).toFixed(0)}%): partido cerrado → Under 3.5 protege la hipótesis de bajo volumen de goles` },
        { id: dc_principal,   razon_mapeo: `Empate equilibrado: DC hacia el lado con mayor prob (${ladoMayor} ${ladoProbStr}) amplía margen sin excluir el empate` },
        { id: dc_secundaria,  razon_mapeo: `Empate equilibrado: DC alternativa cubre el otro resultado plausible` },
      ];
    }
  }

  // ── Totales ──────────────────────────────────────────────────────────────────
  if (mercado === 'totals') {
    if (seleccion === 'over_3.5') return [
      { id: 'over_2.5', razon_mapeo: 'Over 3.5 agresivo: Over 2.5 mantiene hipótesis de partido abierto con menor riesgo' },
      { id: 'over_1.5', razon_mapeo: 'Over 3.5 agresivo: Over 1.5 (≥2 goles) es la versión más conservadora de la hipótesis' },
    ];
    if (seleccion === 'over_2.5') return [
      { id: 'over_1.5', razon_mapeo: 'Over 2.5 con valor: Over 1.5 protege la hipótesis de partido con goles — mayor probabilidad, menor cuota' },
    ];
    if (seleccion === 'over_1.5') return [];
    if (seleccion === 'under_2.5') return [
      { id: 'under_3.5', razon_mapeo: 'Under 2.5 con valor: Under 3.5 amplía el margen a ≤3 goles — misma hipótesis de partido cerrado, mayor cobertura' },
    ];
    if (seleccion === 'under_3.5') return [];
    if (seleccion === 'under_1.5') return [];
  }

  return [];
}

// ── Derivación completa ───────────────────────────────────────────────────────

/**
 * Calcula todos los mercados protegidos para un partido dado.
 *
 * Requiere: lambda_local, lambda_visitante, prob_1x2, prob_over_under
 * Todos estos campos están disponibles en predicciones/{matchId} de J1.
 *
 * @returns objeto estructurado con todos los mercados calculados
 */
export function deriveAllProtectedMarkets(lambda_local, lambda_visitante, prob_1x2, prob_over_under) {
  const { matriz, suma_original, valid } = buildScoreMatrix(lambda_local, lambda_visitante);

  if (!valid) {
    return { error: 'Lambdas inválidas — matriz no construida', calculable: false };
  }

  const dc   = calculateDoubleChance(prob_1x2);
  const dnb  = calculateDrawNoBet(prob_1x2);
  const tot  = calculateProtectedTotals(prob_over_under);
  const team = calculateTeamTotals(lambda_local, lambda_visitante);

  const AH_CONFIGS = [
    { line:  0.5, side: 'local'      },
    { line:  1.0, side: 'local'      },
    { line:  1.5, side: 'local'      },
    { line: -0.5, side: 'local'      },
    { line:  0.5, side: 'visitante'  },
    { line:  1.0, side: 'visitante'  },
    { line:  1.5, side: 'visitante'  },
    { line: -0.5, side: 'visitante'  },
  ];

  const asian_handicap = {};
  for (const cfg of AH_CONFIGS) {
    const r = calculateAsianHandicap(matriz, cfg.line, cfg.side);
    asian_handicap[r.mercado] = r;
  }

  return {
    calculable:          true,
    matrix_info:         { suma_original, valid },
    double_chance:       dc,
    draw_no_bet:         dnb,
    asian_handicap,
    totales_protegidos:  tot,
    team_totals:         team,
  };
}

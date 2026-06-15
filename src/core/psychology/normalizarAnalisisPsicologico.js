/**
 * normalizarAnalisisPsicologico.js — Normalización del análisis psicodeportivo.
 *
 * Convierte un JSON de entrada (estilo V1 o directo) al esquema V2 definido en
 * v2/esquema_firestore_v2.md (sección 6: analisis_psicologico/{matchId}) y
 * v2/diccionario_variables_v2_bloque_P.md.
 *
 * PRINCIPIO RECTOR (del diccionario bloque P):
 *   Estas variables son proxies scrapeadas, no mediciones psicológicas directas.
 *   tipo_proxy refleja qué mecanismo causal probablemente representa cada variable.
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 */

// ── Diccionarios fijos del bloque P (fuente de verdad: diccionario_variables_v2_bloque_P.md) ───

const TIPO_PROXY = {
  necesita_ganar:       'contextual_proxy',
  venganza_narrativa:   'media_narrative_proxy',
  rival_maldito:        'media_narrative_proxy',
  presion_mediatica:    'media_narrative_proxy',
  lider_disponible:     'team_performance_proxy',
  conflicto_interno:    'team_performance_proxy',
  generacion_peak:      'team_performance_proxy',
  underdog:             'market_bias_proxy',
  clasifico_sufriendo:  'contextual_proxy',
  humillacion_previa:   'media_narrative_proxy',
  ausencias_ofensivas:  'team_performance_proxy',
  ausencias_defensivas: 'team_performance_proxy',
};

// confianza_minima_sugerida por variable (diccionario bloque P)
const CONFIANZA_DEFAULT = {
  necesita_ganar:       0.75,
  venganza_narrativa:   0.50,
  rival_maldito:        0.40,
  presion_mediatica:    0.45,
  lider_disponible:     0.60,
  conflicto_interno:    0.35,
  generacion_peak:      0.50,
  underdog:             0.50,
  clasifico_sufriendo:  0.70,
  humillacion_previa:   0.45,
  ausencias_ofensivas:  0.60,
  ausencias_defensivas: 0.60,
};

const VARIABLES = Object.keys(TIPO_PROXY);

// ── Extracción de valores por formato de entrada ──────────────────────────────

/**
 * Detecta el formato del input y extrae { local, visitante, confianza? } para una variable.
 *
 * Formato V1:   input.psicologico.local.variable  /  input.psicologico.visitante.variable
 * Formato directo: input.variable = { local, visitante, confianza? }
 * Formato variables: input.variables.variable = { local, visitante, confianza? }
 */
function extraerVariable(input, variable) {
  // Formato V1 (psicologico.local.variable / psicologico.visitante.variable)
  if (input.psicologico) {
    return {
      local:     input.psicologico?.local?.[variable]     ?? null,
      visitante: input.psicologico?.visitante?.[variable] ?? null,
      confianza: undefined, // V1 no traía confianza
    };
  }

  // Formato variables (ya parcialmente normalizado)
  const desdeVariables = input.variables?.[variable];
  if (desdeVariables !== undefined && desdeVariables !== null) {
    return {
      local:     desdeVariables.local     ?? null,
      visitante: desdeVariables.visitante ?? null,
      confianza: desdeVariables.confianza,
    };
  }

  // Formato directo (input.variable = { local, visitante, confianza? })
  const directo = input[variable];
  if (directo !== undefined && directo !== null && typeof directo === 'object' && !Array.isArray(directo)) {
    return {
      local:     directo.local     ?? null,
      visitante: directo.visitante ?? null,
      confianza: directo.confianza,
    };
  }

  // Variable ausente
  return { local: null, visitante: null, confianza: undefined, ausente: true };
}

function confianzaValida(c) {
  return typeof c === 'number' && isFinite(c) && c >= 0 && c <= 1;
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Normaliza un análisis psicodeportivo al esquema V2.
 *
 * @param {object} input — JSON de entrada (V1, directo, o parcialmente normalizado)
 * @returns {{
 *   ok: true,
 *   analisis: object,
 *   warnings: string[]
 * } | {
 *   ok: false,
 *   razon: string
 * }}
 */
export function normalizarAnalisisPsicologico(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, razon: 'input inválido: se esperaba un objeto' };
  }

  const matchId = input.matchId ?? input.match_id ?? null;
  if (!matchId) {
    return { ok: false, razon: 'matchId es requerido' };
  }

  const warnings = [];
  const variables = {};

  for (const variable of VARIABLES) {
    const extraido = extraerVariable(input, variable);
    const defaultConfianza = CONFIANZA_DEFAULT[variable];

    // Confianza: usar la del input si es válida, si no usar default + warning
    let confianza;
    if (extraido.confianza === undefined || extraido.confianza === null) {
      confianza = defaultConfianza;
    } else if (confianzaValida(extraido.confianza)) {
      confianza = extraido.confianza;
    } else {
      confianza = defaultConfianza;
      warnings.push(
        `${variable}: confianza inválida (${JSON.stringify(extraido.confianza)}) → usando default ${defaultConfianza}`
      );
    }

    // Variable ausente en el input → warning
    if (extraido.ausente) {
      warnings.push(`${variable}: variable ausente en el input → local=null, visitante=null`);
    }

    variables[variable] = {
      local:      extraido.local,
      visitante:  extraido.visitante,
      tipo_proxy: TIPO_PROXY[variable],
      confianza,
    };
  }

  // ── Metadatos del análisis ────────────────────────────────────────────────

  const generado_en = input.generado_en ?? input.analisis_generado ?? new Date().toISOString();

  const analisis = {
    matchId:        String(matchId),
    estado:         'completo',
    generado_en,
    modelo:         input.modelo         ?? null,
    webSearch:      input.webSearch       ?? input.web_search ?? null,
    version_modelo: input.version_modelo ?? null,
    variables,
    narrativa:             input.narrativa              ?? null,
    lesiones_destacadas:   input.lesiones_destacadas    ?? [],
    fuentes:               input.fuentes                ?? [],
    timestamps: {
      evento_partido:           input.timestamps?.evento_partido          ?? input.fecha_partido ?? null,
      analisis_generado:        input.timestamps?.analisis_generado       ?? generado_en,
      disponible_para_modelo:   input.timestamps?.disponible_para_modelo  ?? generado_en,
    },
  };

  return { ok: true, analisis, warnings };
}

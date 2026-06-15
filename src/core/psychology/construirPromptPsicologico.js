/**
 * construirPromptPsicologico.js — Constructor de prompt psicodeportivo V2.
 *
 * Genera el prompt para Claude + web search y define el contrato JSON estricto
 * que debe devolver. Compatible con normalizarAnalisisPsicologico.js (formato
 * "variables": { variable: { local, visitante, confianza, evidencia, fuentes } }).
 *
 * PRINCIPIO (diccionario_variables_v2_bloque_P.md):
 *   Las variables son PROXIES SCRAPEADAS, no mediciones psicológicas directas.
 *   Si no hay evidencia, usar null y confianza baja — nunca inventar.
 *
 * Sin efectos secundarios: sin Firestore, sin APIs, sin I/O.
 */

// ── Metadatos fijos de cada variable (fuente: diccionario bloque P) ───────────

export const VARIABLES_BLOQUE_P = [
  {
    nombre:       'necesita_ganar',
    tipo:         'boolean',
    descripcion:  'El equipo necesita ganar este partido para avanzar o mantenerse (determinable desde tabla de clasificación)',
    confianza_default: 0.75,
  },
  {
    nombre:       'venganza_narrativa',
    tipo:         'boolean',
    descripcion:  'Existe narrativa mediática de revancha por un resultado previo adverso',
    confianza_default: 0.50,
  },
  {
    nombre:       'rival_maldito',
    tipo:         'number (escala 0-5, 0=sin historial adverso, 5=historial muy adverso)',
    descripcion:  'Intensidad del historial H2H adverso narrado en medios',
    confianza_default: 0.40,
  },
  {
    nombre:       'presion_mediatica',
    tipo:         'number (escala 0-10, 0=sin presión, 10=presión extrema)',
    descripcion:  'Volumen y tono de la cobertura mediática que recibe el equipo para este partido',
    confianza_default: 0.45,
  },
  {
    nombre:       'lider_disponible',
    tipo:         'boolean (true = el jugador referente/capitán/goleador principal ESTÁ disponible)',
    descripcion:  'Disponibilidad del jugador clave o referente del equipo',
    confianza_default: 0.60,
  },
  {
    nombre:       'conflicto_interno',
    tipo:         'number (escala 0-5, 0=sin conflicto, 5=conflicto grave confirmado)',
    descripcion:  'Tensión interna en el plantel reportada con evidencia. Usar 0 si es solo rumor sin confirmar.',
    confianza_default: 0.35,
  },
  {
    nombre:       'generacion_peak',
    tipo:         'boolean (true = el equipo está en su mejor generación histórica)',
    descripcion:  'El plantel actual representa el momento de máxima calidad histórica del equipo',
    confianza_default: 0.50,
  },
  {
    nombre:       'underdog',
    tipo:         'boolean (true = el equipo es percibido como candidato improbable con momentum positivo)',
    descripcion:  'Narrativa de equipo sorpresa/underdog con impulso — afecta percepción de mercado más que el partido',
    confianza_default: 0.50,
  },
  {
    nombre:       'clasifico_sufriendo',
    tipo:         'string ("comodo" | "regular" | "ultimo" | "no_aplica")',
    descripcion:  'Cómo llegó el equipo a esta fase: cómodo=primera posición con margen, regular=segunda posición normal, ultimo=repechaje o última plaza, no_aplica=fase eliminatoria directa',
    confianza_default: 0.70,
  },
  {
    nombre:       'humillacion_previa',
    tipo:         'boolean (true = sufrió una derrota humillante reciente, >3 goles de diferencia, especialmente contra este rival)',
    descripcion:  'Derrota humillante reciente que puede crear un entorno narrativo significativo',
    confianza_default: 0.45,
  },
  {
    nombre:       'ausencias_ofensivas',
    tipo:         'number (escala 0.0-1.0, 0.0=sin ausencias relevantes en ataque, 1.0=ausencia total de atacantes clave)',
    descripcion:  'Impacto estimado de bajas en delanteros y mediocampistas ofensivos clave',
    confianza_default: 0.60,
  },
  {
    nombre:       'ausencias_defensivas',
    tipo:         'number (escala 0.0-1.0, 0.0=sin ausencias relevantes en defensa, 1.0=ausencia total de defensores/arquero clave)',
    descripcion:  'Impacto estimado de bajas en defensores centrales, laterales clave o arquero titular',
    confianza_default: 0.60,
  },
];

// ── Contrato JSON que debe devolver Claude ────────────────────────────────────

/**
 * Esquema del JSON que Claude debe devolver, compatible con normalizarAnalisisPsicologico.
 * Este objeto documenta la estructura esperada — no es un JSON Schema formal.
 */
export const CONTRATO_JSON = {
  descripcion: 'JSON estricto sin texto adicional. Compatible con normalizarAnalisisPsicologico (formato variables).',
  campos_raiz: {
    matchId:        'string — ID del partido (proporcionado en el prompt)',
    modelo:         'string — modelo de Claude usado para generarlo',
    webSearch:      'boolean — siempre true (se usó web search)',
    version_modelo: 'string — siempre "2.0"',
    variables:      'object — objeto con las 12 variables del bloque P',
    narrativa:      'string — resumen narrativo del contexto psicodeportivo (2-4 párrafos)',
    lesiones_destacadas: 'array<string> — lista de jugadores con baja confirmada o duda seria. [] si no hay.',
    fuentes:        'array<object> — fuentes consultadas (mínimo 1, máximo sin límite)',
    timestamps:     'object — marcas de tiempo del análisis',
  },
  estructura_variable: {
    local:      'valor según tipo de la variable (boolean | number | string)',
    visitante:  'valor según tipo de la variable (boolean | number | string)',
    confianza:  'number entre 0.0 y 1.0 — qué tan confiable es la evidencia encontrada',
    evidencia:  'string — resumen en 1-2 frases de la evidencia hallada, o null si no hay evidencia suficiente',
    fuentes:    'array<string> — URLs de las fuentes que respaldan este valor específico. [] si no hay.',
  },
  estructura_fuente: {
    titulo:             'string — título del artículo o nota',
    medio:              'string — nombre del medio (ej. "Marca", "BBC Sport", "AS")',
    url:                'string — URL completa',
    fecha_publicacion:  'string — formato YYYY-MM-DD',
    idioma:             'string — código ISO 639-1 (es, en, pt, fr, ar, ...)',
  },
  estructura_timestamps: {
    evento_partido:           'string ISO 8601 — fecha/hora del kickoff',
    analisis_generado:        'string ISO 8601 — momento en que se genera este análisis',
    disponible_para_modelo:   'string ISO 8601 — igual a analisis_generado (momento desde el que puede usarse)',
  },
  regla_null: 'Si no hay evidencia suficiente para una variable, usar local: null, visitante: null, confianza: [default bajo], evidencia: null. NUNCA inventar.',
  regla_leakage: 'No usar ninguna información publicada DESPUÉS del kickoff del partido.',
};

// ── Constructor de prompt ─────────────────────────────────────────────────────

/**
 * Construye el prompt de usuario y el prompt de sistema para el análisis psicodeportivo.
 *
 * @param {{
 *   matchId:       string|number,
 *   local:         string,        — nombre del equipo local
 *   visitante:     string,        — nombre del equipo visitante
 *   fechaPartido:  string,        — ISO 8601 o YYYY-MM-DD HH:MM
 *   fase_torneo?:  string,        — "grupos" | "octavos" | etc.
 *   grupo?:        string|null,   — "A".."L" o null
 *   jornada_grupo?: number|null,  — 1, 2, 3 o null
 * }} params
 * @returns {{
 *   sistemaPrompt: string,
 *   prompt:        string,
 *   contrato:      object,  — referencia a CONTRATO_JSON para trazabilidad
 *   variables:     object[], — referencia a VARIABLES_BLOQUE_P
 * }}
 */
export function construirPromptPsicologico({ matchId, local, visitante, fechaPartido, fase_torneo = 'grupos', grupo = null, jornada_grupo = null }) {
  if (!matchId) throw new Error('construirPromptPsicologico: matchId es requerido');
  if (!local)   throw new Error('construirPromptPsicologico: local es requerido');
  if (!visitante) throw new Error('construirPromptPsicologico: visitante es requerido');
  if (!fechaPartido) throw new Error('construirPromptPsicologico: fechaPartido es requerido');

  const contextoPartido = [
    `Partido: ${local} vs ${visitante}`,
    `Fecha/hora: ${fechaPartido}`,
    `Fase: ${fase_torneo}`,
    grupo        ? `Grupo: ${grupo}` : null,
    jornada_grupo ? `Jornada: ${jornada_grupo}` : null,
    `matchId: ${matchId}`,
  ].filter(Boolean).join('\n');

  // ── Lista de variables con instrucción de tipo ──────────────────────────────

  const listaVariables = VARIABLES_BLOQUE_P.map((v, i) =>
    `${i + 1}. "${v.nombre}"\n` +
    `   Tipo: ${v.tipo}\n` +
    `   Qué mide: ${v.descripcion}\n` +
    `   Confianza sugerida si no hay evidencia clara: ${v.confianza_default}`
  ).join('\n\n');

  // ── Contrato JSON incrustado en el prompt ───────────────────────────────────

  const estructuraJSON = `{
  "matchId": "${matchId}",
  "modelo": "<nombre del modelo que ejecuta esto>",
  "webSearch": true,
  "version_modelo": "2.0",
  "variables": {
    "necesita_ganar": {
      "local": <boolean>,
      "visitante": <boolean>,
      "confianza": <0.0–1.0>,
      "evidencia": "<resumen 1-2 frases o null>",
      "fuentes": ["<url>"]
    },
    "venganza_narrativa":  { "local": <boolean>, "visitante": <boolean>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "rival_maldito":       { "local": <0–5>,     "visitante": <0–5>,     "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "presion_mediatica":   { "local": <0–10>,    "visitante": <0–10>,    "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "lider_disponible":    { "local": <boolean>, "visitante": <boolean>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "conflicto_interno":   { "local": <0–5>,     "visitante": <0–5>,     "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "generacion_peak":     { "local": <boolean>, "visitante": <boolean>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "underdog":            { "local": <boolean>, "visitante": <boolean>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "clasifico_sufriendo": { "local": <"comodo"|"regular"|"ultimo"|"no_aplica">, "visitante": <idem>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "humillacion_previa":  { "local": <boolean>, "visitante": <boolean>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "ausencias_ofensivas": { "local": <0.0–1.0>, "visitante": <0.0–1.0>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] },
    "ausencias_defensivas":{ "local": <0.0–1.0>, "visitante": <0.0–1.0>, "confianza": <0.0–1.0>, "evidencia": "<...o null>", "fuentes": [] }
  },
  "narrativa": "<resumen narrativo del contexto psicodeportivo, 2-4 párrafos>",
  "lesiones_destacadas": ["<Jugador X (equipo) — lesión/duda confirmada>"],
  "fuentes": [
    {
      "titulo": "<título del artículo>",
      "medio": "<nombre del medio>",
      "url": "<URL completa>",
      "fecha_publicacion": "<YYYY-MM-DD>",
      "idioma": "<es|en|pt|fr|ar|...>"
    }
  ],
  "timestamps": {
    "evento_partido": "${fechaPartido}",
    "analisis_generado": "<ISO 8601 del momento actual>",
    "disponible_para_modelo": "<ISO 8601 del momento actual>"
  }
}`;

  // ── Prompt de sistema ───────────────────────────────────────────────────────

  const sistemaPrompt =
`Eres un analista deportivo especializado en fútbol internacional. Tu tarea es analizar el contexto psicodeportivo y de disponibilidad de plantilla para un partido de la Copa del Mundo 2026.

PRINCIPIO FUNDAMENTAL:
Las variables que vas a reportar son PROXIES SCRAPEADAS desde fuentes públicas (noticias, declaraciones, contexto de torneo), no mediciones psicológicas directas. Cada variable refleja un mecanismo diferente:
- contextual_proxy: hechos de la tabla de clasificación o torneo, verificables objetivamente
- media_narrative_proxy: relatos y encuadres periodísticos, no necesariamente predictivos del rendimiento
- team_performance_proxy: información que puede afectar el rendimiento real del equipo
- market_bias_proxy: información que afecta más la percepción del mercado que el partido en sí

REGLA DE LEAKAGE (crítica):
No uses NINGUNA información publicada después del kickoff del partido. Fecha límite de búsqueda: ${fechaPartido}. Si no puedes verificar si una fuente es previa al kickoff, no la uses.

REGLA DE HONESTIDAD:
Si no encuentras evidencia suficiente para una variable, asigna null a los valores y una confianza baja (≤ 0.40). NUNCA inventes datos, no extrapoles sin fuente, no asumas.

REGLA DE FUENTES:
Cita fuentes reales con URL verificable. Las fuentes sin URL o sin fecha no cuentan. Prioriza: medios deportivos de referencia (Marca, AS, BBC Sport, ESPN, L'Equipe, etc.), comunicados oficiales de federaciones, y declaraciones directas de técnicos o jugadores.

REGLA DE SALIDA:
Devuelve ÚNICAMENTE el JSON solicitado, sin texto introductorio, sin explicaciones, sin markdown. El JSON debe ser válido y parseable directamente.`;

  // ── Prompt de usuario ───────────────────────────────────────────────────────

  const prompt =
`Analiza el contexto psicodeportivo del siguiente partido de la Copa del Mundo 2026:

${contextoPartido}

Busca información actualizada y previa al kickoff sobre ambos equipos: ${local} (local) y ${visitante} (visitante).

Debes analizar y reportar las siguientes 12 variables para cada equipo:

${listaVariables}

INSTRUCCIONES DE BÚSQUEDA:
- Busca noticias de los últimos 7 días previos al partido sobre ambos equipos
- Busca el estado de disponibilidad de jugadores clave (lesiones, suspensiones, dudas)
- Busca la situación en la tabla de clasificación para determinar necesidad de victoria
- Busca declaraciones recientes de técnicos y jugadores
- Busca si existe alguna narrativa mediática especial (revancha, historial H2H, presión)
- Para ausencias_ofensivas y ausencias_defensivas: busca lista oficial de convocados y noticias de bajas confirmadas

FORMATO DE RESPUESTA:
Devuelve ÚNICAMENTE el siguiente JSON, reemplazando los valores entre < > con los valores reales encontrados. No incluyas texto antes ni después del JSON. No uses bloques de código markdown.

${estructuraJSON}

RECORDATORIO FINAL:
- Confianza = qué tan seguro estás de la evidencia, no del valor en sí
- Si no hay evidencia de conflicto_interno, pon 0 (no 2, no 3 — 0 es el default seguro)
- Para ausencias: 0.0 significa sin bajas relevantes conocidas; 1.0 sería ausencia de TODO el ataque/defensa
- Para clasifico_sufriendo: usa "no_aplica" si el partido es fase eliminatoria directa
- El campo "evidencia" dentro de cada variable debe ser 1-2 frases que expliquen QUÉ encontraste, no POR QUÉ es importante`;

  return {
    sistemaPrompt,
    prompt,
    contrato:  CONTRATO_JSON,
    variables: VARIABLES_BLOQUE_P,
  };
}

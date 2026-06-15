/**
 * claudePsychologyClient.js — Cliente delgado para llamar Claude (análisis psicodeportivo).
 *
 * Responsabilidad única: llamar la Anthropic Messages API y devolver el texto crudo.
 * No guarda Firestore, no normaliza, no decide política de costos.
 *
 * Usa fetch nativo (Node.js 18+). Sin SDK de Anthropic instalado.
 * El modelo por defecto es Haiku por costo.
 *
 * SEGURIDAD:
 *   - Lee CLAUDE_API_KEY exclusivamente desde process.env
 *   - Nunca imprime ni retorna la API key
 *   - Lanza error explícito si la key no está configurada
 */

const ANTHROPIC_API_URL  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION  = '2023-06-01';
const ANTHROPIC_BETA     = 'web-search-2025-03-05';
const MODELO_DEFAULT     = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_DEFAULT = 4096;

// ── Extracción de texto desde la respuesta de la API ─────────────────────────

/**
 * Extrae el texto de los content blocks de la API.
 * Con web search activo puede haber bloques tool_use intercalados antes del texto final.
 * Se concatenan todos los bloques de tipo "text" en orden.
 */
function extraerTexto(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n')
    .trim();
}

// ── Cliente principal ─────────────────────────────────────────────────────────

/**
 * Llama a Claude con los prompts de sistema y usuario proporcionados.
 * Incluye la herramienta de web search server-side (web_search_20250305).
 *
 * @param {{
 *   sistemaPrompt: string,
 *   prompt:        string,
 *   modelo?:       string,   — por defecto claude-haiku-4-5-20251001
 *   maxTokens?:    number,   — por defecto 4096
 * }} params
 * @returns {{
 *   ok:      true,
 *   texto:   string,  — texto crudo de Claude (debería ser JSON)
 *   modelo:  string,
 *   uso:     { input_tokens: number, output_tokens: number } | null,
 * } | {
 *   ok:      false,
 *   razon:   string,
 *   status?: number,
 * }}
 */
export async function llamarClaudePsicologico({ sistemaPrompt, prompt, modelo = MODELO_DEFAULT, maxTokens = MAX_TOKENS_DEFAULT }) {
  const apiKey = process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    return { ok: false, razon: 'CLAUDE_API_KEY no configurada en process.env' };
  }
  if (!sistemaPrompt || !prompt) {
    return { ok: false, razon: 'sistemaPrompt y prompt son requeridos' };
  }

  const body = {
    model:      modelo,
    max_tokens: maxTokens,
    system:     sistemaPrompt,
    messages:   [{ role: 'user', content: prompt }],
    tools: [
      {
        type:     'web_search_20250305',
        name:     'web_search',
        max_uses: 8,
      },
    ],
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta':  ANTHROPIC_BETA,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, razon: `Error de red al llamar Anthropic API: ${err.message}` };
  }

  if (!response.ok) {
    let errorBody = '';
    try { errorBody = await response.text(); } catch {}
    return {
      ok:     false,
      razon:  `Anthropic API respondió ${response.status}: ${errorBody.slice(0, 200)}`,
      status: response.status,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, razon: `Error al parsear respuesta JSON de Anthropic: ${err.message}` };
  }

  const texto = extraerTexto(data.content);

  if (!texto) {
    return { ok: false, razon: 'Anthropic respondió sin bloques de texto (posible respuesta solo tool_use)' };
  }

  return {
    ok:     true,
    texto,
    modelo: data.model ?? modelo,
    uso:    data.usage ?? null,
  };
}

/**
 * generarAnalisisPsicologicoPartido.js — Orquestador psicodeportivo (Fase 4.4/4.5)
 *
 * Evalúa condiciones y, opcionalmente con --execute, llama Claude y persiste el análisis.
 *
 * Uso:
 *   node scripts/generarAnalisisPsicologicoPartido.js <matchId>            ← dry-run
 *   node scripts/generarAnalisisPsicologicoPartido.js <matchId> --dry-run  ← igual
 *   node scripts/generarAnalisisPsicologicoPartido.js <matchId> --execute  ← llamada real
 *   node scripts/generarAnalisisPsicologicoPartido.js <matchId> --execute --force
 *
 * Política de costos (máximo 1 llamada IA por matchId):
 *   - Solo el mismo día del partido (comparación UTC)
 *   - Si ya existe análisis completo_v2, NO llamar (salvo --force)
 *   - Si existe análisis incompleto, NO llamar sin --force
 *   - --force no puede superar la restricción de día de partido
 *   - Sin CLAUDE_API_KEY → BLOQUEADO
 *   - Sin --execute → nunca llamar Claude (dry-run)
 *
 * Reportes generados:
 *   dry-run    → reports/dryrun_analisis_psicologico_<matchId>_TS.json
 *   éxito real → reports/analisis_psicologico_<matchId>_TS.json
 *   error real → reports/error_analisis_psicologico_<matchId>_TS.json
 *
 * GARANTÍAS en modo dry-run: 0 escrituras Firestore. 0 llamadas Claude.
 * GARANTÍAS en --execute:    SOLO escribe en analisis_psicologico/{matchId}.
 *                            NUNCA en predicciones/{matchId}.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve }                  from 'path';

import '../src/firebase/init.js';
import { obtenerPartidosMundial }                      from '../src/data/pipeline/footballData.js';
import { existeAnalisisPsicologico,
         leerAnalisisPsicologico,
         guardarAnalisisPsicologico }                  from '../src/firebase/analisisPsicologico.js';
import { construirPromptPsicologico }                  from '../src/core/psychology/construirPromptPsicologico.js';
import { llamarClaudePsicologico }                     from '../src/core/psychology/claudePsychologyClient.js';
import { normalizarAnalisisPsicologico }               from '../src/core/psychology/normalizarAnalisisPsicologico.js';
import { parsearRespuestaClaude }                      from '../src/core/psychology/parsearRespuestaClaude.js';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const matchId = args.find(a => !a.startsWith('--'));
const force   = args.includes('--force');
const execute = args.includes('--execute');

if (!matchId) {
  console.error('\nUso: node scripts/generarAnalisisPsicologicoPartido.js <matchId> [--execute] [--force] [--dry-run]');
  process.exit(1);
}

if (String(matchId).startsWith('TEST_')) {
  console.error(`\nERROR: matchId "${matchId}" empieza con TEST_ — ignorado por política de calibración.\n`);
  process.exit(1);
}

// ── Validación de completitud (igual que auditarAnalisisPsicologico.js) ───────

const VARIABLES_P = [
  'necesita_ganar', 'venganza_narrativa', 'rival_maldito', 'presion_mediatica',
  'lider_disponible', 'conflicto_interno', 'generacion_peak', 'underdog',
  'clasifico_sufriendo', 'humillacion_previa', 'ausencias_ofensivas', 'ausencias_defensivas',
];

const TIPO_PROXY_ESPERADO = {
  necesita_ganar: 'contextual_proxy', venganza_narrativa: 'media_narrative_proxy',
  rival_maldito: 'media_narrative_proxy', presion_mediatica: 'media_narrative_proxy',
  lider_disponible: 'team_performance_proxy', conflicto_interno: 'team_performance_proxy',
  generacion_peak: 'team_performance_proxy', underdog: 'market_bias_proxy',
  clasifico_sufriendo: 'contextual_proxy', humillacion_previa: 'media_narrative_proxy',
  ausencias_ofensivas: 'team_performance_proxy', ausencias_defensivas: 'team_performance_proxy',
};

function confianzaValida(c) { return typeof c === 'number' && isFinite(c) && c >= 0 && c <= 1; }

function clasificarAnalisis(data) {
  if (!data) return { clasificacion: 'falta_analisis', detalle: {} };
  if (data.version_modelo !== '2.0') return { clasificacion: 'version_no_v2', detalle: { version_modelo: data.version_modelo ?? null } };

  const vars = data.variables ?? {};
  const variables_faltantes = [], errores_proxy = [], errores_confianza = [];
  for (const n of VARIABLES_P) {
    const v = vars[n];
    if (!v) { variables_faltantes.push(n); continue; }
    if (v.tipo_proxy !== TIPO_PROXY_ESPERADO[n]) errores_proxy.push(n);
    if (!confianzaValida(v.confianza))            errores_confianza.push(n);
  }
  if (variables_faltantes.length || errores_proxy.length || errores_confianza.length) {
    return { clasificacion: 'incompleto_variables', detalle: { variables_faltantes, errores_proxy, errores_confianza } };
  }

  const campos_faltantes = [];
  if (!data.estado)                 campos_faltantes.push('estado');
  if (!Array.isArray(data.fuentes)) campos_faltantes.push('fuentes');
  if (!data.timestamps)             campos_faltantes.push('timestamps');
  else {
    if (!data.timestamps.evento_partido)         campos_faltantes.push('timestamps.evento_partido');
    if (!data.timestamps.analisis_generado)      campos_faltantes.push('timestamps.analisis_generado');
    if (!data.timestamps.disponible_para_modelo) campos_faltantes.push('timestamps.disponible_para_modelo');
  }
  if (campos_faltantes.length) return { clasificacion: 'incompleto_metadata', detalle: { campos_faltantes } };

  return {
    clasificacion: 'completo_v2',
    detalle: {
      modelo:      data.modelo     ?? null,
      n_variables: Object.keys(vars).length,
      n_fuentes:   data.fuentes?.length ?? 0,
      n_warnings:  Array.isArray(data.warnings) ? data.warnings.length : null,
      guardado_en: data.guardado_en?.toDate?.()?.toISOString() ?? data.guardado_en ?? null,
    },
  };
}

// ── Decisión de acción ────────────────────────────────────────────────────────

function decidirAccion({ existeAnalisis, clasificacion, esDiaPartido, tieneApiKey, force }) {
  if (existeAnalisis && clasificacion === 'completo_v2' && !force)
    return { accion: 'NO_LLAMAR', razon: 'Análisis completo_v2 ya existe. Usar --force para regenerar.' };
  if (existeAnalisis && clasificacion !== 'completo_v2' && !force)
    return { accion: 'NO_LLAMAR', razon: `Análisis incompleto (${clasificacion}) en Firestore. Usar --force para regenerar.` };
  if (!esDiaPartido) {
    const extra = force ? ' (--force no puede superar la restricción de día de partido)' : '';
    return { accion: 'NO_LLAMAR', razon: `No es el día del partido.${extra} El análisis solo se genera el mismo día del kickoff.` };
  }
  if (!tieneApiKey)
    return { accion: 'BLOQUEADO', razon: 'CLAUDE_API_KEY no está configurada en .env.' };
  return { accion: 'LISTO_PARA_LLAMAR_CLAUDE', razon: 'Todas las condiciones cumplidas.' };
}

// ── Guardar reporte ───────────────────────────────────────────────────────────

function guardarReporte(prefijo, matchId, datos) {
  const ts         = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const reportsDir = resolve('reports');
  mkdirSync(reportsDir, { recursive: true });
  const nombre    = `${prefijo}_${matchId}_${ts}.json`;
  const ruta      = resolve(reportsDir, nombre);
  // Nunca incluir API key en reportes
  const seguro    = { ...datos };
  delete seguro.claude_api_key;
  writeFileSync(ruta, JSON.stringify(seguro, null, 2), 'utf-8');
  return `reports/${nombre}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  ANÁLISIS PSICODEPORTIVO — Orquestador (Fase 4.5)');
console.log('═'.repeat(70));
console.log(`\n  matchId : ${matchId}`);
console.log(`  --execute: ${execute}`);
console.log(`  --force  : ${force}`);
console.log(`  modo     : ${execute ? 'EJECUCIÓN REAL' : 'dry-run (0 llamadas Claude, 0 escrituras)'}\n`);

// [1] Buscar partido
console.log('[1/5] Buscando partido en fixture…');
const todos   = await obtenerPartidosMundial();
const partido = todos.find(p => String(p.id) === String(matchId));

if (!partido) {
  console.error(`\n  ERROR: matchId "${matchId}" no encontrado en el fixture del Mundial 2026.\n`);
  process.exit(1);
}

const local        = partido.homeTeam?.name ?? 'Desconocido';
const visitante    = partido.awayTeam?.name ?? 'Desconocido';
const fechaPartido = partido.utcDate ?? null;
const fase_torneo  = partido.stage   ?? 'grupos';
const grupo        = partido.group   ?? null;
const jornada      = partido.matchday ?? null;

console.log(`  → ${local} vs ${visitante}`);
console.log(`  → kickoff: ${fechaPartido}  grupo: ${grupo ?? 'n/a'}  J${jornada ?? '?'}`);

// [2] Día del partido
console.log('\n[2/5] Verificando día del partido…');
const hoyUTC        = new Date().toISOString().slice(0, 10);
const fechaMatchUTC = fechaPartido?.slice(0, 10) ?? null;
const esDiaPartido  = hoyUTC === fechaMatchUTC;
console.log(`  → Hoy (UTC): ${hoyUTC}  |  Partido (UTC): ${fechaMatchUTC ?? '?'}  |  es_dia_partido: ${esDiaPartido}`);

// [3] Análisis existente
console.log('\n[3/5] Verificando analisis_psicologico en Firestore…');
const existeAnalisis = await existeAnalisisPsicologico(matchId);
let analisisData = null, clasificacion = 'falta_analisis', detalleAnalisis = {};
if (existeAnalisis) {
  analisisData    = await leerAnalisisPsicologico(matchId);
  const res       = clasificarAnalisis(analisisData);
  clasificacion   = res.clasificacion;
  detalleAnalisis = res.detalle;
  console.log(`  → Existe: sí  |  clasificación: ${clasificacion}`);
} else {
  console.log(`  → Existe: no`);
}

// [4] API key
console.log('\n[4/5] Verificando CLAUDE_API_KEY…');
const tieneApiKey = Boolean(process.env.CLAUDE_API_KEY);
console.log(`  → CLAUDE_API_KEY configurada: ${tieneApiKey}`);

// [5] Decisión
console.log('\n[5/5] Aplicando política de costos…');
const { accion, razon } = decidirAccion({ existeAnalisis, clasificacion, esDiaPartido, tieneApiKey, force });

console.log(`\n  ACCIÓN : ${accion}`);
console.log(`  RAZÓN  : ${razon}`);

// ── Construir prompt siempre que sea relevante (para dry-run preview y execute) ──

let promptData = null;
if (accion === 'LISTO_PARA_LLAMAR_CLAUDE') {
  promptData = construirPromptPsicologico({ matchId, local, visitante, fechaPartido, fase_torneo, grupo, jornada_grupo: jornada });
}

// ── Rama DRY-RUN ──────────────────────────────────────────────────────────────

if (!execute) {
  if (promptData) {
    console.log('\n[DRY-RUN] Prompt construido. Vista previa (5 líneas):');
    promptData.sistemaPrompt.split('\n').slice(0, 3).forEach(l => console.log('  SISTEMA: ' + l));
    promptData.prompt.split('\n').slice(0, 3).forEach(l => console.log('  USUARIO: ' + l));
    console.log('  [...]\n  En modo real: Anthropic API → claude-haiku-4-5-20251001 → web_search → normalizar → guardar');
  }

  const rutaReporte = guardarReporte('dryrun_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'dry-run', matchId: String(matchId),
    partido: `${local} vs ${visitante}`, fechaPartido, fase_torneo, grupo: grupo ?? null,
    hoy_utc: hoyUTC, es_dia_partido: esDiaPartido, existe_analisis: existeAnalisis,
    clasificacion_analisis: clasificacion, completo_v2: clasificacion === 'completo_v2',
    detalle_analisis: detalleAnalisis, force, claude_api_key_configurada: tieneApiKey,
    accion, razon, prompt_construido: promptData !== null,
    sistemaPrompt_chars: promptData?.sistemaPrompt?.length ?? null,
    prompt_chars: promptData?.prompt?.length ?? null,
    escrituras_firestore: 0, llamadas_claude: 0,
  });

  console.log('\n' + '═'.repeat(70));
  console.log(`  RESUMEN (dry-run)                   : ${accion}`);
  console.log(`  matchId                             : ${matchId}`);
  console.log(`  partido                             : ${local} vs ${visitante}`);
  console.log(`  es_dia_partido                      : ${esDiaPartido}`);
  console.log(`  existe_analisis                     : ${existeAnalisis}`);
  console.log(`  clasificacion_analisis              : ${clasificacion}`);
  console.log(`  force                               : ${force}`);
  console.log(`  claude_api_key_configurada          : ${tieneApiKey}`);
  console.log(`\n  → ${rutaReporte}`);
  console.log('  0 escrituras en Firestore. 0 llamadas a Claude.\n');
  process.exit(0);
}

// ── Rama EXECUTE ──────────────────────────────────────────────────────────────

if (accion !== 'LISTO_PARA_LLAMAR_CLAUDE') {
  console.log(`\n  [EXECUTE] Bloqueado por política — accion: ${accion}\n`);
  const rutaErr = guardarReporte('dryrun_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'execute-bloqueado', matchId: String(matchId),
    partido: `${local} vs ${visitante}`, accion, razon,
    es_dia_partido: esDiaPartido, existe_analisis: existeAnalisis,
    clasificacion_analisis: clasificacion, force,
    escrituras_firestore: 0, llamadas_claude: 0,
  });
  console.log(`  → ${rutaErr}\n`);
  process.exit(0);
}

// — Aquí: accion === LISTO_PARA_LLAMAR_CLAUDE y execute === true —

console.log('\n[EXECUTE] Llamando Claude…');
console.log(`  modelo : claude-haiku-4-5-20251001`);
console.log(`  tools  : [web_search] (max_uses: 8)`);
console.log(`  partido: ${local} vs ${visitante}  |  kickoff: ${fechaPartido}`);

const inicio       = Date.now();
const respuesta    = await llamarClaudePsicologico({
  sistemaPrompt: promptData.sistemaPrompt,
  prompt:        promptData.prompt,
  modelo:        'claude-haiku-4-5-20251001',
});
const duracionMs   = Date.now() - inicio;

if (!respuesta.ok) {
  console.error(`\n  ERROR llamando Claude: ${respuesta.razon}`);
  const rutaErr = guardarReporte('error_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'execute-error-llamada',
    matchId: String(matchId), partido: `${local} vs ${visitante}`, fechaPartido,
    accion, razon_bloqueo: respuesta.razon, duracion_ms: duracionMs,
    escrituras_firestore: 0, llamadas_claude: 1,
  });
  console.log(`  → ${rutaErr}\n`);
  process.exit(1);
}

console.log(`  → Respuesta recibida en ${duracionMs}ms  |  uso: ${JSON.stringify(respuesta.uso)}`);
console.log(`  → ${respuesta.texto.length} chars de texto crudo`);

// Parsear JSON de la respuesta
console.log('\n[EXECUTE] Parseando JSON de la respuesta…');
const parseo = parsearRespuestaClaude(respuesta.texto);

if (!parseo.ok) {
  console.error(`\n  ERROR parseando respuesta: ${parseo.razon}`);
  const rutaErr = guardarReporte('error_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'execute-error-parseo',
    matchId: String(matchId), partido: `${local} vs ${visitante}`, fechaPartido,
    error_parseo: parseo.razon, texto_raw_preview: parseo.textoRaw,
    modelo: respuesta.modelo, uso: respuesta.uso, duracion_ms: duracionMs,
    escrituras_firestore: 0, llamadas_claude: 1,
  });
  console.log(`  → ${rutaErr}\n`);
  process.exit(1);
}

console.log(`  → JSON parseado correctamente`);

// Normalizar con normalizarAnalisisPsicologico
console.log('\n[EXECUTE] Normalizando respuesta…');
const normalizacion = normalizarAnalisisPsicologico({ ...parseo.json, matchId: String(matchId) });

if (!normalizacion.ok) {
  console.error(`\n  ERROR normalizando: ${normalizacion.razon}`);
  const rutaErr = guardarReporte('error_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'execute-error-normalizacion',
    matchId: String(matchId), partido: `${local} vs ${visitante}`, fechaPartido,
    error_normalizacion: normalizacion.razon, modelo: respuesta.modelo,
    uso: respuesta.uso, duracion_ms: duracionMs,
    escrituras_firestore: 0, llamadas_claude: 1,
  });
  console.log(`  → ${rutaErr}\n`);
  process.exit(1);
}

const { analisis, warnings } = normalizacion;
console.log(`  → Normalizado: ${Object.keys(analisis.variables ?? {}).length} variables  |  ${warnings.length} warnings`);
if (warnings.length) {
  warnings.forEach(w => console.log(`  ⚠ ${w}`));
}

// Guardar en Firestore — SOLO analisis_psicologico/{matchId}
console.log('\n[EXECUTE] Guardando en analisis_psicologico/' + matchId + '…');
let docGuardado;
try {
  docGuardado = await guardarAnalisisPsicologico(matchId, analisis);
  console.log(`  → Guardado correctamente.`);
} catch (err) {
  console.error(`\n  ERROR guardando en Firestore: ${err.message}`);
  const rutaErr = guardarReporte('error_analisis_psicologico', matchId, {
    generado_en: new Date().toISOString(), modo: 'execute-error-firestore',
    matchId: String(matchId), partido: `${local} vs ${visitante}`,
    error_firestore: err.message, modelo: respuesta.modelo, uso: respuesta.uso,
    escrituras_firestore: 0, llamadas_claude: 1,
  });
  console.log(`  → ${rutaErr}\n`);
  process.exit(1);
}

// Reporte de éxito
const n_variables = Object.keys(analisis.variables ?? {}).length;
const n_fuentes   = analisis.fuentes?.length ?? 0;
const n_warnings  = warnings.length;

const rutaExito = guardarReporte('analisis_psicologico', matchId, {
  generado_en:          new Date().toISOString(),
  modo:                 'execute-exitoso',
  matchId:              String(matchId),
  partido:              `${local} vs ${visitante}`,
  fechaPartido,
  modelo:               respuesta.modelo,
  accion,
  llamada_claude:       1,
  escrituras_firestore: 1,
  doc_guardado:         `analisis_psicologico/${matchId}`,
  variables_count:      n_variables,
  warnings_count:       n_warnings,
  fuentes_count:        n_fuentes,
  tokens_input:         respuesta.uso?.input_tokens  ?? null,
  tokens_output:        respuesta.uso?.output_tokens ?? null,
  duracion_ms:          duracionMs,
  warnings,
});

console.log('\n' + '═'.repeat(70));
console.log('  ÉXITO');
console.log('─'.repeat(70));
console.log(`  matchId          : ${matchId}`);
console.log(`  partido          : ${local} vs ${visitante}`);
console.log(`  modelo           : ${respuesta.modelo}`);
console.log(`  variables_count  : ${n_variables}`);
console.log(`  warnings_count   : ${n_warnings}`);
console.log(`  fuentes_count    : ${n_fuentes}`);
console.log(`  tokens           : in=${respuesta.uso?.input_tokens ?? '?'} out=${respuesta.uso?.output_tokens ?? '?'}`);
console.log(`  doc_guardado     : analisis_psicologico/${matchId}`);
console.log(`\n  → ${rutaExito}`);
console.log('  1 escritura en analisis_psicologico. 0 escrituras en predicciones.\n');

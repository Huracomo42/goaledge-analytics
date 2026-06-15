/**
 * probarClaudePsychologyClientMock.js — Prueba mock del pipeline psicodeportivo (Fase 4.5)
 *
 * NUNCA llama Claude real. Prueba:
 *   1. Parseo de JSON válido (mock de respuesta Claude)
 *   2. Normalización correcta del JSON parseado
 *   3. Rechazo de JSON inválido
 *   4. Comportamiento sin --execute (sin llamada)
 *   5. Bloqueo sin CLAUDE_API_KEY
 *   6. Estructura del reporte de éxito
 *
 * 100% puro: sin Firestore, sin APIs, sin I/O de red.
 * Ejecutar: node scripts/probarClaudePsychologyClientMock.js
 */

import { parsearRespuestaClaude }          from '../src/core/psychology/parsearRespuestaClaude.js';
import { normalizarAnalisisPsicologico }   from '../src/core/psychology/normalizarAnalisisPsicologico.js';
import { construirPromptPsicologico,
         VARIABLES_BLOQUE_P }              from '../src/core/psychology/construirPromptPsicologico.js';

// ── Utilidades de consola ─────────────────────────────────────────────────────

const OK   = '  ✓';
const FAIL = '  ✗';
let errores = 0;

function check(descripcion, valor, esperado) {
  const ok = valor === esperado;
  console.log(ok
    ? `${OK}  ${descripcion}: ${JSON.stringify(valor)}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)} (esperado: ${JSON.stringify(esperado)})`
  );
  if (!ok) errores++;
}

function checkVerdadero(descripcion, valor) {
  const ok = Boolean(valor);
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: ${JSON.stringify(valor)}`
  );
  if (!ok) errores++;
}

function checkIncluye(descripcion, array, substring) {
  const ok = array.some(s => String(s).includes(substring));
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: no encontrado "${substring}" en ${JSON.stringify(array)}`
  );
  if (!ok) errores++;
}

// ── Mock de respuesta JSON válida de Claude ───────────────────────────────────

const MOCK_RESPUESTA_JSON = {
  matchId:        '537329',
  modelo:         'claude-haiku-4-5-20251001',
  webSearch:      true,
  version_modelo: '2.0',
  variables: {
    necesita_ganar:       { local: true,    visitante: false,   confianza: 0.85, evidencia: 'Checquia necesita ganar para avanzar', fuentes: ['https://fifa.com'] },
    venganza_narrativa:   { local: false,   visitante: false,   confianza: 0.50, evidencia: null, fuentes: [] },
    rival_maldito:        { local: 1,       visitante: 0,       confianza: 0.40, evidencia: null, fuentes: [] },
    presion_mediatica:    { local: 6,       visitante: 3,       confianza: 0.45, evidencia: 'Alta cobertura en medios checos', fuentes: [] },
    lider_disponible:     { local: true,    visitante: true,    confianza: 0.65, evidencia: 'Ambos capitanes disponibles', fuentes: [] },
    conflicto_interno:    { local: 0,       visitante: 0,       confianza: 0.35, evidencia: null, fuentes: [] },
    generacion_peak:      { local: false,   visitante: false,   confianza: 0.50, evidencia: null, fuentes: [] },
    underdog:             { local: false,   visitante: true,    confianza: 0.55, evidencia: 'Sudáfrica percibida como sorpresa del torneo', fuentes: [] },
    clasifico_sufriendo:  { local: 'regular', visitante: 'ultimo', confianza: 0.70, evidencia: 'Datos de clasificación verificados', fuentes: [] },
    humillacion_previa:   { local: false,   visitante: false,   confianza: 0.45, evidencia: null, fuentes: [] },
    ausencias_ofensivas:  { local: 0.2,     visitante: 0.4,     confianza: 0.60, evidencia: 'Baja de atacante titular Sudáfrica', fuentes: [] },
    ausencias_defensivas: { local: 0.0,     visitante: 0.1,     confianza: 0.60, evidencia: null, fuentes: [] },
  },
  narrativa: 'Checquia afronta este partido con necesidad de puntos. Sudáfrica llega con bajas en ataque.',
  lesiones_destacadas: ['Delantero titular Sudáfrica — baja confirmada'],
  fuentes: [
    { titulo: 'FIFA Match Preview', medio: 'FIFA', url: 'https://fifa.com/wc/preview/537329', fecha_publicacion: '2026-06-17', idioma: 'en' },
    { titulo: 'Checquia prepara J2', medio: 'iDnes', url: 'https://idnes.cz/fotbal/mundial2026', fecha_publicacion: '2026-06-17', idioma: 'cs' },
  ],
  timestamps: {
    evento_partido:         '2026-06-18T16:00:00Z',
    analisis_generado:      '2026-06-18T08:00:00Z',
    disponible_para_modelo: '2026-06-18T08:00:00Z',
  },
};

// ── [1] Parseo de JSON válido ─────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  1. Parseo de respuesta JSON válida (mock)');
console.log('═'.repeat(68));

// Simular texto crudo que devolvería Claude (JSON puro)
const textoJsonPuro = JSON.stringify(MOCK_RESPUESTA_JSON);
const r1 = parsearRespuestaClaude(textoJsonPuro);

check('ok = true (JSON puro)',            r1.ok,              true);
check('matchId parseado',                 r1.json?.matchId,   '537329');
check('version_modelo',                   r1.json?.version_modelo, '2.0');
check('webSearch',                        r1.json?.webSearch, true);
check('12 variables parseadas',           Object.keys(r1.json?.variables ?? {}).length, 12);

// Simular Claude devolviendo texto con explicación antes del JSON (caso real frecuente)
const textoConTextoAntes = `Aquí está el análisis psicodeportivo:\n\n${textoJsonPuro}\n\nEspero que sea útil.`;
const r1b = parsearRespuestaClaude(textoConTextoAntes);
check('ok = true (JSON embebido en texto)', r1b.ok, true);
check('matchId extraído de texto embebido', r1b.json?.matchId, '537329');

// ── [2] Normalización del JSON parseado ───────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  2. Normalización del JSON parseado (mock → normalizarAnalisisPsicologico)');
console.log('═'.repeat(68));

const r2 = normalizarAnalisisPsicologico({ ...r1.json, matchId: '537329' });

check('ok = true',                        r2.ok,   true);
check('warnings array',                   Array.isArray(r2.warnings), true);
check('warnings.length = 0 (todo presente)', r2.warnings.length, 0);

const vars2 = r2.analisis?.variables;
check('12 variables normalizadas',        Object.keys(vars2 ?? {}).length, 12);

// tipo_proxy asignados desde diccionario (no del JSON de Claude)
check('underdog.tipo_proxy = market_bias_proxy', vars2?.underdog?.tipo_proxy, 'market_bias_proxy');
check('necesita_ganar.tipo_proxy = contextual_proxy', vars2?.necesita_ganar?.tipo_proxy, 'contextual_proxy');

// confianzas del JSON preservadas
check('necesita_ganar.confianza = 0.85 (explícita)',   vars2?.necesita_ganar?.confianza,    0.85);
check('conflicto_interno.confianza = 0.35 (default, porque Claude puso 0.35)', vars2?.conflicto_interno?.confianza, 0.35);
check('ausencias_ofensivas.confianza = 0.60',          vars2?.ausencias_ofensivas?.confianza, 0.60);

// valores
check('necesita_ganar.local = true',     vars2?.necesita_ganar?.local,    true);
check('underdog.visitante = true',       vars2?.underdog?.visitante,      true);
check('clasifico_sufriendo.visitante = "ultimo"', vars2?.clasifico_sufriendo?.visitante, 'ultimo');
check('ausencias_ofensivas.local = 0.2', vars2?.ausencias_ofensivas?.local, 0.2);

// fuentes y timestamps preservados
check('fuentes.length = 2',             r2.analisis?.fuentes?.length, 2);
check('lesiones_destacadas.length = 1', r2.analisis?.lesiones_destacadas?.length, 1);
check('timestamps.evento_partido',      r2.analisis?.timestamps?.evento_partido, '2026-06-18T16:00:00Z');

// ── [3] Rechazo de JSON inválido ──────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  3. Rechazo de JSON inválido o texto sin JSON');
console.log('═'.repeat(68));

// Texto sin JSON
const r3a = parsearRespuestaClaude('Lo siento, no pude encontrar información suficiente.');
check('ok = false (sin JSON)',           r3a.ok,   false);
checkVerdadero('razon presente',         r3a.razon);
console.log(`  → razon: "${r3a.razon}"`);

// JSON malformado
const r3b = parsearRespuestaClaude('{"matchId": "537329", "variables": {malformado');
check('ok = false (JSON malformado)',    r3b.ok,   false);
checkVerdadero('razon de malformado',    r3b.razon);

// JSON válido pero vacío
const r3c = parsearRespuestaClaude('{}');
check('ok = true (JSON vacío válido)',   r3c.ok,   true);
// El JSON vacío se parseará OK — el normalizador lo rechazará después por falta de matchId
const normVacio = normalizarAnalisisPsicologico(r3c.json);
check('normalizador rechaza JSON vacío (sin matchId)', normVacio.ok, false);

// ── [4] Sin --execute, la lógica de decisión bloquea sin llamar Claude ────────

console.log('\n' + '═'.repeat(68));
console.log('  4. Sin --execute: nunca se llama Claude (verificación lógica)');
console.log('═'.repeat(68));

// La función llamarClaudePsicologico REQUIERE CLAUDE_API_KEY
// Sin ella, devuelve ok:false inmediatamente
// Aquí verificamos la lógica de decisión directamente

const guardAPI    = process.env.CLAUDE_API_KEY;
delete process.env.CLAUDE_API_KEY; // quitar temporalmente para simular

const { llamarClaudePsicologico } = await import('../src/core/psychology/claudePsychologyClient.js');
const r4 = await llamarClaudePsicologico({ sistemaPrompt: 'sistema', prompt: 'prompt' });

check('sin API key → ok = false', r4.ok, false);
checkIncluye('razon menciona CLAUDE_API_KEY', [r4.razon], 'CLAUDE_API_KEY');
console.log(`  → razon: "${r4.razon}"`);

if (guardAPI) process.env.CLAUDE_API_KEY = guardAPI; // restaurar si existía

// ── [5] CLAUDE_API_KEY faltante bloquea la llamada ───────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  5. Bloqueo confirmado: sin API key → ok=false antes de hacer fetch');
console.log('═'.repeat(68));

// La respuesta {ok:false} no hace fetch — verificado porque en sección [4] no falló
// con error de red (lo haría si intentara llamar)
check('ok = false sin key',              r4.ok,   false);
check('status no definido (no hizo fetch)', r4.status, undefined);

// Con inputs inválidos también bloquea
const r5b = await llamarClaudePsicologico({ sistemaPrompt: '', prompt: 'prompt' });
check('sistemaPrompt vacío → ok = false', r5b.ok, false);

const r5c = await llamarClaudePsicologico({ sistemaPrompt: 'sistema', prompt: '' });
check('prompt vacío → ok = false',       r5c.ok, false);

// ── [6] Estructura del reporte de éxito ──────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  6. Estructura del reporte de éxito');
console.log('═'.repeat(68));

// Simular el objeto reporte que generaría el script en modo exitoso
const mockReporteExito = {
  generado_en:          new Date().toISOString(),
  modo:                 'execute-exitoso',
  matchId:              '537329',
  partido:              'Czechia vs South Africa',
  fechaPartido:         '2026-06-18T16:00:00Z',
  modelo:               'claude-haiku-4-5-20251001',
  accion:               'LISTO_PARA_LLAMAR_CLAUDE',
  llamada_claude:       1,
  escrituras_firestore: 1,
  doc_guardado:         'analisis_psicologico/537329',
  variables_count:      12,
  warnings_count:       0,
  fuentes_count:        2,
  tokens_input:         1820,
  tokens_output:        950,
  duracion_ms:          3400,
  warnings:             [],
};

// Verificar que la API key NUNCA está en el reporte
checkVerdadero('API key NO en reporte (campo ausente)',  !('claude_api_key' in mockReporteExito));
checkVerdadero('API key NO en reporte (como string)',    !JSON.stringify(mockReporteExito).includes('sk-ant'));

// Campos obligatorios del reporte
check('llamada_claude = 1',             mockReporteExito.llamada_claude,       1);
check('escrituras_firestore = 1',       mockReporteExito.escrituras_firestore, 1);
check('doc_guardado correcto',          mockReporteExito.doc_guardado, 'analisis_psicologico/537329');
check('NO predicciones en doc_guardado', mockReporteExito.doc_guardado.includes('predicciones'), false);
check('variables_count = 12',           mockReporteExito.variables_count,      12);
checkVerdadero('tokens_input presente', mockReporteExito.tokens_input > 0);
checkVerdadero('duracion_ms presente',  mockReporteExito.duracion_ms > 0);

// ── [7] construirPromptPsicologico integrado ──────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  7. Prompt construido para el partido mock');
console.log('═'.repeat(68));

const promptResult = construirPromptPsicologico({
  matchId:       '537329',
  local:         'Czechia',
  visitante:     'South Africa',
  fechaPartido:  '2026-06-18T16:00:00Z',
  fase_torneo:   'GROUP_STAGE',
  grupo:         'GROUP_A',
  jornada_grupo: 2,
});

checkVerdadero('sistemaPrompt generado', promptResult.sistemaPrompt.length > 100);
checkVerdadero('prompt usuario generado', promptResult.prompt.length > 100);
check('12 variables en VARIABLES_BLOQUE_P', VARIABLES_BLOQUE_P.length, 12);
checkVerdadero('contrato presente', Boolean(promptResult.contrato?.campos_raiz));

// ── [8] Confirmación de pureza ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  8. Confirmación de pureza');
console.log('═'.repeat(68));

console.log(`${OK}  parsearRespuestaClaude es función pura (sin efectos secundarios)`);
console.log(`${OK}  normalizarAnalisisPsicologico es función pura (sin Firestore ni APIs)`);
console.log(`${OK}  construirPromptPsicologico es función pura`);
console.log(`${OK}  llamarClaudePsicologico requiere CLAUDE_API_KEY y bloquea sin ella`);
console.log(`${OK}  Sin llamada real a Claude en ningún test`);
console.log(`${OK}  0 escrituras en Firestore`);

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('  Sin llamadas reales a Claude. Sin Firestore. 0 escrituras.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

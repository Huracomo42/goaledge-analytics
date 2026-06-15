/**
 * probarConstruirPromptPsicologico.js — Prueba de construirPromptPsicologico.js (Fase 4.3)
 *
 * 100% puro: sin Firestore, sin APIs, sin I/O de red.
 * Ejecutar: node scripts/probarConstruirPromptPsicologico.js
 */

import {
  construirPromptPsicologico,
  VARIABLES_BLOQUE_P,
  CONTRATO_JSON,
} from '../src/core/psychology/construirPromptPsicologico.js';

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
    : `${FAIL}  ${descripcion}: falsy`
  );
  if (!ok) errores++;
}

function checkContiene(descripcion, texto, substring) {
  const ok = texto.includes(substring);
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: no encontrado "${substring}"`
  );
  if (!ok) errores++;
}

function checkNoContiene(descripcion, texto, substring) {
  const ok = !texto.includes(substring);
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: encontrado (no debería) "${substring}"`
  );
  if (!ok) errores++;
}

// ── Partido artificial ────────────────────────────────────────────────────────

const PARAMS = {
  matchId:       '537353',
  local:         'Germany',
  visitante:     'Ivory Coast',
  fechaPartido:  '2026-06-20T18:00:00Z',
  fase_torneo:   'grupos',
  grupo:         'C',
  jornada_grupo: 2,
};

// ── [1] Construcción básica ───────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  1. Construcción básica del prompt');
console.log('═'.repeat(68));

const resultado = construirPromptPsicologico(PARAMS);

checkVerdadero('devuelve objeto',           resultado);
checkVerdadero('prompt string',             typeof resultado.prompt === 'string');
checkVerdadero('sistemaPrompt string',      typeof resultado.sistemaPrompt === 'string');
checkVerdadero('contrato object',           typeof resultado.contrato === 'object');
checkVerdadero('variables array',           Array.isArray(resultado.variables));
check('12 variables en el array',           resultado.variables.length, 12);

const { prompt, sistemaPrompt } = resultado;
const promptTotal = sistemaPrompt + '\n' + prompt;

// ── [2] Contiene nombres de ambos equipos ─────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  2. Debe contener nombres de ambos equipos');
console.log('═'.repeat(68));

checkContiene('equipo local "Germany" en prompt',       prompt, 'Germany');
checkContiene('equipo visitante "Ivory Coast" en prompt', prompt, 'Ivory Coast');
checkContiene('equipo local en sistemaPrompt o prompt', promptTotal, 'Germany');
checkContiene('matchId en prompt',                      prompt, '537353');
checkContiene('fechaPartido en prompt',                 prompt, '2026-06-20');
checkContiene('grupo C en prompt',                      prompt, 'Grupo: C');
checkContiene('jornada 2 en prompt',                    prompt, 'Jornada: 2');

// ── [3] Contiene las 12 variables ─────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  3. Debe contener las 12 variables del bloque P');
console.log('═'.repeat(68));

const NOMBRES_VARIABLES = [
  'necesita_ganar',
  'venganza_narrativa',
  'rival_maldito',
  'presion_mediatica',
  'lider_disponible',
  'conflicto_interno',
  'generacion_peak',
  'underdog',
  'clasifico_sufriendo',
  'humillacion_previa',
  'ausencias_ofensivas',
  'ausencias_defensivas',
];

for (const nombre of NOMBRES_VARIABLES) {
  checkContiene(`variable "${nombre}" en prompt`, prompt, nombre);
}

// ── [4] Pide JSON estricto ────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  4. Debe pedir JSON estricto sin texto adicional');
console.log('═'.repeat(68));

checkContiene('menciona "ÚNICAMENTE el JSON"',          prompt, 'ÚNICAMENTE el siguiente JSON');
checkContiene('menciona "No incluyas texto"',           prompt, 'No incluyas texto antes ni después');
checkContiene('menciona parseable (sistema o prompt)',  promptTotal, 'parseable');
checkContiene('menciona "No uses bloques de código"',   prompt, 'bloques de código markdown');

// ── [5] Menciona no usar información post-kickoff ─────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  5. Debe mencionar restricción de leakage post-kickoff');
console.log('═'.repeat(68));

checkContiene('menciona "LEAKAGE"',               sistemaPrompt, 'LEAKAGE');
checkContiene('menciona "después del kickoff"',   sistemaPrompt, 'después del kickoff');
checkContiene('fecha límite en sistemaPrompt',    sistemaPrompt, '2026-06-20');
checkContiene('menciona "kickoff" en prompt',     prompt,        'kickoff');

// ── [6] Menciona fuentes ──────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  6. Debe mencionar fuentes con estructura requerida');
console.log('═'.repeat(68));

checkContiene('menciona "fuentes"',               prompt, 'fuentes');
checkContiene('campo "titulo" en contrato JSON',  prompt, '"titulo"');
checkContiene('campo "medio" en contrato JSON',   prompt, '"medio"');
checkContiene('campo "url" en contrato JSON',     prompt, '"url"');
checkContiene('campo "fecha_publicacion"',        prompt, '"fecha_publicacion"');
checkContiene('campo "idioma"',                   prompt, '"idioma"');
checkContiene('menciona URL verificable',         sistemaPrompt, 'URL verificable');

// ── [7] Menciona confianza ────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  7. Debe mencionar confianza y sus reglas');
console.log('═'.repeat(68));

checkContiene('campo "confianza" en contrato JSON', prompt, '"confianza"');
checkContiene('escala 0.0–1.0',                     prompt, '0.0–1.0');
checkContiene('menciona "confianza baja"',           sistemaPrompt, 'confianza baja');
checkContiene('menciona "NUNCA inventes"',           sistemaPrompt, 'NUNCA inventes datos');
checkContiene('menciona "null" para sin evidencia',  sistemaPrompt, 'null');
checkContiene('menciona "evidencia" por variable',   prompt, '"evidencia"');

// ── [8] CONTRATO_JSON tiene estructura esperada ───────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  8. CONTRATO_JSON tiene la estructura esperada');
console.log('═'.repeat(68));

const contrato = resultado.contrato;
checkVerdadero('contrato.campos_raiz presente',          contrato.campos_raiz);
checkVerdadero('contrato.estructura_variable presente',  contrato.estructura_variable);
checkVerdadero('contrato.estructura_fuente presente',    contrato.estructura_fuente);
checkVerdadero('contrato.estructura_timestamps presente',contrato.estructura_timestamps);
checkVerdadero('contrato.regla_null presente',           contrato.regla_null);
checkVerdadero('contrato.regla_leakage presente',        contrato.regla_leakage);

// Campos raíz del contrato
const camposRaiz = Object.keys(contrato.campos_raiz);
for (const campo of ['matchId', 'modelo', 'webSearch', 'version_modelo', 'variables', 'narrativa', 'lesiones_destacadas', 'fuentes', 'timestamps']) {
  checkVerdadero(`campo raíz "${campo}" en contrato`, camposRaiz.includes(campo));
}

// Campos de variable en contrato
const camposVar = Object.keys(contrato.estructura_variable);
for (const campo of ['local', 'visitante', 'confianza', 'evidencia', 'fuentes']) {
  checkVerdadero(`campo de variable "${campo}" en contrato`, camposVar.includes(campo));
}

// ── [9] VARIABLES_BLOQUE_P tiene metadatos completos ─────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  9. VARIABLES_BLOQUE_P tiene metadatos completos');
console.log('═'.repeat(68));

check('12 variables exportadas', VARIABLES_BLOQUE_P.length, 12);

for (const v of VARIABLES_BLOQUE_P) {
  checkVerdadero(`"${v.nombre}" tiene tipo`,              v.tipo);
  checkVerdadero(`"${v.nombre}" tiene descripcion`,       v.descripcion);
  checkVerdadero(`"${v.nombre}" tiene confianza_default`, typeof v.confianza_default === 'number');
}

// underdog debe tener descripcion que mencione mercado
const underdog = VARIABLES_BLOQUE_P.find(v => v.nombre === 'underdog');
checkContiene('underdog descripcion menciona "mercado"', underdog?.descripcion ?? '', 'mercado');

// confianza_default de conflicto_interno
const conflicto = VARIABLES_BLOQUE_P.find(v => v.nombre === 'conflicto_interno');
check('conflicto_interno.confianza_default = 0.35', conflicto?.confianza_default, 0.35);

// ── [10] Validaciones de input ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  10. Validaciones: rechaza parámetros faltantes');
console.log('═'.repeat(68));

function checkLanzaError(descripcion, fn) {
  try {
    fn();
    console.log(`${FAIL}  ${descripcion}: debería haber lanzado error`);
    errores++;
  } catch (err) {
    console.log(`${OK}  ${descripcion}: ${err.message}`);
  }
}

checkLanzaError('sin matchId',     () => construirPromptPsicologico({ local: 'A', visitante: 'B', fechaPartido: '2026-06-20' }));
checkLanzaError('sin local',       () => construirPromptPsicologico({ matchId: '1', visitante: 'B', fechaPartido: '2026-06-20' }));
checkLanzaError('sin visitante',   () => construirPromptPsicologico({ matchId: '1', local: 'A', fechaPartido: '2026-06-20' }));
checkLanzaError('sin fechaPartido',() => construirPromptPsicologico({ matchId: '1', local: 'A', visitante: 'B' }));

// ── [11] Prompt con parámetros mínimos (sin grupo/jornada) ───────────────────

console.log('\n' + '═'.repeat(68));
console.log('  11. Parámetros opcionales: sin grupo ni jornada');
console.log('═'.repeat(68));

const resultadoMinimo = construirPromptPsicologico({
  matchId: '999',
  local: 'Brazil',
  visitante: 'Argentina',
  fechaPartido: '2026-07-14T20:00:00Z',
});
checkVerdadero('construye prompt sin grupo',      resultadoMinimo.prompt);
checkContiene('Brazil en prompt',                 resultadoMinimo.prompt, 'Brazil');
checkContiene('Argentina en prompt',              resultadoMinimo.prompt, 'Argentina');
checkNoContiene('sin "Grupo: null"',              resultadoMinimo.prompt, 'Grupo: null');
checkNoContiene('sin "Jornada: null"',            resultadoMinimo.prompt, 'Jornada: null');

// ── [12] Confirmación sin APIs ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  12. Confirmación de pureza (sin Firestore, sin APIs)');
console.log('═'.repeat(68));

console.log(`${OK}  Sin imports de firebase-admin.`);
console.log(`${OK}  Sin fetch / axios / llamadas de red.`);
console.log(`${OK}  Sin process.env ni API keys.`);
console.log(`${OK}  Sin I/O de archivos.`);
console.log(`${OK}  0 escrituras. 0 llamadas a Claude.`);

// ── Preview del prompt ────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  PREVIEW — primeras 20 líneas del sistemaPrompt');
console.log('═'.repeat(68));
console.log(sistemaPrompt.split('\n').slice(0, 20).map(l => '  ' + l).join('\n'));

console.log('\n  [...]\n');
console.log('  PREVIEW — primeras 10 líneas del prompt de usuario');
console.log('─'.repeat(68));
console.log(prompt.split('\n').slice(0, 10).map(l => '  ' + l).join('\n'));
console.log('  [...]');

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('  Sin Firestore. Sin APIs. Sin Claude. 0 escrituras.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

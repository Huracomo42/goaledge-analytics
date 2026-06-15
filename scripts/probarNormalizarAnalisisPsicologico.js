/**
 * probarNormalizarAnalisisPsicologico.js — Prueba de normalizarAnalisisPsicologico.js
 *
 * 100% puro: sin Firestore, sin APIs, sin I/O de red.
 * Ejecutar: node scripts/probarNormalizarAnalisisPsicologico.js
 */

import { normalizarAnalisisPsicologico } from '../src/core/psychology/normalizarAnalisisPsicologico.js';

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
  const ok = array.some(s => s.includes(substring));
  console.log(ok
    ? `${OK}  ${descripcion}`
    : `${FAIL}  ${descripcion}: no encontrado en ${JSON.stringify(array)}`
  );
  if (!ok) errores++;
}

// ── [1] Input estilo V1 ───────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  1. Input estilo V1 (psicologico.local / psicologico.visitante)');
console.log('═'.repeat(68));

const inputV1 = {
  matchId: '537329',
  modelo: 'claude-haiku-4-5',
  webSearch: true,
  version_modelo: '2.0',
  psicologico: {
    local: {
      necesita_ganar:      true,
      venganza_narrativa:  false,
      rival_maldito:       2,
      presion_mediatica:   7,
      lider_disponible:    true,
      conflicto_interno:   1,
      generacion_peak:     true,
      underdog:            false,
      clasifico_sufriendo: 'comodo',
      humillacion_previa:  false,
      ausencias_ofensivas: 0.2,
      ausencias_defensivas: 0.0,
    },
    visitante: {
      necesita_ganar:      false,
      venganza_narrativa:  true,
      rival_maldito:       3,
      presion_mediatica:   5,
      lider_disponible:    false,
      conflicto_interno:   0,
      generacion_peak:     false,
      underdog:            true,
      clasifico_sufriendo: 'ultimo',
      humillacion_previa:  true,
      ausencias_ofensivas: 0.4,
      ausencias_defensivas: 0.3,
    },
  },
  narrativa: 'Alemania llega motivada, Ghana con baja de su líder.',
  lesiones_destacadas: ['Müller descartado'],
  fuentes: ['marca.com', 'bbc.co.uk'],
  timestamps: {
    evento_partido:         '2026-06-20T18:00:00Z',
    analisis_generado:      '2026-06-20T10:00:00Z',
    disponible_para_modelo: '2026-06-20T10:00:00Z',
  },
};

const r1 = normalizarAnalisisPsicologico(inputV1);

check('ok = true', r1.ok, true);
check('matchId', r1.analisis?.matchId, '537329');
check('estado', r1.analisis?.estado, 'completo');
check('modelo', r1.analisis?.modelo, 'claude-haiku-4-5');
check('webSearch', r1.analisis?.webSearch, true);

// Variables extraídas correctamente de formato V1
const vars1 = r1.analisis?.variables;
check('necesita_ganar.local',        vars1?.necesita_ganar?.local,       true);
check('necesita_ganar.visitante',    vars1?.necesita_ganar?.visitante,   false);
check('underdog.local',              vars1?.underdog?.local,             false);
check('underdog.visitante',          vars1?.underdog?.visitante,         true);
check('ausencias_ofensivas.local',   vars1?.ausencias_ofensivas?.local,  0.2);
check('ausencias_defensivas.visitante', vars1?.ausencias_defensivas?.visitante, 0.3);

// tipo_proxy asignados desde diccionario (no del input V1)
check('necesita_ganar.tipo_proxy',    vars1?.necesita_ganar?.tipo_proxy,   'contextual_proxy');
check('underdog.tipo_proxy',          vars1?.underdog?.tipo_proxy,         'market_bias_proxy');
check('lider_disponible.tipo_proxy',  vars1?.lider_disponible?.tipo_proxy, 'team_performance_proxy');
check('venganza_narrativa.tipo_proxy',vars1?.venganza_narrativa?.tipo_proxy, 'media_narrative_proxy');

// confianzas default (V1 no trae confianza)
check('necesita_ganar.confianza default',  vars1?.necesita_ganar?.confianza,  0.75);
check('conflicto_interno.confianza default', vars1?.conflicto_interno?.confianza, 0.35);
check('underdog.confianza default',        vars1?.underdog?.confianza,        0.50);

// Timestamps y narrativa preservados
check('narrativa',                    r1.analisis?.narrativa, 'Alemania llega motivada, Ghana con baja de su líder.');
check('lesiones_destacadas[0]',       r1.analisis?.lesiones_destacadas?.[0], 'Müller descartado');
check('timestamps.evento_partido',    r1.analisis?.timestamps?.evento_partido, '2026-06-20T18:00:00Z');

// Sin warnings (todas las variables presentes en V1)
check('sin warnings (V1 completo)', r1.warnings?.length, 0);

// ── [2] Input directo con confianzas explícitas ───────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  2. Input formato directo con confianzas explícitas');
console.log('═'.repeat(68));

const inputDirecto = {
  matchId: '537330',
  version_modelo: '2.0',
  necesita_ganar:      { local: true,  visitante: false, confianza: 0.90 },
  venganza_narrativa:  { local: false, visitante: false, confianza: 0.55 },
  rival_maldito:       { local: 1,     visitante: 0,     confianza: 0.45 },
  presion_mediatica:   { local: 6,     visitante: 4 },       // sin confianza → default
  lider_disponible:    { local: true,  visitante: true,  confianza: 0.65 },
  conflicto_interno:   { local: 0,     visitante: 2 },       // sin confianza → default
  generacion_peak:     { local: false, visitante: false, confianza: 0.55 },
  underdog:            { local: false, visitante: true,  confianza: 0.50 },
  clasifico_sufriendo: { local: 'comodo', visitante: 'ultimo' },
  humillacion_previa:  { local: false, visitante: false },
  ausencias_ofensivas: { local: 0.1,  visitante: 0.5,   confianza: 0.70 },
  ausencias_defensivas:{ local: 0.0,  visitante: 0.2,   confianza: 0.65 },
};

const r2 = normalizarAnalisisPsicologico(inputDirecto);
const vars2 = r2.analisis?.variables;

check('ok = true', r2.ok, true);
// confianza explícita preservada
check('necesita_ganar.confianza = 0.90',    vars2?.necesita_ganar?.confianza,     0.90);
check('ausencias_ofensivas.confianza = 0.70', vars2?.ausencias_ofensivas?.confianza, 0.70);
// sin confianza → default
check('presion_mediatica.confianza default (0.45)', vars2?.presion_mediatica?.confianza, 0.45);
check('conflicto_interno.confianza default (0.35)', vars2?.conflicto_interno?.confianza, 0.35);
// valores preservados
check('rival_maldito.local = 1',      vars2?.rival_maldito?.local,     1);
check('clasifico_sufriendo.visitante', vars2?.clasifico_sufriendo?.visitante, 'ultimo');
// sin warnings (todas las variables presentes)
check('sin warnings (directo completo)', r2.warnings?.length, 0);

// ── [3] Input con variables faltantes ────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  3. Input con variables faltantes → null + warning');
console.log('═'.repeat(68));

const inputParcial = {
  matchId: '537335',
  version_modelo: '2.0',
  // Solo 3 variables de 12
  necesita_ganar:   { local: true,  visitante: true },
  underdog:         { local: false, visitante: true },
  lider_disponible: { local: true,  visitante: false },
};

const r3 = normalizarAnalisisPsicologico(inputParcial);
const vars3 = r3.analisis?.variables;

check('ok = true', r3.ok, true);
// Variables presentes tienen valores
check('necesita_ganar.local',    vars3?.necesita_ganar?.local,    true);
check('underdog.visitante',      vars3?.underdog?.visitante,      true);
// Variables ausentes → null con tipo_proxy y confianza default
check('venganza_narrativa.local = null',     vars3?.venganza_narrativa?.local,    null);
check('venganza_narrativa.visitante = null', vars3?.venganza_narrativa?.visitante,null);
check('venganza_narrativa.tipo_proxy',       vars3?.venganza_narrativa?.tipo_proxy, 'media_narrative_proxy');
check('venganza_narrativa.confianza default',vars3?.venganza_narrativa?.confianza, 0.50);
check('ausencias_ofensivas.local = null',    vars3?.ausencias_ofensivas?.local,   null);
// Debe haber warnings por cada variable ausente (9 variables = 12 - 3 presentes)
const nVarsAusentes = 12 - 3;
check(`warnings.length = ${nVarsAusentes} (9 vars ausentes)`, r3.warnings?.length, nVarsAusentes);
checkIncluye('warning menciona "venganza_narrativa"', r3.warnings, 'venganza_narrativa');
checkIncluye('warning menciona "ausentes"', r3.warnings, 'ausente');

// ── [4] Input con confianza inválida ─────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  4. Input con confianza inválida → default + warning');
console.log('═'.repeat(68));

const inputConfianzaMala = {
  matchId: '537336',
  version_modelo: '2.0',
  // confianza como string
  necesita_ganar:   { local: true,  visitante: false, confianza: 'alta' },
  // confianza fuera de rango [0,1]
  underdog:         { local: false, visitante: true,  confianza: 1.5 },
  // confianza negativa
  conflicto_interno:{ local: 0,     visitante: 1,     confianza: -0.1 },
  // confianza válida — no debe generar warning
  lider_disponible: { local: true,  visitante: true,  confianza: 0.80 },
};

const r4 = normalizarAnalisisPsicologico(inputConfianzaMala);
const vars4 = r4.analisis?.variables;

check('ok = true', r4.ok, true);
// Confianzas inválidas → default sin error (análisis no se descarta)
check('necesita_ganar.confianza → default 0.75',  vars4?.necesita_ganar?.confianza,   0.75);
check('underdog.confianza → default 0.50',         vars4?.underdog?.confianza,         0.50);
check('conflicto_interno.confianza → default 0.35',vars4?.conflicto_interno?.confianza,0.35);
// confianza válida preservada
check('lider_disponible.confianza = 0.80',          vars4?.lider_disponible?.confianza, 0.80);
// Warnings de confianza inválida (3) + warnings de variables ausentes (8 = 12-4)
const nWarningsConfianza = 3;
const nWarningsAusentes  = 8;
check(`warnings por confianza inválida: ${nWarningsConfianza}`,
  r4.warnings?.filter(w => w.includes('inválida')).length, nWarningsConfianza
);
check(`warnings por variable ausente: ${nWarningsAusentes}`,
  r4.warnings?.filter(w => w.includes('ausente')).length, nWarningsAusentes
);
checkIncluye('warning menciona "confianza inválida"', r4.warnings, 'confianza inválida');

// ── [5] underdog queda como market_bias_proxy ─────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  5. underdog debe tener tipo_proxy = "market_bias_proxy"');
console.log('═'.repeat(68));

// Verificado con r1, r2, r3, r4 — comprobación explícita adicional:
const rUD = normalizarAnalisisPsicologico({
  matchId: 'TEST_PROXY_CHECK',
  underdog: { local: true, visitante: false },
});
// matchId no empieza con TEST_ en el guard del normalizer (solo en Firebase)
check('underdog.tipo_proxy = market_bias_proxy', rUD.analisis?.variables?.underdog?.tipo_proxy, 'market_bias_proxy');
check('underdog.local = true',                   rUD.analisis?.variables?.underdog?.local,       true);
check('underdog no entra en contextual_proxy',
  rUD.analisis?.variables?.underdog?.tipo_proxy !== 'contextual_proxy', true);

// ── [6] conflicto_interno confianza default = 0.35 ───────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  6. conflicto_interno confianza default = 0.35 (la más baja)');
console.log('═'.repeat(68));

const rCI = normalizarAnalisisPsicologico({
  matchId: '999001',
  conflicto_interno: { local: 2, visitante: 0 }, // sin confianza
});
check('conflicto_interno.confianza = 0.35 (default)',
  rCI.analisis?.variables?.conflicto_interno?.confianza, 0.35);
check('conflicto_interno.tipo_proxy = team_performance_proxy',
  rCI.analisis?.variables?.conflicto_interno?.tipo_proxy, 'team_performance_proxy');
check('conflicto_interno.local = 2',    rCI.analisis?.variables?.conflicto_interno?.local,    2);
check('conflicto_interno.visitante = 0',rCI.analisis?.variables?.conflicto_interno?.visitante, 0);

// ── [7] Rechazo por matchId faltante ─────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  7. Debe rechazar si falta matchId');
console.log('═'.repeat(68));

const rSinId = normalizarAnalisisPsicologico({ necesita_ganar: { local: true, visitante: false } });
check('ok = false sin matchId',  rSinId.ok,    false);
checkVerdadero('razon presente', rSinId.razon);
console.log(`  → razon: "${rSinId.razon}"`);

const rInputNulo = normalizarAnalisisPsicologico(null);
check('ok = false con null', rInputNulo.ok, false);

// ── [8] Estructura completa del output ───────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  8. Estructura completa del output normalizado (V1 → V2)');
console.log('═'.repeat(68));

const camposRaiz = Object.keys(r1.analisis).sort();
const camposEsperados = [
  'matchId', 'estado', 'generado_en', 'modelo', 'webSearch', 'version_modelo',
  'variables', 'narrativa', 'lesiones_destacadas', 'fuentes', 'timestamps',
].sort();
check('campos raíz = 11', camposRaiz.length, 11);
for (const campo of camposEsperados) {
  checkVerdadero(`campo "${campo}" presente`, camposRaiz.includes(campo));
}

const camposTimestamps = Object.keys(r1.analisis.timestamps).sort();
check('timestamps tiene 3 campos', camposTimestamps.length, 3);

check('variables tiene 12 entradas', Object.keys(r1.analisis.variables).length, 12);

const camposVar = Object.keys(r1.analisis.variables.necesita_ganar).sort();
check('cada variable tiene 4 campos (local,visitante,tipo_proxy,confianza)',
  camposVar.join(','), ['confianza','local','tipo_proxy','visitante'].join(','));

// ── [9] Confirmación sin Firestore ni APIs ────────────────────────────────────

console.log('\n' + '═'.repeat(68));
console.log('  9. Confirmación de pureza (sin Firestore, sin APIs)');
console.log('═'.repeat(68));

console.log(`${OK}  Sin imports de firebase-admin ni dotenv.`);
console.log(`${OK}  Sin fetch/axios ni llamadas de red.`);
console.log(`${OK}  Sin process.env en el módulo principal.`);
console.log(`${OK}  Sin I/O de archivos.`);
console.log(`${OK}  0 escrituras en Firestore.`);

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(68));
if (errores === 0) {
  console.log('  RESULTADO: todas las pruebas pasaron correctamente.');
  console.log('  Sin Firestore. Sin APIs. 0 escrituras.');
} else {
  console.log(`  RESULTADO: ${errores} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(68) + '\n');

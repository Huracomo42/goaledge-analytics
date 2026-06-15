/**
 * importarAnalisisPsicoDesdeMd.js
 *
 * Lee analisis_psicodeportivo_j1_restante_mundial_2026.md, extrae los bloques
 * JSON por equipo (local/visitante), construye documentos Firestore y los
 * guarda en analisis_psicologico/{matchId}.
 *
 * Modos:
 *   (sin flags) / --dry-run  — valida y muestra estructura, NO escribe Firestore
 *   --write                  — escribe en Firestore
 *   --write --force          — sobreescribe documentos existentes
 *
 * Restricciones:
 *   - NO usa Claude API.
 *   - NO consulta APIs externas.
 *   - NO modifica Prediction Engine, poisson.js, contextAdjustments.js.
 *   - NO recalibra ni modifica predicciones existentes.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import '../src/firebase/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MD_PATH   = path.join(__dirname, '..', 'analisis_psicodeportivo_j1_restante_mundial_2026.md');

// ── Argumentos ────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const WRITE   = args.includes('--write');
const DRY_RUN = !WRITE;
const FORCE   = args.includes('--force');

// ── Tablas del normalizer (fuente de verdad: normalizarAnalisisPsicologico.js) ─

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

// Campos del MD → nombre engine (3 renombrados, 4 iguales)
const MD_A_ENGINE = {
  ausencias_ofensivas:  'ausencias_ofensivas',
  ausencias_defensivas: 'ausencias_defensivas',
  liderazgo:            'lider_disponible',
  conflicto_interno:    'conflicto_interno',
  presion:              'presion_mediatica',
  generacion_dorada:    'generacion_peak',
  necesita_ganar:       'necesita_ganar',
};

const MD_CAMPOS = Object.keys(MD_A_ENGINE);

// ── Parser MD ─────────────────────────────────────────────────────────────────

function parsearMd(contenido) {
  const bloques = [];
  const re = /```json\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(contenido)) !== null) {
    try {
      bloques.push(JSON.parse(m[1]));
    } catch (e) {
      console.warn(`  WARN: bloque JSON inválido en posición ${m.index}: ${e.message}`);
    }
  }
  return bloques;
}

// ── Validación ────────────────────────────────────────────────────────────────

function validarBloque(bloque) {
  const errores = [];
  if (!bloque.matchId) errores.push('falta matchId');
  if (!bloque.equipo)  errores.push('falta equipo');
  if (!bloque.rol || !['local', 'visitante'].includes(bloque.rol))
    errores.push(`rol inválido: "${bloque.rol}"`);
  if (!bloque.variables || typeof bloque.variables !== 'object')
    errores.push('falta campo variables');
  else {
    const ausentes = MD_CAMPOS.filter(c => bloque.variables[c] == null);
    if (ausentes.length > 0) errores.push(`variables ausentes: ${ausentes.join(', ')}`);
  }
  return errores;
}

// ── Construcción del documento ────────────────────────────────────────────────

function round3(n) { return Math.round(n * 1000) / 1000; }

function buildDoc(matchId, localBlk, visitanteBlk) {
  const variables = {};

  // 1. Variables presentes en el MD (con mapping de nombres al engine)
  for (const mdCampo of MD_CAMPOS) {
    const engineCampo = MD_A_ENGINE[mdCampo];
    const lv = localBlk.variables?.[mdCampo];
    const vv = visitanteBlk.variables?.[mdCampo];

    const localVal  = lv?.valor     ?? null;
    const visitVal  = vv?.valor     ?? null;
    const localConf = typeof lv?.confianza === 'number' ? lv.confianza : null;
    const visitConf = typeof vv?.confianza === 'number' ? vv.confianza : null;

    // Confianza compartida = promedio de ambos equipos
    let confianza;
    if (localConf !== null && visitConf !== null) {
      confianza = round3((localConf + visitConf) / 2);
    } else {
      confianza = localConf ?? visitConf ?? CONFIANZA_DEFAULT[engineCampo];
    }

    variables[engineCampo] = {
      local:      localVal,
      visitante:  visitVal,
      tipo_proxy: TIPO_PROXY[engineCampo],
      confianza,
    };
  }

  // 2. Variables del normalizer ausentes en el MD → null + defaults
  for (const engineCampo of Object.keys(TIPO_PROXY)) {
    if (!variables[engineCampo]) {
      variables[engineCampo] = {
        local:      null,
        visitante:  null,
        tipo_proxy: TIPO_PROXY[engineCampo],
        confianza:  CONFIANZA_DEFAULT[engineCampo],
      };
    }
  }

  // 3. Datos ricos por equipo (nombres de campo originales del MD)
  const equipos = {
    local: {
      nombre:                localBlk.equipo,
      variables:             localBlk.variables      ?? {},
      narrativa_psicologica: localBlk.narrativa_psicologica ?? null,
      alertas:               localBlk.alertas         ?? [],
      fuentes:               localBlk.fuentes         ?? [],
    },
    visitante: {
      nombre:                visitanteBlk.equipo,
      variables:             visitanteBlk.variables   ?? {},
      narrativa_psicologica: visitanteBlk.narrativa_psicologica ?? null,
      alertas:               visitanteBlk.alertas     ?? [],
      fuentes:               visitanteBlk.fuentes     ?? [],
    },
  };

  return {
    matchId:            String(matchId),
    variables,
    equipos,
    fuente:             'md_psicodeportivo_manual',
    generado_por:       'chatgpt_web_externo',
    version_estructura: 'psico-md-v1',
    listo_para_modelo:  true,
    // importado_en se añade al escribir (FieldValue.serverTimestamp())
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  IMPORTAR ANÁLISIS PSICODEPORTIVO DESDE MD');
console.log(`  Modo     : ${DRY_RUN ? 'DRY-RUN (sin escrituras Firestore)' : 'WRITE'}`);
if (!DRY_RUN && FORCE) console.log('  FORCE    : sobreescribirá documentos existentes');
console.log(`  Archivo  : ${path.basename(MD_PATH)}`);
console.log('═'.repeat(76));

// 1. Leer MD
if (!fs.existsSync(MD_PATH)) {
  console.error(`\n  ERROR: no encontré el archivo MD en:\n    ${MD_PATH}`);
  process.exit(1);
}

const contenido = fs.readFileSync(MD_PATH, 'utf8');
const bloques   = parsearMd(contenido);
console.log(`\n  Bloques JSON extraídos: ${bloques.length}`);

// 2. Validar y agrupar por matchId
const porMatchId     = new Map();
const erroresBloque  = [];

for (const bloque of bloques) {
  const matchId = String(bloque.matchId ?? '(sin matchId)');
  const errores = validarBloque(bloque);

  if (errores.length > 0) {
    erroresBloque.push({ matchId, equipo: bloque.equipo ?? '?', errores });
    continue;
  }

  if (!porMatchId.has(matchId)) porMatchId.set(matchId, {});
  const grupo = porMatchId.get(matchId);

  if (bloque.rol === 'local') {
    if (grupo.local) erroresBloque.push({ matchId, equipo: bloque.equipo, errores: ['bloque local duplicado'] });
    else grupo.local = bloque;
  } else {
    if (grupo.visitante) erroresBloque.push({ matchId, equipo: bloque.equipo, errores: ['bloque visitante duplicado'] });
    else grupo.visitante = bloque;
  }
}

// 3. Clasificar en completos / incompletos
const completos   = [];
const incompletos = [];

for (const [matchId, grupo] of porMatchId) {
  if (grupo.local && grupo.visitante) {
    completos.push({ matchId, grupo });
  } else {
    incompletos.push({ matchId, falta: !grupo.local ? 'bloque local' : 'bloque visitante' });
  }
}

// 4. Reportar problemas
if (erroresBloque.length > 0) {
  console.log('\n  ERRORES DE VALIDACIÓN:');
  for (const e of erroresBloque) {
    console.log(`    ${e.matchId} (${e.equipo}): ${e.errores.join(', ')}`);
  }
}

if (incompletos.length > 0) {
  console.log('\n  PARTIDOS INCOMPLETOS:');
  for (const i of incompletos) {
    console.log(`    ${i.matchId}: falta ${i.falta}`);
  }
}

console.log(`\n  Partidos completos : ${completos.length}`);
console.log(`  Partidos con error : ${erroresBloque.length + incompletos.length}`);

if (completos.length === 0) {
  console.log('\n  Nada para importar. Saliendo.');
  process.exit(erroresBloque.length > 0 ? 1 : 0);
}

// 5. Construir documentos y mostrar
console.log('\n' + '─'.repeat(76));
console.log('  DOCUMENTOS — analisis_psicologico/{matchId}');
console.log('─'.repeat(76));

const documentos = [];

for (const { matchId, grupo } of completos) {
  const doc    = buildDoc(matchId, grupo.local, grupo.visitante);
  const titulo = `${grupo.local.equipo} vs ${grupo.visitante.equipo}`;

  documentos.push({ matchId, doc, titulo });

  console.log(`\n  ${matchId}  ${titulo}`);

  // Tabla de variables engine
  if (matchId === completos[0].matchId) {
    // Primer partido: tabla completa
    console.log('\n  variables (para motor — engine field names):');
    console.log('  ' + '─'.repeat(74));
    console.log('  campo                   local  visitante  confianza  tipo_proxy');
    console.log('  ' + '─'.repeat(74));
    for (const [campo, v] of Object.entries(doc.variables)) {
      const lStr = v.local      !== null ? String(v.local).padStart(5) : ' null';
      const vStr = v.visitante  !== null ? String(v.visitante).padStart(9) : '     null';
      console.log(
        `  ${campo.padEnd(22)}  ${lStr}  ${vStr}    ${String(v.confianza.toFixed(3)).padStart(7)}  ${v.tipo_proxy}`
      );
    }
    console.log('  ' + '─'.repeat(74));

    console.log('\n  equipos.local.variables (nombres originales MD):');
    for (const [k, vobj] of Object.entries(doc.equipos.local.variables)) {
      console.log(`    ${k.padEnd(22)} valor=${String(vobj.valor ?? 'null').padStart(4)}  confianza=${vobj.confianza}`);
    }

    console.log('\n  (resto de partidos — resumen de variables MD únicamente)');
  } else {
    // Resumen de variables con valores no nulos
    const lineas = MD_CAMPOS.map(mdCampo => {
      const engineCampo = MD_A_ENGINE[mdCampo];
      const v = doc.variables[engineCampo];
      return `${mdCampo}→${engineCampo}(L=${v.local} V=${v.visitante} c=${v.confianza.toFixed(2)})`;
    });
    // Dos por línea
    for (let i = 0; i < lineas.length; i += 2) {
      console.log(`    ${lineas[i]}  ${lineas[i + 1] ?? ''}`);
    }
  }
}

// 6. Estructura resumida del documento
console.log('\n' + '─'.repeat(76));
console.log('  ESTRUCTURA FINAL DEL DOCUMENTO FIRESTORE');
console.log('─'.repeat(76));
console.log(`
  analisis_psicologico/{matchId}:
    matchId              : string
    listo_para_modelo    : true
    version_estructura   : "psico-md-v1"
    fuente               : "md_psicodeportivo_manual"
    generado_por         : "chatgpt_web_externo"
    importado_en         : FieldValue.serverTimestamp()
    variables:
      {engine_campo}:
        local            : number | null   ← valor del equipo local
        visitante        : number | null   ← valor del equipo visitante
        confianza        : number          ← promedio(local.conf, visitante.conf)
        tipo_proxy       : string          ← del normalizer
    equipos:
      local:
        nombre           : string
        variables:
          {md_campo}:
            valor        : number
            confianza    : number
            justificacion: string
        narrativa_psicologica: string
        alertas          : string[]
        fuentes          : [{nombre, url}]
      visitante:         ← misma estructura
`);

// 7. Terminar si es dry-run
if (DRY_RUN) {
  console.log('═'.repeat(76));
  console.log(`  DRY-RUN completado — ${documentos.length} documentos listos`);
  console.log('');
  console.log('  Para escribir en Firestore:');
  console.log('    node scripts/importarAnalisisPsicoDesdeMd.js --write');
  console.log('    node scripts/importarAnalisisPsicoDesdeMd.js --write --force');
  console.log('═'.repeat(76));
  process.exit(0);
}

// 8. Escribir en Firestore
console.log('─'.repeat(76));
console.log(`  ESCRIBIENDO EN FIRESTORE (force=${FORCE})`);
console.log('─'.repeat(76));

const db = getFirestore();
let escritos = 0, omitidos = 0, erroresEscritura = 0;

for (const { matchId, doc, titulo } of documentos) {
  try {
    const ref  = db.collection('analisis_psicologico').doc(matchId);
    const snap = await ref.get();

    if (snap.exists && !FORCE) {
      console.log(`  SKIP      ${matchId}  ${titulo}  (ya existe — usa --force para sobreescribir)`);
      omitidos++;
      continue;
    }

    const docConTimestamp = { ...doc, importado_en: FieldValue.serverTimestamp() };
    await ref.set(docConTimestamp);

    const accion = snap.exists ? 'OVERWRITE' : 'WRITE';
    console.log(`  ${accion.padEnd(9)} ${matchId}  ${titulo}`);
    escritos++;
  } catch (err) {
    console.error(`  ERROR     ${matchId}: ${err.message}`);
    erroresEscritura++;
  }
}

// 9. Resumen
console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN ESCRITURA');
console.log(`    Escritos    : ${escritos}`);
console.log(`    Omitidos    : ${omitidos}  (ya existían, sin --force)`);
console.log(`    Errores     : ${erroresEscritura}`);
if (escritos > 0) {
  console.log('\n  Para verificar:');
  console.log('    node scripts/verificarAnalisisPsicologicoJ1Restante.js');
}
console.log('═'.repeat(76));

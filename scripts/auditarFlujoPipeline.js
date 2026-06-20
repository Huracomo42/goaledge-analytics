/**
 * auditarFlujoPipeline.js — Verifica que el pipeline esté unificado post-J1.
 *
 * Escanea todos los scripts/ para detectar:
 *   1. Imports directos de signalFilters.js (deben venir de recommendationPolicy.js)
 *   2. Llamadas a filtrarSenalesApuesta() (legacy, solo aceptada en testSignalFiltersJ1.js)
 *   3. Scripts que no están en DEPRECATED_SCRIPTS pero usan la ruta legacy
 *   4. Confirma que el OFFICIAL_PIPELINE existe y no está deprecado
 *
 * No modifica nada. Solo reporta.
 *
 * Uso:
 *   node scripts/auditarFlujoPipeline.js
 *   node scripts/auditarFlujoPipeline.js --json   → salida JSON a reports/
 */

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, relative } from 'path';
import process from 'process';

import {
  OFFICIAL_PIPELINE,
  DEPRECATED_SCRIPTS,
  POLICY_VERSION,
} from '../src/core/betting/recommendationPolicy.js';

const SCRIPTS_DIR    = resolve('scripts');
const SRC_DIR        = resolve('src');
const PROJECT_ROOT   = resolve('.');
const OUTPUT_JSON    = process.argv.includes('--json');

// Archivos con permiso explícito para mencionar/usar filtrarSenalesApuesta:
//   signalFilters.js      → define la función (fuente canónica)
//   recommendationPolicy.js → re-exporta intencionalmente como legacy
//   generarRecomendacionesJ2Filtradas.js → deprecado, ya atrapado por DEPRECATED_SCRIPTS check
//   explorarSeñalesProtegidасJ2.js → script diagnóstico (mentions en console.log, no llamadas)
//   auditarFlujoPipeline.js → este mismo script (menciona el nombre en strings de auditoría)
const LEGACY_WHITELIST = new Set([
  'scripts/testSignalFiltersJ1.js',
  'src/core/betting/signalFilters.js',
  'src/core/betting/recommendationPolicy.js',
  'scripts/generarRecomendacionesJ2Filtradas.js',
  'scripts/explorarSeñalesProtegidасJ2.js',
  'scripts/auditarFlujoPipeline.js',
]);

// Archivos que mencionan scripts deprecados de forma intencional (no son dependencias)
const DEPRECATED_REF_WHITELIST = new Set([
  'src/core/betting/recommendationPolicy.js',  // define DEPRECATED_SCRIPTS
  'scripts/auditarFlujoPipeline.js',            // este script
]);

// ── Recopilar todos los .js del proyecto ──────────────────────────────────────

function walkJs(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Saltar node_modules y .git
      if (entry === 'node_modules' || entry === '.git') continue;
      walkJs(full, files);
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = [
  ...walkJs(SCRIPTS_DIR),
  ...walkJs(SRC_DIR),
];

// ── Análisis por archivo ───────────────────────────────────────────────────────

const issues  = [];   // problemas reales
const notices = [];   // solo informativos
const ok      = [];   // confirmaciones positivas

for (const filePath of allFiles) {
  const rel     = relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  let   content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    issues.push({ severity: 'ERROR', file: rel, mensaje: 'No se pudo leer el archivo' });
    continue;
  }

  const lines = content.split('\n');

  // ── Cheque 1: imports directos de signalFilters.js ──────────────────────────
  const directImports = lines
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) =>
      line.startsWith('import') && line.includes('signalFilters.js') &&
      !line.includes('recommendationPolicy.js')
    );

  if (directImports.length > 0) {
    for (const { line, n } of directImports) {
      issues.push({
        severity: 'WARN',
        file:     rel,
        linea:    n,
        mensaje:  `Import directo de signalFilters.js — cambiar a recommendationPolicy.js`,
        detalle:  line,
      });
    }
  }

  // ── Cheque 2: llamadas a filtrarSenalesApuesta ───────────────────────────────
  const legacyCalls = lines
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.includes('filtrarSenalesApuesta') && !line.startsWith('//') && !line.startsWith('*'));

  if (legacyCalls.length > 0) {
    const allowed = LEGACY_WHITELIST.has(rel);
    for (const { line, n } of legacyCalls) {
      if (allowed) {
        notices.push({
          severity: 'WHITELIST',
          file:     rel,
          linea:    n,
          mensaje:  `filtrarSenalesApuesta() — whitelist OK (script histórico)`,
          detalle:  line,
        });
      } else {
        issues.push({
          severity: 'ERROR',
          file:     rel,
          linea:    n,
          mensaje:  `filtrarSenalesApuesta() fuera de whitelist — usar clasificarSenales()`,
          detalle:  line,
        });
      }
    }
  }

  // ── Cheque 3: scripts deprecados llamados desde otros scripts ────────────────
  if (!DEPRECATED_REF_WHITELIST.has(rel)) {
    for (const dep of DEPRECATED_SCRIPTS) {
      const depBasename = dep.script.replace(/^scripts\//, '');
      if (content.includes(depBasename) && rel !== dep.script) {
        issues.push({
          severity: 'WARN',
          file:     rel,
          mensaje:  `Referencia a script deprecado: ${dep.script}`,
          detalle:  dep.razon,
        });
      }
    }
  }
}

// ── Cheque 3b: generarCombinadasValor.js tiene política OFF_BY_DEFAULT ───────

const comboScriptPath = resolve('scripts/generarCombinadasValor.js');
if (existsSync(comboScriptPath)) {
  const comboContent = readFileSync(comboScriptPath, 'utf-8');

  // Debe tener los tres flags
  const missingFlags = [];
  if (!comboContent.includes('--include-conservadoras')) missingFlags.push('--include-conservadoras');
  if (!comboContent.includes('--include-moderadas'))     missingFlags.push('--include-moderadas');
  if (!comboContent.includes('--include-especulativas')) missingFlags.push('--include-especulativas');

  if (missingFlags.length > 0) {
    issues.push({
      severity: 'ERROR',
      file:     'scripts/generarCombinadasValor.js',
      mensaje:  `Faltan flags en generarCombinadasValor.js: ${missingFlags.join(', ')}`,
    });
  } else {
    ok.push({ check: 'COMBO_FLAGS', mensaje: 'generarCombinadasValor.js tiene los 3 flags de activación explícita' });
  }

  // Verificar que las conservadoras no están activas por defecto
  // (INCLUDE_CONSERVADORAS debe asignarse con args.includes(), no con true)
  const defaultOnPattern = /INCLUDE_CONSERVADORAS\s*=\s*true/;
  if (defaultOnPattern.test(comboContent)) {
    issues.push({
      severity: 'ERROR',
      file:     'scripts/generarCombinadasValor.js',
      mensaje:  'INCLUDE_CONSERVADORAS está hardcodeada como true — debe ser false por defecto',
    });
  } else {
    ok.push({ check: 'COMBO_OFF_BY_DEFAULT', mensaje: 'generarCombinadasValor.js: ninguna categoría activa por defecto ✓' });
  }

  // Verificar que COMBINADAS_POLICY en recommendationPolicy tiene conservadoras OFF
  const _policyFile   = resolve('src/core/betting/recommendationPolicy.js');
  const policyContent = existsSync(_policyFile) ? readFileSync(_policyFile, 'utf-8') : '';
  if (policyContent.includes('conservadoras') && policyContent.includes('defaultEnabled: false')) {
    ok.push({ check: 'POLICY_COMBO_OFF', mensaje: 'recommendationPolicy.js: conservadoras.defaultEnabled = false ✓' });
  } else {
    issues.push({
      severity: 'WARN',
      file:     'src/core/betting/recommendationPolicy.js',
      mensaje:  'COMBINADAS_POLICY.conservadoras.defaultEnabled no es false — verificar',
    });
  }
}

// ── Cheque 4: pipeline oficial existe ────────────────────────────────────────

const officialPath = resolve(OFFICIAL_PIPELINE);
if (existsSync(officialPath)) {
  ok.push({ check: 'OFFICIAL_PIPELINE', mensaje: `Existe: ${OFFICIAL_PIPELINE}` });
} else {
  issues.push({
    severity: 'ERROR',
    file:     OFFICIAL_PIPELINE,
    mensaje:  'Pipeline oficial NO existe en disco',
  });
}

// ── Cheque 5: scripts deprecados tienen su guardia de salida ─────────────────

for (const dep of DEPRECATED_SCRIPTS) {
  const depPath = resolve(dep.script);
  if (!existsSync(depPath)) {
    notices.push({ severity: 'INFO', file: dep.script, mensaje: 'Archivo deprecado ya no existe (OK, eliminado)' });
    continue;
  }
  const content = readFileSync(depPath, 'utf-8');
  if (content.includes('--force-deprecated') && content.includes('process.exit(1)')) {
    ok.push({ check: 'DEPRECATED_GUARD', mensaje: `${dep.script} tiene guardia process.exit(1) ✓` });
  } else {
    issues.push({
      severity: 'WARN',
      file:     dep.script,
      mensaje:  'Script deprecado NO tiene guardia de salida. Añadir header con process.exit(1).',
    });
  }
}

// ── Cheque 6: recommendationPolicy.js existe ─────────────────────────────────

const policyPath = resolve('src/core/betting/recommendationPolicy.js');
if (existsSync(policyPath)) {
  ok.push({ check: 'POLICY_FILE', mensaje: `recommendationPolicy.js existe (${POLICY_VERSION})` });
} else {
  issues.push({
    severity: 'ERROR',
    file:     'src/core/betting/recommendationPolicy.js',
    mensaje:  'recommendationPolicy.js NO existe',
  });
}

// ── Imprimir reporte ──────────────────────────────────────────────────────────

const ERRORS  = issues.filter(i => i.severity === 'ERROR');
const WARNS   = issues.filter(i => i.severity === 'WARN');

console.log('\n' + '═'.repeat(76));
console.log(`  auditarFlujoPipeline — GoalEdge Analytics ${POLICY_VERSION}`);
console.log('═'.repeat(76));

console.log(`\n  Archivos escaneados : ${allFiles.length}`);
console.log(`  ✓ Cheques OK        : ${ok.length}`);
console.log(`  ⚠ Warnings          : ${WARNS.length}`);
console.log(`  ✗ Errores           : ${ERRORS.length}`);
console.log(`  ℹ Whitelist/info    : ${notices.length}`);

if (ok.length > 0) {
  console.log('\n── CHEQUES PASADOS ─────────────────────────────────────────────────────────');
  for (const c of ok) {
    console.log(`  ✓ [${c.check}] ${c.mensaje}`);
  }
}

if (WARNS.length > 0) {
  console.log('\n── WARNINGS ────────────────────────────────────────────────────────────────');
  for (const w of WARNS) {
    const loc = w.linea ? `:${w.linea}` : '';
    console.log(`  ⚠ ${w.file}${loc}`);
    console.log(`    ${w.mensaje}`);
    if (w.detalle) console.log(`    → ${w.detalle}`);
  }
}

if (ERRORS.length > 0) {
  console.log('\n── ERRORES ─────────────────────────────────────────────────────────────────');
  for (const e of ERRORS) {
    const loc = e.linea ? `:${e.linea}` : '';
    console.log(`  ✗ ${e.file}${loc}`);
    console.log(`    ${e.mensaje}`);
    if (e.detalle) console.log(`    → ${e.detalle}`);
  }
}

if (notices.length > 0) {
  console.log('\n── INFORMATIVO ─────────────────────────────────────────────────────────────');
  for (const n of notices) {
    const loc = n.linea ? `:${n.linea}` : '';
    console.log(`  ℹ [${n.severity}] ${n.file}${loc}: ${n.mensaje}`);
    if (n.detalle) console.log(`    → ${n.detalle}`);
  }
}

const STATUS = ERRORS.length > 0 ? 'FAIL' : WARNS.length > 0 ? 'WARN' : 'PASS';
console.log('\n' + '═'.repeat(76));
console.log(`  Estado final: ${STATUS}`);
console.log('═'.repeat(76) + '\n');

// ── Guardar JSON ──────────────────────────────────────────────────────────────

if (OUTPUT_JSON) {
  const ts        = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const reportsDir = resolve('reports');
  mkdirSync(reportsDir, { recursive: true });
  const outPath   = join(reportsDir, `auditoria_pipeline_${ts}.json`);
  writeFileSync(outPath, JSON.stringify({
    generado_en:       new Date().toISOString(),
    policy_version:    POLICY_VERSION,
    official_pipeline: OFFICIAL_PIPELINE,
    deprecated_scripts: DEPRECATED_SCRIPTS,
    archivos_escaneados: allFiles.length,
    status:            STATUS,
    ok,
    warnings:          WARNS,
    errors:            ERRORS,
    notices,
  }, null, 2), 'utf-8');
  console.log(`  Reporte JSON: ${outPath}\n`);
}

process.exit(ERRORS.length > 0 ? 1 : 0);

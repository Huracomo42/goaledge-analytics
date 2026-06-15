/**
 * registrarResultadosJ1.js — Registro manual de resultados de J1 en Firestore.
 *
 * Workflow:
 *   1. node scripts/registrarResultadosJ1.js          → muestra fixture J1 con matchIds
 *   2. Editar data/resultados_j1.json con scores
 *   3. node scripts/registrarResultadosJ1.js --dry-run → preview
 *   4. node scripts/registrarResultadosJ1.js --write   → escribe en Firestore
 *
 * Flags:
 *   (sin flags)   Muestra fixture J1 (matchIds + equipos + status). Sin Firestore.
 *   --dry-run     Lee data/resultados_j1.json y muestra lo que escribiría.
 *   --write       Escribe en resultados/{matchId} vía guardarResultado().
 *   --force       Con --write, sobreescribe documentos existentes.
 *
 * Formato de data/resultados_j1.json:
 *   [
 *     {
 *       "matchId": 537329,
 *       "goles_local": 2,
 *       "goles_visitante": 0,
 *       "xg_local_real": null,
 *       "xg_visitante_real": null
 *     },
 *     ...
 *   ]
 *
 * GARANTÍAS:
 *   - Sin flags: 0 escrituras Firestore, solo llama fixture API.
 *   - --dry-run: 0 escrituras Firestore.
 *   - --write sin --force: salta matchIds que ya existen en resultados/.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve }                  from 'path';

import { getFirestore }                     from 'firebase-admin/firestore';
import '../src/firebase/init.js';
import { obtenerPartidosMundial }           from '../src/data/pipeline/footballData.js';
import { guardarResultado, leerResultado }  from '../src/firebase/resultados.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const MODO_WRITE = args.includes('--write');
const MODO_DRY   = args.includes('--dry-run');
const MODO_FORCE = args.includes('--force');
const MODO_LIST  = !MODO_WRITE && !MODO_DRY;   // default cuando no hay otros flags

const RESULTADOS_PATH = resolve('data/resultados_j1.json');

// ── Helper derivados (mirror de resultados.js, para preview en dry-run) ───────

function derivar(gl, gv) {
  const total = gl + gv;
  return {
    resultado_1x2: gl > gv ? 'local' : gl === gv ? 'empate' : 'visitante',
    total_goles:   total,
    over_under_result: {
      '1.5': total > 1.5 ? 'over' : 'under',
      '2.5': total > 2.5 ? 'over' : 'under',
      '3.5': total > 3.5 ? 'over' : 'under',
      '4.5': total > 4.5 ? 'over' : 'under',
    },
    btts_result: gl > 0 && gv > 0,
  };
}

// ── MODO LIST (default) ───────────────────────────────────────────────────────

if (MODO_LIST) {
  console.log('\n' + '═'.repeat(72));
  console.log('  J1 — Fixture (rellena data/resultados_j1.json con estos matchIds)');
  console.log('  [football-data: SOLO fixture y matchIds — scores NO se toman de ahí]');
  console.log('═'.repeat(72));

  const todos = await obtenerPartidosMundial();
  const j1 = todos
    .filter(p => p.matchday === 1)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  console.log(`\n  ${j1.length} partidos J1:\n`);
  console.log(`  ${''.padEnd(2)} ${'matchId'.padEnd(10)} ${'Fecha UTC'.padEnd(11)} ${'Status'.padEnd(12)} Partido`);
  console.log(`  ${'-'.repeat(70)}`);

  for (const p of j1) {
    const estado = p.status ?? '?';
    const fecha  = p.utcDate?.slice(0, 10) ?? '?';
    const nombre = `${p.homeTeam?.name} vs ${p.awayTeam?.name}`;
    const icono  = estado === 'FINISHED' ? '✓' : '·';
    console.log(`  ${icono} ${String(p.id).padEnd(10)} ${fecha.padEnd(11)} ${estado.padEnd(12)} ${nombre}`);
  }

  const terminados = j1.filter(p => p.status === 'FINISHED').length;
  console.log(`\n  Total: ${j1.length}   FINISHED: ${terminados}   Pendientes: ${j1.length - terminados}`);

  console.log(`
  Copia los matchIds de los FINISHED y edita data/resultados_j1.json:
  [
    { "matchId": <ID>, "goles_local": X, "goles_visitante": Y, "xg_local_real": null, "xg_visitante_real": null },
    ...
  ]

  Luego:  node scripts/registrarResultadosJ1.js --dry-run
          node scripts/registrarResultadosJ1.js --write
`);
  process.exit(0);
}

// ── Leer y validar data/resultados_j1.json ────────────────────────────────────

if (!existsSync(RESULTADOS_PATH)) {
  console.error('\nERROR: data/resultados_j1.json no existe.');
  console.error('Ejecuta sin flags para ver el fixture J1 con los matchIds.\n');
  process.exit(1);
}

let entradas;
try {
  entradas = JSON.parse(readFileSync(RESULTADOS_PATH, 'utf-8'));
} catch (err) {
  console.error(`\nERROR: No se puede parsear data/resultados_j1.json: ${err.message}\n`);
  process.exit(1);
}

if (!Array.isArray(entradas) || entradas.length === 0) {
  console.error('\nERROR: data/resultados_j1.json debe ser un array no vacío.');
  console.error('Ejecuta sin flags para ver el fixture J1 y llena el archivo.\n');
  process.exit(1);
}

// Validación de campos mínimos
const errores = [];
for (let i = 0; i < entradas.length; i++) {
  const e = entradas[i];
  if (typeof e.matchId !== 'number' || e.matchId <= 0) {
    errores.push(`[${i}] matchId debe ser número positivo`);
  }
  if (!Number.isInteger(e.goles_local) || e.goles_local < 0) {
    errores.push(`[${i}] goles_local debe ser entero >= 0`);
  }
  if (!Number.isInteger(e.goles_visitante) || e.goles_visitante < 0) {
    errores.push(`[${i}] goles_visitante debe ser entero >= 0`);
  }
}

if (errores.length > 0) {
  console.error('\nERROR: data/resultados_j1.json inválido:');
  for (const e of errores) console.error(`  ${e}`);
  process.exit(1);
}

// Verificar matchIds duplicados en el JSON
const matchIdsSeen = new Set();
for (const e of entradas) {
  if (matchIdsSeen.has(e.matchId)) {
    console.error(`\nERROR: matchId ${e.matchId} duplicado en data/resultados_j1.json\n`);
    process.exit(1);
  }
  matchIdsSeen.add(e.matchId);
}

// ── Enriquecer con nombres desde fixture ──────────────────────────────────────
// football-data se usa SOLO para obtener matchIds y nombres de equipo del fixture J1.
// Los scores provienen exclusivamente de data/resultados_j1.json.

console.log('  [football-data: SOLO fixture y matchIds — scores vienen de data/resultados_j1.json]\n');

const todos      = await obtenerPartidosMundial();
const j1ByMatchId = Object.fromEntries(
  todos.filter(p => p.matchday === 1).map(p => [String(p.id), p])
);

const db = getFirestore();

// ── Procesar cada entrada ─────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log(MODO_WRITE
  ? `  J1 — Registrando resultados en Firestore${MODO_FORCE ? ' (--force)' : ''}`
  : '  J1 — Dry-run (preview, sin escrituras)');
console.log('═'.repeat(72) + '\n');

let escritos = 0, omitidos = 0, errores_escritura = 0;

for (const entrada of entradas) {
  const matchId = String(entrada.matchId);
  const partido = j1ByMatchId[matchId];

  if (!partido) {
    console.warn(`  WARN: ${matchId} no está en el fixture J1 — omitido`);
    omitidos++;
    continue;
  }

  const nombrePartido = `${partido.homeTeam?.name} vs ${partido.awayTeam?.name}`;
  const der = derivar(entrada.goles_local, entrada.goles_visitante);

  console.log(`  → ${matchId}  ${nombrePartido}`);
  console.log(`    Score   : ${entrada.goles_local} - ${entrada.goles_visitante}`);
  console.log(`    1X2     : ${der.resultado_1x2}   total: ${der.total_goles}   BTTS: ${der.btts_result}   OU2.5: ${der.over_under_result['2.5']}`);
  if (entrada.xg_local_real != null || entrada.xg_visitante_real != null) {
    console.log(`    xG      : local=${entrada.xg_local_real}  visitante=${entrada.xg_visitante_real}`);
  }

  // Verificar si existe predicción previa (informativo, no bloquea la escritura)
  const snapPred = await db.collection('predicciones').doc(matchId).get();
  if (!snapPred.exists) {
    console.log(`    AVISO   : no existe predicciones/${matchId} — resultado se registrará sin predicción para auditar`);
  }

  if (MODO_WRITE) {
    if (!MODO_FORCE) {
      const existente = await leerResultado(matchId);
      if (existente) {
        console.log(`    SKIP    : ya existe en resultados/${matchId} (usa --force para sobreescribir)`);
        omitidos++;
        console.log('');
        continue;
      }
    }

    try {
      await guardarResultado(matchId, {
        goles_local:        entrada.goles_local,
        goles_visitante:    entrada.goles_visitante,
        xg_local_real:      entrada.xg_local_real     ?? null,
        xg_visitante_real:  entrada.xg_visitante_real ?? null,
        fuente:             'manual',
        terminado:          true,
      });
      console.log(`    GUARDADO ✓`);
      escritos++;
    } catch (err) {
      console.error(`    ERROR   : ${err.message}`);
      errores_escritura++;
    }
  } else {
    console.log(`    [dry-run] no escrito`);
  }

  console.log('');
}

console.log('─'.repeat(72));
if (MODO_WRITE) {
  console.log(`  Escritos: ${escritos}   Omitidos/skip: ${omitidos}   Errores: ${errores_escritura}`);
  if (escritos > 0) {
    console.log(`  Colección: resultados/{matchId}   fuente: "manual"`);
  }
} else {
  console.log(`  Dry-run. Entradas en JSON: ${entradas.length}`);
  console.log(`  Ejecuta --write para guardar en Firestore.`);
}
console.log('═'.repeat(72) + '\n');

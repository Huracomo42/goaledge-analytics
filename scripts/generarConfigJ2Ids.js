/**
 * generarConfigJ2Ids.js — Genera config/j2_ids.json con los 24 partidos J2.
 *
 * Fuentes en orden de prioridad (se usa la primera que devuelva 24 partidos):
 *   1. Firestore predicciones/ → query where matchday == 2
 *   2. reports/auditoria_j2_predicciones_*.json (cache local)
 *   3. football-data.org → obtenerPartidosMundial() como fallback
 *
 * Para todas las fuentes: los nombres local/visitante se leen desde Firestore
 * predicciones/{matchId}.nombreLocal/nombreVisitante (fuente de verdad de nombres).
 *
 * Restricciones:
 *   - No llama The Odds API.
 *   - No modifica predicciones.
 *   - No modifica resultados.
 *   - Solo escribe config/j2_ids.json.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join }  from 'path';
import { globSync }       from 'glob';
import { getFirestore }   from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import { obtenerPartidosMundial } from '../src/data/pipeline/footballData.js';

const db = getFirestore();

const OUT_PATH = resolve('config', 'j2_ids.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extraerFecha(data) {
  if (!data) return null;
  const raw = data.utcDate ?? data.fecha ?? data.partido?.utcDate ?? data.partido?.fecha ?? null;
  if (!raw) return null;
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (raw?.toDate) return raw.toDate().toISOString().slice(0, 10);
  return null;
}

/**
 * Dado un array de { matchId, fechaFallback?, localFallback?, visitanteFallback? },
 * enriquece con nombres desde Firestore predicciones/{matchId}.
 * Si Firestore no tiene el doc, usa los valores fallback.
 */
async function enriquecerConFirestore(entradas) {
  const resultado = [];
  for (const e of entradas) {
    const snap = await db.collection('predicciones').doc(String(e.matchId)).get();
    if (snap.exists) {
      const d = snap.data();
      const local     = d.nombreLocal     ?? d.equipoLocal     ?? d.partido?.nombreLocal     ?? e.localFallback     ?? null;
      const visitante = d.nombreVisitante ?? d.equipoVisitante ?? d.partido?.nombreVisitante ?? e.visitanteFallback ?? null;
      const fecha     = extraerFecha(d) ?? e.fechaFallback ?? null;
      if (!local || !visitante) {
        console.log(`  WARN  ${e.matchId}: Firestore doc existe pero sin nombreLocal/nombreVisitante`);
      }
      resultado.push({ matchId: String(e.matchId), local, visitante, fecha });
    } else {
      // Firestore doc no existe — usar fallback
      if (e.localFallback && e.visitanteFallback) {
        resultado.push({
          matchId:   String(e.matchId),
          local:     e.localFallback,
          visitante: e.visitanteFallback,
          fecha:     e.fechaFallback ?? null,
        });
      } else {
        console.log(`  WARN  ${e.matchId}: sin doc en Firestore y sin nombres fallback — omitido`);
      }
    }
  }
  return resultado;
}

// ── Cabecera ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  generarConfigJ2Ids — config/j2_ids.json');
console.log('═'.repeat(70));

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 1: Firestore query where matchday == 2
// ══════════════════════════════════════════════════════════════════════════════

let partidos = null;

console.log('\n[Source 1] Firestore query: predicciones where matchday == 2…');

let snapshot = await db.collection('predicciones').where('matchday', '==', 2).get();
if (snapshot.size === 0) {
  snapshot = await db.collection('predicciones').where('matchday', '==', '2').get();
}

if (snapshot.size > 0) {
  console.log(`  ${snapshot.size} documentos encontrados.`);
  const candidatos = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    const local     = d.nombreLocal     ?? d.equipoLocal     ?? d.partido?.nombreLocal     ?? null;
    const visitante = d.nombreVisitante ?? d.equipoVisitante ?? d.partido?.nombreVisitante ?? null;
    const fecha     = extraerFecha(d);
    if (local && visitante) {
      candidatos.push({ matchId: doc.id, local, visitante, fecha });
    } else {
      console.log(`  WARN  ${doc.id}: doc sin nombreLocal/nombreVisitante, omitido`);
    }
  }

  if (candidatos.length === 24) {
    console.log('  ✓ Source 1: 24 partidos con nombres válidos.');
    partidos = candidatos;
  } else {
    console.log(`  ✗ Source 1: ${candidatos.length} partidos con nombres (se requieren 24). Pasando a Source 2.`);
  }
} else {
  console.log('  ✗ Source 1: campo matchday no indexado en predicciones/. Pasando a Source 2.');
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 2: Cache local reports/auditoria_j2_predicciones_*.json
// ══════════════════════════════════════════════════════════════════════════════

if (!partidos) {
  console.log('\n[Source 2] Cache local: reports/auditoria_j2_predicciones_*.json…');

  const archivos = globSync('reports/auditoria_j2_predicciones_*.json', { cwd: resolve('.') })
    .sort()
    .reverse();

  if (archivos.length === 0) {
    console.log('  ✗ Source 2: no se encontraron archivos de auditoría local. Pasando a Source 3.');
  } else {
    const archivo = archivos[0];
    console.log(`  Usando archivo más reciente: ${archivo}`);
    const cache = JSON.parse(readFileSync(resolve(archivo), 'utf-8'));
    const filas = cache.detalle ?? cache.filas ?? cache.partidos ?? [];

    if (filas.length === 0) {
      console.log('  ✗ Source 2: archivo sin entradas (detalle/filas/partidos). Pasando a Source 3.');
    } else {
      console.log(`  ${filas.length} entradas en cache. Enriqueciendo nombres desde Firestore…`);

      const entradas = filas.map(f => {
        const [localFallback, visitanteFallback] = (f.nombre ?? '').split(' vs ').map(s => s?.trim());
        return {
          matchId:          f.matchId,
          fechaFallback:    f.fechaPartido ?? f.fecha ?? null,
          localFallback:    localFallback  ?? null,
          visitanteFallback: visitanteFallback ?? null,
        };
      });

      const enriquecidos = await enriquecerConFirestore(entradas);

      if (enriquecidos.length === 24) {
        console.log('  ✓ Source 2: 24 partidos con nombres válidos.');
        partidos = enriquecidos;
      } else {
        console.log(`  ✗ Source 2: solo ${enriquecidos.length}/24 partidos resueltos. Pasando a Source 3.`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 3: football-data.org como fallback
// ══════════════════════════════════════════════════════════════════════════════

if (!partidos) {
  console.log('\n[Source 3] football-data.org: obtenerPartidosMundial()…');

  const todos = await obtenerPartidosMundial();
  const j2fd  = todos
    .filter(p => p.matchday === 2)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  if (j2fd.length === 0) {
    console.error('  ✗ Source 3: 0 partidos J2 desde football-data.org. Verifica FOOTBALL_DATA_TOKEN.');
  } else {
    console.log(`  ${j2fd.length} partidos J2 desde FD. Enriqueciendo nombres desde Firestore…`);

    const entradas = j2fd.map(p => ({
      matchId:           p.id,
      fechaFallback:     p.utcDate?.slice(0, 10) ?? null,
      localFallback:     p.homeTeam?.name ?? null,
      visitanteFallback: p.awayTeam?.name ?? null,
    }));

    const enriquecidos = await enriquecerConFirestore(entradas);

    if (enriquecidos.length === 24) {
      console.log('  ✓ Source 3: 24 partidos con nombres válidos.');
      partidos = enriquecidos;
    } else {
      console.log(`  ✗ Source 3: solo ${enriquecidos.length}/24 partidos resueltos.`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Validación final
// ══════════════════════════════════════════════════════════════════════════════

if (!partidos || partidos.length !== 24) {
  const count = partidos?.length ?? 0;
  console.error('\n' + '═'.repeat(70));
  console.error(`  ABORTANDO: solo se encontraron ${count}/24 partidos J2.`);
  console.error('');
  console.error('  Posibles causas:');
  console.error('    1. Firestore: predicciones J2 no tienen campo "matchday" indexado.');
  console.error('    2. Cache local: reports/auditoria_j2_predicciones_*.json no existe o está vacío.');
  console.error('    3. FD API: FOOTBALL_DATA_TOKEN no configurado o fixture J2 incompleto.');
  console.error('    4. Algunos matchIds J2 no tienen predicción en Firestore.');
  console.error('');
  console.error('  Soluciones:');
  console.error('    → Ejecutar: node scripts/auditarPrediccionesJ2.js  (genera la cache local)');
  console.error('    → Verificar variable FOOTBALL_DATA_TOKEN en .env');
  console.error('═'.repeat(70));
  process.exit(1);
}

// Ordenar por fecha
partidos.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));

// ══════════════════════════════════════════════════════════════════════════════
// Tabla de confirmación
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '─'.repeat(70));
console.log('  #   matchId    Fecha        Local                        Visitante');
console.log('─'.repeat(70));
partidos.forEach((p, i) => {
  const n      = String(i + 1).padStart(2);
  const mid    = String(p.matchId).padEnd(10);
  const fecha  = (p.fecha ?? '?').padEnd(12);
  const local  = (p.local ?? '?').padEnd(28);
  const visit  = p.visitante ?? '?';
  console.log(`  ${n}  ${mid} ${fecha} ${local} ${visit}`);
});
console.log('─'.repeat(70));
console.log(`  Total: ${partidos.length} partidos J2`);
console.log('');

// ══════════════════════════════════════════════════════════════════════════════
// Escribir config/j2_ids.json
// ══════════════════════════════════════════════════════════════════════════════

mkdirSync(resolve('config'), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(partidos, null, 2), 'utf-8');
console.log(`  Guardado: config/j2_ids.json  (${partidos.length} partidos)\n`);

/**
 * Diagnóstico read-only de 4 colecciones de Firestore.
 * NO borra ni modifica nada.
 */

import { guardarOddsSnapshot } from '../src/firebase/oddsSnapshots.js'; // inicializa Firebase
import { getFirestore }        from 'firebase-admin/firestore';

const db = getFirestore();

const COLECCIONES = [
  'analisis_psicologico',
  'mapeo_partidos_fotmob',
  'stats_avanzadas',
  'team_stats_premundial',
];

// Campos que suelen indicar fecha de creación/actualización
const CAMPOS_FECHA = [
  'creado_en', 'actualizado_en', 'fecha', 'timestamp', 'updatedAt',
  'createdAt', 'generado_en', 'fecha_actualizacion', 'last_updated',
];

function resumirValor(v) {
  if (v === null)                    return 'null';
  if (v === undefined)               return 'undefined';
  if (typeof v !== 'object')         return JSON.stringify(v);
  if (v?.constructor?.name === 'Timestamp') return `Timestamp(${v.toDate().toISOString()})`;
  if (Array.isArray(v))              return `Array(${v.length})`;
  return `{${Object.keys(v).join(', ')}}`;
}

for (const coleccion of COLECCIONES) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  COLECCIÓN: ${coleccion}`);
  console.log('═'.repeat(70));

  // Contar documentos (limit 1000 para no saturar; si tiene más lo decimos)
  const snapCount = await db.collection(coleccion).limit(1000).get();
  const n = snapCount.size;
  const masDeLimit = n === 1000;
  console.log(`\n  Documentos: ${n}${masDeLimit ? '+' : ''}`);

  if (n === 0) {
    console.log('  (colección vacía o no existe)\n');
    continue;
  }

  // Muestra de hasta 2 documentos
  const muestra = snapCount.docs.slice(0, 2);
  for (let i = 0; i < muestra.length; i++) {
    const doc = muestra[i];
    const data = doc.data();
    const campos = Object.keys(data);

    console.log(`\n  [Ejemplo ${i + 1}] ID: "${doc.id}"`);
    console.log(`  Campos (${campos.length}): ${campos.join(', ')}`);

    // Mostrar cada campo con su valor resumido
    for (const [k, v] of Object.entries(data)) {
      console.log(`    ${k.padEnd(30)} ${resumirValor(v)}`);
    }
  }

  // Detectar campos de fecha y su rango
  console.log('\n  ── Campos de fecha detectados ──');
  let algunaFechaEncontrada = false;

  for (const doc of snapCount.docs) {
    const data = doc.data();
    for (const campo of CAMPOS_FECHA) {
      const v = data[campo];
      if (v !== undefined && v !== null) {
        const ts = v?.toDate?.() ?? (typeof v === 'string' ? new Date(v) : null);
        if (ts && !isNaN(ts)) {
          console.log(`    campo "${campo}" en doc "${doc.id}": ${ts.toISOString()}`);
          algunaFechaEncontrada = true;
        }
      }
    }
  }

  if (!algunaFechaEncontrada) {
    console.log('    (ninguno de los campos de fecha estándar detectado)');
  }

  // Rango de timestamps si Firestore tiene __name__ orderable (solo si hay alguno)
  // Para estimar antigüedad: primer y último doc de la colección por orden de inserción
  // no es trivial sin índice — nos quedamos con los campos explícitos detectados arriba.

  console.log('');
}

console.log('═'.repeat(70));
console.log('  FIN DEL INVENTARIO — 0 escrituras realizadas.');
console.log('═'.repeat(70) + '\n');

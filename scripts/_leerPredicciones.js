/**
 * Solo lectura — inspecciona 2 documentos de predicciones/.
 * NO escribe ni modifica nada.
 */

import { guardarOddsSnapshot } from '../src/firebase/oddsSnapshots.js'; // inicializa Firebase
import { getFirestore }        from 'firebase-admin/firestore';

const db = getFirestore();

const DOCS = [
  { id: '537352', label: 'Ecuador vs Curaçao (J2)' },
  { id: '537335', label: 'México vs South Korea (J2)' },
];

// Campos conocidos de V2
const CAMPOS_V2 = new Set([
  'matchId', 'nombreLocal', 'nombreVisitante', 'fechaPartido',
  'lambda_local', 'lambda_visitante',
  'prob_local', 'prob_empate', 'prob_visitante',
  'marcador_mas_probable', 'goles_esperados_local', 'goles_esperados_visitante',
  'muestra_local', 'muestra_visitante',
  'version_modelo',   // V2 usa "2.0"
  'generado_en', 'fuentes_p_disponibles', 'analisis_psicologico_ref',
  'ultimo_odds_snapshot_id',
]);

// Campos conocidos de V1
const CAMPOS_V1 = new Set([
  'scoreStat', 'scorePsico', 'boost', 'total', 'apuestas',
  'pesos_usados', 'factores', 'score_final', 'recomendacion',
  'equipoLocal', 'equipoVisitante',  // camelCase V1
  'partidoId',
]);

function resumirValor(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== 'object')         return JSON.stringify(v);
  if (v?.constructor?.name === 'Timestamp') return `Timestamp(${v.toDate().toISOString()})`;
  if (Array.isArray(v))              return `Array(${v.length})`;
  const keys = Object.keys(v);
  return `{ ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''} }`;
}

for (const { id, label } of DOCS) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  predicciones/${id}  —  ${label}`);
  console.log('═'.repeat(70));

  const snap = await db.collection('predicciones').doc(id).get();

  if (!snap.exists) {
    console.log('  ✗ Documento NO existe en Firestore.\n');
    continue;
  }

  const data   = snap.data();
  const campos = Object.keys(data).sort();

  console.log(`\n  Total de campos: ${campos.length}`);

  const enV2      = campos.filter(c => CAMPOS_V2.has(c));
  const enV1      = campos.filter(c => CAMPOS_V1.has(c));
  const enAmbos   = enV2.filter(c => CAMPOS_V1.has(c));
  const desconocidos = campos.filter(c => !CAMPOS_V2.has(c) && !CAMPOS_V1.has(c));

  console.log(`  Campos V2 reconocidos   : ${enV2.length}  → ${enV2.join(', ') || '(ninguno)'}`);
  console.log(`  Campos V1 reconocidos   : ${enV1.length}  → ${enV1.join(', ') || '(ninguno)'}`);
  console.log(`  Campos en AMBOS sets    : ${enAmbos.length}  → ${enAmbos.join(', ') || '(ninguno)'}`);
  console.log(`  Campos desconocidos     : ${desconocidos.length}  → ${desconocidos.join(', ') || '(ninguno)'}`);

  console.log('\n  ── Todos los campos ──');
  for (const k of campos) {
    const tag = CAMPOS_V2.has(k) ? '[V2]' : CAMPOS_V1.has(k) ? '[V1]' : '[??]';
    console.log(`  ${tag} ${k.padEnd(35)} ${resumirValor(data[k])}`);
  }

  // Timestamps explícitos
  console.log('\n  ── Timestamps de generación ──');
  for (const campo of ['generado_en', 'generadoEn', 'creado_en', 'actualizado_en', 'timestamp']) {
    const v = data[campo];
    if (v !== undefined) {
      const ts = v?.toDate?.() ?? (typeof v === 'string' ? new Date(v) : null);
      console.log(`  ${campo}: ${ts ? ts.toISOString() : JSON.stringify(v)}`);
    }
  }

  // version_modelo explícito
  if (data.version_modelo !== undefined) {
    console.log(`\n  version_modelo: ${JSON.stringify(data.version_modelo)}`);
  }
}

console.log('\n' + '─'.repeat(70));
console.log('  FIN — 0 escrituras realizadas.\n');

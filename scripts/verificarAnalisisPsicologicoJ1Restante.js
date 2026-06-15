/**
 * verificarAnalisisPsicologicoJ1Restante.js
 *
 * Verifica que los 12 documentos analisis_psicologico/{matchId} de J1 restante
 * existen en Firestore y son válidos para el motor de predicciones.
 *
 * Comprueba:
 *   - Documento existe
 *   - equipos.local y equipos.visitante con nombre
 *   - Las 7 variables que lee el engine tienen local, visitante y confianza
 *   - listo_para_modelo === true
 *
 * 0 escrituras en Firestore.
 */

import 'dotenv/config';
import { getFirestore } from 'firebase-admin/firestore';
import '../src/firebase/init.js';

const J1_RESTANTE = [
  { matchId: '537369', local: 'Spain',        visitante: 'Cape Verde Islands' },
  { matchId: '537363', local: 'Belgium',      visitante: 'Egypt'              },
  { matchId: '537370', local: 'Saudi Arabia', visitante: 'Uruguay'            },
  { matchId: '537364', local: 'Iran',         visitante: 'New Zealand'        },
  { matchId: '537391', local: 'France',       visitante: 'Senegal'            },
  { matchId: '537392', local: 'Iraq',         visitante: 'Norway'             },
  { matchId: '537397', local: 'Argentina',    visitante: 'Algeria'            },
  { matchId: '537398', local: 'Austria',      visitante: 'Jordan'             },
  { matchId: '537403', local: 'Portugal',     visitante: 'Congo DR'           },
  { matchId: '537409', local: 'England',      visitante: 'Croatia'            },
  { matchId: '537410', local: 'Ghana',        visitante: 'Panama'             },
  { matchId: '537404', local: 'Uzbekistan',   visitante: 'Colombia'           },
];

// Variables que el motor leerá (engine field names)
const VARS_MOTOR = [
  'ausencias_ofensivas',
  'ausencias_defensivas',
  'lider_disponible',
  'conflicto_interno',
  'presion_mediatica',
  'generacion_peak',
  'necesita_ganar',
];

const db = getFirestore();

console.log('\n' + '═'.repeat(76));
console.log('  VERIFICACIÓN — analisis_psicologico J1 restante');
console.log('  0 escrituras en Firestore.');
console.log('═'.repeat(76));

let ok = 0, errores = 0;
const advertencias = [];

for (const { matchId, local, visitante } of J1_RESTANTE) {
  const snap = await db.collection('analisis_psicologico').doc(matchId).get();
  const nombre = `${local} vs ${visitante}`;

  if (!snap.exists) {
    console.log(`\n  ✗ FALTA    ${matchId}  ${nombre}`);
    errores++;
    continue;
  }

  const data = snap.data();
  const vars = data.variables ?? {};
  const problemas = [];

  // Verificar variables del motor
  for (const v of VARS_MOTOR) {
    if (vars[v] == null) {
      problemas.push(`variable "${v}" ausente`);
    } else {
      if (vars[v].local === undefined)     problemas.push(`${v}.local ausente`);
      if (vars[v].visitante === undefined) problemas.push(`${v}.visitante ausente`);
      if (typeof vars[v].confianza !== 'number') problemas.push(`${v}.confianza no es número`);
    }
  }

  if (!data.equipos?.local?.nombre)     problemas.push('equipos.local.nombre ausente');
  if (!data.equipos?.visitante?.nombre) problemas.push('equipos.visitante.nombre ausente');
  if (data.listo_para_modelo !== true)  problemas.push('listo_para_modelo !== true');

  if (problemas.length > 0) {
    console.log(`\n  ✗ ERROR    ${matchId}  ${nombre}`);
    for (const p of problemas) console.log(`    - ${p}`);
    errores++;
    continue;
  }

  // Variables con local=null y visitante=null (esperado para campos no-MD)
  const nullPairs = VARS_MOTOR.filter(v => vars[v]?.local === null && vars[v]?.visitante === null);
  if (nullPairs.length > 0) {
    advertencias.push(`${matchId}: vars con local=null+visitante=null: ${nullPairs.join(', ')}`);
  }

  console.log(`\n  ✓ OK       ${matchId}  ${nombre}`);
  console.log(`    local   : ${data.equipos?.local?.nombre ?? '?'}    visitante: ${data.equipos?.visitante?.nombre ?? '?'}`);

  // Mostrar valores de variables motor (formato compacto)
  const filaVars = VARS_MOTOR
    .filter(v => vars[v]?.local !== null || vars[v]?.visitante !== null)
    .map(v => {
      const lv = vars[v];
      return `${v.replace('ausencias_', 'aus_').replace('presion_mediatica', 'presion').replace('generacion_peak', 'gen_peak').replace('lider_disponible', 'lider').replace('conflicto_interno', 'conflicto').replace('necesita_ganar', 'nec_ganar')}(L=${lv.local} V=${lv.visitante} c=${lv.confianza?.toFixed(2) ?? '?'})`;
    });

  for (let i = 0; i < filaVars.length; i += 2) {
    console.log(`    ${filaVars[i]}  ${filaVars[i + 1] ?? ''}`);
  }

  if (nullPairs.length > 0) {
    console.log(`    AVISO: local=null+visitante=null en: ${nullPairs.join(', ')}`);
  }

  ok++;
}

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  RESUMEN');
console.log(`    ✓ OK      : ${ok} / ${J1_RESTANTE.length}`);
console.log(`    ✗ Errores : ${errores}`);

if (advertencias.length > 0) {
  console.log('\n  ADVERTENCIAS (esperadas para campos no presentes en MD):');
  for (const a of advertencias) console.log(`    ${a}`);
}

if (ok === J1_RESTANTE.length) {
  console.log('\n  Todos los documentos están listos para el motor de predicciones.');
} else {
  console.log('\n  Hay documentos con errores. Ejecuta el importador para corregir:');
  console.log('    node scripts/importarAnalisisPsicoDesdeMd.js --write --force');
}

console.log('═'.repeat(76));

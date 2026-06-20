/**
 * explorarSeñalesProtegidасJ2.js — Diagnóstico estructural de señales_protegidas J2.
 *
 * SOLO LECTURA. Zero escrituras. Zero llamadas a APIs externas.
 *
 * Determina si señales_protegidas puede alimentar filtrarSenalesApuesta()
 * tal como lo hace señales_valor.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve }      from 'path';
import { getFirestore } from 'firebase-admin/firestore';

import '../src/firebase/init.js';

const db = getFirestore();

// ── Campos que filtrarSenalesApuesta() necesita (de signalFilters.js) ─────────

const CAMPOS_REQUERIDOS_FILTRO = [
  'mercado',         // 'h2h' | 'totals'
  'seleccion',       // 'local' | 'empate' | 'visitante' | 'over_2.5' | etc.
  'prob_modelo',     // número 0-1
  'bookmaker_odds',  // número > 1
  'expected_value',  // número (ev = prob*odds - 1)
  'edge',            // número
  'is_value_bet',    // boolean
];

// Campos alternativos comunes que podrían mapear a los requeridos
const ALIAS_CONOCIDOS = {
  'cuota':              'bookmaker_odds',
  'odds':               'bookmaker_odds',
  'ev':                 'expected_value',
  'expected_value':     'expected_value',
  'valor_esperado':     'expected_value',
  'prob_implicita':     'implied_probability',
  'implied_probability':'implied_probability',
  'prob_no_vig':        'no_vig_probability',
  'no_vig_probability': 'no_vig_probability',
  'tipo':               'mercado',       // posible alias de mercado
  'fuente_odds':        null,
  'bookmaker':          null,
  'confianza':          null,
  'justificacion':      null,
  'timestamp':          null,
};

// ── Cargar config/j2_ids.json ─────────────────────────────────────────────────

const rawConfig = JSON.parse(readFileSync(resolve('config', 'j2_ids.json'), 'utf-8'));
const J2_IDS    = Array.isArray(rawConfig) ? rawConfig : (rawConfig.partidos ?? []);

console.log('\n' + '═'.repeat(76));
console.log('  explorarSeñalesProtegidas — SOLO LECTURA');
console.log('═'.repeat(76));
console.log(`\n  ${J2_IDS.length} partidos desde config/j2_ids.json\n`);

// ── Leer los 24 documentos en paralelo ───────────────────────────────────────

const snaps = await Promise.all(
  J2_IDS.map(e => db.collection('predicciones').doc(String(e.matchId)).get())
);

// ── Recolectar estadísticas globales de campos ────────────────────────────────

const conteoGlobal = {}; // campo → cuántas señales lo tienen
let totalSeñales   = 0;
let totalMatchIds  = 0;

// Ejemplos a imprimir al final
const ejemplos = { h2h: null, totals: null, handicap: null };

// Tabla por partido
const tablaPartidos = [];

for (let i = 0; i < J2_IDS.length; i++) {
  const entrada = J2_IDS[i];
  const snap    = snaps[i];
  const matchId = String(entrada.matchId);
  const partido = `${entrada.local} vs ${entrada.visitante}`;

  if (!snap.exists) {
    tablaPartidos.push({ matchId, partido, estado: 'PREDICCION_AUSENTE', señales: [] });
    continue;
  }

  const pred         = snap.data();
  const version      = pred.version_modelo ?? '?';
  const raw          = pred.señales_protegidas;
  const tipoRaw      = raw == null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw;
  const señalesArr   = Array.isArray(raw) ? raw : (raw != null ? Object.values(raw) : []);

  tablaPartidos.push({
    matchId,
    partido,
    version,
    tipoRaw,
    count: señalesArr.length,
    señales: señalesArr,
  });

  totalMatchIds++;
  totalSeñales += señalesArr.length;

  for (const s of señalesArr) {
    if (typeof s !== 'object' || s == null) continue;
    for (const k of Object.keys(s)) {
      conteoGlobal[k] = (conteoGlobal[k] ?? 0) + 1;
    }

    // Capturar ejemplos por tipo
    const mercado    = s.mercado ?? s.tipo ?? '';
    const seleccion  = s.seleccion ?? '';
    const esH2H      = mercado === 'h2h' || ['local','empate','visitante'].includes(seleccion);
    const esTotals   = mercado === 'totals' || String(seleccion).startsWith('over') || String(seleccion).startsWith('under');
    const esHandicap = mercado?.toLowerCase().includes('handicap') ||
                       mercado?.toLowerCase().includes('spread') ||
                       mercado?.toLowerCase().includes('ah') ||
                       String(seleccion).includes('handicap');

    if (!ejemplos.h2h      && esH2H)      ejemplos.h2h      = { matchId, partido, señal: s };
    if (!ejemplos.totals   && esTotals)   ejemplos.totals   = { matchId, partido, señal: s };
    if (!ejemplos.handicap && esHandicap) ejemplos.handicap = { matchId, partido, señal: s };
  }
}

// ── Tabla de partidos ─────────────────────────────────────────────────────────

console.log('  TABLA DE PARTIDOS');
console.log('─'.repeat(76));
console.log('  #   matchId    partido                             version        tipo    count');
console.log('─'.repeat(76));

for (let i = 0; i < tablaPartidos.length; i++) {
  const r   = tablaPartidos[i];
  const n   = String(i + 1).padStart(2);
  const mid = r.matchId.padEnd(10);
  const nom = (r.partido ?? '').padEnd(36);
  const ver = (r.version ?? '?').padEnd(20);
  const tip = (r.tipoRaw ?? r.estado ?? '?').padEnd(7);
  const cnt = r.count ?? 0;
  console.log(`  ${n}  ${mid} ${nom} ${ver} ${tip} ${cnt}`);
}

console.log('─'.repeat(76));
console.log(`  Total partidos: ${totalMatchIds}  |  Total señales: ${totalSeñales}  |  Promedio: ${totalMatchIds > 0 ? (totalSeñales / totalMatchIds).toFixed(1) : '—'} por partido`);

// ── Presencia de campos por señal ─────────────────────────────────────────────

console.log('\n\n  CAMPOS ENCONTRADOS EN señales_protegidas (frecuencia sobre ' + totalSeñales + ' señales)');
console.log('─'.repeat(76));

const camposOrdenados = Object.entries(conteoGlobal)
  .sort((a, b) => b[1] - a[1]);

for (const [campo, cnt] of camposOrdenados) {
  const pct    = totalSeñales > 0 ? `${((cnt / totalSeñales) * 100).toFixed(0)}%` : '—';
  const alias  = ALIAS_CONOCIDOS[campo] ? ` → mapea a "${ALIAS_CONOCIDOS[campo]}"` : '';
  const needed = CAMPOS_REQUERIDOS_FILTRO.includes(campo) ? ' ★ REQUERIDO' : '';
  console.log(`    ${campo.padEnd(28)} ${String(cnt).padStart(4)} señales  (${pct.padStart(4)})${alias}${needed}`);
}

// Campos requeridos que faltan
const camposPresentes = new Set(Object.keys(conteoGlobal));
const faltantes = CAMPOS_REQUERIDOS_FILTRO.filter(c => !camposPresentes.has(c));

if (faltantes.length > 0) {
  console.log('\n  CAMPOS REQUERIDOS POR filtrarSenalesApuesta() QUE NO ESTÁN DIRECTAMENTE:');
  for (const c of faltantes) {
    const posibleAlias = Object.entries(ALIAS_CONOCIDOS).find(([k, v]) => v === c && camposPresentes.has(k));
    const nota = posibleAlias ? ` → posible alias: "${posibleAlias[0]}"` : ' → SIN ALIAS ENCONTRADO';
    console.log(`    ✗ ${c}${nota}`);
  }
}

// ── Ejemplos concretos ────────────────────────────────────────────────────────

console.log('\n\n  EJEMPLOS CONCRETOS');
console.log('═'.repeat(76));

function imprimirEjemplo(etiqueta, ej) {
  if (!ej) {
    console.log(`\n  [${etiqueta}] — ninguna señal de este tipo encontrada`);
    return;
  }
  console.log(`\n  [${etiqueta}] — ${ej.partido} (matchId ${ej.matchId})`);
  console.log('  ' + '─'.repeat(50));
  for (const [k, v] of Object.entries(ej.señal)) {
    const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`    ${k.padEnd(28)}: ${vStr}`);
  }
}

imprimirEjemplo('H2H', ejemplos.h2h);
imprimirEjemplo('OVER/UNDER', ejemplos.totals);
imprimirEjemplo('HANDICAP/SPREAD', ejemplos.handicap);

// ── Diagnóstico de compatibilidad ─────────────────────────────────────────────

console.log('\n\n  DIAGNÓSTICO DE COMPATIBILIDAD CON filtrarSenalesApuesta()');
console.log('═'.repeat(76));

// Verificar si los campos requeridos están presentes (directamente o via alias)
const camposConAlias = new Set([
  ...camposPresentes,
  ...Object.entries(ALIAS_CONOCIDOS)
    .filter(([k]) => camposPresentes.has(k))
    .map(([, v]) => v)
    .filter(Boolean),
]);

const requeridosCubiertos  = CAMPOS_REQUERIDOS_FILTRO.filter(c => camposConAlias.has(c));
const requeridosFaltantes  = CAMPOS_REQUERIDOS_FILTRO.filter(c => !camposConAlias.has(c));

console.log(`\n  Campos requeridos cubiertos (directo o alias): ${requeridosCubiertos.length}/${CAMPOS_REQUERIDOS_FILTRO.length}`);
for (const c of requeridosCubiertos) {
  const directo = camposPresentes.has(c);
  const aliasUsado = !directo
    ? Object.entries(ALIAS_CONOCIDOS).find(([k, v]) => v === c && camposPresentes.has(k))?.[0]
    : null;
  console.log(`    ✓ ${c}${aliasUsado ? ` (via campo "${aliasUsado}")` : ''}`);
}

if (requeridosFaltantes.length > 0) {
  console.log(`\n  Campos requeridos NO cubiertos: ${requeridosFaltantes.length}`);
  for (const c of requeridosFaltantes) console.log(`    ✗ ${c}`);
}

// Decisión final
let compatibilidad;
let motivo;

if (totalSeñales === 0) {
  compatibilidad = 'NO_COMPATIBLE';
  motivo = 'señales_protegidas vacío o ausente en todos los partidos';
} else if (requeridosFaltantes.length === 0 && faltantes.length === 0) {
  compatibilidad = 'COMPATIBLE_DIRECTO';
  motivo = 'todos los campos requeridos presentes con los mismos nombres';
} else if (requeridosFaltantes.length === 0) {
  compatibilidad = 'COMPATIBLE_DIRECTO';
  motivo = 'todos los campos requeridos presentes directamente';
} else if (requeridosCubiertos.length >= CAMPOS_REQUERIDOS_FILTRO.length - 1) {
  compatibilidad = 'COMPATIBLE_CON_ADAPTADOR';
  motivo = `requiere mapear: ${requeridosFaltantes.map(c => {
    const alias = Object.entries(ALIAS_CONOCIDOS).find(([k, v]) => v === c && camposPresentes.has(k))?.[0];
    return alias ? `"${alias}"→"${c}"` : `"${c}" (sin alias)`;
  }).join(', ')}`;
} else {
  compatibilidad = 'NO_COMPATIBLE';
  motivo = `faltan campos críticos sin alias: ${requeridosFaltantes.join(', ')}`;
}

console.log('\n' + '═'.repeat(76));
console.log(`  RESULTADO: ${compatibilidad}`);
console.log(`  Motivo   : ${motivo}`);
console.log('═'.repeat(76));
console.log('');

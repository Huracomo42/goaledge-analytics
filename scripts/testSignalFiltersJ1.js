/**
 * testSignalFiltersJ1.js — Test retrospectivo de clasificarSenales() contra J1 V2.1.
 *
 * Aplica clasificarSenales() (taxonomía post-J1) a las 12 predicciones V2.1 de J1
 * y compara el resultado contra los resultados reales del partido.
 *
 * Responde:
 *   - ¿Cuántas señales originales había?
 *   - ¿Cuántas habrían sido VALUE_BET/PROTECTED_ONLY (aprobadas)?
 *   - ¿Cuántas habrían sido WATCHLIST/NO_BET (no recomendadas)?
 *   - De las no recomendadas: ¿cuántas eran errores? ¿cuántas eran aciertos perdidos?
 *   - De las aprobadas: ¿cuántas eran aciertos? ¿cuántas errores restantes?
 *
 * No escribe Firestore. Solo lee y reporta.
 *
 * Fuentes:
 *   - Firestore predicciones/{matchId}.señales_valor    → señales originales
 *   - reports/auditoria_j1_predicciones_20260618052649.json → resultados reales
 */

import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getFirestore } from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import {
  clasificarSenales,
  clasificarTipo,
  TIPO_SENAL,
  FRAGILIDAD,
  RISK_LEVEL,
} from '../src/core/betting/recommendationPolicy.js';

const db = getFirestore();

// ── Constantes ────────────────────────────────────────────────────────────────

const MATCH_IDS_V21 = [
  '537369', '537363', '537370', '537364',
  '537391', '537392', '537397', '537398',
  '537403', '537409', '537410', '537404',
];

const AUDIT_PATH = resolve('reports/auditoria_j1_predicciones_20260618052649.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Determina si una señal fue ACERTADA dado un resultado real.
 * @param {object} señal   — señal con mercado + seleccion + linea
 * @param {object} resultado — { real_1x2, goles_local, goles_visitante, real_btts }
 * @returns {boolean|null}  null = no determinable
 */
function eraAcertada(señal, resultado) {
  const tipo = clasificarTipo(señal);
  const { real_1x2, real_goles_local, real_goles_visitante, real_btts } = resultado;
  const totalGoles = (real_goles_local ?? 0) + (real_goles_visitante ?? 0);

  switch (tipo) {
    case TIPO_SENAL.H2H_LOCAL:
      return real_1x2 === 'local';
    case TIPO_SENAL.H2H_EMPATE:
      return real_1x2 === 'empate';
    case TIPO_SENAL.H2H_VISITANTE:
      return real_1x2 === 'visitante';
    case TIPO_SENAL.OVER: {
      const linea = parseFloat((señal.seleccion ?? '').replace('over_', ''));
      return isNaN(linea) ? null : totalGoles > linea;
    }
    case TIPO_SENAL.UNDER: {
      const linea = parseFloat((señal.seleccion ?? '').replace('under_', ''));
      return isNaN(linea) ? null : totalGoles <= linea;
    }
    case TIPO_SENAL.BTTS_SI:
      return real_btts === true;
    case TIPO_SENAL.BTTS_NO:
      return real_btts === false;
    default:
      return null;
  }
}

const pct   = (n, d) => d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
const evPct = ev => ev != null ? `${(ev * 100).toFixed(1)}%` : '—';

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(76));
console.log('  testSignalFiltersJ1 — Filtros de fragilidad aplicados retroactivamente a J1 V2.1');
console.log('═'.repeat(76));

// [1/3] Cargar resultados reales del JSON de auditoría
console.log('\n[1/3] Cargando auditoría J1...');
const auditData = JSON.parse(readFileSync(AUDIT_PATH, 'utf-8'));
const resultadosPorMatch = new Map(
  auditData.detalle
    .filter(d => d.estado === 'auditado')
    .map(d => [
      d.matchId,
      {
        nombre:             d.nombre,
        real_1x2:           d.real_1x2,
        real_goles_local:   d.real_goles_local,
        real_goles_visitante: d.real_goles_visitante,
        real_btts:          d.real_btts,
        real_ou25:          d.real_ou25,
      },
    ])
);
console.log(`  ${resultadosPorMatch.size} partidos auditados encontrados.`);

// [2/3] Leer predicciones de Firestore
console.log('\n[2/3] Leyendo predicciones V2.1 desde Firestore...');
const predicciones = [];

for (const matchId of MATCH_IDS_V21) {
  const snap = await db.collection('predicciones').doc(matchId).get();
  if (!snap.exists) {
    console.log(`  WARN  ${matchId}: sin predicción en Firestore`);
    continue;
  }
  // snap.data() puede tener matchId numérico — forzar string para consistencia con el Map
  predicciones.push({ ...snap.data(), matchId: String(matchId) });
}

console.log(`  ${predicciones.length}/12 predicciones encontradas.`);

// [3/3] Clasificar con taxonomía post-J1
console.log('\n[3/3] Aplicando clasificarSenales() (taxonomía post-J1)...\n');

// Contadores globales
let totalSenalesOrig    = 0;
let totalAprobadas      = 0;
let totalBloqueadas     = 0;
let erroresEvitados     = 0;  // bloqueadas AND falladas (correctamente eliminadas)
let aciertosEvitados    = 0;  // bloqueadas AND acertadas (falso negativo - acierto perdido)
let erroresRestantes    = 0;  // aprobadas AND falladas  (falso positivo - error no atrapado)
let aciertosPreservados = 0;  // aprobadas AND acertadas (correcto)
let indeterminados      = 0;  // resultado no determinable

const detallePartidos = [];

for (const pred of predicciones) {
  const matchId  = pred.matchId;
  const resultado = resultadosPorMatch.get(matchId);
  if (!resultado) {
    console.log(`  ${matchId}: sin resultado en auditoría, omitido.`);
    continue;
  }

  const senalesOrig = pred.señales_valor ?? [];
  if (senalesOrig.length === 0) {
    console.log(`  ${matchId} ${resultado.nombre}: sin señales_valor en Firestore, omitido.`);
    continue;
  }

  const res = clasificarSenales({
    prediccion: pred,
    senales:    senalesOrig,
    contexto:   { tipo: 'individual' },
  });

  const RISK_LABEL = { EXTREME: 'critica', HIGH: 'alta', MEDIUM: 'media', LOW: 'baja' };

  const senales_aprobadas  = [...res.senales_value_bet, ...res.senales_protected];
  // Solo contar como "bloqueadas" las que tenían is_value_bet=true (evitar contar no-value naturales)
  const senales_bloqueadas = [...res.senales_watchlist, ...res.senales_no_bet]
    .filter(s => s.is_value_bet);
  const advertencias = [
    ...(res._lambda_extrema_info          ? [`LAMBDA_EXTREMA: ${res._lambda_extrema_info}`]          : []),
    ...(res._btts_ambas_lambda_riesgo     ? [`RIESGO_BTTS: ${res._btts_ambas_lambda_riesgo}`]        : []),
    ...(res.model_warnings?.length        ? res.model_warnings.map(w => `MODEL_WARNING: ${w}`)        : []),
  ];
  const nivel_fragilidad_global = RISK_LABEL[res.risk_level] ?? 'ninguna';

  const senalesValorOrig = senalesOrig.filter(s => s.is_value_bet === true);
  totalSenalesOrig += senalesValorOrig.length;
  totalAprobadas   += senales_aprobadas.length;
  totalBloqueadas  += senales_bloqueadas.length;

  const analisisBloqueadas = senales_bloqueadas.map(s => {
    const acertada = eraAcertada(s, resultado);
    if (acertada === true)  aciertosEvitados++;
    else if (acertada === false) erroresEvitados++;
    else indeterminados++;
    return { ...s, era_acertada: acertada };
  });

  const analisisAprobadas = senales_aprobadas.map(s => {
    const acertada = eraAcertada(s, resultado);
    if (acertada === true)  aciertosPreservados++;
    else if (acertada === false) erroresRestantes++;
    else indeterminados++;
    return { ...s, era_acertada: acertada };
  });

  console.log(`  ── ${matchId}  ${resultado.nombre}`);
  console.log(`     λ: ${pred.lambda_local?.toFixed(2)}/${pred.lambda_visitante?.toFixed(2)}  real: ${resultado.real_goles_local}-${resultado.real_goles_visitante}  (${resultado.real_1x2})`);
  console.log(`     fragilidad_global: ${nivel_fragilidad_global}  advertencias: ${advertencias.length}`);

  if (advertencias.length > 0) {
    for (const adv of advertencias) console.log(`     ⚠ ${adv}`);
  }

  if (senalesValorOrig.length === 0) {
    console.log(`     (sin señales de valor generadas)`);
  } else {
    console.log(`     señales orig: ${senalesValorOrig.length}  aprobadas: ${senales_aprobadas.length}  bloqueadas: ${senales_bloqueadas.length}`);

    // Mostrar aprobadas
    for (const s of analisisAprobadas) {
      const ok = s.era_acertada === true ? '✅' : s.era_acertada === false ? '❌' : '?';
      const frag = s.fragilidad ? ` [fragil=${s.fragilidad}]` : '';
      console.log(`       APROBADA  ${s.mercado}/${s.seleccion.padEnd(10)} EV=${evPct(s.expected_value).padEnd(7)} → ${ok}${frag}`);
    }

    // Mostrar bloqueadas
    for (const s of analisisBloqueadas) {
      const ok = s.era_acertada === true ? '⚠(acierto perdido)' : s.era_acertada === false ? '✓(error evitado)' : '?';
      console.log(`       BLOQUEADA ${s.mercado}/${s.seleccion.padEnd(10)} EV=${evPct(s.expected_value).padEnd(7)} [${s.regla}/${s.etiqueta}] → ${ok}`);
      if (s.sugerencia) console.log(`         sugerencia: ${s.sugerencia}`);
    }
  }
  console.log('');

  detallePartidos.push({
    matchId,
    nombre:                resultado.nombre,
    lambda_local:          pred.lambda_local,
    lambda_visitante:      pred.lambda_visitante,
    resultado_real:        `${resultado.real_goles_local}-${resultado.real_goles_visitante}`,
    real_1x2:              resultado.real_1x2,
    nivel_fragilidad:      nivel_fragilidad_global,
    advertencias,
    senales_orig_count:    senalesValorOrig.length,
    aprobadas:             analisisAprobadas,
    bloqueadas:            analisisBloqueadas,
  });
}

// ── Resumen global ────────────────────────────────────────────────────────────

const totalJuzgados = erroresEvitados + aciertosEvitados + erroresRestantes + aciertosPreservados;

console.log('═'.repeat(76));
console.log('  RESUMEN GLOBAL — Impacto retroactivo en J1 V2.1');
console.log('─'.repeat(76));
console.log(`  Partidos analizados              : ${detallePartidos.length}/12`);
console.log(`  Señales originales (is_value)    : ${totalSenalesOrig}`);
console.log(`  Señales aprobadas por filtros    : ${totalAprobadas}  (${pct(totalAprobadas, totalSenalesOrig)} del total)`);
console.log(`  Señales bloqueadas por filtros   : ${totalBloqueadas}  (${pct(totalBloqueadas, totalSenalesOrig)} del total)`);
console.log('─'.repeat(76));
console.log('  Análisis de las BLOQUEADAS:');
console.log(`    Errores evitados  (bloq + fallada)  : ${erroresEvitados}  ← señales malas correctamente eliminadas`);
console.log(`    Aciertos perdidos (bloq + acertada) : ${aciertosEvitados}  ← falsos negativos (aciertos bloqueados)`);
console.log('  Análisis de las APROBADAS:');
console.log(`    Aciertos preservados (apr + acertada): ${aciertosPreservados}  ← señales buenas que sobrevivieron`);
console.log(`    Errores restantes    (apr + fallada) : ${erroresRestantes}  ← señales malas que pasaron el filtro`);
console.log(`    Indeterminados                       : ${indeterminados}`);
console.log('─'.repeat(76));

const senalesOrigAcertadas  = aciertosPreservados + aciertosEvitados;
const senalesOrigFalladas   = erroresEvitados + erroresRestantes;
const hitRateOrig = senalesOrigAcertadas + senalesOrigFalladas > 0
  ? (senalesOrigAcertadas / (senalesOrigAcertadas + senalesOrigFalladas) * 100).toFixed(1)
  : '—';

const hitRateFiltrado = aciertosPreservados + erroresRestantes > 0
  ? (aciertosPreservados / (aciertosPreservados + erroresRestantes) * 100).toFixed(1)
  : '—';

console.log(`  Hit rate ORIGINAL  (sin filtros) : ${hitRateOrig}%  (${senalesOrigAcertadas}/${senalesOrigAcertadas + senalesOrigFalladas})`);
console.log(`  Hit rate FILTRADO  (con filtros) : ${hitRateFiltrado}%  (${aciertosPreservados}/${aciertosPreservados + erroresRestantes})`);
console.log('─'.repeat(76));

// Desglose por regla
const bloqueosPorRegla = {};
for (const p of detallePartidos) {
  for (const b of p.bloqueadas) {
    const k = b.regla ?? 'desconocida';
    if (!bloqueosPorRegla[k]) bloqueosPorRegla[k] = { total: 0, errores: 0, aciertos: 0 };
    bloqueosPorRegla[k].total++;
    if (b.era_acertada === false) bloqueosPorRegla[k].errores++;
    if (b.era_acertada === true)  bloqueosPorRegla[k].aciertos++;
  }
}

console.log('  Bloqueos por regla:');
for (const [regla, cnt] of Object.entries(bloqueosPorRegla).sort()) {
  console.log(`    ${regla.padEnd(4)}: ${cnt.total} señales bloqueadas  →  errores_evitados=${cnt.errores}  aciertos_perdidos=${cnt.aciertos}`);
}

console.log('─'.repeat(76));

// Diagnóstico de fragilidad por partido
const fragPorNivel = {};
for (const p of detallePartidos) {
  const k = p.nivel_fragilidad ?? FRAGILIDAD.NINGUNA;
  fragPorNivel[k] = (fragPorNivel[k] ?? 0) + 1;
}
console.log('  Nivel de fragilidad por partido:');
for (const [nivel, cnt] of Object.entries(fragPorNivel)) {
  console.log(`    ${nivel.padEnd(8)}: ${cnt} partido(s)`);
}

console.log('═'.repeat(76));
console.log('');

// ── Guardar reporte JSON ──────────────────────────────────────────────────────

const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const reportsDir = resolve('reports');
mkdirSync(reportsDir, { recursive: true });

const reportPath = resolve(reportsDir, `signal_filters_j1_test_${ts}.json`);
writeFileSync(reportPath, JSON.stringify({
  generado_en:              new Date().toISOString(),
  descripcion:              'Test retroactivo de clasificarSenales() (post-J1) contra J1 V2.1',
  partidos_analizados:      detallePartidos.length,
  senales_orig_total:       totalSenalesOrig,
  senales_aprobadas:        totalAprobadas,
  senales_bloqueadas:       totalBloqueadas,
  tasa_bloqueo:             totalSenalesOrig > 0 ? +(totalBloqueadas / totalSenalesOrig).toFixed(3) : 0,
  errores_evitados:         erroresEvitados,
  aciertos_perdidos:        aciertosEvitados,
  aciertos_preservados:     aciertosPreservados,
  errores_restantes:        erroresRestantes,
  hit_rate_original_pct:    hitRateOrig,
  hit_rate_filtrado_pct:    hitRateFiltrado,
  bloqueos_por_regla:       bloqueosPorRegla,
  fragilidad_por_nivel:     fragPorNivel,
  detalle:                  detallePartidos,
}, null, 2), 'utf-8');

console.log(`  Reporte guardado: reports/signal_filters_j1_test_${ts}.json\n`);

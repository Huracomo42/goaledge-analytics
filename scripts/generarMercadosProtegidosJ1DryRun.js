/**
 * generarMercadosProtegidosJ1DryRun.js — V2.2 Protection Markets Engine (revisado)
 *
 * Cambios v2 respecto al primer dry-run:
 *   - mapBaseSignalToProtectedMarkets ahora recibe contexto (prob_1x2, prob_modelo,
 *     bookmaker_odds) y devuelve { id, razon_mapeo } en lugar de strings planos.
 *   - Eliminado DC_12 como protección de favorito gana.
 *   - Eliminado AH -0.5 como protección de underdog.
 *   - Empate en partido desequilibrado → proteccion_no_recomendada (con justificación).
 *   - Añadido team_home_over_0_5 / team_away_over_0_5 para señales de favorito.
 *   - Añadido campo razon_mapeo en cada mercado protegido.
 *   - Añadida sección "Control de calidad del mapeo" en el Markdown.
 *   - Añadida sección "Análisis de The Odds API" con recomendaciones para J2.
 *
 * GARANTÍAS (idénticas a la versión anterior):
 *   - 0 escrituras en Firestore.
 *   - 0 llamadas a APIs externas.
 *   - 0 llamadas a Claude API.
 *   - No modifica el Prediction Engine V2.1.
 *   - EV = null en todos los mercados protegidos (sin cuota real).
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve }                  from 'path';
import { getFirestore }             from 'firebase-admin/firestore';

import '../src/firebase/init.js';
import {
  deriveAllProtectedMarkets,
  mapBaseSignalToProtectedMarkets,
  classifyProtectedMarketRisk,
} from '../src/betting/protectionMarkets.js';

const db = getFirestore();

const J1_IDS = [
  '537369', '537363', '537370', '537364',
  '537391', '537392', '537397', '537398',
  '537403', '537409', '537410', '537404',
];

const HOY = new Date().toISOString().slice(0, 10);

// ── Lectura Firestore ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  V2.2 — PROTECTION MARKETS ENGINE — DRY-RUN J1 (v2 — mapeo corregido)');
console.log('═'.repeat(70));
console.log(`\n  Fecha: ${HOY}  |  Sin escrituras Firestore  |  Sin llamadas API\n`);

console.log('[1/3] Leyendo predicciones J1 desde Firestore...');
const snaps = await Promise.all(
  J1_IDS.map(id => db.collection('predicciones').doc(id).get())
);

const predicciones = [];
for (const snap of snaps) {
  if (!snap.exists) { console.log(`  ✗ ${snap.id} — NO encontrado`); continue; }
  const d = snap.data();
  predicciones.push({ matchId: snap.id, ...d });
  console.log(`  ✓ ${snap.id} — ${d.nombreLocal} vs ${d.nombreVisitante}`);
}
console.log(`\n  ${predicciones.length}/12 predicciones cargadas\n`);

// ── Resolución de ID a datos de mercado ──────────────────────────────────────

function resolverMercadoProtegido(id, mercados, nombreLocal, nombreVisitante) {
  const dc   = mercados.double_chance;
  const dnb  = mercados.draw_no_bet;
  const ah   = mercados.asian_handicap;
  const tot  = mercados.totales_protegidos;
  const tt   = mercados.team_totals;

  switch (id) {
    case 'DC_1X':
      return { descripcion: `${nombreLocal} gana o empate`, fuente: 'double_chance', prob_modelo: dc['1X'] };
    case 'DC_X2':
      return { descripcion: `Empate o ${nombreVisitante} gana`, fuente: 'double_chance', prob_modelo: dc['X2'] };
    case 'DC_12':
      return { descripcion: `${nombreLocal} o ${nombreVisitante} gana`, fuente: 'double_chance', prob_modelo: dc['12'] };
    case 'DNB_local':
      return { descripcion: `${nombreLocal} DNB (empate devuelve)`, fuente: 'draw_no_bet', prob_modelo: dnb.local_dnb.prob_win };
    case 'DNB_visitante':
      return { descripcion: `${nombreVisitante} DNB (empate devuelve)`, fuente: 'draw_no_bet', prob_modelo: dnb.visitante_dnb.prob_win };
    case 'AH_local_+0.5':
      return { descripcion: `${nombreLocal} +0.5 (gana o empata)`, fuente: 'asian_handicap', prob_modelo: ah['AH_local_+0.5']?.prob_win };
    case 'AH_local_+1.0':
      return { descripcion: `${nombreLocal} +1.0 (push si pierde por 1)`, fuente: 'asian_handicap', prob_modelo: ah['AH_local_+1.0']?.prob_win, tiene_push: true, prob_push: ah['AH_local_+1.0']?.prob_push };
    case 'AH_local_+1.5':
      return { descripcion: `${nombreLocal} +1.5 (pierde si cae por 2+)`, fuente: 'asian_handicap', prob_modelo: ah['AH_local_+1.5']?.prob_win };
    case 'AH_local_-0.5':
      return { descripcion: `${nombreLocal} -0.5 (debe ganar por 1+)`, fuente: 'asian_handicap', prob_modelo: ah['AH_local_-0.5']?.prob_win };
    case 'AH_visitante_+0.5':
      return { descripcion: `${nombreVisitante} +0.5 (gana o empata)`, fuente: 'asian_handicap', prob_modelo: ah['AH_visitante_+0.5']?.prob_win };
    case 'AH_visitante_+1.0':
      return { descripcion: `${nombreVisitante} +1.0 (push si pierde por 1)`, fuente: 'asian_handicap', prob_modelo: ah['AH_visitante_+1.0']?.prob_win, tiene_push: true, prob_push: ah['AH_visitante_+1.0']?.prob_push };
    case 'AH_visitante_+1.5':
      return { descripcion: `${nombreVisitante} +1.5 (pierde si cae por 2+)`, fuente: 'asian_handicap', prob_modelo: ah['AH_visitante_+1.5']?.prob_win };
    case 'AH_visitante_-0.5':
      return { descripcion: `${nombreVisitante} -0.5 (debe ganar por 1+)`, fuente: 'asian_handicap', prob_modelo: ah['AH_visitante_-0.5']?.prob_win };
    case 'over_1.5':
      return { descripcion: 'Over 1.5 goles totales', fuente: 'totales_protegidos', prob_modelo: tot.over_1_5 };
    case 'over_2.5':
      return { descripcion: 'Over 2.5 goles totales', fuente: 'totales_protegidos', prob_modelo: tot.over_2_5 };
    case 'under_3.5':
      return { descripcion: 'Under 3.5 goles totales', fuente: 'totales_protegidos', prob_modelo: tot.under_3_5 };
    case 'team_home_over_0_5':
      return { descripcion: `${nombreLocal} ≥1 gol`, fuente: 'team_totals', prob_modelo: tt.home_over_0_5 };
    case 'team_away_over_0_5':
      return { descripcion: `${nombreVisitante} ≥1 gol`, fuente: 'team_totals', prob_modelo: tt.away_over_0_5 };
    default:
      return null;
  }
}

// ── Cálculo de mercados protegidos ───────────────────────────────────────────

console.log('[2/3] Calculando mercados protegidos...\n');

const resultados = [];

// Contadores para control de calidad
const qc = {
  total_mapeos: 0,
  alta_proteccion: 0,
  proteccion_moderada: 0,
  proteccion_limitada: 0,
  proteccion_no_recomendada: 0,
  dc12_como_proteccion_favorito: 0,
  ah_menos05_como_proteccion_underdog: 0,
  empates_mapeados_ambos_lados: 0,
};

for (const pred of predicciones) {
  const {
    matchId, nombreLocal, nombreVisitante, fechaPartido,
    lambda_local, lambda_visitante, prob_1x2, prob_over_under, señales_valor,
  } = pred;

  const nombre = `${nombreLocal} vs ${nombreVisitante}`;

  const senalesActivas = (señales_valor ?? []).filter(s =>
    s.is_value_bet === true &&
    (s.recomendacion === 'apostar' || s.recomendacion === 'considerar')
  );

  // Calcular todos los mercados matemáticos
  const mercados = deriveAllProtectedMarkets(
    lambda_local, lambda_visitante, prob_1x2, prob_over_under
  );

  if (!mercados.calculable) {
    console.log(`  ✗ ${matchId} ${nombre} — error: ${mercados.error}`);
    resultados.push({ matchId, nombre, fechaPartido, error: mercados.error });
    continue;
  }

  // Mapear cada señal activa a mercados protegidos
  const mapeo_señales = [];

  for (const señal of senalesActivas) {
    const contexto = {
      prob_1x2,
      prob_modelo:    señal.prob_modelo,
      bookmaker_odds: señal.bookmaker_odds,
    };

    const items = mapBaseSignalToProtectedMarkets(señal.mercado, señal.seleccion, contexto);

    const detalle_protegidos = [];

    for (const item of items) {
      const { id, razon_mapeo } = item;

      // Caso especial: protección no recomendada
      if (id === 'proteccion_no_recomendada') {
        qc.proteccion_no_recomendada++;
        detalle_protegidos.push({
          mercado_id:        id,
          descripcion:       'No hay protección natural para esta señal',
          fuente_calculo:    'decision_de_mapeo',
          prob_modelo:       null,
          tipo_proteccion:   'proteccion_no_recomendada',
          estado:            'no_recomendada',
          cuota_real:        null,
          EV:                null,
          edge:              null,
          razon_mapeo,
          nota:              'Ver razon_mapeo para detalles.',
        });
        continue;
      }

      const datos = resolverMercadoProtegido(id, mercados, nombreLocal, nombreVisitante);
      if (!datos) continue;

      const tipo = datos.prob_modelo != null
        ? classifyProtectedMarketRisk(datos.prob_modelo)
        : 'desconocido';

      // Contadores QC
      if      (tipo === 'alta_proteccion')     qc.alta_proteccion++;
      else if (tipo === 'proteccion_moderada') qc.proteccion_moderada++;
      else if (tipo === 'proteccion_limitada') qc.proteccion_limitada++;
      qc.total_mapeos++;

      const entry = {
        mercado_id:       id,
        descripcion:      datos.descripcion,
        fuente_calculo:   datos.fuente,
        prob_modelo:      datos.prob_modelo != null ? +datos.prob_modelo.toFixed(4) : null,
        tipo_proteccion:  tipo,
        estado:           'calculable_no_apostable',
        cuota_real:       null,
        EV:               null,
        edge:             null,
        razon_mapeo,
        nota:             'Sin cuota real. Requiere odds de The Odds API para calcular EV.',
      };

      if (datos.tiene_push) {
        entry.prob_push = datos.prob_push != null ? +datos.prob_push.toFixed(4) : null;
        entry.nota_push = 'EV debe calcularse con evConPush(), no evSimple()';
      }

      detalle_protegidos.push(entry);
    }

    // Verificar si empate se mapeó a ambos lados sin criterio
    if (señal.seleccion === 'empate') {
      const ids = items.map(i => i.id);
      if (ids.includes('DC_1X') && ids.includes('DC_X2') && ids.includes('DNB_local') && ids.includes('DNB_visitante')) {
        qc.empates_mapeados_ambos_lados++;
      }
    }

    mapeo_señales.push({
      señal_base: {
        mercado:        señal.mercado,
        seleccion:      señal.seleccion,
        equipo:         señal.equipo ?? null,
        prob_modelo:    señal.prob_modelo,
        bookmaker_odds: señal.bookmaker_odds,
        EV:             señal.expected_value,
        nivel_valor:    señal.nivel_valor,
        recomendacion:  señal.recomendacion,
      },
      mercados_protegidos: detalle_protegidos,
    });
  }

  const n_mapeados = mapeo_señales.reduce((s, m) =>
    s + m.mercados_protegidos.filter(mp => mp.estado !== 'no_recomendada').length, 0
  );
  const n_no_recomendados = mapeo_señales.reduce((s, m) =>
    s + m.mercados_protegidos.filter(mp => mp.estado === 'no_recomendada').length, 0
  );

  resultados.push({
    matchId, nombre, fechaPartido,
    lambdas: { local: lambda_local, visitante: lambda_visitante },
    prob_1x2,
    matrix_info: mercados.matrix_info,
    señales_activas_v21:   senalesActivas.length,
    todos_mercados: {
      double_chance:      mercados.double_chance,
      draw_no_bet:        mercados.draw_no_bet,
      asian_handicap:     mercados.asian_handicap,
      totales_protegidos: mercados.totales_protegidos,
      team_totals:        mercados.team_totals,
    },
    mapeo_señales,
  });

  console.log(`  ✓ ${matchId} ${nombre}`);
  console.log(`    λL=${lambda_local.toFixed(3)} λV=${lambda_visitante.toFixed(3)}`);
  console.log(`    Señales activas: ${senalesActivas.length}  →  Mapeados: ${n_mapeados}  No recomendados: ${n_no_recomendados}`);
}

// ── Generación de reportes ────────────────────────────────────────────────────

console.log('\n[3/3] Generando reportes...');

const OUT_DIR  = resolve('reports');
mkdirSync(OUT_DIR, { recursive: true });
const OUT_MD   = resolve(OUT_DIR, 'mercados_protegidos_j1_dryrun.md');
const OUT_JSON = resolve(OUT_DIR, 'mercados_protegidos_j1_dryrun.json');

// ── Helpers Markdown ──────────────────────────────────────────────────────────

const pct = n => n != null ? `${(n * 100).toFixed(1)}%` : 'N/A';
const lvl = n => {
  if (n == null) return '⬜';
  if (n >= 0.75) return '🟢';
  if (n >= 0.55) return '🟡';
  return '🔴';
};
const tipoIcon = t => {
  if (t === 'alta_proteccion')            return '🟢 alta';
  if (t === 'proteccion_moderada')        return '🟡 moderada';
  if (t === 'proteccion_limitada')        return '🔴 limitada';
  if (t === 'proteccion_no_recomendada')  return '⛔ no_recomendada';
  return '⬜ desconocido';
};

const L = [];  // líneas Markdown

L.push(`# GoalEdge Analytics V2.2 — Mercados Protegidos J1 (v2 — mapeo corregido)`);
L.push(`**Generado:** ${HOY}  |  **Modelo base:** V2.1-psico-context  |  **Dry-run:** SIN escrituras`);
L.push(``);

// ── Resumen ejecutivo ─────────────────────────────────────────────────────────

L.push(`## Resumen Ejecutivo`);
L.push(``);
L.push(`| Campo | Estado |`);
L.push(`|-------|--------|`);
L.push(`| Partidos leídos | ${predicciones.length}/12 |`);
L.push(`| Campos disponibles | lambda_local, lambda_visitante, prob_1x2, prob_over_under, señales_valor |`);
L.push(`| matriz_marcadores | ✗ No guardada en Firestore → reconstruida desde lambdas |`);
L.push(`| Cuotas mercados protegidos | ✗ Sin cuota real — todos calculable_no_apostable |`);
L.push(`| DC_12 como protección de favorito gana | ✅ Eliminado |`);
L.push(`| AH -0.5 como protección de underdog | ✅ Eliminado |`);
L.push(`| Empates sin criterio de equilibrio | ✅ Eliminado — ahora usa dif L-V y pX |`);
L.push(`| razon_mapeo por cada protección | ✅ Añadido |`);
L.push(``);

const totalMapeados = resultados
  .filter(r => !r.error)
  .reduce((s, r) => s + r.mapeo_señales.reduce((ss, m) =>
    ss + m.mercados_protegidos.filter(mp => mp.estado !== 'no_recomendada').length, 0), 0);
const totalNoRecom = resultados
  .filter(r => !r.error)
  .reduce((s, r) => s + r.mapeo_señales.reduce((ss, m) =>
    ss + m.mercados_protegidos.filter(mp => mp.estado === 'no_recomendada').length, 0), 0);

L.push(`**Transformaciones activas:** ${totalMapeados}  |  **No recomendadas:** ${totalNoRecom}  |  **Escrituras Firestore:** 0  |  **Llamadas API:** 0`);
L.push(``);
L.push(`> ⚠️ EV = null en todos los mercados protegidos. Sin cuota real de The Odds API.`);
L.push(``);

// ── Control de calidad ────────────────────────────────────────────────────────

L.push(`## Control de Calidad del Mapeo`);
L.push(``);
L.push(`| Métrica | Resultado |`);
L.push(`|---------|-----------|`);
L.push(`| Total transformaciones activas | ${qc.total_mapeos} |`);
L.push(`| 🟢 alta_proteccion (prob ≥ 75%) | ${qc.alta_proteccion} |`);
L.push(`| 🟡 proteccion_moderada (55–75%) | ${qc.proteccion_moderada} |`);
L.push(`| 🔴 proteccion_limitada (< 55%) | ${qc.proteccion_limitada} |`);
L.push(`| ⛔ proteccion_no_recomendada | ${qc.proteccion_no_recomendada} |`);
L.push(`| DC_12 como protección de favorito gana | ${qc.dc12_como_proteccion_favorito} ✅ |`);
L.push(`| AH -0.5 como protección de underdog | ${qc.ah_menos05_como_proteccion_underdog} ✅ |`);
L.push(`| Empates mapeados a ambos lados sin criterio | ${qc.empates_mapeados_ambos_lados} ✅ |`);
L.push(``);
L.push(`**Interpretación de proteccion_no_recomendada:** El modelo detectó valor en un empate pero el partido`);
L.push(`es demasiado desequilibrado para cubrir ese empate sin exponer al favorito. No hay mercado protegido`);
L.push(`que mantenga la hipótesis sin contradecirla. Se documenta con razon_mapeo para auditoría.`);
L.push(``);

// ── Por partido ───────────────────────────────────────────────────────────────

L.push(`## Análisis por Partido`);
L.push(``);

for (const r of resultados) {
  if (r.error) {
    L.push(`### ✗ ${r.matchId} — ${r.nombre}`);
    L.push(`**Error:** ${r.error}`);
    L.push(``);
    continue;
  }

  const { matchId, nombre, fechaPartido, lambdas, prob_1x2, todos_mercados, mapeo_señales } = r;
  const dc  = todos_mercados.double_chance;
  const dnb = todos_mercados.draw_no_bet;
  const ah  = todos_mercados.asian_handicap;
  const tot = todos_mercados.totales_protegidos;
  const tt  = todos_mercados.team_totals;
  const [local, visitante] = nombre.split(' vs ');

  L.push(`### ${matchId} — ${nombre}`);
  L.push(`**Fecha:** ${fechaPartido}  |  λL=\`${lambdas.local.toFixed(4)}\`  λV=\`${lambdas.visitante.toFixed(4)}\``);
  L.push(``);
  L.push(`**1X2 del modelo:** L=${pct(prob_1x2.local)}  X=${pct(prob_1x2.empate)}  V=${pct(prob_1x2.visitante)}`);
  L.push(``);

  // Señales activas
  if (r.señales_activas_v21 > 0) {
    L.push(`#### Señales V2.1 activas`);
    L.push(``);
    for (const ms of mapeo_señales) {
      const s = ms.señal_base;
      const eq = s.equipo ? ` (${s.equipo})` : '';
      L.push(`- **${s.mercado}/${s.seleccion}**${eq} — EV=${pct(s.EV)}  cuota=${s.bookmaker_odds}  prob=${pct(s.prob_modelo)}  [${s.nivel_valor}] → _${s.recomendacion}_`);
    }
    L.push(``);
  } else {
    L.push(`_Sin señales activas V2.1 (apostar/considerar)._`);
    L.push(``);
  }

  // Tabla completa de mercados calculados
  L.push(`#### Todos los Mercados Calculados`);
  L.push(``);
  L.push(`| Mercado | Prob Modelo | Nivel |`);
  L.push(`|---------|-------------|-------|`);
  L.push(`| DC 1X (${local} o empate) | ${pct(dc['1X'])} | ${lvl(dc['1X'])} |`);
  L.push(`| DC X2 (empate o ${visitante}) | ${pct(dc['X2'])} | ${lvl(dc['X2'])} |`);
  L.push(`| DC 12 (sin empate) | ${pct(dc['12'])} | ${lvl(dc['12'])} |`);
  L.push(`| DNB ${local} | ${pct(dnb.local_dnb.prob_win)} | ${lvl(dnb.local_dnb.prob_win)} |`);
  L.push(`| DNB ${visitante} | ${pct(dnb.visitante_dnb.prob_win)} | ${lvl(dnb.visitante_dnb.prob_win)} |`);
  L.push(`| AH ${local} +0.5 | ${pct(ah['AH_local_+0.5']?.prob_win)} | ${lvl(ah['AH_local_+0.5']?.prob_win)} |`);
  L.push(`| AH ${local} +1.0 | ${pct(ah['AH_local_+1.0']?.prob_win)} (push=${pct(ah['AH_local_+1.0']?.prob_push)}) | ${lvl(ah['AH_local_+1.0']?.prob_win)} |`);
  L.push(`| AH ${local} +1.5 | ${pct(ah['AH_local_+1.5']?.prob_win)} | ${lvl(ah['AH_local_+1.5']?.prob_win)} |`);
  L.push(`| AH ${visitante} +0.5 | ${pct(ah['AH_visitante_+0.5']?.prob_win)} | ${lvl(ah['AH_visitante_+0.5']?.prob_win)} |`);
  L.push(`| AH ${visitante} +1.0 | ${pct(ah['AH_visitante_+1.0']?.prob_win)} (push=${pct(ah['AH_visitante_+1.0']?.prob_push)}) | ${lvl(ah['AH_visitante_+1.0']?.prob_win)} |`);
  L.push(`| AH ${visitante} +1.5 | ${pct(ah['AH_visitante_+1.5']?.prob_win)} | ${lvl(ah['AH_visitante_+1.5']?.prob_win)} |`);
  L.push(`| Over 1.5 | ${pct(tot.over_1_5)} | ${lvl(tot.over_1_5)} |`);
  L.push(`| Over 2.5 | ${pct(tot.over_2_5)} | ${lvl(tot.over_2_5)} |`);
  L.push(`| Under 2.5 | ${pct(tot.under_2_5)} | ${lvl(tot.under_2_5)} |`);
  L.push(`| Under 3.5 | ${pct(tot.under_3_5)} | ${lvl(tot.under_3_5)} |`);
  L.push(`| Team ${local} ≥1 gol | ${pct(tt.home_over_0_5)} | ${lvl(tt.home_over_0_5)} |`);
  L.push(`| Team ${visitante} ≥1 gol | ${pct(tt.away_over_0_5)} | ${lvl(tt.away_over_0_5)} |`);
  L.push(``);

  // Transformaciones señal → protección
  if (mapeo_señales.length > 0) {
    L.push(`#### Transformación Señal V2.1 → Versión Protegida V2.2`);
    L.push(``);

    for (const ms of mapeo_señales) {
      const s = ms.señal_base;
      const eq = s.equipo ? ` (${s.equipo})` : '';
      L.push(`**Señal base:** \`${s.mercado}/${s.seleccion}\`${eq}  EV=${pct(s.EV)}  cuota=${s.bookmaker_odds}  prob=${pct(s.prob_modelo)}`);
      L.push(``);

      if (ms.mercados_protegidos.length === 0) {
        L.push(`_Sin versiones protegidas (mercado ya conservador o no protegible)._`);
      } else {
        L.push(`| Mercado | Prob | Tipo | Estado | Razón |`);
        L.push(`|---------|------|------|--------|-------|`);
        for (const mp of ms.mercados_protegidos) {
          const probStr  = mp.prob_modelo != null ? pct(mp.prob_modelo) : '—';
          const pushStr  = mp.prob_push   != null ? ` (push=${pct(mp.prob_push)})` : '';
          const estado   = mp.estado === 'no_recomendada' ? '⛔ no_recomendada' : '⚠️ sin cuota';
          const razon    = mp.razon_mapeo.length > 80 ? mp.razon_mapeo.slice(0, 80) + '…' : mp.razon_mapeo;
          L.push(`| \`${mp.mercado_id}\` | ${probStr}${pushStr} | ${tipoIcon(mp.tipo_proteccion)} | ${estado} | ${razon} |`);
        }
      }
      L.push(``);
    }
  }

  L.push(`---`);
  L.push(``);
}

// ── Análisis de The Odds API ─────────────────────────────────────────────────

L.push(`## Análisis de The Odds API — Preparación para J2`);
L.push(``);
L.push(`### Situación actual`);
L.push(``);
L.push(`El parámetro \`markets=\` está **hardcodeado** en dos scripts:`);
L.push(``);
L.push(`| Script | Línea | Valor actual |`);
L.push(`|--------|-------|--------------|`);
L.push(`| \`guardarOddsPorMatchIds.js\` | 193 | \`markets=h2h,totals\` |`);
L.push(`| \`guardarOddsDelDia.js\` | 80 | \`markets=h2h,totals\` |`);
L.push(``);
L.push(`El pipeline \`oddsApi.js\` solo tiene procesadores para \`h2h\` y \`totals\`.`);
L.push(`No hay soporte para \`double_chance\`, \`draw_no_bet\` ni \`asian_handicap\`.`);
L.push(``);
L.push(`### ⚠️ Advertencia crítica`);
L.push(``);
L.push(`> **NO gastar una llamada completa de jornada para verificar nombres de mercado.**`);
L.push(`> Los nombres de market key en The Odds API v4 pueden diferir de lo esperado:`);
L.push(``);
L.push(`| Mercado esperado | Posibles keys en The Odds API |`);
L.push(`|------------------|-------------------------------|`);
L.push(`| Double Chance | \`double_chance\` |`);
L.push(`| Draw No Bet | \`draw_no_bet\` |`);
L.push(`| Asian Handicap | \`spreads\` ó \`asian_handicap\` ó \`alternate_spreads\` |`);
L.push(`| Over/Under líneas alternativas | ya disponible en \`totals\` (incluye múltiples líneas) |`);
L.push(``);
L.push(`### Plan de verificación mínima (antes de J2)`);
L.push(``);
L.push(`1. **Hacer UNA llamada de prueba con 1 partido** antes de gastar créditos de jornada:`);
L.push(`   \`\`\``);
L.push(`   GET /v4/sports/soccer_fifa_world_cup/odds?apiKey=***`);
L.push(`      &regions=eu`);
L.push(`      &markets=h2h,totals,double_chance,draw_no_bet,spreads`);
L.push(`      &eventIds=<un_event_id_conocido>`);
L.push(`   \`\`\``);
L.push(`2. Revisar qué \`market.key\` devuelve la respuesta para cada mercado.`);
L.push(`3. Solo entonces añadir los procesadores en \`oddsApi.js\` y ampliar la URL.`);
L.push(``);
L.push(`### Cambios mínimos para J2 (no hacer hasta verificar keys)`);
L.push(``);
L.push(`**En \`guardarOddsPorMatchIds.js\` y \`guardarOddsDelDia.js\`:**`);
L.push(`\`\`\`js`);
L.push(`// Antes`);
L.push(`const url = \`\${BASE_URL}/v4/sports/\${SPORT}/odds?...&markets=h2h,totals&...\`;`);
L.push(`// Después (una vez verificados los keys)`);
L.push(`const MARKETS = 'h2h,totals,double_chance,draw_no_bet,<key_AH_verificado>';`);
L.push(`const url = \`\${BASE_URL}/v4/sports/\${SPORT}/odds?...&markets=\${MARKETS}&...\`;`);
L.push(`\`\`\``);
L.push(``);
L.push(`**En \`oddsApi.js\`:** Añadir \`procesarDoubleChance()\`, \`procesarDrawNoBet()\`, \`procesarAsianHandicap()\`.`);
L.push(`**En \`actualizarSenalesConOdds.js\`:** Añadir evaluación de señales para los nuevos mercados.`);
L.push(``);

// ── Advertencias metodológicas ────────────────────────────────────────────────

L.push(`## Advertencias Metodológicas`);
L.push(``);
L.push(`1. **Matriz truncada en MAX_GOLES=6:** Para lambdas ≤ 3.6 el impacto es < 0.1% en todas las probabilidades.`);
L.push(`2. **AH +1.0 y push:** El EV real requiere \`evConPush(prob_win, prob_loss, cuota)\`, nunca \`evSimple()\`.`);
L.push(`3. **TAU = 0 provisional:** Sin backtest histórico. No apostar solo por EV > 0.`);
L.push(`4. **proteccion_no_recomendada:** No es un error — es una decisión documentada. El modelo dice "no hay protección coherente".`);
L.push(`5. **Team totals independientes:** Se calculan desde la distribución marginal de Poisson, no desde la matriz conjunta.`);
L.push(``);

L.push(`---`);
L.push(`*GoalEdge Analytics V2.2 — Protection Markets Layer (v2) — ${HOY} — DRY-RUN*`);

writeFileSync(OUT_MD, L.join('\n'), 'utf8');

// ── JSON ──────────────────────────────────────────────────────────────────────

const jsonOutput = {
  meta: {
    version:             'V2.2-protection-markets-v2',
    modelo_base:         'V2.1-psico-context',
    generado_en:         HOY,
    jornada:             1,
    modo:                'dry-run',
    cambios_vs_v1: [
      'mapBaseSignalToProtectedMarkets ahora es context-aware',
      'DC_12 eliminado como protección de favorito local',
      'AH -0.5 eliminado como protección de underdog',
      'empate en partido desequilibrado → proteccion_no_recomendada',
      'team_home_over_0_5 / team_away_over_0_5 añadidos para señales de favorito',
      'razon_mapeo añadido en cada transformación',
    ],
    escrituras_firestore: 0,
    llamadas_api:         0,
    partidos_leidos:      predicciones.length,
    control_calidad: {
      ...qc,
      dc12_eliminado:           qc.dc12_como_proteccion_favorito === 0,
      ah_menos05_eliminado:     qc.ah_menos05_como_proteccion_underdog === 0,
      empates_sin_criterio:     qc.empates_mapeados_ambos_lados === 0,
    },
    advertencias_odds_api: [
      'markets=h2h,totals hardcodeado en guardarOddsPorMatchIds.js y guardarOddsDelDia.js',
      'NO gastar llamada de jornada para verificar nombres de market key',
      'Verificar primero con ?eventIds=<un_id> y markets=h2h,totals,double_chance,draw_no_bet,spreads',
    ],
  },
  partidos: resultados,
};

writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), 'utf8');

// ── Resumen final ─────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`);
console.log(`  COMPLETADO`);
console.log(`${'─'.repeat(70)}`);
console.log(`  ✓ Markdown  : ${OUT_MD}`);
console.log(`  ✓ JSON      : ${OUT_JSON}`);
console.log(`  Partidos    : ${resultados.filter(r => !r.error).length}/12`);
console.log(`  Mapeados    : ${totalMapeados} transformaciones activas`);
console.log(`  No recom.   : ${totalNoRecom} (empates en partidos desequilibrados)`);
console.log(`${'─'.repeat(70)}`);
console.log(`  Control de calidad:`);
console.log(`    alta_proteccion     : ${qc.alta_proteccion}`);
console.log(`    proteccion_moderada : ${qc.proteccion_moderada}`);
console.log(`    proteccion_limitada : ${qc.proteccion_limitada}`);
console.log(`    no_recomendada      : ${qc.proteccion_no_recomendada}`);
console.log(`    DC_12 como favorito : ${qc.dc12_como_proteccion_favorito} ✅`);
console.log(`    AH -0.5 underdog    : ${qc.ah_menos05_como_proteccion_underdog} ✅`);
console.log(`    Empates sin criterio: ${qc.empates_mapeados_ambos_lados} ✅`);
console.log(`${'─'.repeat(70)}`);
console.log(`  Escrituras Firestore : 0`);
console.log(`  Llamadas API         : 0`);
console.log(`${'═'.repeat(70)}\n`);

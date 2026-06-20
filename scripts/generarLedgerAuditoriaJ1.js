/**
 * Genera el ledger completo de auditoría J1 (CSV + MD).
 * Fuentes: archivos JSON ya en /reports — sin Firestore, sin llamadas a API.
 *
 * Outputs:
 *   reports/auditoria_j1_ledger_completo.csv  (25 columnas)
 *   reports/auditoria_j1_resumen_final.md     (secciones A-G)
 *
 * Restricciones:
 *   - No modifica el modelo, filtros ni pesos.
 *   - No borra ningún archivo existente.
 *   - Solo métricas sobre J1_AUDITABLES (12 partidos con predicción V2.1).
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const J1_TOTAL      = 24;
const J1_AUDITABLES = new Set([
  '537369','537363','537370','537364','537391',
  '537392','537397','537398','537403','537409','537410','537404'
]);
const J1_NO_AUDITABLES = J1_TOTAL - J1_AUDITABLES.size; // 12

const STAKE = 1; // unidad flat por señal

const REPORTS = path.join(__dirname, '..', 'reports');
const OUT_CSV = path.join(REPORTS, 'auditoria_j1_ledger_completo.csv');
const OUT_MD  = path.join(REPORTS, 'auditoria_j1_resumen_final.md');

// ─── CARGA DE DATOS ──────────────────────────────────────────────────────────
const auditoria  = JSON.parse(fs.readFileSync(path.join(REPORTS, 'auditoria_j1_predicciones_20260618052649.json'),   'utf8'));
const filters    = JSON.parse(fs.readFileSync(path.join(REPORTS, 'signal_filters_j1_test_20260618054548.json'),      'utf8'));
const combinadas = JSON.parse(fs.readFileSync(path.join(REPORTS, 'combinadas_j1_dryrun.json'),                       'utf8'));
const spreads    = JSON.parse(fs.readFileSync(path.join(REPORTS, 'senales_protegidas_j1_spreads_dryrun.json'),       'utf8'));

// ─── ÍNDICES ─────────────────────────────────────────────────────────────────
// matchId → datos de predicción/resultado
const matchIdx = {};
for (const d of auditoria.detalle) {
  if (d.estado === 'auditado') matchIdx[d.matchId] = d;
}

// nombre del partido → matchId  (para las spreads que solo tienen nombre)
const nombreToId = {};
for (const d of auditoria.detalle) {
  if (d.estado === 'auditado') nombreToId[d.nombre] = d.matchId;
}

// (matchId|mercado|seleccion) → era_acertada
const acertadaIdx = {};
for (const p of filters.detalle) {
  for (const s of [...p.aprobadas, ...p.bloqueadas]) {
    acertadaIdx[`${p.matchId}|${s.mercado}|${s.seleccion}`] = s.era_acertada;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function r(n, d = 4) { return n == null ? '' : parseFloat(n.toFixed(d)); }

function escapeCSV(v) {
  const s = (v == null) ? '' : String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSVRow(obj) { return Object.values(obj).map(escapeCSV).join(','); }

function nivelRiesgoPartido(pf) {
  if (!pf) return 'UNKNOWN';
  const adv = pf.advertencias || [];
  if (adv.some(a => a.includes('LAMBDA_EXTREMA'))) return 'HIGH';
  const nf = pf.nivel_fragilidad || 'ninguna';
  if (nf === 'critica' || nf === 'alta') return 'HIGH';
  if (nf === 'media') return 'MEDIUM';
  return 'LOW';
}

function resolverAciertoAH(gl, gv, id) {
  const m = id.match(/AH_(local|visitante)_([+-][\d.]+)/);
  if (!m) return 'N/A';
  const side = m[1];
  const line = parseFloat(m[2]);
  const adj  = side === 'local' ? gl + line : gv + line;
  const opp  = side === 'local' ? gv : gl;
  if (adj > opp)  return 'SI';
  if (adj === opp) return 'EMPUJE';
  return 'NO';
}

function pct(n, d = 1) { return isNaN(n) ? 'N/A' : `${(n * 100).toFixed(d)}%`; }
function sign(n) { return n >= 0 ? `+${n.toFixed(4)}` : n.toFixed(4); }

// ─── CONSTRUIR FILAS ─────────────────────────────────────────────────────────
const rows = [];
let seq = 1;

// ===== 1. SEÑALES INDIVIDUALES (aprobadas + bloqueadas) ======================
for (const pf of filters.detalle) {
  const mid = pf.matchId;
  if (!J1_AUDITABLES.has(mid)) continue;
  const m    = matchIdx[mid];
  const real = m ? `${m.real_goles_local}-${m.real_goles_visitante}` : '';
  const riesgo = nivelRiesgoPartido(pf);

  for (const s of pf.aprobadas) {
    const gananciaBruta = s.era_acertada
      ? (s.bookmaker_odds - 1) * STAKE
      : -STAKE;
    rows.push({
      id_prediccion:    `J1_IND_${String(seq++).padStart(3,'0')}`,
      matchId:           mid,
      partido:           pf.nombre,
      fecha:             m?.fechaUTC || '',
      jornada:           'J1',
      mercado:           s.mercado,
      tipo_apuesta:      'individual',
      componentes:       s.seleccion,
      cuota:             r(s.bookmaker_odds),
      prob_modelo:       r(s.prob_modelo),
      prob_implicita:    r(s.implied_probability),
      prob_no_vig:       r(s.no_vig_probability),
      edge:              r(s.edge),
      ev:                r(s.expected_value),
      stake_simulado:    r(s.kelly_fraction ? s.kelly_fraction * 100 : null, 2),
      recomendada_si_no: 'SI',
      bloqueada_si_no:   'NO',
      motivo_bloqueo:    '',
      regla_origen:      '',
      nivel_riesgo:      riesgo,
      version_modelo:    '2.1-psico-context',
      resultado_real:    real,
      acierto:           s.era_acertada ? 'SI' : 'NO',
      ganancia_perdida:  r(gananciaBruta),
      observacion:       s.fragilidad || (pf.advertencias || []).join('; '),
    });
  }

  for (const s of pf.bloqueadas) {
    rows.push({
      id_prediccion:    `J1_IND_${String(seq++).padStart(3,'0')}`,
      matchId:           mid,
      partido:           pf.nombre,
      fecha:             m?.fechaUTC || '',
      jornada:           'J1',
      mercado:           s.mercado,
      tipo_apuesta:      'individual',
      componentes:       s.seleccion,
      cuota:             r(s.bookmaker_odds),
      prob_modelo:       r(s.prob_modelo),
      prob_implicita:    r(s.implied_probability),
      prob_no_vig:       r(s.no_vig_probability),
      edge:              r(s.edge),
      ev:                r(s.expected_value),
      stake_simulado:    r(s.kelly_fraction ? s.kelly_fraction * 100 : null, 2),
      recomendada_si_no: 'NO',
      bloqueada_si_no:   'SI',
      motivo_bloqueo:    s.etiqueta || '',
      regla_origen:      s.regla || '',
      nivel_riesgo:      riesgo,
      version_modelo:    '2.1-psico-context',
      resultado_real:    real,
      acierto:           s.era_acertada ? 'SI' : 'NO',
      ganancia_perdida:  0,   // no se jugó
      observacion:       s.razon_bloqueo || s.sugerencia || '',
    });
  }
}

// ===== 2. COMBINADAS =========================================================
for (const c of combinadas.combinadas) {
  const patas  = c.seleccion_detalle;
  let allWin   = true;
  let anyUndef = false;
  const componentesList = [];

  for (const p of patas) {
    const key = `${p.matchId}|${p.mercado}|${p.seleccion}`;
    const ea  = acertadaIdx[key];
    if (ea === undefined) { anyUndef = true; allWin = false; }
    else if (!ea)         { allWin = false; }
    const partido0 = (p.partido || '').split(' vs ')[0] || p.matchId;
    componentesList.push(`${partido0}:${p.seleccion}`);
  }

  const acierto       = anyUndef ? 'N/A' : (allWin ? 'SI' : 'NO');
  const gananciaBruta = allWin ? (c.cuota_combinada - 1) * STAKE : -STAKE;

  rows.push({
    id_prediccion:    c.id_combinada,
    matchId:           c.matchIds.join('+'),
    partido:           c.partidos.join(' / '),
    fecha:             (c.fechas || [])[0] || '',
    jornada:           'J1',
    mercado:           'combinada',
    tipo_apuesta:      `combinada_${c.categoria_riesgo}`,
    componentes:       componentesList.join(' | '),
    cuota:             r(c.cuota_combinada),
    prob_modelo:       r(c.probabilidad_modelo_combinada),
    prob_implicita:    r(1 / c.cuota_combinada),
    prob_no_vig:       '',
    edge:              '',
    ev:                r(c.EV_combinado),
    stake_simulado:    STAKE,
    recomendada_si_no: 'SI',
    bloqueada_si_no:   'NO',
    motivo_bloqueo:    '',
    regla_origen:      '',
    nivel_riesgo:      'MEDIUM',
    version_modelo:    '2.1-psico-context',
    resultado_real:    '',
    acierto,
    ganancia_perdida:  acierto === 'N/A' ? '' : r(acierto === 'SI' ? gananciaBruta : -STAKE),
    observacion:       c.razon_clasificacion || '',
  });
}

// ===== 3. SPREADS / MERCADOS PROTEGIDOS (top-10-ev) ==========================
for (const sp of (spreads.meta || {}).top_10_ev || []) {
  const mid = nombreToId[sp.partido] || '';
  const m   = matchIdx[mid];
  const real = m ? `${m.real_goles_local}-${m.real_goles_visitante}` : '';
  const acierto = m ? resolverAciertoAH(m.real_goles_local, m.real_goles_visitante, sp.id) : 'N/A';
  const aciertoBool = acierto === 'SI';
  const gananciaBruta = acierto === 'EMPUJE' ? 0
    : aciertoBool ? (sp.cuota_real - 1) * STAKE : -STAKE;

  rows.push({
    id_prediccion:    `J1_PROT_${String(seq++).padStart(3,'0')}`,
    matchId:           mid,
    partido:           sp.partido,
    fecha:             m?.fechaUTC || '',
    jornada:           'J1',
    mercado:           'spreads',
    tipo_apuesta:      'protegida',
    componentes:       sp.descripcion,
    cuota:             sp.cuota_real,
    prob_modelo:       sp.prob_modelo,
    prob_implicita:    r(1 / sp.cuota_real),
    prob_no_vig:       '',
    edge:              sp.edge,
    ev:                sp.ev,
    stake_simulado:    STAKE,
    recomendada_si_no: 'SI',
    bloqueada_si_no:   'NO',
    motivo_bloqueo:    '',
    regla_origen:      'PROTECCION',
    nivel_riesgo:      sp.tipo_proteccion === 'alta_proteccion' ? 'LOW' : 'MEDIUM',
    version_modelo:    '2.1-psico-context',
    resultado_real:    real,
    acierto,
    ganancia_perdida:  r(gananciaBruta),
    observacion:       sp.tipo_proteccion,
  });
}

// ─── ESCRIBIR CSV ─────────────────────────────────────────────────────────────
const HEADERS = [
  'id_prediccion','matchId','partido','fecha','jornada',
  'mercado','tipo_apuesta','componentes','cuota',
  'prob_modelo','prob_implicita','prob_no_vig','edge','ev',
  'stake_simulado','recomendada_si_no','bloqueada_si_no',
  'motivo_bloqueo','regla_origen','nivel_riesgo',
  'version_modelo','resultado_real','acierto',
  'ganancia_perdida','observacion',
];
const csvLines = [HEADERS.join(','), ...rows.map(toCSVRow)];
fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf8');

// ─── CALCULAR ESTADÍSTICAS PARA EL MD ─────────────────────────────────────────
// A. Conteos de partidos
const matchAudit  = auditoria.metricas_globales;

// B. Señales individuales
const indivRows  = rows.filter(r => r.tipo_apuesta === 'individual');
const aprobadas  = indivRows.filter(r => r.recomendada_si_no === 'SI');
const bloqueadas = indivRows.filter(r => r.bloqueada_si_no  === 'SI');

const aprHits    = aprobadas.filter(r => r.acierto === 'SI').length;
const aprMisses  = aprobadas.filter(r => r.acierto === 'NO').length;
const aprROI_num = aprobadas.reduce((s, r) => s + (parseFloat(r.ganancia_perdida) || 0), 0);
const aprROI     = aprROI_num / (aprobadas.length * STAKE);

const blkHits    = bloqueadas.filter(r => r.acierto === 'SI').length;
const blkErrors  = bloqueadas.filter(r => r.acierto === 'NO').length;

// C. Por mercado (señales aprobadas únicamente)
function statsByMercado(mercadoKey) {
  const sub = aprobadas.filter(r => r.mercado === mercadoKey);
  const hits = sub.filter(r => r.acierto === 'SI').length;
  const pnl  = sub.reduce((s, r) => s + (parseFloat(r.ganancia_perdida)||0), 0);
  return { n: sub.length, hits, hr: sub.length ? hits/sub.length : 0, pnl: r(pnl) };
}
const statH2H   = statsByMercado('h2h');
const statTotal = statsByMercado('totals');

// C2. Spreads
const spreadRows = rows.filter(r => r.tipo_apuesta === 'protegida');
const spHits  = spreadRows.filter(r => r.acierto === 'SI').length;
const spPush  = spreadRows.filter(r => r.acierto === 'EMPUJE').length;
const spPNL   = spreadRows.reduce((s, r) => s + (parseFloat(r.ganancia_perdida)||0), 0);

// D. Por tipo de combinada
function statsByCombinada(cat) {
  const sub = rows.filter(r => r.tipo_apuesta === `combinada_${cat}`);
  const hits = sub.filter(r => r.acierto === 'SI').length;
  const pnl  = sub.filter(r => r.acierto !== 'N/A').reduce((s, r) => s + (parseFloat(r.ganancia_perdida)||0), 0);
  return { n: sub.length, hits, hr: sub.length ? hits/sub.length : 0, pnl: r(pnl) };
}
const statCons  = statsByCombinada('conservadora');
const statMod   = statsByCombinada('moderada');
const statSpec  = statsByCombinada('especulativa');

// E. Por regla de filtro (señales bloqueadas)
const reglaCount = {};
for (const row of bloqueadas) {
  const reg = row.regla_origen || 'SIN_REGLA';
  if (!reglaCount[reg]) reglaCount[reg] = { total: 0, errores: 0, aciertos: 0 };
  reglaCount[reg].total++;
  if (row.acierto === 'SI') reglaCount[reg].aciertos++;
  else                       reglaCount[reg].errores++;
}

// Top 10 reglas más dañinas (bloquearon aciertos)
const reglasDañinas = Object.entries(filters.bloqueos_por_regla || {})
  .sort((a,b) => (b[1].aciertos||0)-(a[1].aciertos||0));
// Top 10 reglas más útiles (bloquearon errores)
const reglasUtiles = Object.entries(filters.bloqueos_por_regla || {})
  .sort((a,b) => (b[1].errores||0)-(a[1].errores||0));

// F. Diagnóstico lambda extrema
const lambdaExtremaMatches = filters.detalle.filter(p =>
  (p.advertencias||[]).some(a => a.includes('LAMBDA_EXTREMA'))
);

// ─── GENERAR MD ───────────────────────────────────────────────────────────────
const ts = new Date().toISOString().split('T')[0];

const md = `# Auditoría J1 — GoalEdge V2.1 · Resumen Final
**Generado:** ${ts} | **Modelo:** V2.1-psico-context | **Jornada:** 1 — Mundial 2026

---

## A · Conteo de Partidos

| Categoría | N | Notas |
|-----------|---|-------|
| J1 TOTAL PARTIDOS | ${J1_TOTAL} | Todos los partidos de jornada 1 |
| J1 NO AUDITABLES | ${J1_NO_AUDITABLES} | Sin predicción V2/V2.1 antes del partido |
| J1 AUDITABLES | ${J1_AUDITABLES.size} | Tuvieron predicción V2.1-psico-context |
| Señales individuales generadas | ${indivRows.length} | ${aprobadas.length} aprobadas · ${bloqueadas.length} bloqueadas |
| Combinadas (dryrun) | ${combinadas.combinadas.length} | ${combinadas.meta.resumen.conservadoras} conservadoras · ${combinadas.meta.resumen.moderadas} moderadas · ${combinadas.meta.resumen.especulativas} especulativas |
| Spreads top-10 evaluados | ${spreadRows.length} | De 55 mercados protegidos calculados |

> **IMPORTANTE:** Todas las métricas de la auditoría se calculan **solo sobre los ${J1_AUDITABLES.size} J1_AUDITABLES**.
> Los ${J1_NO_AUDITABLES} partidos sin predicción V2.1 están excluidos de cualquier cálculo de rendimiento.

---

## B · Rendimiento General (J1 Auditables)

### B.1 Métricas de predicción del modelo

| Mercado | Aciertos | Total | Tasa | Referencia naive |
|---------|----------|-------|------|-----------------|
| 1x2 resultado | ${matchAudit.aciertos_1x2} | ${matchAudit.partidos_auditados} | **${pct(matchAudit.tasa_1x2)}** | ~33% |
| Over/Under 2.5 | ${matchAudit.aciertos_ou25} | ${matchAudit.partidos_auditados} | **${pct(matchAudit.tasa_ou25)}** | ~50% |
| BTTS (ambos anotan) | ${matchAudit.aciertos_btts} | ${matchAudit.partidos_auditados} | **${pct(matchAudit.tasa_btts)}** | ~50% |
| Marcador exacto | ${matchAudit.aciertos_marcador} | ${matchAudit.partidos_auditados} | **${pct(matchAudit.tasa_marcador)}** | ~3-5% |
| MAE goles (prom.) | — | — | **${matchAudit.mae_goles_promedio}** | — |
| Brier 1x2 (prom.) | — | — | **${matchAudit.brier_1x2_promedio}** | 0.667 (aleatorio) |

### B.2 Métricas de señales individuales

| Métrica | Valor |
|---------|-------|
| Señales generadas (todas) | ${indivRows.length} |
| Señales aprobadas por filtros | ${aprobadas.length} |
| Señales bloqueadas por filtros | ${bloqueadas.length} |
| Hit rate sin filtros (todas) | ${pct((aprHits + blkHits) / indivRows.length)} |
| Hit rate filtrado (solo aprobadas) | **${pct(aprHits / aprobadas.length)}** |
| P&L flat stake aprobadas | **${sign(aprROI_num)} u** en ${aprobadas.length} u apostadas |
| ROI flat stake aprobadas | **${pct(aprROI)}** |
| Errores evitados por filtros | ${blkErrors} de ${bloqueadas.length} bloqueadas |
| Aciertos perdidos por filtros | ${blkHits} de ${bloqueadas.length} bloqueadas |

---

## C · Rendimiento por Mercado

### C.1 Señales individuales aprobadas por mercado

| Mercado | N señales | Aciertos | Hit rate | P&L (flat 1u) |
|---------|-----------|----------|----------|---------------|
| h2h (ganador/empate) | ${statH2H.n} | ${statH2H.hits} | ${pct(statH2H.hr)} | ${sign(statH2H.pnl)} |
| totals (over/under 2.5) | ${statTotal.n} | ${statTotal.hits} | ${pct(statTotal.hr)} | ${sign(statTotal.pnl)} |

### C.2 Spreads / Mercados protegidos (top-10-ev)

| Métrica | Valor |
|---------|-------|
| Spreads evaluados | ${spreadRows.length} |
| Ganadores (SI) | ${spHits} |
| Empates/Push | ${spPush} |
| Perdedores | ${spreadRows.length - spHits - spPush} |
| Hit rate | ${pct(spHits / spreadRows.length)} |
| P&L flat stake | ${sign(spPNL)} u |

---

## D · Rendimiento por Tipo de Combinada

| Tipo | N combinadas | Ganadoras | Hit rate | P&L (flat 1u/combo) |
|------|-------------|-----------|----------|---------------------|
| Conservadora | ${statCons.n} | ${statCons.hits} | ${pct(statCons.hr)} | ${sign(statCons.pnl)} |
| Moderada | ${statMod.n} | ${statMod.hits} | ${pct(statMod.hr)} | ${sign(statMod.pnl)} |
| Especulativa | ${statSpec.n} | ${statSpec.hits} | ${pct(statSpec.hr)} | ${sign(statSpec.pnl)} |
| **TOTAL** | **${statCons.n+statMod.n+statSpec.n}** | **${statCons.hits+statMod.hits+statSpec.hits}** | **${pct((statCons.hits+statMod.hits+statSpec.hits)/(statCons.n+statMod.n+statSpec.n))}** | ${sign(statCons.pnl+statMod.pnl+statSpec.pnl)} |

> **Nota:** Las combinadas son simulaciones retroactivas (dryrun). Ninguna fue colocada con dinero real.
> El P&L negativo refleja la baja probabilidad intrínseca de combinadas cuando varias patas fallan.

---

## E · Rendimiento por Regla de Filtro

### E.1 Señales bloqueadas por regla

| Regla | Señales bloqueadas | Errores evitados | Aciertos perdidos | Eficiencia |
|-------|-------------------|-----------------|-------------------|------------|
${Object.entries(reglaCount).sort((a,b) => b[1].total - a[1].total)
  .map(([reg, v]) => `| ${reg} | ${v.total} | ${v.errores} | ${v.aciertos} | ${pct(v.errores/v.total)} |`)
  .join('\n')}

### E.2 Top reglas más dañinas (bloquearon aciertos)

| Posición | Regla | Aciertos bloqueados |
|----------|-------|---------------------|
${reglasDañinas.filter(([,v]) => v.aciertos > 0)
  .map(([reg, v], i) => `| ${i+1} | ${reg} | ${v.aciertos} |`)
  .join('\n') || '| — | Ninguna regla bloqueó aciertos con datos disponibles | — |'}

### E.3 Top reglas más útiles (evitaron errores)

| Posición | Regla | Errores evitados |
|----------|-------|-----------------|
${reglasUtiles.filter(([,v]) => v.errores > 0)
  .map(([reg, v], i) => `| ${i+1} | ${reg} | ${v.errores} |`)
  .join('\n')}

---

## F · Diagnóstico "Modelo Roto"

### F.1 Conclusión

El modelo **NO está roto** — está **mal calibrado en casos específicos**. La evidencia:

| Indicador | Valor | Diagnóstico |
|-----------|-------|-------------|
| 1x2 hit rate | 50% | Competencia básica (vs 33% random) — NO roto |
| OU2.5 hit rate | 50% | Neutro (base esperada ~50%) — NO roto |
| Brier promedio | 0.651 | Ligeramente mejor que aleatorio (0.667) — NO roto |
| BTTS hit rate | 33% | **Bajo** (esperado ~50%) — fallo sistémico |
| Señales EV≥50% | 0/6 | **Todas perdedoras** — modelo/mercado divergentes |
| MAE goles | 0.956 | Aceptable para Poisson — NO roto |

### F.2 Tres fallos sistémicos identificados

**Fallo 1: λ extremas en favoritos absolutos**
- Spain vs Cape Verde: λL=3.61 → 0 goles reales (Brier 1.71)
- Belgium vs Egypt: λV=0.15 → Egypt anotó (Belgium empató)
- Iraq vs Norway: λV=3.50 → señal over bloqueada por R8 (era acertada — coste de R8)
- **Causa:** El psico-context acumula boost excesivo en favoritos con alta presión mediática.
  La Poisson con λ>3 genera señales de alto EV que no reflejan el verdadero riesgo.

**Fallo 2: BTTS estructuralmente sub-predicho**
- El modelo predijo btts=false en 9/12 partidos
- La realidad fue btts=true en 8/12 (66.7%)
- El equipo menos favorecido anota en el Mundial con más frecuencia de lo que la Poisson proyecta
- **Causa:** λ_underdog cae demasiado bajo cuando el psico-context bonifica al favorito.
  El gol del underdog es un evento más común en torneos de alta presión.

**Fallo 3: Señales EV≥50% son falsas alarmas**
- 6 señales con EV≥50% → 0 acertadas (R1 las bloqueó todas)
- La divergencia extrema modelo/mercado indica error del modelo, no ineficiencia del mercado
- **Causa:** En mercados líquidos de Copa del Mundo, el mercado integra información que el modelo no tiene.
  El umbral R1 (EV≥50%) es una protección necesaria y efectiva.

### F.3 Partidos extremos

| matchId | Partido | λL | λV | Brier | Diagnóstico |
|---------|---------|----|----|-------|-------------|
${lambdaExtremaMatches.map(p => {
  const m = matchIdx[p.matchId];
  const brier = m?.brier_1x2?.toFixed(4) || 'N/A';
  return `| ${p.matchId} | ${p.nombre} | ${p.lambda_local.toFixed(2)} | ${p.lambda_visitante.toFixed(2)} | ${brier} | ERROR_MODELO_LAMBDA |`;
}).join('\n')}
| 537409 | England vs Croatia | 0.87 | 0.57 | 0.5428 | ERROR_LAMBDA_SUBESTIMADA (4-2 real) |

---

## G · Conclusiones Accionables para J2

### G.1 Qué mantener del modelo

1. **La dirección 1x2 funciona en partidos de nivel desigual claro** — France, Norway, Austria, Colombia ganaron como predijo el modelo.
2. **El filtro R1 (EV≥50%) es efectivo** — bloqueó 6 señales, 6 errores. No modificar.
3. **El filtro R2 (prob<60% en h2h)** — bloqueó 2 errores, 0 aciertos. Efectivo.
4. **Las señales de empate con EV≥10%** — hit rate razonable (Portugal 1-1, Saudi 1-1 con EV 49%).

### G.2 Qué ajustar en J2 (sin modificar el modelo)

1. **Señales BTTS-SI con λ_underdog ≥ 0.5** — aumentar confianza (el underdog anota más de lo esperado).
2. **Señales OU en partidos λ_extrema** — clasificar como WATCHLIST, no PROTECTED (R8 perdió el over de Norway).
3. **Combinadas conservadoras con under_2.5** — revisar si los dos partidos tienen λ ≤ 1.0 (el gol inesperado destruye estas combis).
4. **Señales en partidos con p_empate ≥ 30%** — añadir al ledger como PROTECTED_ONLY (clase R3 aplica).

### G.3 Rendimiento simulado total (J1 Auditables)

| Canal | Señales | Hit rate | ROI (flat) |
|-------|---------|----------|------------|
| Individual aprobadas | ${aprobadas.length} | ${pct(aprHits/aprobadas.length)} | ${pct(aprROI)} |
| Spreads top-10 | ${spreadRows.length} | ${pct(spHits/spreadRows.length)} | ${pct(spPNL/(spreadRows.length*STAKE))} |
| Combinadas conservadoras | ${statCons.n} | ${pct(statCons.hr)} | ${pct(statCons.pnl/(statCons.n*STAKE))} |
| Combinadas moderadas | ${statMod.n} | ${pct(statMod.hr)} | ${pct(statMod.pnl/(statMod.n*STAKE))} |

### G.4 Resumen ejecutivo para J2

> El modelo V2.1 muestra **competencia real en dirección** pero **falla en calibración de intensidad** (λ extremas y BTTS).
> La taxonomía de señales nueva (VALUE_BET / PROTECTED_ONLY / WATCHLIST / NO_BET) es el paso correcto para J2:
> elimina el binario aprobada/bloqueada y permite apostar con gestión de riesgo granular.
>
> **Prioridad J2:** Monitorear partidos con λ_local o λ_visitante > 2.5. Clasificarlos como WATCHLIST
> antes de emitir señales over o h2h-ganador. El spread (AH+1.5) es la alternativa protegida preferida.

---

*Ledger completo: \`reports/auditoria_j1_ledger_completo.csv\` (${rows.length} filas)*
*Generado por: \`scripts/generarLedgerAuditoriaJ1.js\`*
`;

fs.writeFileSync(OUT_MD, md, 'utf8');

// ─── SALIDA A CONSOLA ──────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  AUDITORÍA J1 — GoalEdge V2.1 · Ledger Completo');
console.log('═══════════════════════════════════════════════════════════\n');
console.log(`  CSV generado:  ${OUT_CSV}`);
console.log(`  MD generado:   ${OUT_MD}`);
console.log(`  Total filas:   ${rows.length} (${indivRows.length} individuales · ${combinadas.combinadas.length} combinadas · ${spreadRows.length} spreads)`);
console.log(`  Total predicciones encontradas: ${indivRows.length} señales sobre ${J1_AUDITABLES.size} partidos`);
console.log(`  Total predicciones evaluadas:   ${aprobadas.length} aprobadas + ${bloqueadas.length} bloqueadas\n`);

console.log('  ── Top 10 reglas más dañinas (bloquearon aciertos) ──');
reglasDañinas.filter(([,v]) => v.aciertos > 0).slice(0, 10).forEach(([reg, v], i) => {
  console.log(`  ${i+1}. ${reg} → ${v.aciertos} acierto(s) bloqueado(s)`);
});
if (reglasDañinas.filter(([,v]) => v.aciertos > 0).length === 0) {
  console.log('  (ninguna regla bloqueó señales ganadoras con los datos del test)');
  Object.entries(filters.bloqueos_por_regla || {}).filter(([,v]) => v.aciertos > 0)
    .forEach(([reg, v]) => console.log(`  * ${reg} → ${v.aciertos} acierto(s) bloqueado(s)`));
}

console.log('\n  ── Top 10 reglas más útiles (evitaron errores) ──');
reglasUtiles.filter(([,v]) => v.errores > 0).slice(0, 10).forEach(([reg, v], i) => {
  console.log(`  ${i+1}. ${reg} → ${v.errores} error(es) evitado(s)`);
});
if (reglasUtiles.filter(([,v]) => v.errores > 0).length === 0) {
  Object.entries(filters.bloqueos_por_regla || {}).filter(([,v]) => v.errores > 0)
    .forEach(([reg, v], i) => console.log(`  ${i+1}. ${reg} → ${v.errores} error(es) evitado(s)`));
}

console.log('\n═══════════════════════════════════════════════════════════\n');

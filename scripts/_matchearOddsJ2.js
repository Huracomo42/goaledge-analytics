/**
 * Matching The Odds API events ↔ predicciones J2 de Firestore.
 * Lee data/ejemplos/odds_api_respuesta_real.json (63 eventos ya guardados).
 * NO llama a la API. NO toca Firestore.
 */

import { readFileSync }                from 'fs';
import { resolve }                     from 'path';
import { obtenerPartidosMundial }      from '../src/data/pipeline/footballData.js';
import { normalizar, simNombres }      from '../src/core/utils/teamNames.js';

// ── Cargar datos ─────────────────────────────────────────────────────────────

const oddsEvents = JSON.parse(
  readFileSync(resolve('data/ejemplos/odds_api_respuesta_real.json'), 'utf-8')
);

const fixtures   = await obtenerPartidosMundial();
const j2Fixtures = fixtures
  .filter(p => p.matchday === 2 && (p.status === 'TIMED' || p.status === 'SCHEDULED'))
  .sort((a, b) => a.utcDate.localeCompare(b.utcDate));

// ── Algoritmo de matching ─────────────────────────────────────────────────────
//
// Para cada partido J2 (FD) buscamos el evento de Odds API que tenga:
//   a) score de similitud de ambos equipos ≥ 0.8 (uno incluye al otro tras normalizar + alias)
//   b) fecha coincidente (YYYY-MM-DD parte de commence_time, ±1 día de tolerancia)
//
// El criterio es deliberadamente estricto (≥ 0.8) porque trabajamos con un
// conjunto cerrado de 63 eventos: si el alias funciona, el score es 1.0 (idéntico).

const SCORE_MIN  = 0.8;   // exige coincidencia parcial (includes) o exacta
const DIAS_MARGEN = 1;    // tolerancia de ±1 día para desfase UTC vs horario local

function fechaDiff(fdDate, oddsTime) {
  const a = new Date(fdDate + 'T00:00:00Z');
  const b = new Date(oddsTime);
  b.setUTCHours(0, 0, 0, 0);
  return Math.abs((a - b) / 86400000); // diferencia en días
}

function matchearEvento(fdHome, fdAway, fdDate) {
  let mejor = null, mejorScore = -1;

  for (const ev of oddsEvents) {
    const scoreH = simNombres(ev.home_team, fdHome);
    const scoreA = simNombres(ev.away_team, fdAway);
    const score  = Math.min(scoreH, scoreA); // ambos deben coincidir

    if (score <= mejorScore) continue;
    const diff = fechaDiff(fdDate, ev.commence_time);
    if (diff > DIAS_MARGEN) continue;

    mejorScore = score;
    mejor = { ev, score, scoreH, scoreA, diff };
  }

  return mejor;
}

// ── PASO 2: Matching partido a partido ───────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('  PASO 2 — Matching J2 Firestore ↔ Odds API (63 eventos)');
console.log(`  Score mínimo: ${SCORE_MIN}  |  Margen fecha: ±${DIAS_MARGEN} día`);
console.log('═'.repeat(72) + '\n');

const resultados = [];

for (const p of j2Fixtures) {
  const fdHome = p.homeTeam?.name;
  const fdAway = p.awayTeam?.name;
  const fdDate = p.utcDate?.slice(0, 10);

  const match = matchearEvento(fdHome, fdAway, fdDate);

  const ok = match && match.score >= SCORE_MIN;

  const oddsHome = match?.ev.home_team ?? '—';
  const oddsAway = match?.ev.away_team ?? '—';
  const score    = match?.score?.toFixed(2) ?? '—';
  const diff     = match?.diff != null ? `+${match.diff}d` : '—';

  resultados.push({
    matchId:    p.id,
    fdHome, fdAway, fdDate,
    ok,
    oddsHome, oddsAway,
    score:   match?.score,
    diff:    match?.diff,
    oddsId:  match?.ev.id,
    nBk:     match?.ev.bookmakers?.length ?? 0,
  });

  const icon = ok ? '✓' : '✗';
  console.log(
    `  ${icon} matchId=${String(p.id).padEnd(10)} [${fdDate}]` +
    ` "${fdHome}" vs "${fdAway}"`
  );
  if (ok) {
    console.log(
      `      → OddsAPI: "${oddsHome}" vs "${oddsAway}"` +
      `  score=${score}  Δfecha=${diff}  nBk=${match.ev.bookmakers?.length}`
    );
  } else if (match) {
    console.log(
      `      ⚠ Mejor candidato: "${oddsHome}" vs "${oddsAway}"` +
      `  score=${score} (< ${SCORE_MIN})  Δfecha=${diff}`
    );
    console.log(
      `      norm_fd=("${normalizar(fdHome)}" / "${normalizar(fdAway)}")` +
      `  norm_odds=("${normalizar(oddsHome)}" / "${normalizar(oddsAway)}")`
    );
  } else {
    console.log(`      ✗ Sin candidato con fecha ±${DIAS_MARGEN}d`);
  }
}

// ── PASO 3: Tabla resumen ─────────────────────────────────────────────────────

const matched   = resultados.filter(r => r.ok);
const unmatched = resultados.filter(r => !r.ok);

console.log('\n' + '═'.repeat(72));
console.log('  PASO 3 — TABLA RESUMEN');
console.log('═'.repeat(72));
console.log(
  '\n' +
  'matchId'.padEnd(12) +
  'FD home'.padEnd(24) +
  'FD away'.padEnd(24) +
  'Match'.padEnd(6) +
  'OddsAPI home / away'
);
console.log('─'.repeat(90));

for (const r of resultados) {
  const st = r.ok ? '✓' : '✗';
  const oddsLabel = r.ok
    ? `"${r.oddsHome}" / "${r.oddsAway}"`
    : '— SIN MATCH —';
  console.log(
    String(r.matchId).padEnd(12) +
    r.fdHome.padEnd(24) +
    r.fdAway.padEnd(24) +
    st.padEnd(6) +
    oddsLabel
  );
}

console.log('\n' + '─'.repeat(72));
console.log(`  Matches encontrados : ${matched.length} / ${j2Fixtures.length}`);
console.log(`  Sin match           : ${unmatched.length}`);

if (unmatched.length > 0) {
  console.log('\n  Partidos sin match (diagnóstico):');
  for (const r of unmatched) {
    console.log(`\n  ✗ [${r.fdDate}] "${r.fdHome}" vs "${r.fdAway}" (FD matchId=${r.matchId})`);
    console.log(`    norm FD: "${normalizar(r.fdHome)}" / "${normalizar(r.fdAway)}"`);
    // Buscar candidatos cercanos (cualquier score > 0)
    const cercanos = oddsEvents
      .filter(ev => fechaDiff(r.fdDate, ev.commence_time) <= 2)
      .map(ev => ({
        ev,
        s: Math.min(simNombres(ev.home_team, r.fdHome), simNombres(ev.away_team, r.fdAway)),
      }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);

    if (cercanos.length > 0) {
      console.log('    Candidatos próximos en fecha:');
      for (const c of cercanos) {
        console.log(
          `      score=${c.s.toFixed(2)}  "${c.ev.home_team}" vs "${c.ev.away_team}"` +
          `  Δ=${fechaDiff(r.fdDate, c.ev.commence_time).toFixed(1)}d` +
          `  norm=("${normalizar(c.ev.home_team)}" / "${normalizar(c.ev.away_team)}")`
        );
      }
    } else {
      console.log('    Sin candidatos cercanos en ±2 días.');
    }
  }
}

console.log('');

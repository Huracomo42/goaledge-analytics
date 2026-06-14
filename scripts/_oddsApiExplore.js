/**
 * Exploración inicial de The Odds API — PASO 1 y PASO 2.
 * Solo lectura, sin tocar Firestore.
 * PASO 1: GET /v4/sports  (costo cero)
 * PASO 2: GET /v4/sports/{sport_key}/odds?markets=h2h  (UNA sola llamada)
 */

import 'dotenv/config';

const API_KEY  = process.env.THE_ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com';

if (!API_KEY) {
  console.error('ERROR: THE_ODDS_API_KEY no definida en .env');
  process.exit(1);
}

// Wrapper de fetch con headers reportados
async function oddsApiFetch(path) {
  const url = `${BASE_URL}${path}`;
  console.log(`\n→ GET ${url.replace(API_KEY, '***KEY***')}`);
  const res = await fetch(url);

  // Headers de rate limit / créditos
  const hdrs = {
    'x-requests-remaining': res.headers.get('x-requests-remaining'),
    'x-requests-used':      res.headers.get('x-requests-used'),
    'x-requests-last':      res.headers.get('x-requests-last'),
    'content-type':         res.headers.get('content-type'),
  };

  console.log('\nHeaders relevantes:');
  for (const [k, v] of Object.entries(hdrs)) {
    if (v !== null) console.log(`  ${k}: ${v}`);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return { data, headers: hdrs };
}

// ── PASO 1: Listar deportes disponibles ──────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  PASO 1 — GET /v4/sports (costo cero)');
console.log('═'.repeat(65));

const { data: sports, headers: h1 } = await oddsApiFetch(
  `/v4/sports?apiKey=${API_KEY}&all=true`
);

// Buscar todos los sport_keys relacionados con World Cup / FIFA
const wcDeportes = sports.filter(s =>
  (s.key   ?? '').toLowerCase().includes('world') ||
  (s.title ?? '').toLowerCase().includes('world') ||
  (s.key   ?? '').toLowerCase().includes('fifa')  ||
  (s.title ?? '').toLowerCase().includes('fifa')
);

console.log(`\nTotal deportes disponibles: ${sports.length}`);
console.log(`\nDeportes con "world" o "fifa" en key/title (${wcDeportes.length}):`);
for (const s of wcDeportes) {
  const activo = s.active ? '✓ activo' : '○ inactivo';
  console.log(`  ${activo}  key="${s.key}"  title="${s.title}"  group="${s.group}"`);
}

// También mostrar cualquier soccer activo por si el WC está bajo otro slug
const soccerActivos = sports.filter(s =>
  s.active && (s.key ?? '').startsWith('soccer')
);
console.log(`\nTodos los soccer activos (${soccerActivos.length}):`);
for (const s of soccerActivos) {
  console.log(`  key="${s.key}"  title="${s.title}"`);
}

// ── PASO 2: Una sola llamada a /odds ─────────────────────────────────────────

// Elegir el sport_key más probable para el WC
const wcKey = wcDeportes.find(s => s.active)?.key
           ?? wcDeportes[0]?.key;

if (!wcKey) {
  console.error('\n⚠ No se encontró sport_key para World Cup. Revisar listado completo arriba.');
  process.exit(1);
}

console.log(`\n${'═'.repeat(65)}`);
console.log(`  PASO 2 — GET /v4/sports/${wcKey}/odds`);
console.log('  markets=h2h SOLAMENTE | region=eu | oddsFormat=decimal');
console.log('═'.repeat(65));

const { data: events, headers: h2 } = await oddsApiFetch(
  `/v4/sports/${wcKey}/odds?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
);

console.log(`\nEventos devueltos: ${events.length}`);

if (events.length === 0) {
  console.log('⚠ 0 eventos — puede ser que el WC no tenga partidos próximos o el sport_key no cubre J2.');
  process.exit(0);
}

// Estadísticas de bookmakers por evento
const nBkPerEvent = events.map(e => e.bookmakers?.length ?? 0);
const avgBk = nBkPerEvent.reduce((a, b) => a + b, 0) / nBkPerEvent.length;
console.log(`Bookmakers por evento: min=${Math.min(...nBkPerEvent)} max=${Math.max(...nBkPerEvent)} avg=${avgBk.toFixed(1)}`);

// Listar todos los eventos
console.log('\nEventos:');
for (const ev of events) {
  const commence = ev.commence_time?.slice(0, 16) ?? '?';
  const nBk = ev.bookmakers?.length ?? 0;
  console.log(`  [${commence}]  "${ev.home_team}" vs "${ev.away_team}"  (${nBk} bookmakers)  id="${ev.id}"`);
}

// Estructura de un evento de muestra (primer evento)
const muestra = events[0];
console.log('\n── Estructura del primer evento (muestra) ──');
console.log('Campos top-level:', Object.keys(muestra).join(', '));

if (muestra.bookmakers?.length > 0) {
  const bk0 = muestra.bookmakers[0];
  console.log(`\nPrimer bookmaker: key="${bk0.key}"  title="${bk0.title}"`);
  console.log('Campos bookmaker:', Object.keys(bk0).join(', '));

  if (bk0.markets?.length > 0) {
    const mkt = bk0.markets[0];
    console.log(`\nMercado: key="${mkt.key}"`);
    console.log('Campos market:', Object.keys(mkt).join(', '));
    console.log('Outcomes:');
    for (const oc of (mkt.outcomes ?? [])) {
      console.log(`  ${JSON.stringify(oc)}`);
    }
  }
}

// Guardar respuesta cruda para PASO 3
import { writeFileSync } from 'fs';
writeFileSync('./data/ejemplos/odds_api_respuesta_real.json', JSON.stringify(events, null, 2));
console.log('\n→ Respuesta completa guardada en data/ejemplos/odds_api_respuesta_real.json');
console.log(`\nSport key usado: "${wcKey}"`);
console.log(`Créditos usados en esta sesión: ${h2['x-requests-used'] ?? '(no reportado)'}`);
console.log(`Créditos restantes: ${h2['x-requests-remaining'] ?? '(no reportado)'}`);

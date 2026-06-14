/**
 * PASO 2 y PASO 3 — UNA sola llamada real a /odds y transformación.
 * sport_key confirmado en PASO 1: "soccer_fifa_world_cup"
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { transformarRespuestaOddsApi } from '../src/data/pipeline/oddsApi.js';

const API_KEY  = process.env.THE_ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com';
const SPORT    = 'soccer_fifa_world_cup'; // confirmado en PASO 1

// ── PASO 2 ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log(`  PASO 2 — GET /v4/sports/${SPORT}/odds`);
console.log('  markets=h2h | region=eu | oddsFormat=decimal');
console.log('═'.repeat(65));

const url = `${BASE_URL}/v4/sports/${SPORT}/odds?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
console.log(`\n→ GET ${url.replace(API_KEY, '***KEY***')}`);

const res = await fetch(url);

// Reportar TODOS los headers relevantes
const headersRelevantes = [
  'x-requests-remaining',
  'x-requests-used',
  'x-requests-last',
  'content-type',
];
console.log('\nHeaders de rate limit / créditos:');
for (const h of headersRelevantes) {
  const v = res.headers.get(h);
  if (v !== null) console.log(`  ${h}: ${v}`);
  else            console.log(`  ${h}: (no presente en respuesta)`);
}

if (!res.ok) {
  const txt = await res.text();
  console.error(`\nHTTP ${res.status}: ${txt}`);
  process.exit(1);
}

const events = await res.json();
console.log(`\nEventos devueltos: ${events.length}`);

if (events.length === 0) {
  console.log('⚠ 0 eventos — puede que no haya partidos próximos con odds disponibles.');
  process.exit(0);
}

// Estadísticas
const nBkPerEvent = events.map(e => e.bookmakers?.length ?? 0);
const avg = (nBkPerEvent.reduce((a, b) => a + b, 0) / nBkPerEvent.length).toFixed(1);
console.log(`Bookmakers por evento: min=${Math.min(...nBkPerEvent)}  max=${Math.max(...nBkPerEvent)}  avg=${avg}`);

// Listar todos los eventos
console.log('\nEventos disponibles:');
for (const ev of events) {
  const fecha = ev.commence_time?.slice(0, 16) ?? '?';
  const nBk   = ev.bookmakers?.length ?? 0;
  console.log(`  [${fecha}Z]  "${ev.home_team}" vs "${ev.away_team}"  ${nBk} bookmakers  id="${ev.id}"`);
}

// Inspeccionar estructura del primer evento
const ev0 = events[0];
console.log('\n── Campos top-level de un evento ──');
console.log(' ', Object.keys(ev0).join(', '));

if (ev0.bookmakers?.length > 0) {
  const bk = ev0.bookmakers[0];
  console.log(`\nEjemplo bookmaker: key="${bk.key}"  title="${bk.title}"`);
  console.log('Campos bookmaker:', Object.keys(bk).join(', '));
  if (bk.markets?.length > 0) {
    const mkt = bk.markets[0];
    console.log(`\nMercado key="${mkt.key}"`);
    console.log('Campos market:', Object.keys(mkt).join(', '));
    console.log('Outcomes (raw):');
    for (const oc of mkt.outcomes ?? []) {
      console.log(`  ${JSON.stringify(oc)}`);
    }
  }
}

// Comparar con lo asumido en el ejemplo
console.log('\n── Comparación formato real vs odds_api_ejemplo.json ──');
const camposEsperados = ['id','sport_key','sport_title','commence_time','home_team','away_team','bookmakers'];
for (const c of camposEsperados) {
  const ok = c in ev0;
  console.log(`  ${ok ? '✓' : '✗'} campo "${c}" presente`);
}
// Check nombre del Draw en h2h
const drawName = ev0.bookmakers?.[0]?.markets
  ?.find(m => m.key === 'h2h')?.outcomes
  ?.find(oc => oc.name?.toLowerCase().includes('draw'))?.name;
console.log(`  Draw outcome name: "${drawName ?? '(no encontrado)'}" ${drawName ? '← verificado' : '← puede ser "Tie" u otro'}`);

// Guardar respuesta cruda
writeFileSync('./data/ejemplos/odds_api_respuesta_real.json', JSON.stringify(events, null, 2));
console.log('\n→ Guardado en data/ejemplos/odds_api_respuesta_real.json');

// ── PASO 3 — Transformar UN evento real ──────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  PASO 3 — transformarRespuestaOddsApi() con evento real');
console.log('═'.repeat(65));

// Buscar partido que ya tengamos en Firestore (predicciones J2)
// Equipos que tenemos: Czechia, South Africa, Switzerland, Bosnia-Herzegovina,
// Canada, Qatar, Mexico, South Korea, United States, Australia, Scotland, Morocco...
const equiposConPrediccion = new Set([
  'czechia','south africa','switzerland','bosnia-herzegovina',
  'canada','qatar','mexico','south korea','united states','australia',
  'scotland','morocco','brazil','haiti','turkey','paraguay',
  'netherlands','sweden','germany','ivory coast','ecuador','curacao','curaçao',
  'tunisia','japan','belgium','iran','cape verde','cape verde islands',
  'saudi arabia','spain','uruguay','france','iraq','norway','senegal',
  'algeria','argentina','austria','jordan','colombia','congo dr','dr congo',
  'portugal','uzbekistan','croatia','england','ghana','panama',
]);

function norm(s) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,' ').trim();
}

const eventoConPrediccion = events.find(ev => {
  const nh = norm(ev.home_team);
  const na = norm(ev.away_team);
  return [...equiposConPrediccion].some(eq => nh.includes(eq) || eq.includes(nh)) &&
         [...equiposConPrediccion].some(eq => na.includes(eq) || eq.includes(na));
});

const eventoATransformar = eventoConPrediccion ?? events[0];
const homeT = eventoATransformar.home_team;
const awayT = eventoATransformar.away_team;
const fecha = eventoATransformar.commence_time?.slice(0, 10) ?? '?';

console.log(`\nEvento elegido: "${homeT}" vs "${awayT}"  (${fecha})`);
console.log(eventoConPrediccion
  ? '  → ✓ Este partido tiene predicción en Firestore (J2)'
  : '  → ⚠ No encontrado en predicciones J2 (usando primer evento disponible)');

let snap, errorTransform;
try {
  snap = transformarRespuestaOddsApi(
    events,   // array directo, no el wrapper { eventos: [] }
    0,        // matchId placeholder (no tenemos el FD ID aquí)
    fecha,
    { homeTeam: homeT, awayTeam: awayT, region: 'eu' }
  );
} catch (e) {
  errorTransform = e;
}

if (snap) {
  console.log('\nTransformación exitosa. odds_snapshots resultante:');
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.log(`\n✗ Error en transformarRespuestaOddsApi: ${errorTransform?.message}`);
  console.log('→ Reportar diferencias y ajustar oddsApi.js si es necesario.');
}

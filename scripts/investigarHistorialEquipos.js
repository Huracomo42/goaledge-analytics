import { obtenerPartidosMundial, obtenerPartidosRecientesEquipo } from '../src/data/pipeline/footballData.js';

const FOTMOB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/json,text/plain,*/*',
  'Referer':    'https://www.fotmob.com/'
};

// ID de México confirmado en el JSON de probarFotmob.js (campo home.id)
const MEXICO_FOTMOB_ID = 6710;

const SEP = '─'.repeat(58);

// ─────────────────────────────────────────────────────────────
// PASO 1 — FotMob: /api/data/teamData?id=6710
// ─────────────────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('PASO 1 — FotMob /api/data/teamData?id=6710 (Mexico)');
console.log(`${SEP}\n`);

const fotmobUrl = `https://www.fotmob.com/api/data/teamData?id=${MEXICO_FOTMOB_ID}`;
console.log(`GET ${fotmobUrl}\n`);

try {
  const res  = await fetch(fotmobUrl, { headers: FOTMOB_HEADERS });
  const text = await res.text();
  console.log(`Status HTTP: ${res.status}`);

  if (res.status === 200) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.log('\nPOSIBLE BLOQUEO DE CLOUDFLARE — respuesta no es JSON válido.');
      console.log(text.slice(0, 400));
      process.exit(0);
    }

    console.log('\nKeys de nivel superior:');
    console.log(Object.keys(data));

    // Buscar cualquier campo que sugiera historial de partidos
    const KEYS_PARTIDOS = ['history', 'matches', 'previousMatches', 'recentResults',
                           'lastXMatches', 'latestFixtures', 'fixtures', 'events',
                           'allMatches', 'pastMatches', 'results'];
    const encontrados = KEYS_PARTIDOS.filter(k => data[k] !== undefined);

    if (encontrados.length) {
      console.log('\nCampos relacionados con partidos encontrados:');
      for (const k of encontrados) {
        const v = data[k];
        const preview = Array.isArray(v)
          ? `array de ${v.length} elementos`
          : (v && typeof v === 'object')
            ? `objeto — keys: ${Object.keys(v).join(', ')}`
            : String(v);
        console.log(`  "${k}": ${preview}`);
      }
    } else {
      console.log('\nNingún campo de historial de partidos encontrado en el nivel superior.');
    }

    console.log('\n--- Primeras 600 caracteres del JSON ---');
    console.log(JSON.stringify(data).slice(0, 600));

  } else {
    console.log(`Respuesta no exitosa. Body: ${text.slice(0, 300)}`);
  }

} catch (err) {
  console.log(err.name === 'TypeError'
    ? `Error de red: ${err.message}`
    : `Error: ${err.message}`);
}

// ─────────────────────────────────────────────────────────────
// PASO 2 — football-data.org: /v4/teams/{id}/matches sin filtro de competición
// ─────────────────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('PASO 2 — football-data.org /v4/teams/{id}/matches (sin filtro)');
console.log(`${SEP}\n`);

// Obtener el ID de México desde los fixtures (no hardcodeado)
const fixtures  = await obtenerPartidosMundial();
const pMexico   = fixtures.find(p =>
  p.homeTeam?.name?.toLowerCase().includes('mexico') ||
  p.awayTeam?.name?.toLowerCase().includes('mexico')
);

if (!pMexico) {
  const nombres = [...new Set(fixtures.flatMap(p => [p.homeTeam?.name, p.awayTeam?.name]))]
    .filter(Boolean).sort();
  console.log('No se encontró México en los fixtures. Nombres disponibles:');
  console.log(nombres.join(', '));
  process.exit(0);
}

const isLocal  = pMexico.homeTeam?.name?.toLowerCase().includes('mexico');
const mexicoId = isLocal ? pMexico.homeTeam.id : pMexico.awayTeam.id;
const mexicoNombre = isLocal ? pMexico.homeTeam.name : pMexico.awayTeam.name;

console.log(`"${mexicoNombre}" — football-data.org ID: ${mexicoId}`);
console.log(`GET /v4/teams/${mexicoId}/matches?status=FINISHED&limit=10\n`);

try {
  const partidos = await obtenerPartidosRecientesEquipo(mexicoId, 10);

  if (!partidos.length) {
    console.log('Sin partidos recientes (respuesta vacía).');
  } else {
    console.log(`${partidos.length} partidos encontrados:\n`);
    for (const p of partidos) {
      const marcador = `${p.goles_local ?? '?'}-${p.goles_visit ?? '?'}`;
      const rol      = p.equipo_local_id === mexicoId ? 'LOCAL' : 'VISIT';
      console.log(`  ${p.fecha?.slice(0, 10)}  [${rol}]  ${p.equipo_local} ${marcador} ${p.equipo_visit}  — ${p.competicion}`);
    }
    const antesDelMundial = partidos.filter(p => p.fecha < '2026-06-11');
    console.log(`\n→ Partidos ANTES del Mundial (< 2026-06-11): ${antesDelMundial.length}`);
    const comps = [...new Set(antesDelMundial.map(p => p.competicion))];
    if (comps.length) {
      console.log(`  Competiciones: ${comps.join(', ')}`);
    }
  }

} catch (err) {
  console.log(`Error: ${err.message}`);
}

import { obtenerDetallePartido } from '../src/data/pipeline/fotmob.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/json,text/plain,*/*',
  'Referer':    'https://www.fotmob.com/'
};
const SEP  = '─'.repeat(62);
const SEP2 = '═'.repeat(62);

// ═══════════════════════════════════════════════════════════════
// PASO 1 — content.matchFacts.teamForm del matchDetails 4667751
// ═══════════════════════════════════════════════════════════════
console.log(`\n${SEP2}`);
console.log('PASO 1 — content.matchFacts.teamForm (matchId 4667751)');
console.log(`${SEP2}\n`);

const det      = await obtenerDetallePartido(4667751);
const teamForm = det?.content?.matchFacts?.teamForm;

if (!teamForm) {
  console.log('⚠ content.matchFacts.teamForm no existe en este JSON.\n');
} else {
  console.log(`teamForm es un array de ${teamForm.length} elementos (uno por equipo).\n`);

  for (let t = 0; t < teamForm.length; t++) {
    const equipo = teamForm[t];
    console.log(`${SEP}`);
    console.log(`Equipo ${t + 1} — Keys del objeto: ${JSON.stringify(Object.keys(equipo))}`);
    console.log(SEP);

    // Mostrar campos escalares del equipo
    for (const [k, v] of Object.entries(equipo)) {
      if (Array.isArray(v)) continue; // los arrays los mostramos aparte
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }

    // Mostrar arrays elemento por elemento
    for (const [k, v] of Object.entries(equipo)) {
      if (!Array.isArray(v)) continue;
      console.log(`\n  ${k}: array[${v.length}]`);
      for (let i = 0; i < v.length; i++) {
        const item = v[i];
        console.log(`\n    [${i}] Keys: ${JSON.stringify(Object.keys(item))}`);
        for (const [fk, fv] of Object.entries(item)) {
          console.log(`         ${fk}: ${JSON.stringify(fv)}`);
        }
      }
    }
    console.log();
  }

  // Resumen diagnóstico
  console.log(SEP);
  console.log('DIAGNÓSTICO teamForm:');
  const primerEquipo = teamForm[0];
  const primerPartido = Object.values(primerEquipo).find(Array.isArray)?.[0];
  if (primerPartido) {
    const tieneMatchId = 'id' in primerPartido || 'matchId' in primerPartido;
    const tieneXG     = JSON.stringify(primerPartido).toLowerCase().includes('xg')
                     || JSON.stringify(primerPartido).toLowerCase().includes('expected');
    const tieneGoles  = 'score' in primerPartido || 'homeScore' in primerPartido
                     || 'result' in primerPartido || 'goals' in primerPartido;
    console.log(`  ¿Tiene matchId/id propio?  ${tieneMatchId ? '✓ SÍ' : '✗ NO'}`);
    console.log(`  ¿Tiene campo xG directo?   ${tieneXG ? '✓ SÍ' : '✗ NO'}`);
    console.log(`  ¿Tiene resultado/goles?    ${tieneGoles ? '✓ SÍ' : '✗ NO'}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PASO 2 — fixtures.allFixtures del endpoint /api/data/teams?id=6710
// ═══════════════════════════════════════════════════════════════
console.log(`\n${SEP2}`);
console.log('PASO 2 — /api/data/teams?id=6710  →  fixtures.allFixtures');
console.log(`${SEP2}\n`);

const resTeams = await fetch('https://www.fotmob.com/api/data/teams?id=6710', { headers: HEADERS });
const teamsData = await resTeams.json();

const allFixtures = teamsData?.fixtures?.allFixtures;

if (!allFixtures) {
  console.log('⚠ fixtures.allFixtures no existe en la respuesta.\n');
  console.log('Keys de fixtures:', Object.keys(teamsData?.fixtures ?? {}));
} else {
  console.log(`allFixtures es un array de ${allFixtures.length} elementos.\n`);

  // Mostrar estructura del primer elemento
  console.log('── Estructura del primer elemento ──');
  const primero = allFixtures[0];
  console.log(`  Keys: ${JSON.stringify(Object.keys(primero))}`);
  console.log('  Contenido:');
  for (const [k, v] of Object.entries(primero)) {
    console.log(`    ${k}: ${JSON.stringify(v)}`);
  }

  // Mostrar primeros 5 elementos con campos clave
  console.log(`\n── Primeros 5 elementos (campos clave) ──`);
  for (let i = 0; i < Math.min(5, allFixtures.length); i++) {
    const f = allFixtures[i];
    // Detectar campos de fecha, id, equipos y resultado
    const fecha    = f.date ?? f.utcDate ?? f.matchDate ?? f.time ?? '?';
    const matchId  = f.id   ?? f.matchId ?? '?';
    const home     = f.home?.name  ?? f.homeTeam?.name  ?? f.homeTeamName  ?? '?';
    const away     = f.away?.name  ?? f.awayTeam?.name  ?? f.awayTeamName  ?? '?';
    const homeScore = f.home?.score ?? f.score?.home ?? f.homeScore ?? '?';
    const awayScore = f.away?.score ?? f.score?.away ?? f.awayScore ?? '?';
    console.log(`  [${i}] fecha=${JSON.stringify(fecha)}  matchId=${matchId}  ${home} ${homeScore}-${awayScore} ${away}`);
  }

  // Contar partidos ANTERIORES al Mundial para México
  const CORTE = '2026-06-11';
  const preMundial = allFixtures.filter(f => {
    const d = f.date ?? f.utcDate ?? f.matchDate ?? '';
    if (typeof d === 'string') return d.slice(0, 10) < CORTE;
    if (typeof d === 'object' && d !== null) {
      // FotMob a veces pone la fecha como objeto { utcTime: '...' }
      const inner = d.utcTime ?? d.iso ?? d.dateString ?? '';
      return String(inner).slice(0, 10) < CORTE;
    }
    return false;
  });

  console.log(`\n── Filtro pre-Mundial (fecha < ${CORTE}) ──`);
  console.log(`  Total en allFixtures  : ${allFixtures.length}`);
  console.log(`  Anteriores al Mundial : ${preMundial.length}`);

  if (preMundial.length > 0) {
    console.log('\n  Últimos 5 pre-Mundial (más recientes):');
    const ultimos = preMundial.slice(-5);
    for (const f of ultimos) {
      const fecha   = f.date ?? f.utcDate ?? f.matchDate ?? f.time ?? '?';
      const matchId = f.id  ?? f.matchId  ?? '?';
      const home    = f.home?.name ?? f.homeTeam?.name ?? f.homeTeamName ?? '?';
      const away    = f.away?.name ?? f.awayTeam?.name ?? f.awayTeamName ?? '?';
      const homeScore = f.home?.score ?? f.score?.home ?? f.homeScore ?? '?';
      const awayScore = f.away?.score ?? f.score?.away ?? f.awayScore ?? '?';
      console.log(`    fecha=${JSON.stringify(fecha)}  matchId=${matchId}  ${home} ${homeScore}-${awayScore} ${away}`);
    }
  }

  // Mostrar raw del primer elemento pre-Mundial para ver estructura completa
  if (preMundial.length > 0) {
    console.log('\n── Raw completo del último partido pre-Mundial ──');
    console.log(JSON.stringify(preMundial[preMundial.length - 1], null, 2));
  }
}

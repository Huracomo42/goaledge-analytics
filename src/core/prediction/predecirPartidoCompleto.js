import { obtenerPartidosMundial }       from '../../data/pipeline/footballData.js';
import { obtenerPartidosFotmobPorFecha } from '../../data/pipeline/fotmob.js';
import { calcularAtaqueDefensa }         from '../../data/pipeline/equipoStats.js';
import { predecirPartido }               from './poisson.js';

// ─────────────────────────────────────────────────────────────
// Utilidades de coincidencia de nombres entre APIs
// ─────────────────────────────────────────────────────────────

function normalizar(nombre) {
  return (nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similitud de nombres entre 0 y 1.
 * 1.0 = idénticos tras normalizar
 * 0.8 = uno es subconjunto del otro
 * 0.5+ = comparten al menos una palabra significativa
 * 0   = sin coincidencia
 */
function simNombres(a, b) {
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb)  return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const shared = wa.filter(w => wb.has(w)).length;
  return shared > 0 ? 0.5 + 0.1 * shared : 0;
}

/**
 * Llama al endpoint de FotMob para la fecha del partido y busca el match
 * cuyos nombres de equipo más se parecen a los de football-data.org.
 * Maneja automáticamente el caso en que home/away estén invertidos entre APIs.
 *
 * Lanza Error si la mejor coincidencia tiene score < 0.5 (equipo no identificado).
 */
async function resolverIdsFotmob(utcDate, nombreLocalFD, nombreVisitanteFD) {
  const fechaFotmob = utcDate.slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const datos = await obtenerPartidosFotmobPorFecha(fechaFotmob);

  let mejor      = null;
  let mejorScore = -1;

  for (const liga of (datos.leagues ?? [])) {
    for (const match of (liga.matches ?? [])) {
      const hName = match.home?.name;
      const aName = match.away?.name;

      const scoreNormal = simNombres(hName, nombreLocalFD)
                        + simNombres(aName, nombreVisitanteFD);
      const scoreSwap   = simNombres(hName, nombreVisitanteFD)
                        + simNombres(aName, nombreLocalFD);

      if (scoreNormal >= scoreSwap && scoreNormal > mejorScore) {
        mejorScore = scoreNormal;
        mejor = {
          homeIdFotmob:     Number(match.home?.id),
          awayIdFotmob:     Number(match.away?.id),
          homeNombreFotmob: hName,
          awayNombreFotmob: aName,
        };
      } else if (scoreSwap > scoreNormal && scoreSwap > mejorScore) {
        mejorScore = scoreSwap;
        mejor = {
          homeIdFotmob:     Number(match.away?.id), // roles invertidos entre APIs
          awayIdFotmob:     Number(match.home?.id),
          homeNombreFotmob: aName,
          awayNombreFotmob: hName,
        };
      }
    }
  }

  if (!mejor || mejorScore < 0.5) {
    throw new Error(
      `No se pudo mapear a FotMob: "${nombreLocalFD}" vs "${nombreVisitanteFD}" ` +
      `el ${utcDate.slice(0, 10)} (mejor score: ${mejorScore.toFixed(2)})`
    );
  }

  return mejor;
}

// ─────────────────────────────────────────────────────────────
// Función principal exportada
// ─────────────────────────────────────────────────────────────

/**
 * Predicción completa para un partido del Mundial 2026.
 *
 * @param {number} matchIdFD  — ID numérico de football-data.org
 * @returns Resultado de predecirPartido() + metadata de contexto
 */
export async function predecirPartidoCompleto(matchIdFD) {
  // 1. Localizar el partido en el fixture (con cache de módulo en footballData.js)
  const fixtures = await obtenerPartidosMundial();
  const partido  = fixtures.find(p => p.id === matchIdFD);
  if (!partido) throw new Error(`Partido ${matchIdFD} no encontrado en el fixture del Mundial`);

  const fechaPartido  = partido.utcDate?.slice(0, 10); // 'YYYY-MM-DD'
  const nombreLocalFD = partido.homeTeam?.name;
  const nombreVisitFD = partido.awayTeam?.name;

  // 2. Resolver FotMob IDs haciendo match por nombre en la fecha del partido
  const ids = await resolverIdsFotmob(partido.utcDate, nombreLocalFD, nombreVisitFD);

  // 3. E001/E002 de ambos equipos: todo lo jugado en el Mundial antes de este partido
  //    (Promise.all para paralelizar las dos búsquedas de fechas en FotMob)
  const [statsLocal, statsVisit] = await Promise.all([
    calcularAtaqueDefensa(ids.homeIdFotmob, fechaPartido),
    calcularAtaqueDefensa(ids.awayIdFotmob, fechaPartido),
  ]);

  // 4. Modelo Poisson
  const prediccion = predecirPartido({
    ataque_local:      statsLocal.ataque,
    defensa_local:     statsLocal.defensa,
    ataque_visitante:  statsVisit.ataque,
    defensa_visitante: statsVisit.defensa,
  });

  // 5. Resultado completo con metadata de trazabilidad
  return {
    ...prediccion,
    matchId:         matchIdFD,
    nombreLocal:     nombreLocalFD,
    nombreVisitante: nombreVisitFD,
    fechaPartido,
    muestra_local: {
      n_partidos:      statsLocal.n_partidos,
      fuente:          statsLocal.fuente,
      muestra_pequena: statsLocal.muestra_pequena,
    },
    muestra_visitante: {
      n_partidos:      statsVisit.n_partidos,
      fuente:          statsVisit.fuente,
      muestra_pequena: statsVisit.muestra_pequena,
    },
  };
}

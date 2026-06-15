import { readFileSync, existsSync } from 'fs';
import { resolve }                  from 'path';

import { obtenerPartidosMundial }        from '../../data/pipeline/footballData.js';
import { obtenerPartidosFotmobPorFecha } from '../../data/pipeline/fotmob.js';
import { calcularAtaqueDefensa }         from '../../data/pipeline/equipoStats.js';
import { predecirPartido, MU_LIGA }      from './poisson.js';
import { leerAnalisisPsicologico }       from '../../firebase/analisisPsicologico.js';
import {
  ajustarAtaqueDefensaPorAusencias,
  calcularAjustePsicodeportivo,
  calcularAjusteMundialista,
  aplicarFactorExponencial,
  calcularGapRankingFifa,
  PESOS_USADOS,
} from './contextAdjustments.js';

// Constantes del modelo Poisson — deben mantenerse sincronizadas con poisson.js
const FACTOR_LOCAL = 1.10;
const FACTOR_VISIT = 0.95;
const RANKINGS_PATH = resolve('data/rankings.json');

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function normalizar(nombre) {
  return (nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

async function resolverIdsFotmob(utcDate, nombreLocalFD, nombreVisitanteFD) {
  const fechaFotmob = utcDate.slice(0, 10).replace(/-/g, '');
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
          homeIdFotmob:     Number(match.away?.id),
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

function leerRankingsFifa() {
  try {
    if (!existsSync(RANKINGS_PATH)) return {};
    return JSON.parse(readFileSync(RANKINGS_PATH, 'utf-8'));
  } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────

/**
 * Predicción completa enriquecida para un partido del Mundial 2026.
 *
 * Flujo V2.1-psico-context:
 *   1. Obtener ataque/defensa base (xG ponderado K=5)
 *   2. Leer analisis_psicologico/{matchId} si existe (no bloquea si falta)
 *   3. Leer contexto del fixture: matchday, group, stage
 *   4. Leer ranking FIFA desde data/rankings.json (no bloquea si falta)
 *   5. Ajustar ataque/defensa por ausencias ofensivas/defensivas
 *   6. Calcular factor exponencial: psico + contexto mundialista
 *   7. Ataque efectivo = ataque_ajustado * exp(ajuste_total)
 *   8. Llamar predecirPartido() con valores efectivos → la matriz Poisson,
 *      1X2, Over/Under, BTTS y marcador probable reflejan todos los ajustes
 *   9. Devolver prediccion + ajustes_modelo con trazabilidad completa
 *
 * @param {number} matchIdFD — ID numérico de football-data.org
 */
export async function predecirPartidoCompleto(matchIdFD) {
  // ── 1. Fixture ───────────────────────────────────────────────
  const fixtures = await obtenerPartidosMundial();
  const partido  = fixtures.find(p => p.id === matchIdFD);
  if (!partido) throw new Error(`Partido ${matchIdFD} no encontrado en el fixture del Mundial`);

  const fechaPartido  = partido.utcDate?.slice(0, 10);
  const nombreLocalFD = partido.homeTeam?.name;
  const nombreVisitFD = partido.awayTeam?.name;
  const jornadaGrupo  = partido.matchday ?? null;
  const grupo         = partido.group ?? null;
  const faseTorneo    = partido.stage ?? 'GROUP_STAGE';

  // ── 2. FotMob IDs ───────────────────────────────────────────
  const ids = await resolverIdsFotmob(partido.utcDate, nombreLocalFD, nombreVisitFD);

  // ── 3. Stats base (xG ponderado K=5) ────────────────────────
  const [statsLocal, statsVisit] = await Promise.all([
    calcularAtaqueDefensa(ids.homeIdFotmob, fechaPartido),
    calcularAtaqueDefensa(ids.awayIdFotmob, fechaPartido),
  ]);

  // ── 4. Análisis psicodeportivo (opcional — no bloquea) ───────
  let analisisPsico   = null;
  let psicoDisponible = false;
  try {
    analisisPsico   = await leerAnalisisPsicologico(String(matchIdFD));
    psicoDisponible = analisisPsico !== null;
  } catch { /* psico es enriquecimiento opcional */ }

  // ── 5. Rankings FIFA (opcional — no bloquea) ─────────────────
  //
  // Regla de seguridad:
  //   Si _rankings_fuente === "placeholder" Y USAR_RANKING_FIFA !== "true"
  //   → rankings se tratan como null (ajuste_ranking = 0).
  //   Si USAR_RANKING_FIFA === "false" → siempre null, sin importar la fuente.
  //   Solo se usan rankings reales cuando la fuente no es placeholder,
  //   o cuando el operador activa explícitamente USAR_RANKING_FIFA=true.
  //
  const rankings        = leerRankingsFifa();
  const rankingsFuente  = rankings._rankings_fuente ?? 'unknown';
  const envFlag         = process.env.USAR_RANKING_FIFA;          // 'true' | 'false' | undefined

  const rankingDesactivado =
    envFlag === 'false' ||
    (rankingsFuente === 'placeholder' && envFlag !== 'true');

  if (rankingDesactivado) {
    const razon = envFlag === 'false'
      ? 'USAR_RANKING_FIFA=false (desactivado por bandera)'
      : `rankings._rankings_fuente="${rankingsFuente}" — usa USAR_RANKING_FIFA=true para forzar`;
    console.warn(`[predecirPartidoCompleto] Ajuste por ranking FIFA omitido: ${razon}`);
  }

  const rankingLocal        = rankingDesactivado ? null : (rankings[nombreLocalFD] ?? null);
  const rankingVisit        = rankingDesactivado ? null : (rankings[nombreVisitFD] ?? null);
  const rankingAjusteActivo = !rankingDesactivado && rankingLocal !== null && rankingVisit !== null;

  // Variables psico normalizadas (acceso unificado desde el documento)
  const vars = analisisPsico?.variables ?? null;

  // ── 6. Ajuste por ausencias → modifica ataque/defensa base ───
  //
  // Cada equipo tiene sus propias ausencias (local.local y visitante.visitante).
  // La defensa ajustada del equipo A entra en el lambda del equipo B.
  //
  const ajLocal = ajustarAtaqueDefensaPorAusencias({
    ataque:              statsLocal.ataque,
    defensa:             statsLocal.defensa,
    ausenciasOfensivas:  vars?.ausencias_ofensivas?.local     ?? 0,
    ausenciasDefensivas: vars?.ausencias_defensivas?.local    ?? 0,
    confianzaOfensivas:  vars?.ausencias_ofensivas?.confianza ?? 0,
    confianzaDefensivas: vars?.ausencias_defensivas?.confianza ?? 0,
  });

  const ajVisit = ajustarAtaqueDefensaPorAusencias({
    ataque:              statsVisit.ataque,
    defensa:             statsVisit.defensa,
    ausenciasOfensivas:  vars?.ausencias_ofensivas?.visitante  ?? 0,
    ausenciasDefensivas: vars?.ausencias_defensivas?.visitante ?? 0,
    confianzaOfensivas:  vars?.ausencias_ofensivas?.confianza  ?? 0,
    confianzaDefensivas: vars?.ausencias_defensivas?.confianza ?? 0,
  });

  // ── 7. Ajuste psicodeportivo (lider, conflicto, presion, generacion) ─
  const ajPsicoLocal = calcularAjustePsicodeportivo({
    liderDisponible:     vars?.lider_disponible?.local,
    conflictoInterno:    vars?.conflicto_interno?.local,
    presionMediatica:    vars?.presion_mediatica?.local,
    generacionPeak:      vars?.generacion_peak?.local,
    confianzaLider:      vars?.lider_disponible?.confianza      ?? 0,
    confianzaConflicto:  vars?.conflicto_interno?.confianza     ?? 0,
    confianzaPresion:    vars?.presion_mediatica?.confianza     ?? 0,
    confianzaGeneracion: vars?.generacion_peak?.confianza       ?? 0,
  });

  const ajPsicoVisit = calcularAjustePsicodeportivo({
    liderDisponible:     vars?.lider_disponible?.visitante,
    conflictoInterno:    vars?.conflicto_interno?.visitante,
    presionMediatica:    vars?.presion_mediatica?.visitante,
    generacionPeak:      vars?.generacion_peak?.visitante,
    confianzaLider:      vars?.lider_disponible?.confianza      ?? 0,
    confianzaConflicto:  vars?.conflicto_interno?.confianza     ?? 0,
    confianzaPresion:    vars?.presion_mediatica?.confianza     ?? 0,
    confianzaGeneracion: vars?.generacion_peak?.confianza       ?? 0,
  });

  // ── 8. Ajuste mundialista/contextual ─────────────────────────
  const ajCtxLocal = calcularAjusteMundialista({
    rankingEquipo:     rankingLocal,
    rankingRival:      rankingVisit,
    jornadaGrupo,
    faseTorneo,
    necesitaGanar:     vars?.necesita_ganar?.local,
    confianzaNecesita: vars?.necesita_ganar?.confianza ?? 0,
  });

  const ajCtxVisit = calcularAjusteMundialista({
    rankingEquipo:     rankingVisit,
    rankingRival:      rankingLocal,
    jornadaGrupo,
    faseTorneo,
    necesitaGanar:     vars?.necesita_ganar?.visitante,
    confianzaNecesita: vars?.necesita_ganar?.confianza ?? 0,
  });

  // ── 9. Ataque efectivo = ataque_ajustado * exp(psico + contexto) ─────
  //
  // El factor exponencial absorbe los ajustes de psico y contexto sobre lambda:
  //   lambda_final = lambda_base * exp(psico + contexto)
  //   ≡ (ataque_efectivo * defensa_ajustada / MU_LIGA) * FACTOR
  //   donde ataque_efectivo = ataque_ajustado * exp(ajuste_total)
  //
  const ajusteTotalLocal = ajPsicoLocal.ajuste + ajCtxLocal.ajuste;
  const ajusteTotalVisit = ajPsicoVisit.ajuste + ajCtxVisit.ajuste;

  const ataqueEfectivoLocal = aplicarFactorExponencial(ajLocal.ataqueAjustado, ajusteTotalLocal);
  const ataqueEfectivoVisit = aplicarFactorExponencial(ajVisit.ataqueAjustado, ajusteTotalVisit);

  // ── 10. Modelo Poisson con valores ajustados ──────────────────
  //
  // predecirPartido() recibe los valores ya ajustados.
  // La matriz Poisson, 1X2, Over/Under, BTTS y marcador probable
  // se calculan una sola vez con los parámetros finales.
  //
  const prediccion = predecirPartido({
    ataque_local:      ataqueEfectivoLocal,
    defensa_local:     ajLocal.defensaAjustada,
    ataque_visitante:  ataqueEfectivoVisit,
    defensa_visitante: ajVisit.defensaAjustada,
  });

  // ── 11. Lambda base (trazabilidad — sin ajustes) ──────────────
  const lambdaBaseLocal = (statsLocal.ataque * statsVisit.defensa / MU_LIGA) * FACTOR_LOCAL;
  const lambdaBaseVisit = (statsVisit.ataque * statsLocal.defensa / MU_LIGA) * FACTOR_VISIT;

  // ── 12. Metadata de ajustes completa ─────────────────────────
  const { gap: gapLocal, gap_norm: gnLocal } = calcularGapRankingFifa(rankingLocal, rankingVisit);
  const { gap: gapVisit, gap_norm: gnVisit } = calcularGapRankingFifa(rankingVisit, rankingLocal);

  const ajustesModelo = {
    version_modelo:              '2.1-psico-context',
    psicodeportivo_activo:       psicoDisponible,
    contexto_mundialista_activo: rankingAjusteActivo,

    // Valores originales (sin ajuste)
    ataque_original_local:      +statsLocal.ataque.toFixed(4),
    defensa_original_local:     +statsLocal.defensa.toFixed(4),
    ataque_original_visitante:  +statsVisit.ataque.toFixed(4),
    defensa_original_visitante: +statsVisit.defensa.toFixed(4),

    // Valores efectivos pasados a predecirPartido()
    ataque_ajustado_local:      +ataqueEfectivoLocal.toFixed(4),
    defensa_ajustada_local:     +ajLocal.defensaAjustada.toFixed(4),
    ataque_ajustado_visitante:  +ataqueEfectivoVisit.toFixed(4),
    defensa_ajustada_visitante: +ajVisit.defensaAjustada.toFixed(4),

    // Lambda base vs final (para comparación y detección de ajuste excesivo)
    lambda_base_local:      +lambdaBaseLocal.toFixed(4),
    lambda_base_visitante:  +lambdaBaseVisit.toFixed(4),
    lambda_final_local:     +prediccion.lambda_local.toFixed(4),
    lambda_final_visitante: +prediccion.lambda_visitante.toFixed(4),
    delta_lambda_local_pct:  +(((prediccion.lambda_local  - lambdaBaseLocal) / lambdaBaseLocal)  * 100).toFixed(2),
    delta_lambda_visit_pct:  +(((prediccion.lambda_visitante - lambdaBaseVisit) / lambdaBaseVisit) * 100).toFixed(2),

    // Ajustes desagregados por equipo
    ajuste_ausencias_local:   ajLocal.trazabilidad,
    ajuste_ausencias_visitante: ajVisit.trazabilidad,
    ajuste_psico_local:       { total: ajPsicoLocal.ajuste,  breakdown: ajPsicoLocal.breakdown },
    ajuste_psico_visitante:   { total: ajPsicoVisit.ajuste,  breakdown: ajPsicoVisit.breakdown },
    ajuste_contexto_local:    { total: ajCtxLocal.ajuste,    breakdown: ajCtxLocal.breakdown },
    ajuste_contexto_visitante:{ total: ajCtxVisit.ajuste,    breakdown: ajCtxVisit.breakdown },
    ajuste_total_local:       +ajusteTotalLocal.toFixed(5),
    ajuste_total_visitante:   +ajusteTotalVisit.toFixed(5),

    // Variables psico usadas (null si no hay análisis)
    variables_psico_usadas: psicoDisponible ? {
      ausencias_ofensivas_local:     vars?.ausencias_ofensivas?.local      ?? null,
      ausencias_defensivas_local:    vars?.ausencias_defensivas?.local     ?? null,
      ausencias_ofensivas_visitante: vars?.ausencias_ofensivas?.visitante  ?? null,
      ausencias_defensivas_visitante:vars?.ausencias_defensivas?.visitante ?? null,
      necesita_ganar_local:          vars?.necesita_ganar?.local           ?? null,
      necesita_ganar_visitante:      vars?.necesita_ganar?.visitante       ?? null,
      lider_disponible_local:        vars?.lider_disponible?.local         ?? null,
      lider_disponible_visitante:    vars?.lider_disponible?.visitante     ?? null,
      conflicto_interno_local:       vars?.conflicto_interno?.local        ?? null,
      conflicto_interno_visitante:   vars?.conflicto_interno?.visitante    ?? null,
      presion_mediatica_local:       vars?.presion_mediatica?.local        ?? null,
      presion_mediatica_visitante:   vars?.presion_mediatica?.visitante    ?? null,
    } : null,

    // Variables contextuales usadas
    variables_contexto_usadas: {
      ranking_fifa_local:    rankingLocal,
      ranking_fifa_visitante: rankingVisit,
      gap_ranking_local:     gnLocal,
      gap_ranking_visitante: gnVisit,
      ranking_fuente_estado: rankingsFuente,
      ranking_ajuste_activo: rankingAjusteActivo,
      jornada_grupo:         jornadaGrupo,
      fase_torneo:           faseTorneo,
      grupo,
    },

    pesos_usados: PESOS_USADOS,
  };

  return {
    ...prediccion,
    version_modelo:  '2.1-psico-context',
    matchId:         matchIdFD,
    nombreLocal:     nombreLocalFD,
    nombreVisitante: nombreVisitFD,
    fechaPartido,
    grupo,
    jornadaGrupo,
    faseTorneo,
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
    fuentes_p_disponibles:    psicoDisponible,
    analisis_psicologico_ref: psicoDisponible ? `analisis_psicologico/${matchIdFD}` : null,
    ajustes_modelo:           ajustesModelo,
  };
}

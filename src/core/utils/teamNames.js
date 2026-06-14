/**
 * teamNames.js — Normalización canónica de nombres de equipos.
 *
 * Centraliza la lógica compartida entre:
 *   - src/data/pipeline/oddsApi.js       (matching vs The Odds API)
 *   - src/core/prediction/predecirPartidoCompleto.js  (matching vs FotMob)
 *
 * NOTA sobre FotMob overrides:
 *   probarCoberturaHistorial.js y predecirPartidoCompleto.js usan
 *   overrides FD→ID numérico de FotMob ("United States"→6713, "Turkey"→6595).
 *   Son un concepto diferente (resolución de IDs, no alias de nombre) y
 *   se gestionan allí donde se necesitan, no aquí.
 *
 * ALIASES aquí: variantes de nombre de API externa → nombre canónico FD.
 *   Se aplican dentro de normalizar() para que todo el matching descendente
 *   sea transparente al alias.
 */

// ── Alias de nombres ─────────────────────────────────────────────────────────
//
// Clave: nombre normalizado (minúsculas, sin tildes, sin puntuación)
//         tal como llega de una API externa.
// Valor: nombre canónico FD equivalente, también normalizado.
//
// The Odds API (verificado con respuesta real 14-jun-2026):
//   "Czech Republic"  → FD usa "Czechia"
//   "USA"             → FD usa "United States"
//   "DR Congo"        → FD usa "Congo DR"
// FotMob (para futuras referencias de matching por nombre, no por ID):
//   "Turkiye"         → FD usa "Turkey"   (en prod se resuelve con ID override)
//
export const ALIASES = {
  'czech republic': 'czechia',
  'usa':            'united states',
  'dr congo':       'congo dr',
  'turkiye':        'turkey',
};

// ── Funciones exportadas ─────────────────────────────────────────────────────

/**
 * Normaliza un nombre de equipo: minúsculas, sin tildes, sin puntuación,
 * colapsa espacios, y aplica alias conocidos.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizar(s) {
  const base = (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[base] ?? base;
}

/**
 * Similitud de nombres entre 0 y 1.
 * 1.0 = idénticos tras normalizar (incluye alias)
 * 0.8 = uno contiene al otro
 * 0.5+ = comparten al menos una palabra significativa (> 2 chars)
 * 0   = sin coincidencia
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function simNombres(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb)      return 0;
  if (na === nb)       return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const shared = wa.filter(w => wb.has(w)).length;
  return shared > 0 ? 0.5 + 0.1 * shared : 0;
}

/**
 * recommendationPolicy.js — Single source of truth de la política de recomendaciones.
 *
 * Todos los scripts del pipeline deben importar de aquí, no de signalFilters.js
 * directamente. Esto garantiza que cualquier cambio de política se propaga desde
 * un único punto sin tener que editar cada script.
 *
 * @version V2.2-post-j1
 * @see scripts/generarRecomendacionesJ2FinalConservador.js  ← pipeline oficial
 * @see scripts/auditarFlujoPipeline.js                      ← auditoría de rutas
 */

// ── Re-exportar taxonomía y clasificador completo ─────────────────────────────
export {
  PREDICTION_STATUS,
  BETTING_STATUS,
  RISK_LEVEL,
  MODEL_WARNING,
  TIPO_SENAL,
  ETIQUETA,
  FRAGILIDAD,
  UMBRALES,
  clasificarSenales,
  clasificarTipo,
  // Legacy — solo para testSignalFiltersJ1.js histórico
  filtrarSenalesApuesta,
} from './signalFilters.js';

// ── Versión de la política ────────────────────────────────────────────────────
export const POLICY_VERSION = 'V2.2-post-j1';

// ── Pipeline oficial ──────────────────────────────────────────────────────────
// Solo este script debe usarse para producción. Los demás son auxiliares o
// están deprecados.
export const OFFICIAL_PIPELINE = 'scripts/generarRecomendacionesJ2FinalConservador.js';

// Scripts deprecados. No deben llamarse en producción.
export const DEPRECATED_SCRIPTS = Object.freeze([
  {
    script: 'scripts/generarRecomendacionesJ2Filtradas.js',
    razon:  'Usa filtrarSenalesApuesta() (legacy). Reemplazado por el pipeline oficial.',
  },
]);

// ── Política de combinadas ────────────────────────────────────────────────────
// NINGUNA categoría está activa por defecto.
// Evidencia J1: conservadoras 18.2% hit rate / -49.9% ROI, moderadas 13.2%, especulativas 5.4%.
// Todas requieren flag explícito — OFF_BY_DEFAULT.
export const COMBINADAS_POLICY = Object.freeze({
  conservadoras:  { defaultEnabled: false, flag: '--include-conservadoras',  label: 'Conservadoras', j1_hit_rate: 0.182, j1_roi: -0.499 },
  moderadas:      { defaultEnabled: false, flag: '--include-moderadas',       label: 'Moderadas',     j1_hit_rate: 0.132, j1_roi: null  },
  especulativas:  { defaultEnabled: false, flag: '--include-especulativas',   label: 'Especulativas', j1_hit_rate: 0.054, j1_roi: null  },
});

// ── Campos que actualizarSenalesConOdds.js persiste en Firestore ──────────────
// Cada señal individual recibe `betting_status`.
// Estos son campos a nivel de partido (prediction document).
export const FIRESTORE_SIGNAL_FIELDS = Object.freeze([
  'prediction_status',   // OK | DATA_INCOMPLETE | TECHNICAL_ERROR
  'risk_level',          // LOW | MEDIUM | HIGH | EXTREME
  'model_warnings',      // MODEL_WARNING[]
]);

// ── Regla de oro ──────────────────────────────────────────────────────────────
// Solo TECHNICAL_ERROR bloquea una predicción.
// Incertidumbre y riesgo son clasificaciones (betting_status), no bloqueos.
// La predicción del modelo SIEMPRE se muestra, aunque betting_status sea NO_BET.
export const GOLDEN_RULE =
  'Solo TECHNICAL_ERROR puede bloquear. Incertidumbre → betting_status, nunca bloqueo.';

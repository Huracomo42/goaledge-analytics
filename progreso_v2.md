# Proyecto Futboleros V2 — Resumen de Progreso

**Última actualización**: 14 de junio de 2026 (durante J1 del Mundial 2026)

Este documento resume el estado del proyecto para retomar sin perder contexto.
Sirve como punto de referencia entre sesiones.

---

## Decisión de ritmo (14-jun-2026)

Se decide **no correr contra el calendario del Mundial**. La J1 (11-18 jun)
sigue jugándose y alimenta automáticamente el historial de cada equipo
(`calcularAtaqueDefensa`, vía caché de xG). Mientras tanto, hay una ventana
real —hasta que empiece J2 (18-19 jun)— para avanzar el Betting Engine y
otros módulos sin presión de tiempo real.

Razonamiento: el histórico pre-Mundial (Gold Cup, clasificatorias, etc.) y
el desempeño real del torneo son dos fuentes distintas; conviene dejar que
la J1 termine de aportar su xG real antes de la siguiente corrida grande
sobre J2.

---

## Fase 0 — Diseño conceptual ✅ COMPLETO

- 4 documentos base cargados como "biblia" del proyecto:
  - `revision_modelo_apuestas_futbol_BASE.md`
  - `formulacion_matematica_modelo_apuestas_futbol_BASE.md`
  - `sistema_calibracion_incremental_BASE.md`
  - `diccionario_maestro_variables_fuentes_BASE.md`
- Esquema conceptual de Firestore y especificación del módulo Poisson definidos
  en sesiones previas.

---

## Fase 1 — Prediction Engine + Data Pipeline ✅ COMPLETO (versión actual)

### 1. Módulo Poisson (`src/core/prediction/poisson.js`)
- λ_local / λ_visitante desde ataque/defensa (E001/E002).
- Matriz de marcadores 7×7 + "otros". Deriva 1X2, Over/Under (1.5–4.5), BTTS,
  marcador más probable.
- Parámetros: `MU_LIGA=1.35`, `FACTOR_LOCAL=1.10`, `FACTOR_VISIT=0.95`,
  clamps `[0.15, 4.5]`.
- Verificado contra el ejemplo Argentina vs Arabia Saudita de la especificación.

### 2. football-data.org (`src/data/pipeline/footballData.js`)
- `obtenerPartidosMundial()` — fixture completo (104 partidos), cache de proceso.
- Confirmado: el tier gratis NO da historial pre-Mundial de equipos (solo
  partidos del propio Mundial 2026) — esto definió el diseño del historial.
- **Pendiente de seguridad anotado, no resuelto**: token expuesto desde V1
  (ver `.env`). Decisión consciente de no rotar por ahora.

### 3. FotMob (`src/data/pipeline/fotmob.js`)
- `obtenerPartidosFotmobPorFecha(fecha)`, `obtenerDetallePartido(matchId)`,
  `obtenerEquipoFotmob(fotmobTeamId)` (nuevo, para `allFixtures`).
- Caché en memoria para schedules diarios (evita re-pedir el mismo
  `matches?date=X` para múltiples equipos).
- xG disponible y detallado (total, open play, set play, non-penalty, xGOT).

### 4. Cálculo de ataque/defensa con historial pre-Mundial (`src/data/pipeline/equipoStats.js`)

`calcularAtaqueDefensa(equipoIdFotmob, fechaCorte)`:

- **K=5** (mismo valor que V1).
- Combina partidos del Mundial 2026 ya jugados (antes de `fechaCorte`) +
  partidos pre-Mundial (antes del inicio del torneo) hasta completar K.
- Ponderación exponencial `w_s = e^(-λs) / Σ` sobre el total de muestras.
- Itera sobre el historial pre-Mundial saltando partidos sin xG (amistosos
  no trackeados por FotMob) hasta encontrar K con xG real (típicamente
  Gold Cup, clasificatorias UEFA/CONMEBOL, AFCON, Nations League).
- Cada partido usado registra `tournament` (ej. "CONCACAF Gold Cup",
  "FIFA World Cup", null).
- Fallback `{ ataque: MU_LIGA, defensa: MU_LIGA, fuente: "default_mu_liga" }`
  cuando `n_partidos === 0`.
- `fuente`: `"fotmob_mundial_2026"` (solo partidos del Mundial) o
  `"fotmob_mundial_2026+historial"` (combinado).

**Caché de xG** (`data/cache/xg_partidos.json`):
- Partidos `finished: true` con xG → `{ xg_local, xg_visitante, home_team_id }`.
- Partidos `finished: true` sin xG (amistosos) → `{ sin_xg: true }` — solo
  para partidos **pre-Mundial** (`conDelay === true`).
- Partidos NO finalizados (`no_iniciado` o `en_curso`) → **nunca se cachean**,
  ni como xG real ni como `sin_xg`. Devuelven `null` y se reintentan en la
  próxima corrida.

### 5. Bugs encontrados y corregidos hoy (en vivo, durante el Mundial)

| Bug | Causa | Fix |
|---|---|---|
| `no_iniciado` cacheado como `sin_xg: true` permanente | El scan de WC barre fechas futuras; partidos no jugados devuelven `null` y se cacheaban como "sin xG para siempre" | `sin_xg: true` solo se escribe para partidos pre-Mundial (`conDelay=true`), nunca para partidos WC sin jugar |
| xG parcial de partido **en curso** cacheado como definitivo | Alemania vs Curaçao en entretiempo (14-jun) — xG de 1T (0.69/0.11) se cacheó como si fuera el xG final del partido | `obtenerXgConCache` ahora verifica `detalle?.general?.status?.finished`; si no es `true`, devuelve `null` sin escribir nada al caché |

Ambos bugs habrían contaminado permanentemente el historial de los equipos
afectados en todas las predicciones futuras. Se detectaron porque el sistema
corrió **en tiempo real contra el torneo en curso** — no eran detectables con
datos históricos estáticos.

### 6. Mapeo de los 48 equipos a IDs de FotMob — verificado

- Fuzzy matching inicial sin filtro de liga producía falsos positivos graves
  (equipos sub-20/sub-23, clubes homónimos: ej. "South Korea" → ID de
  "South Africa", "Canada" → "Canada U20", "Iran" → club argentino
  "Almirante Brown").
- **Fix**: filtrar candidatos solo a ligas con "World Cup" en el nombre del
  schedule de FotMob antes de hacer fuzzy matching.
- Resultado: 46/48 resueltos por fuzzy match (score ≥0.5, sin ambigüedad —
  incluye casos de nombre distinto pero inequívoco: Bosnia-Herzegovina↔"Bosnia
  and Herzegovina" 0.70, Cape Verde Islands↔"Cape Verde" 0.80, Congo DR↔"DR
  Congo" 0.60, Curaçao↔"Curacao" 1.00).
- 2/48 por override manual: United States→"USA" (id 6713), Turkey→"Turkiye"
  (id 6595).
- Lista completa de 48 equipos con IDs validada y en uso.

### 7. Dry-run de cobertura de historial — 48 equipos (14-jun-2026)

| Categoría | Equipos | % |
|---|---|---|
| n=5 (historial completo) | 27 | 56% |
| n=2–4 (historial parcial) | 10 | 21% |
| n=1 (solo J1 del Mundial) | 3 | 6% |
| n=0 (default_mu_liga) | 8 | 17% |

- Los 3 con n=1: South Korea, Qatar, Australia (J1 jugado, sin historial
  pre-Mundial con xG disponible).
- Los 8 con n=0 (al momento de la corrida): Japan, Iran, New Zealand,
  Cape Verde Islands, Iraq, Jordan, Uzbekistan, Ghana — **todos por J1 aún
  no jugado**, no por falta real de datos. Se resuelven solos conforme avanza
  J1 (14–18 jun).
- Patrón por confederación: UEFA y CONCACAF → mayormente n=5 (clasificatorias
  UEFA / Gold Cup). CAF → n=4-5 (AFCON). CONMEBOL → n=2-3 (FotMob no trackea
  consistentemente clasificatorias CONMEBOL). AFC/OFC → la brecha más grande
  (n=0-1).

### 8. Corrida grande J2 — 24/24 predicciones actualizadas en Firestore

- Script: `scripts/predecirJ2ConHistorial.js`.
- `setDoc` (reemplazo completo) sobre `predicciones/{matchId}` — comportamiento
  ya validado, sin necesidad de limpieza manual.
- Sanidad verificada: los 8 equipos n=0 quedaron exactamente en
  `ataque=defensa=1.35` (MU_LIGA); los 48 λ (24 partidos × 2 equipos) son
  positivos, finitos, sin NaN, dentro del rango `[0.15, 4.5]`.

**10 partidos marcados ⚑ — pendientes de re-corrida** cuando el J1 del equipo
indicado finalice:

| Equipo | J1 finaliza | Partido J2 afectado |
|---|---|---|
| Germany / Curaçao | 14-jun (en curso, 2T) | Germany vs Ivory Coast · Ecuador vs Curaçao |
| Japan | 14-jun | Tunisia vs Japan |
| Cape Verde Islands | 15-jun | Uruguay vs Cape Verde Islands |
| Iran / New Zealand | 16-jun | Belgium vs Iran · New Zealand vs Egypt |
| Iraq | 16-jun | France vs Iraq |
| Jordan / Ghana | 17-jun | Jordan vs Algeria · England vs Ghana |
| Uzbekistan | 18-jun | Portugal vs Uzbekistan |

Acción de re-corrida: `node scripts/predecirJ2ConHistorial.js` (idempotente,
cache-aware). Sin urgencia — se puede hacer cuando convenga, antes de que
empiece J2.

---

## Fase 2 — Betting Engine 🔶 EN PROGRESO (siguiente bloque)

Estado: **diseño iniciado, cero código escrito todavía.**

### Fórmulas confirmadas (sección 11, 19, 20 de `formulacion_matematica...md`)

- `impliedProbability(odds) = 1 / odds`
- `noVigProbability`: **pendiente de decisión final** — método propuesto:
  normalización proporcional simple (cada prob implícita / suma de todas).
  Los documentos base NO especifican el método (proporcional vs Shin vs
  power); proporcional simple es el estándar más citado en la literatura
  referenciada por los propios documentos. **Decisión: usar proporcional
  simple, documentado explícitamente en código como provisional.**
- `edge = p_modelo - p_noVig`
- `EV = p_modelo * odds - 1`
- `fairOdds = 1 / p_modelo`
- Regla de decisión: `EV > τ`. **τ provisional = 0** (el documento exige que
  τ se calibre con robustez histórica — no disponible todavía, sin backtest).
  Documentar como provisional.
- Kelly (`f* = (b·p - q)/b`, `b=o-1`, `q=1-p`): **opcional**, no parte del
  motor base según el documento.

### Separación de capas (confirmada, sección 6 de revisión + repos doc)

`match prediction` (ya existe) → `evaluate_bet(model_probability,
bookmaker_odds)` (motor de apuestas, pendiente) — el motor de apuestas no
debe conocer nada de fútbol, solo recibe probabilidad + cuota.

### Hallazgo: "control de contradicciones entre mercados"

Mencionado en el prompt original del proyecto como requisito del Betting
Engine, pero **no tiene fórmula definida en ningún documento base**. Se
reencuadra como *test de consistencia interna del Prediction Engine* (todos
los mercados derivan de la misma matriz de Poisson, así que la inconsistencia
no debería ocurrir si todo se deriva correctamente desde la misma
distribución) — no es responsabilidad del Betting Engine.

### Sub-fases pendientes de Fase 2

- **2a — `bettingMath.js`**: funciones puras (impliedProbability,
  noVigProbability, fairOdds, edge, expectedValue, evaluateBet). Sin
  dependencias externas, sin Firestore, sin gasto de créditos de API.
  **Primera prioridad — sin bloqueos, se puede iniciar de inmediato.**
- **2b — Integración con The Odds API**: confirmado que el usuario tiene
  cuenta free tier (**500 créditos/mes**; costo = `mercados × regiones` por
  llamada, no 1 fijo — una llamada con 2 mercados en 1 región ya cuesta 2
  créditos). Requiere diseño de estrategia de consumo antes de conectar en
  serio (104 partidos del torneo, varios mercados, snapshots para CLV).
  Pendiente: 1 llamada de prueba (1 partido, mercado `h2h` únicamente) para
  ver formato real de respuesta sin comprometer presupuesto mensual.
- **2c — `odds_snapshots` en Firestore**: diseño de esquema nuevo, con
  impacto/migración/pantallas afectadas documentados (regla de Firebase del
  proyecto). Depende de 2b.
- **2d — Integración final**: predicción + odds reales + EV/edge +
  recomendación, end-to-end para al menos 1 partido real.

---

## Fase 3 — Calibration Engine ⬜ NO INICIADO

Bloqueado por calendario: requiere resultados reales de partidos (Brier,
log loss, calibration curves, CLV). Los partidos de J2 todavía no se han
jugado. No tiene sentido construir esto hasta tener datos para validarlo.

---

## Fase 4 — Scraping / Proxy Engine ⬜ NO INICIADO

Módulo entero pendiente. Ninguna de las 7 categorías de proxies
(`team_performance_proxy`, `media_narrative_proxy`, `market_bias_proxy`,
`contextual_proxy`, `direct_observable`, `estimated_proxy`,
`narrative_proxy`) tiene fuente de scraping conectada todavía.

---

## Fase 5 — Frontend ⬜ ESTADO NO REVISADO EN ESTA SESIÓN

No se ha discutido en sesiones recientes el estado del frontend de V1/V2.
Pendiente de diagnóstico cuando corresponda.

---

## Pendientes de seguridad (anotados, sin resolver — decisión consciente)

- Token de football-data.org sigue siendo el de V1, expuesto públicamente.
  No rotar por ahora; revisar si deja de funcionar.
- `.env.example` revela el ID del proyecto Firebase (nombre del archivo de
  credenciales admin SDK).

---

## Próxima sesión — punto de partida sugerido

1. **Fase 2a** (`bettingMath.js`) — sin dependencias, se puede arrancar
   directo.
2. En paralelo o después: re-correr `predecirJ2ConHistorial.js` conforme
   avancen los J1 pendientes (tabla de 10 partidos ⚑ arriba) — sin prisa,
   antes de que empiece J2 (18-19 jun).
3. Cuando 2a esté listo: 1 llamada de prueba a The Odds API (1 partido,
   1 mercado) para ver formato real, sin comprometer los 500 créditos/mes.

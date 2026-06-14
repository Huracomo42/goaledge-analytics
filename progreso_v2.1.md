# Proyecto Futboleros V2 — Resumen de Progreso

**Última actualización**: 14 de junio de 2026, sesión de tarde (Fase 2 cerrada)

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

### 9. Incidente V1 + Auditoría J2 + Corrida 1 (14-jun-2026)

#### Incidente V1 — MITIGADO

- V1 ejecutó `setDoc` completo sobre `predicciones/537352` (Ecuador vs Curaçao),
  sobrescribiendo la predicción V2.
- Fix: parcheado V1 en repo `predictor-mundial-2026`, commit `4f33b12`.
  GitHub Pages sirve el guard `[V1 BLOCKED]` — riesgo de sobrescritura V1→V2 eliminado.
- `analisis_psicologico/` no afectada (colección separada, no colisiona con `predicciones/`).

#### Auditoría J2 — 24/24 V2_LIMPIO

- Script: `node scripts/auditarPrediccionesJ2.js` (solo lectura).
- Resultado: **24/24 V2_LIMPIO**, 0 contaminados, 0 ausentes.
- Reporte: `reports/auditoria_j2_predicciones_20260614222142.json`.

#### Corrida 1 post-incidente (14-jun-2026)

- Script: `node scripts/predecirJ2ConHistorial.js` — **24/24 guardados, 0 errores**.
- J1 WC incorporado en los equipos que ya terminaron su J1:

| Equipo ⚑ | Partido J2 | matchId J2 | n | fuente | J1 WC |
|---|---|---|---|---|---|
| Germany | Germany vs Ivory Coast | 537353 | 4 | `wc+hist` | ✓ incorporado |
| Curaçao | Ecuador vs Curaçao | 537354 | 5 | `wc+hist` | ✓ incorporado |
| Japan | Tunisia vs Japan | 537360 | 0 | `default_mu_liga` | ✗ no disponible aún |

- Japan: xG J1 no disponible en FotMob al momento de Corrida 1. Se capturará en Corrida 2.

**Equipos que siguen en `default_mu_liga` (n=0) tras Corrida 1:**
Japan · Cape Verde Islands · Iran · New Zealand · Iraq · Jordan · Ghana · Uzbekistan

---

## Fase 2 — Betting Engine ✅ COMPLETO (núcleo matemático + integración de mercado)

### Fórmulas implementadas (sección 11, 19, 20 de `formulacion_matematica...md`)

`src/core/betting/bettingMath.js` — 7 exports, probado con ejemplos
numéricos a mano (6/6 validaciones de error correctas):

- `impliedProbability(odds) = 1/odds` — valida `odds > 1`.
- `noVigProbability(impliedProbsArray)`: normalización proporcional simple
  (cada prob / suma de todas). **Documentado en código como provisional**
  — los documentos base no especifican el método (alternativas: Shin,
  power); si se requiere mayor precisión, se reemplaza esta función
  aisladamente sin tocar el resto del motor.
- `edge = p_modelo - p_noVig`
- `expectedValue = p_modelo * odds - 1`
- `fairOdds = 1/p_modelo`
- `evaluateBet(probModelo, odds, allOddsMismoMercado)` — objeto compuesto
  completo (implied/no-vig/fair odds/edge/EV/is_value_bet).
- `TAU = 0` (constante exportada) — **umbral provisional**, documentado:
  requiere calibración con backtest (Fase 3, bloqueada por calendario). No
  ajustar sin justificación.
- `kellyFraction` — incluido como utilidad opcional, no parte del flujo
  obligatorio.

### Separación de capas (confirmada)

`match prediction` (Fase 1) → `evaluate_bet(model_probability,
bookmaker_odds)` (Fase 2) — el motor de apuestas no conoce fútbol, solo
recibe números.

### Hallazgo: "control de contradicciones entre mercados"

No tiene fórmula definida en ningún documento base. Reencuadrado como *test
de consistencia interna del Prediction Engine* (todos los mercados derivan
de la misma matriz de Poisson) — no es responsabilidad del Betting Engine.
**No implementado todavía** — pendiente para cuando se trabaje el Prediction
Engine de nuevo.

### Integración con The Odds API — `src/data/pipeline/oddsApi.js`

- **Sport key confirmado**: `soccer_fifa_world_cup` (verificado con llamada
  real, 14-jun-2026). `soccer_fifa_world_cup_winner` es un mercado distinto
  (campeón outright) — no usar para odds de partido.
- **1 sola llamada a `/odds` con `markets=h2h` devolvió 63 eventos**
  (J1+J2+J3 completos) por 1 crédito — más eficiente de lo estimado.
  Bookmakers por evento: min=15, max=24, avg=20.1.
- `transformarRespuestaOddsApi()` funcionó sin ajustes contra la respuesta
  real (formato real coincidió con el JSON de ejemplo, salvo nombres de
  equipo).
- Cuotas agregadas por **mediana** de todos los bookmakers devueltos
  (`criterio_agregacion: "mediana"`, `n_bookmakers` guardado para
  trazabilidad).

### `src/core/utils/teamNames.js` — normalizador compartido

Extraído de 3 copias duplicadas (`predecirPartidoCompleto.js`,
`probarCoberturaHistorial.js`, `oddsApi.js`). Centraliza `normalizar()` +
`simNombres()` + tabla `ALIASES` (alias de nombre, distinto de los
overrides FD→ID-FotMob que se mantienen donde estaban).

Aliases confirmados (14-jun-2026, contra respuesta real de The Odds API):
- `"czech republic"` → `"czechia"`
- `"usa"` → `"united states"`
- `"dr congo"` → `"congo dr"`
- `"turkiye"` → `"turkey"` (referencia para FotMob, en prod se resuelve
  por ID override)

**Matching de los 24 eventos de J2 contra los 63 de The Odds API: 24/24**,
score ≥0.8, fecha exacta (Δ=0 días).

### `odds_snapshots` — esquema y persistencia

Colección nueva en Firestore. Esquema:

```
odds_snapshots/{matchId}_{timestamp_compacto}
  matchId, fecha_partido, capturado_en, tipo_snapshot
  ("temprano" | "cercano" | "cierre"), fuente_api, region,
  mercados: { h2h: {...}, totals: {...} }
```

- `src/firebase/oddsSnapshots.js` — `guardarOddsSnapshot(matchId, datos)`,
  `setDoc` (mismo patrón que `guardarPrediccion`).
- `predicciones/{matchId}` recibe campo nuevo opcional
  `ultimo_odds_snapshot_id` vía `update()` (NUNCA `setDoc` completo — no
  pisa el resto de la predicción).
- **Impacto/migración**: colección nueva, sin migración sobre datos
  existentes. Ninguna pantalla de frontend depende de esto todavía.

### `scripts/guardarOddsDelDia.js` — mecanismo de snapshot "del día"

- **Guard correcto (v2, tras corrección)**: consulta `predicciones/` con
  `where('fechaPartido', '==', fecha)`. Si 0 documentos → 0 llamadas a la
  API. Solo procesa partidos que **ya tienen predicción guardada** — no
  el fixture completo de football-data (primera versión del guard era
  incorrecta: filtraba por "¿hay partido del Mundial esa fecha?", lo cual
  incluía partidos J1 sin predicción y gastó 4 créditos de más).
- Para cada predicción de esa fecha: matchea contra la respuesta de
  `/odds` (vía `encontrarEvento` + `teamNames.js`), transforma, guarda
  snapshot con `tipo_snapshot: "cierre"`, actualiza
  `ultimo_odds_snapshot_id`.
- **Probado**: con fecha=2026-06-14 (hoy), 0 predicciones J2 tienen esa
  fecha (J2 empieza 18-jun) → 0 llamadas, confirmado.

### Decisión de timing — snapshots de cierre, no tempranos

Se decidió **no** generar snapshots "tempranos" para los 24 de J2 hoy
(14-jun, 4-5 días antes de J2) — las cuotas se moverían y quedarían
desactualizadas. Coherente con la regla del proyecto: "la llamada cara debe
ejecutarse el día del partido". Primer uso real será el **18-jun**.

### Costo de créditos The Odds API (free tier, 500/mes)

- 1 crédito: llamada de prueba inicial (`/odds`, `markets=h2h`, 63 eventos).
- 4 créditos: 2 corridas de prueba del guard v1 (incorrecto), que trajo
  J1 sin querer (`markets=h2h,totals` = 2 créditos × 2 corridas).
- **Total gastado hoy: 5/500**. Quedan 495/500.
- 3 snapshots huérfanos (de las corridas de prueba, partidos J1 sin
  predicción asociada) fueron creados y **luego borrados** de
  `odds_snapshots/`.
- Estimación a futuro: 1 llamada (`h2h,totals` = 2 créditos) por día con
  partidos de J2+ ya predichos. Para fase de grupos (~25-30 días con
  partidos), ampliamente dentro del presupuesto mensual.

### Pendiente real, no resuelto

- **`τ` (umbral EV) y método de no-vig** siguen siendo provisionales —
  requieren backtest (Fase 3) para calibrarse con justificación.
- **"Control de contradicciones entre mercados"** — sin implementar,
  reencuadrado como tarea del Prediction Engine.
- **CLV real** — requiere 2+ snapshots por partido (apertura/cierre). Hoy
  solo hay infraestructura para snapshots de "cierre"; snapshot temprano
  para CLV no se ha generado para ningún partido todavía (decisión
  consciente, ver arriba).

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

## Pendientes acumulados (en curso — J1 avanza 15–18 jun)

1. **Corridas de re-predicción J2** — `node scripts/predecirJ2ConHistorial.js`
   (idempotente, cache-aware). Programadas por fecha de J1:
   - **15-jun**: Japan (si xG disponible en FotMob), Cape Verde Islands
   - **16-jun**: Iran, New Zealand, Iraq
   - **17-jun noche**: Jordan, Ghana
   - **18-jun**: Uzbekistan (Portugal vs Uzbekistan juega el 23-jun, hay margen)
2. **Inventario de colecciones V1 en Firestore** — detectadas hoy en la
   captura de pantalla del usuario, sin tocar:
   `analisis_psicologico`, `mapeo_partidos_fotmob`, `stats_avanzadas`,
   `team_stats_premundial`. Pendiente: ¿algún código V2 las usa? ¿de qué
   fecha son los documentos? Sin acción de borrado hasta tener ese mapa.
3. **18-jun (o cuando empiece J2)**: correr
   `node scripts/guardarOddsDelDia.js 2026-06-18` — primer snapshot de
   cierre real, primer uso real de `evaluateBet` con datos 100% reales
   (modelo + mercado).

---

## Próxima sesión — punto de partida sugerido

Con Fase 1 y Fase 2 cerradas, las opciones para la siguiente sesión son:

- **Operativo/bajo esfuerzo**: re-correr historial (pendiente 1) y/o
  inventario de V1 (pendiente 2) — ninguno depende de diseño nuevo.
- **Fase 4 (Scraping/Proxy Engine)**: módulo entero nuevo, las 7 categorías
  de proxies psicodeportivas — requiere diseño desde cero, sin código
  previo en V1 ni V2.
- **Fase 5 (Frontend)**: diagnóstico de estado actual, no revisado todavía
  en V2.
- **18-jun**: ejecutar pendiente 3 (primer snapshot de cierre real) —
  cuando llegue la fecha, es la pieza que cierra el ciclo completo
  predicción→mercado→EV con datos reales por primera vez.

Fase 3 (Calibration Engine) sigue bloqueada por calendario — sin resultados
reales de partidos todavía.

# Esquema de Firestore V2

**Proyecto Futboleros — Predictor Mundial 2026**

Quinto y último documento de la fase de diseño. Define las colecciones de Firestore para
V2, cómo se conectan entre sí, y cómo cada colección refleja el diccionario de variables
(E/P/C/M) y los principios de trazabilidad, leakage y versionado acordados.

**Decisiones ya cerradas que este esquema refleja**:
- Solo se guarda la **última versión activa** del modelo por partido (no historial de
  predicciones por versión).
- Las 4 predicciones viejas de V1 **no se migran** — no aportan valor frente al backtest.
- Los **8 partidos ya jugados** se aprovechan vía una colección `backtest_v2` separada,
  que simula predicción prepartido con datos que SÍ estaban disponibles antes del kickoff
  (bloques E y M), marcando el bloque P como no disponible para evitar leakage.

---

## Mapa general de colecciones

```
matches/{matchId}
equipos/{equipoId}
predicciones/{matchId}
resultados/{matchId}
odds_snapshots/{matchId}/{snapshotId}
analisis_psicologico/{matchId}
backtest_v2/{matchId}
modelo_versiones/{versionId}
modelo_versiones/activa
calibracion_runs/{runId}
```

Cada una se detalla abajo.

---

## 1. `matches/{matchId}`

**Propósito**: datos estáticos y de fixture del partido — el "qué, cuándo, dónde".

```
{
  matchId: string,              // ID de football-data.org, como string
  equipoLocalId, equipoVisitanteId: string,
  nombreLocal, nombreVisitante: string,
  fecha_utc: timestamp,
  estadio: string,
  fase_torneo: string,          // C004 — "grupos" | "dieciseisavos" | "octavos" | ...
  jornada_grupo: number | null, // C005 — 1, 2, 3, o null en eliminatorias
  grupo: string | null,         // "A".."L" en fase de grupos
  tipo_localidad: string,       // C003 — "sede" | "local" | "visitante" | "neutral"
  altitud_estadio: number,      // C001 — metros, desde config estático
  estado: string,               // "SCHEDULED" | "FINISHED" | etc., sincronizado de football-data
  fuente: "football-data.org",
  actualizado_en: timestamp
}
```

**Origen de los datos**: football-data.org (`getMatches`, ya existe en V1) + enriquecido
con C001/C003/C004/C005 del diccionario, calculados al sincronizar el fixture.

**Por qué es su propia colección y no parte de `predicciones`**: los datos de `matches`
existen independientemente de si hay una predicción o no — son hechos del calendario. Esto
también es lo que permite que `backtest_v2` referencie el mismo `matchId` sin duplicar esta
información.

---

## 2. `equipos/{equipoId}`

**Propósito**: estado "vivo" de cada selección — los valores E001/E002 ponderados por
recencia, actualizados a medida que cada equipo juega partidos.

```
{
  equipoId: string,
  nombre: string,
  ranking_fifa: number,           // E (rating_equipo vía ranking FIFA, según lo acordado)
  ataque: {                       // E001 — xg_promedio ponderado
    valor: number,
    n_partidos: number,
    muestra_pequena: boolean,     // true si n_partidos < 10
    fuente: "fotmob" | "football-data" | "mixta",
    actualizado_en: timestamp
  },
  defensa: {                      // E002 — xg_concedido_promedio ponderado
    valor: number,
    n_partidos: number,
    muestra_pequena: boolean,
    fuente: string,
    actualizado_en: timestamp
  },
  adaptado_altitud: boolean,       // C002 — lista estática corregida (no heurística rol=local)
  pais_sede: boolean               // true para Mexico/USA/Canada — usado en C003
}
```

**Origen**: calculado por el Data Pipeline a partir de FotMob (`stats_avanzadas` por
partido histórico) + football-data.org, aplicando la ponderación exponencial por recencia
(K=10) definida en la especificación Poisson.

**Nota de diseño**: esta colección es la que **resuelve el bug C002 documentado** — el
campo `adaptado_altitud` se llena con la lista estática (México, Colombia, Ecuador,
Bolivia, Perú) al crear/actualizar cada documento de equipo, no se calcula dinámicamente
por rol local/visitante en cada partido.

---

## 3. `predicciones/{matchId}`

**Propósito**: la predicción activa (última versión del modelo) para un partido —
combina la salida del módulo Poisson (Prediction Engine) y del Betting Engine.

```
{
  matchId: string,
  version_modelo: string,          // ej "2.0" — referencia a modelo_versiones

  // === Prediction Engine (salida de poisson.js) ===
  inputs_usados: {
    ataque_local, defensa_local,
    ataque_visitante, defensa_visitante,
    ausencias_ofensivas_local, ausencias_defensivas_local,     // P_LES_OFE/DEF
    ausencias_ofensivas_visitante, ausencias_defensivas_visitante,
    fuente_ataque_local, fuente_defensa_local, ...             // trazabilidad de fuente por valor
  },
  lambda_local: number,
  lambda_visitante: number,
  matriz_marcadores: array,        // 7x7 + "otros", o referencia comprimida
  prob_1x2: { local: number, empate: number, visitante: number },
  prob_over_under: { "1.5": {...}, "2.5": {...}, "3.5": {...} },
  prob_btts: { si: number, no: number },
  marcador_mas_probable: { local: number, visitante: number, prob: number },

  // === Betting Engine (M001-M004) ===
  odds_snapshot_id: string | null,  // referencia a odds_snapshots/{matchId}/{snapshotId} usado
  comparacion_mercado: {
    "1x2.local":     { p_modelo: number, odds: number, p_no_vig: number, edge: number, ev: number },
    "1x2.empate":    { ... },
    "1x2.visitante": { ... },
    "over_2.5":      { ... },
    // ... un objeto por mercado donde haya odds disponibles
  },
  recomendaciones: [
    {
      mercado: string,
      edge: number,
      ev: number,
      clasificacion: string,   // criterio de selección, a definir en Betting Engine
      justificacion: string    // explicación legible
    }
  ],

  // === Metadata / trazabilidad ===
  metadata_poisson: {
    mu_liga, factor_local, factor_visitante,
    peso_les_ofe, peso_les_def,
    clamps_activados: []
  },
  generado_en: timestamp,
  fuentes_p_disponibles: boolean,   // false si analisis_psicologico no estaba listo al generar
  analisis_psicologico_ref: string | null  // referencia a analisis_psicologico/{matchId}
}
```

**Confirmación de la decisión tomada**: este documento se **sobrescribe** cuando se
recalibra a una nueva `version_modelo` — no hay sub-colección de versiones históricas por
partido. El historial de qué versiones existieron y sus métricas vive en
`modelo_versiones` (colección 8).

**Conexión con el diccionario**: cada campo de `inputs_usados` y `comparacion_mercado` es
trazable a una ficha específica del diccionario (E001/E002, P_LES_OFE/DEF, M001-M004) — esto
es lo que permite que el calibrador, más adelante, sepa exactamente qué variable revisar si
algo no calibra bien.

---

## 4. `resultados/{matchId}`

**Propósito**: lo que realmente pasó — separado de `predicciones` para que comparar
"predicho vs. real" sea una operación de leer dos documentos, no de buscar campos dentro de
uno solo (que era parcialmente el caso en V1, donde `resultado_real` vivía dentro del mismo
doc de `predicciones`).

```
{
  matchId: string,
  goles_local: number,
  goles_visitante: number,
  xg_local_real: number | null,
  xg_visitante_real: number | null,
  corners_local: number | null,
  corners_visitante: number | null,
  amarillas_local, amarillas_visitante, rojas_local, rojas_visitante: number | null,
  fuente: "fotmob" | "manual",
  fuente_resultado_partido: "fotmob" | "manual",
  terminado: boolean,
  capturado_en: timestamp
}
```

**Origen**: `getAdvancedMatchStats`/`syncAdvancedStats` (FotMob, ya existe en V1) como
fuente primaria; ingreso manual como fallback (también ya existe en V1 vía `historial.html`).

**Por qué separar de `predicciones`**: permite que `resultados` exista para partidos que
nunca tuvieron una predicción guardada (ej. si se sincroniza FotMob para todos los partidos
del día por completitud del dataset histórico, sin que cada uno necesite una predicción
activa) — y permite que el cálculo de métricas (Brier, log loss) sea un join simple entre
dos colecciones por `matchId`.

---

## 5. `odds_snapshots/{matchId}/{snapshotId}`

**Propósito**: histórico de cuotas — M001 y M005 del diccionario.

```
{
  matchId: string,
  snapshotId: string,             // ej "2026-06-14T08:00:00Z" o "apertura"/"cierre"
  capturado_en: timestamp,
  tipo_snapshot: "diario" | "pre_kickoff",
  bookmakers: {
    "pinnacle": {
      h2h: { local: number, empate: number, visitante: number },
      totals: { "2.5": { over: number, under: number }, ... }
    },
    // ... otros bookmakers si regions devuelve más de uno
  },
  fuente: "the-odds-api",
  sport_key: "soccer_fifa_world_cup"
}
```

**Por qué sub-colección y no documento único**: necesitamos múltiples snapshots por
partido a lo largo del tiempo (apertura, intermedios, cierre) para CLV (M005) — una
sub-colección permite `orderBy(capturado_en)` y quedarse con el primero/último sin
sobrescribir historial.

**Conexión con `predicciones`**: el campo `odds_snapshot_id` en `predicciones/{matchId}`
apunta al snapshot específico usado para calcular `comparacion_mercado` — esto es
trazabilidad explícita: "esta predicción comparó contra ESTAS cuotas, capturadas en ESTE
momento".

---

## 6. `analisis_psicologico/{matchId}`

**Propósito**: las 10 variables del bloque P (V1) + las 2 nuevas (P_LES_OFE/DEF) —
prácticamente la misma estructura que V1 ya tiene, con metadatos de proxy añadidos.

```
{
  matchId: string,
  estado: "completo" | "generando" | "error" | "pendiente",
  generado_en: timestamp,
  modelo: "claude-haiku-4-5",
  webSearch: true,
  version_modelo: string,

  variables: {
    necesita_ganar:      { local: bool, visitante: bool, tipo_proxy: "contextual_proxy", confianza: number },
    venganza_narrativa:  { local: bool, visitante: bool, tipo_proxy: "media_narrative_proxy", confianza: number },
    rival_maldito:       { local: number, visitante: number, tipo_proxy: "media_narrative_proxy", confianza: number },
    presion_mediatica:   { local: number, visitante: number, tipo_proxy: "media_narrative_proxy", confianza: number },
    lider_disponible:    { local: bool, visitante: bool, tipo_proxy: "team_performance_proxy", confianza: number },
    conflicto_interno:   { local: number, visitante: number, tipo_proxy: "team_performance_proxy", confianza: number },
    generacion_peak:     { local: bool, visitante: bool, tipo_proxy: "team_performance_proxy", confianza: number },
    underdog:            { local: bool, visitante: bool, tipo_proxy: "market_bias_proxy", confianza: number },
    clasifico_sufriendo: { local: string, visitante: string, tipo_proxy: "contextual_proxy", confianza: number },
    humillacion_previa:  { local: bool, visitante: bool, tipo_proxy: "media_narrative_proxy", confianza: number },
    ausencias_ofensivas:   { local: number, visitante: number, tipo_proxy: "team_performance_proxy", confianza: number },
    ausencias_defensivas:  { local: number, visitante: number, tipo_proxy: "team_performance_proxy", confianza: number }
  },

  narrativa: string,
  lesiones_destacadas: array,
  fuentes: array,

  // === Trazabilidad de leakage (regla del prompt original) ===
  timestamps: {
    evento_partido: timestamp,        // kickoff
    analisis_generado: timestamp,     // cuándo se ejecutó analyzePsychology
    disponible_para_modelo: timestamp // = analisis_generado, si se usó en predicciones
  }
}
```

**Cambio respecto a V1**: V1 guarda `psicologico.local.necesita_ganar = false` (valor
plano). V2 guarda `variables.necesita_ganar.local = false` **junto con** `tipo_proxy` y
`confianza` — esto es la "reclasificación sin tocar el prompt" que diseñamos: el prompt de
Claude puede seguir devolviendo el mismo JSON plano, y una capa de normalización en el Data
Pipeline le añade `tipo_proxy` (fijo, viene del diccionario) y `confianza` (si Claude la
reporta, o un valor por defecto de `confianza_minima_sugerida` del diccionario si no).

---

## 7. `backtest_v2/{matchId}`

**Propósito**: la pieza nueva que surge de tu idea — predicciones retrospectivas de los 8
partidos ya jugados, simulando que se predicen "el día antes", **sin** bloque P (para
evitar leakage).

```
{
  matchId: string,
  es_backtest: true,                 // flag explícito, nunca se confunde con predicciones reales
  fecha_simulada_prediccion: timestamp,  // = fecha del partido (simulamos "el día antes")

  // Mismos campos que predicciones/{matchId}, pero:
  inputs_usados: {
    ataque_local, defensa_local, ataque_visitante, defensa_visitante,
    // calculados con SOLO datos anteriores a fecha_simulada_prediccion
    ausencias_ofensivas_local: null,      // P no disponible
    ausencias_defensivas_local: null,
    // ... resto null
  },
  bloque_p_disponible: false,
  motivo_bloque_p: "Backtest retrospectivo — analyzePsychology generaría leakage al buscar noticias posteriores al partido",

  lambda_local, lambda_visitante,
  prob_1x2, prob_over_under, prob_btts, marcador_mas_probable,

  odds_snapshot_id: string | null,   // si The Odds API tiene histórico para esa fecha (plan free probablemente NO incluye históricos, según vimos: "Historical Odds" tachado en el plan Starter)
  comparacion_mercado: { ... } | null,

  version_modelo: string,
  generado_en: timestamp,

  // Resultado real (ya conocido, se usa para evaluación inmediata)
  resultado_ref: string  // referencia a resultados/{matchId}
}
```

**Nota honesta sobre odds en backtest**: como vimos al evaluar The Odds API, el plan
gratuito Starter **no incluye Historical Odds** — por tanto, `odds_snapshot_id` y
`comparacion_mercado` probablemente queden `null` para los 8 partidos de backtest, salvo
que hayamos capturado un snapshot de odds para esos partidos específicos antes de que se
jugaran (poco probable, dado que el proyecto recién está arrancando). Esto significa: **el
backtest de estos 8 partidos evalúa principalmente el Prediction Engine (Poisson), no el
Betting Engine** — lo cual es, de cualquier modo, lo más urgente de validar primero.

**Por qué `es_backtest: true` como campo explícito y no solo "estar en otra colección"**:
defensa en profundidad — si alguna consulta futura (por accidente) mezclara colecciones, el
flag explícito previene que un registro de backtest se cuente como predicción real en
métricas de calibración. El documento de calibración exige distinguir "qué partidos y qué
señales son realmente utilizables para aprendizaje" (Módulo 1) — un backtest sin bloque P
tiene un perfil de "utilizable" distinto a una predicción real completa, y este flag es lo
que permite al calibrador tratarlos de forma diferenciada explícitamente.

---

## 8. `modelo_versiones/{versionId}` y `modelo_versiones/activa`

**Propósito**: heredado de V1 (`getPesos`/`guardarPesos`/`getVersionesModelo`, ya
identificados como "conservar" en el documento de calibración), extendido con los
parámetros nuevos del módulo Poisson.

```
// modelo_versiones/{versionId}, ej "2.0"
{
  version: "2.0",
  parametros: {
    mu_liga: 1.35,
    factor_local: 1.10,
    factor_visitante: 0.95,
    peso_les_ofe: 0.15,
    peso_les_def: 0.15,
    clamp_lambda_min: 0.15,
    clamp_lambda_max: 4.5
  },
  metodo_actualizacion: "inicial" | "recalibracion_externa" | "ajuste_bloques" | "ajuste_coeficientes",
  dataset_usado: {
    n_partidos: number,
    fuente: "backtest_v2" | "predicciones_reales" | "mixto"
  },
  metricas_pre: { brier: number, log_loss: number } | null,
  metricas_post: { brier: number, log_loss: number } | null,
  guardado_en: timestamp
}

// modelo_versiones/activa — copia de la versión vigente, para lectura rápida
{
  version: "2.0",
  parametros: { ... }  // mismo objeto que la versión correspondiente
}
```

**Conexión con la decisión de "solo última versión activa"**: `predicciones/{matchId}`
siempre referencia `modelo_versiones/activa`. Cuando se recalibra, se crea un nuevo
`modelo_versiones/{nuevaVersion}`, se actualiza `modelo_versiones/activa`, y **se
recalculan** los documentos de `predicciones` para partidos futuros (no jugados) con los
nuevos parámetros — los partidos ya jugados conservan su predicción tal como se generó
(es, en sí misma, parte del histórico de calibración).

---

## 9. `calibracion_runs/{runId}`

**Propósito**: cada vez que se ejecuta el sistema de calibración (Módulos 1-5 del
documento 3), se guarda un registro — esto es lo que el documento de calibración llama
"reportes formales" (sección 14): reporte de calidad de datos, reporte de desempeño,
reporte de valor de señales, recomendación de actualización.

```
{
  runId: string,
  ejecutado_en: timestamp,
  version_modelo_evaluada: string,

  auditoria: {
    n_partidos_calibrables: number,    // incluye backtest_v2 + predicciones reales con resultado
    n_con_bloque_p: number,
    n_sin_bloque_p: number,            // los 8 de backtest entran aquí
    confianza_promedio_scraping: number
  },

  metricas_partido: {
    brier_score: number,
    log_loss: number,
    calibration_curve: array
  },

  metricas_mercado: {
    hit_rate_por_mercado: object,
    roi: number | null,
    yield: number | null,
    clv: number | null   // probablemente null mientras no haya historical odds
  },

  evaluacion_senales: [
    {
      variable: string,          // ej "presion_mediatica"
      tipo_proxy: string,
      n_muestra: number,
      mejora_marginal_brier: number | null,
      recomendacion: "conservar" | "activar" | "descartar" | "mover_de_bloque" | "sin_evidencia_suficiente"
    }
  ],

  recomendacion_global: "mantener_pesos" | "recalibrar_salidas" | "ajustar_bloques" | "no_actualizar_por_muestra_insuficiente"
}
```

**Conexión con la política de gobernanza del documento 3**: el campo
`recomendacion_global` usa exactamente las categorías de la "Política de actualización"
(sección 13) — esto no es una colección "bonita para mostrar en el frontend todavía", es el
registro que permite auditar, en cualquier momento, *por qué* el modelo está en la versión
que está y *qué evidencia* respaldó cada cambio.

---

## Resumen visual de relaciones

```
matches/{matchId} ──┬── predicciones/{matchId} ──── odds_snapshots/{matchId}/{snapshotId}
                     │         │
                     │         └── analisis_psicologico_ref ──> analisis_psicologico/{matchId}
                     │
                     ├── resultados/{matchId}
                     │
                     └── backtest_v2/{matchId} ──── resultado_ref ──> resultados/{matchId}

modelo_versiones/activa <──── referenciado por predicciones/{matchId}.version_modelo

calibracion_runs/{runId} ──── lee de: predicciones + resultados + backtest_v2 + analisis_psicologico
```

---

## Qué NO incluye este esquema (deliberadamente)

- No hay colección de "usuarios" — el prompt original especifica que el análisis guardado
  debe estar disponible para todos los usuarios (sin autenticación por usuario), y eso es
  lo que ya hace V1 (Firestore como caché compartida). V2 mantiene ese modelo.
- No hay colección separada para "fuentes" como entidad independiente — las fuentes viven
  dentro de `analisis_psicologico.fuentes` (array), porque su única función es trazabilidad
  de ESE análisis específico, no son una entidad reutilizable entre partidos.
- No hay sub-colección de versiones históricas de predicciones por partido — decisión ya
  confirmada (solo última versión activa).

---

## Próxima acción concreta

Con los 5 documentos de diseño completos (4 bloques del diccionario + este esquema), la
fase de "planos" está terminada. El siguiente paso natural es decidir **por dónde empezar a
programar en Claude Code** — mi sugerencia sería: (1) el módulo `poisson.js` puro (sin
Firestore, solo la función matemática, testeable con el ejemplo Argentina vs Arabia
Saudita), y (2) en paralelo o después, el script de backtest para los 8 partidos ya
jugados, que es la forma más rápida de obtener una primera señal real de qué tan bien
funciona el núcleo nuevo.

# Diccionario de Variables V2 — Bloque Contextual (C)

**Proyecto Futboleros — Predictor Mundial 2026**

Tercera parte del diccionario maestro de variables. Cubre el **Bloque Contextual (C)**:
variables del entorno físico/competitivo del partido — localía, altitud, fase del torneo,
incentivos de clasificación. A diferencia de P (psicodeportivo), estas son en su mayoría
**hechos verificables**, no proxies scrapeadas con incertidumbre — lo cual cambia su
tratamiento de confianza/riesgo respecto al bloque P.

---

## Qué entra aquí y qué no

Este bloque agrupa dos tipos de variables, ambos ya identificados en documentos previos
pero que conviene separar con claridad:

1. **Contexto físico del partido** (C_fisico): estadio, altitud, sede — afectan a AMBOS
   equipos de forma asimétrica según si están o no adaptados a la condición.
2. **Contexto de torneo** (C_torneo): fase, incentivo de clasificación, gap de ranking —
   las variables P001 (`necesita_ganar`) y P009 (`clasifico_sufriendo`) del bloque P viven
   conceptualmente aquí, y se referencian de vuelta en este documento para no duplicar
   fichas — el diccionario debe evitar que la misma idea aparezca dos veces con nombres
   distintos (función B del propósito del diccionario maestro, doc 4).

---

## C001 — `altitud_estadio`

| Campo | Valor |
|---|---|
| **nombre_legible** | Altitud del estadio sobre el nivel del mar |
| **bloque_modelo** | C_fisico |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | integer (metros) |
| **rango_esperado** | 0 – 2240 (Estadio Azteca, el más alto de los venues del Mundial 2026 según `ESTADIOS_ALTITUD` en `config.js` de V1) |
| **momento_captura** | estático — el calendario de sedes se conoce con meses de anticipación |
| **frecuencia_actualización** | una vez (dato fijo por estadio, no cambia entre partidos) |
| **fuente_primaria** | `ESTADIOS_ALTITUD` (config.js, V1) — **ya existe, se reutiliza tal cual** |
| **riesgo_leakage** | ninguno — información pública desde la asignación de sedes |
| **riesgo_sesgo** | ninguno — dato físico medible |
| **confianza_minima_sugerida** | 1.0 — es un hecho geográfico, no un proxy |
| **hipótesis_causal** | la literatura deportiva documenta efectos fisiológicos de altitud sobre rendimiento aeróbico para equipos no aclimatados — particularmente relevante para el Estadio Azteca (2240m) y Estadio Akron (1566m). El documento de revisión (sección 3.5) marca esto explícitamente como variable a **mover del bloque psicológico al bloque contextual-físico**, porque "en tu modelo está dentro del score psico, cuando en realidad es más bien fisiológica y contextual" |
| **uso_modelo** | ajuste asimétrico: solo penaliza al equipo NO adaptado a la altitud (ver C002). No es una covariable simétrica — su efecto depende de QUIÉN juega, no es un valor fijo del partido |
| **uso_calibrador** | se evalúa si el ajuste de altitud mejora la calibración específicamente en los partidos jugados en Azteca/Akron/BBVA (los 3 venues mexicanos con altitud relevante) |

---

## C002 — `equipo_adaptado_altitud`

| Campo | Valor |
|---|---|
| **nombre_legible** | Indicador de si el equipo está adaptado a jugar en altitud |
| **bloque_modelo** | C_fisico |
| **tipo_proxy** | derived_variable |
| **tipo_dato** | boolean |
| **momento_captura** | estático por equipo (depende de dónde juega habitualmente sus partidos de local/clasificatorias) |
| **fuente_primaria** | **derivado**, no scrapeado — V1 usa una heurística simplista: `equipoAdaptadoAltitud = (rol === 'local')`, es decir, asume que el local siempre está adaptado |
| **riesgo_sesgo** | **medio-alto en V1**: la heurística "local = adaptado" es razonable para México (juega en Azteca/Akron habitualmente) pero **incorrecta para cualquier otro local** — ej. si Brasil juega de "local" (en el sentido de orden de fixture) en el Estadio Azteca, Brasil NO está adaptado a esa altitud solo por ser nominalmente "local" en ese partido del Mundial |
| **hipótesis_causal** | equipos que entrenan/compiten regularmente sobre 1500m+ (México, Colombia, Ecuador, Bolivia en clasificatorias CONMEBOL) tienen ventaja fisiológica real documentada en altitud |
| **uso_modelo** | determina si el ajuste de C001 se aplica al equipo local, visitante, ninguno o ambos |
| **transformación_pre_modelo** | **se requiere corregir la heurística de V1**: en vez de `rol === 'local'`, usar una lista explícita de selecciones "adaptadas a altitud" (México, Colombia, Ecuador, Bolivia, Perú son los candidatos típicos por geografía) independiente del rol local/visitante en el partido específico. Esta lista es estática y pequeña — se puede fijar manualmente con baja incertidumbre, no requiere scraping |

**Esto es un bug de V1 que el diccionario expone**: la fórmula `if (altitud > 800 &&
!equipoAdaptadoAltitud) scoreLocal -= ...` con `equipoAdaptadoAltitud = (rol === 'local')`
significa que en V1, **el equipo local NUNCA recibe penalización por altitud, sin importar
de dónde sea** — lo cual es correcto solo cuando el local es efectivamente un equipo de
altitud (México). Se documenta aquí para que el Data Pipeline V2 lo corrija con la lista
explícita, no para parchear V1.

---

## C003 — `tipo_localidad`

| Campo | Valor |
|---|---|
| **nombre_legible** | Tipo de localía: sede / local / visitante / neutral |
| **bloque_modelo** | C_fisico |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | categórico (`sede`, `local`, `visitante`, `neutral`) |
| **momento_captura** | estático por partido (定 desde el fixture) |
| **fuente_primaria** | derivado del fixture (football-data.org) + lista de selecciones anfitrionas (México, USA, Canadá) |
| **riesgo_sesgo** | bajo, si se deriva correctamente |
| **hipótesis_causal** | jugar en el país propio ("sede", para Mx/USA/Canadá) tiene un efecto de apoyo de público distinto a jugar como "local" nominal en terreno neutral — el documento de revisión (sección 3.5) ya distingue estos casos: `tipoLocalidad === 'sede'` suma más que `'local'` |
| **uso_modelo** | en V1 esto ya existe dentro del score psicológico (`scoreLocal`). En V2, se separa del bloque P y se trata como ajuste contextual: la ventaja "sede" (jugar en el país propio) puede ser un incremento adicional sobre `factor_local` (sección 2.1 de la especificación Poisson) — **pendiente de activación**, mismo criterio que el resto del bloque C: no se activa hasta tener bloque C diseñado completo y calibración disponible |
| **uso_calibrador** | se evalúa si los partidos de México/USA/Canadá como anfitriones muestran un `factor_local` efectivo distinto al resto — si sí, se calibra un `factor_sede` adicional específico para esos 3 equipos |

**Nota de consistencia con el bloque E/Poisson**: el `factor_local=1.10` fijado en la
especificación Poisson es un valor **global**, igual para todos los partidos. C003 es la
variable que, en una fase futura, permitiría diferenciar ese factor para los 3 países
anfitriones (que probablemente tienen una ventaja de local mayor que el resto, por jugar
en casa de verdad) vs. el resto de selecciones (que en su mayoría juegan en terreno
neutral, donde un "local" nominal del fixture no tiene ventaja real de público).

---

## C004 — `fase_torneo`

| Campo | Valor |
|---|---|
| **nombre_legible** | Fase del torneo (grupos / dieciseisavos / octavos / cuartos / semis / final) |
| **bloque_modelo** | C_torneo |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | categórico |
| **momento_captura** | estático por partido, conocido desde el fixture |
| **fuente_primaria** | football-data.org (campo de competición/ronda) |
| **riesgo_sesgo** | ninguno |
| **hipótesis_causal** | el documento matemático (sección 10) incluye `Fase_i` como componente de `C_i^torneo` — partidos eliminatorios pueden tener dinámicas distintas (más cautela táctica, menos goles) que fase de grupos |
| **uso_modelo** | componente de `C_i^torneo` — **pendiente de activación junto con el resto del bloque C**. Cuando se active, es candidato a un ajuste pequeño sobre `mu_liga` específico por fase (ej. fase eliminatoria podría tener `mu_liga` ligeramente menor que fase de grupos, si los datos del propio torneo lo confirman) |
| **uso_calibrador** | se evalúa por fase: ¿el modelo calibra distinto en grupos vs. eliminatorias? Esto es directamente relevante para el "drift de partido" del documento de calibración (sección 12.4) — un cambio sistemático de comportamiento al pasar de fase de grupos a eliminatorias sería un drift esperado, no un error del modelo |

---

## C005 — `jornada_grupo`

| Campo | Valor |
|---|---|
| **nombre_legible** | Jornada dentro de la fase de grupos (1, 2, 3) |
| **bloque_modelo** | C_torneo |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | integer (1-3, o null en fase eliminatoria) |
| **fuente_primaria** | calculado desde fecha del partido (V1 ya tiene `inferirJornada` con lógica de fechas) |
| **hipótesis_causal** | esta es la variable que en V1 alimentaba `calcularBoost` (el "boost mundialista" multiplicativo, ya descartado en favor de Poisson). Su justificación original: equipos con peor ranking reciben más "boost emocional" en J1, decreciente en J2/J3 |
| **uso_modelo** | **ya resuelto en la especificación Poisson, sección 7**: el viejo "boost mundialista" se reformula como `C_i^torneo` additivo en el exponente, no como multiplicador del score total. C005 sería uno de los inputs de ese ajuste — pero, igual que el resto del bloque C, queda pendiente de activación hasta diseñar `C_i^torneo` completo con evidencia |
| **uso_calibrador** | el documento de revisión (sección 3.6) ya advirtió: "no encontré validación directa para boost automático al peor ranking, fórmula decreciente por jornada, multiplicar el total final entero" — es decir, **la forma específica de este ajuste (decreciente J1→J3) no tiene respaldo fuerte en la literatura citada**, solo la intuición general de "incentivos de torneo importan" (que sí tiene respaldo: Feddersen et al. 2021, Csató et al. 2022). Por tanto, cuando se active C_i^torneo, la forma funcional de C005 debe estimarse de los datos del propio Mundial 2026, no asumirse igual a la fórmula descartada de V1 |

---

## C006 — `gap_ranking_fifa`

| Campo | Valor |
|---|---|
| **nombre_legible** | Diferencia de ranking FIFA entre ambos equipos |
| **bloque_modelo** | C_torneo |
| **tipo_proxy** | derived_variable |
| **tipo_dato** | integer (puede ser negativo, según convención local-visitante) |
| **fuente_primaria** | derivado de `rankings.json` (ya existe en V1) — `ranking_visitante - ranking_local` |
| **riesgo_sesgo** | bajo |
| **hipótesis_causal** | el documento matemático (sección 10) incluye `GapRanking_i` explícitamente como componente de `C_i^torneo`. Conceptualmente, mide cuán "predecible" es el partido por fuerza relativa — relevante porque el efecto de incentivos de torneo (C005) probablemente interactúa con esto: un equipo débil con mucho "boost emocional" contra un equipo muy superior puede no manifestarse igual que contra un equipo parejo |
| **uso_modelo** | componente de `C_i^torneo`, pendiente de activación — posible término de interacción con C005 (`gap_ranking × jornada`) en vez de término aditivo independiente, dado que el doc de revisión sugiere que la forma multiplicativa simple del boost original no tenía respaldo, pero una interacción sí podría tenerlo |
| **uso_calibrador** | se evalúa si el residual de xG (`r_{i,m}`, el "boost real" rediseñado) correlaciona con `gap_ranking_fifa` — esto sería evidencia de que equipos con mucho gap de ranking sub/sobre-rinden de forma sistemática, lo cual justificaría activar este término |

**Nota importante**: C006 ya está disponible como dato (no requiere scraping nuevo — es
una resta entre dos valores de `rankings.json`), pero su **uso en el modelo está pendiente**
hasta que C_i^torneo se diseñe formalmente con evidencia. Esto es deliberado: tener el dato
disponible y tener el modelo activado son cosas distintas — el diccionario documenta ambas
por separado para que no se asuma que "como el dato existe, ya se está usando".

---

## C007 — `referencia_cruzada_P001_necesita_ganar` y C008 — `referencia_cruzada_P009_clasifico_sufriendo`

Estas dos variables **NO se redefinen aquí** — ya están completamente especificadas en el
diccionario del bloque P (P001 y P009 respectivamente). Se referencian en este documento
únicamente para que quede explícito que, conceptualmente, pertenecen al bloque C_torneo
(incentivo de clasificación / forma de llegada a la fase), aunque su **captura** ocurre por
el pipeline de Claude + web search (bloque P) y no por una fuente estructurada separada.

**Por qué se documenta así y no se duplica la ficha**: el documento maestro (función B,
"Controlar semántica") es explícito: *"Cada variable debe significar exactamente lo mismo
en todo el proyecto"* — crear una ficha C007 separada con la misma definición que P001
violaría esto. La ubicación de la ficha completa (en el bloque P) refleja **cómo se
captura**; esta referencia cruzada refleja **cómo se usa en el modelo** (bloque C_torneo).
Ambas cosas son ciertas simultáneamente y no son contradictorias.

---

## Resumen del bloque C — estado de activación

| Variable | ¿Activa en el primer módulo Poisson? | Estado |
|---|---|---|
| C001 altitud_estadio | No (dato disponible, ajuste pendiente) | Dato ya existe en `config.js` |
| C002 equipo_adaptado_altitud | No | **Requiere corrección de la heurística de V1** antes de activar — bug documentado |
| C003 tipo_localidad | No | Candidato a diferenciar `factor_local` para sedes anfitrionas |
| C004 fase_torneo | No | Dato disponible, candidato a ajustar `mu_liga` por fase |
| C005 jornada_grupo | No | Forma funcional NO debe copiarse de V1 (sin respaldo) — estimar de datos reales |
| C006 gap_ranking_fifa | No | Dato disponible (resta simple), uso pendiente de evidencia |
| P001/P009 (referencia) | No | Ya documentadas en bloque P |

**Patrón consistente con los bloques anteriores**: igual que en P, casi todo el bloque C
queda "documentado y disponible, pero no activo". La única diferencia real respecto al
bloque P es que aquí **no hay incertidumbre de scraping** — son datos duros o derivaciones
simples. Lo que falta no es "calidad del dato", sino **diseño del mecanismo de ajuste**
(`C_i^torneo`) y evidencia de calibración para no repetir el error de V1 de aplicar un
"boost" con forma funcional sin respaldo.

---

## Por qué el bloque C es más simple que el P, y qué implica para el plan

A diferencia del bloque P (12 variables, mucha incertidumbre, requiere taxonomía de
proxies), el bloque C tiene 6 variables nuevas + 2 referencias cruzadas, **todas con
`riesgo_sesgo` bajo o ninguno** porque son datos físicos/estructurales, no opiniones
scrapeadas. Esto significa que cuando se active `C_i^torneo`, el trabajo principal no es
"mejorar la captura de datos" (ya están disponibles) sino **diseñar correctamente la forma
funcional del ajuste** — que es justamente donde V1 falló (boost multiplicativo sin
respaldo).

**Implicación concreta para el orden de trabajo**: activar el bloque C es, en términos de
ingeniería de datos, más barato que activar más variables del bloque P (no requiere
scraping nuevo ni evaluación de confianza). Pero en términos de **diseño matemático**, es
donde más cuidado hay que tener, porque es exactamente el tipo de ajuste que el documento
de revisión ya señaló como "intuición válida, implementación sin respaldo" en V1. Cuando
llegue el momento de activar C, el primer paso debe ser mirar los datos reales del Mundial
2026 (una vez haya partidos jugados) y preguntar: *¿hay evidencia de que C005/C006 importan
en ESTE torneo?* — no asumir que sí porque "suena lógico".

# Diccionario de Variables V2 — Bloque Psicodeportivo (P)

**Proyecto Futboleros — Predictor Mundial 2026**

Segunda parte del diccionario maestro de variables. Cubre el **Bloque Psicodeportivo (P)**:
señales sobre el estado competitivo, narrativo y de disponibilidad de cada equipo, capturadas
vía análisis IA (Claude + web search) — el pipeline `analyzePsychology` que ya existe en V1.

**Principio rector de este bloque** (recordatorio de los documentos base 1 y 4): estas
variables NO son mediciones psicométricas directas. Son **proxies scrapeadas** desde fuentes
públicas (noticias, declaraciones, contexto de torneo), y cada una debe clasificarse según
qué mecanismo causal probablemente refleja:

- **`team_performance_proxy`**: puede afectar el rendimiento real del equipo en el partido.
- **`media_narrative_proxy`**: refleja el entorno simbólico/narrativo, no necesariamente el
  rendimiento.
- **`market_bias_proxy`**: puede afectar más cómo el mercado valora al equipo (la cuota) que
  el partido en sí.
- **`contextual_proxy`**: información de contexto factual (clasificación, fase de torneo).

---

## Decisión de alcance para esta versión

Las **10 variables que V1 ya captura** vía `analyzePsychology` (Claude + web search) se
**mantienen sin cambios en el prompt** — se reclasifican con la taxonomía de proxies y se
les añade `confianza_scraping`. Esto se justifica así:

1. El documento de revisión conceptual evaluó estas 10 variables una por una (sección 3.3)
   y la mayoría está marcada "mantener" — no hay evidencia de que deban eliminarse.
2. Cambiar el prompt de Claude simultáneamente con el cambio de modelo matemático (Poisson)
   haría imposible diagnosticar, si algo falla, si el problema es la variable o el modelo —
   violaría el principio de "un cambio a la vez" del documento de calibración.
3. La reclasificación es de bajo riesgo: no toca `analyzePsychology`, solo añade metadatos.
4. El rediseño del prompt (si hace falta) se decide en Fase 2/3, **con evidencia** del
   módulo de evaluación de señales scrapeadas (sección 8 del documento de calibración) —
   no por intuición ahora.

Adicionalmente, se añaden **2 variables nuevas** para resolver el placeholder E007
(lesiones/ausencias) que quedó pendiente del bloque E, con el mismo pipeline de captura.

---

## Tabla resumen de las 10 variables existentes (reclasificadas)

| Variable V1 | tipo_proxy asignado | Razón de la clasificación |
|---|---|---|
| `necesita_ganar` | `contextual_proxy` | Es un hecho de la tabla de clasificación (matemáticamente determinable), no una opinión scrapeada — aunque Claude la infiere via web search, su naturaleza es factual |
| `venganza_narrativa` | `media_narrative_proxy` | Es relato/encuadre periodístico de un partido pasado, no un hecho medible sobre el equipo actual |
| `rival_maldito` | `media_narrative_proxy` | Mismo razonamiento — historial H2H narrado, no estado actual del equipo |
| `presion_mediatica` | `media_narrative_proxy` | Por definición, mide volumen/tono de cobertura mediática |
| `lider_disponible` | `team_performance_proxy` | Disponibilidad real de un jugador clave SÍ afecta el rendimiento esperado |
| `conflicto_interno` | `team_performance_proxy` | Si es real (no solo rumor), afecta cohesión y rendimiento — pero tiene alto riesgo de ser en realidad `media_narrative_proxy` si se basa en rumores sin confirmar |
| `generacion_peak` | `team_performance_proxy` | Refleja calidad de plantilla en su mejor momento — relacionado con `rating_equipo` (E, vía ranking FIFA) pero capturado de forma cualitativa |
| `underdog` | `market_bias_proxy` | Esta es la variable que el documento 1 (sección sobre "sesgo de hincha/mercado") identifica como la más cercana a sesgo de mercado: "underdog con narrativa positiva" afecta cómo el público/mercado valora al equipo, más que su rendimiento real |
| `clasifico_sufriendo` | `contextual_proxy` | Hecho factual sobre cómo llegó el equipo a esta fase |
| `humillacion_previa` | `media_narrative_proxy` | Encuadre narrativo de un resultado pasado |

**Nota importante sobre `underdog`**: esta es la variable que en V1 alimentaba directamente
`underdogConMomentum` para generar apuestas "malcriadas" (alto riesgo, cuotas altas como
5.5-18.0 inventadas). En V2, al clasificarla como `market_bias_proxy`, su rol cambia: en
vez de generar una probabilidad de evento del partido, su lugar natural es el **Betting
Engine** (capa de sesgo de mercado, sección 12 del documento matemático: B_A = w1
SesgoPublico + ... + w4 IdentidadHincha + ...), no el Prediction Engine. Esto es un
ejemplo concreto de la separación obligatoria "predicción ≠ decisión de apuesta" que pediste
desde el inicio — `underdog` no debería mover λ_goles, debería ayudar a explicar por qué el
mercado podría estar mal calibrado en un mercado específico.

---

## P001 — `necesita_ganar`

| Campo | Valor |
|---|---|
| **nombre_legible** | Necesidad competitiva de victoria |
| **bloque_modelo** | P_team (vía contextual_proxy) |
| **tipo_proxy** | contextual_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search (`analyzePsychology`), cache-first, generado el día del partido |
| **riesgo_leakage** | bajo — es información disponible públicamente antes del partido (tabla de clasificación) |
| **riesgo_sesgo** | bajo |
| **confianza_minima_sugerida** | 0.75 — al ser determinable desde la tabla de clasificación, debería tener alta confianza salvo error de Claude |
| **hipótesis_causal** | mayor incentivo competitivo puede alterar esfuerzo/planteamiento/presión (respaldado en el doc de revisión, sección sobre "boost mundialista" y literatura de incentivos de torneo) |
| **uso_modelo** | bloque C (contextual) — ajuste additivo pequeño sobre λ, vía C_i^torneo (sección 10 del doc matemático). **No implementado en el primer módulo Poisson** — queda para cuando se active el bloque C |
| **uso_calibrador** | módulo de evaluación de señales scrapeadas — se mide su mejora marginal en log loss/Brier una vez haya muestra |

---

## P002 — `venganza_narrativa`

| Campo | Valor |
|---|---|
| **nombre_legible** | Narrativa de revancha/venganza |
| **bloque_modelo** | P_media |
| **tipo_proxy** | media_narrative_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_leakage** | bajo |
| **riesgo_sesgo** | medio-alto — depende de qué tan presente esté la narrativa en medios al momento de la búsqueda |
| **confianza_minima_sugerida** | 0.50 — más subjetivo que P001 |
| **hipótesis_causal** | **débil como predictor directo del partido**; el documento de revisión la incluye pero advierte que estas señales narrativas "no siempre predicen bien el rendimiento real, pero sí pueden capturar el entorno simbólico" |
| **uso_modelo** | **no entra en λ por ahora**. Se mantiene capturada y registrada, pero su uso queda pendiente de evaluación — es candidata a moverse al Betting Engine (sesgo de mercado) si la calibración muestra que no aporta a la predicción del partido pero sí correlaciona con desajustes de cuota |
| **uso_calibrador** | evaluación de señal tipo `media_narrative_proxy` — el documento de calibración (sección 8.3) dice explícitamente que este tipo de señal "afecta percepción pública y a veces el partido", por lo que se mide su correlación con ambos: resultado real Y con el error del mercado (diferencia entre prob. del modelo y prob. implícita) |

---

## P003 — `rival_maldito`

| Campo | Valor |
|---|---|
| **nombre_legible** | Historial adverso ante este rival específico (H2H narrativo) |
| **bloque_modelo** | P_media |
| **tipo_proxy** | media_narrative_proxy |
| **tipo_dato** | float/escala (0-N, según V1) |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | alto — "maldición" es un encuadre periodístico, no un efecto estadístico verificado |
| **confianza_minima_sugerida** | 0.40 |
| **hipótesis_causal** | similar a P002 — entorno simbólico, no necesariamente predictivo |
| **uso_modelo** | no entra en λ. Registrado para evaluación de calibrador, mismo tratamiento que P002 |
| **uso_calibrador** | igual a P002 |

---

## P004 — `presion_mediatica`

| Campo | Valor |
|---|---|
| **nombre_legible** | Presión mediática estimada |
| **bloque_modelo** | P_media |
| **tipo_proxy** | media_narrative_proxy |
| **tipo_dato** | float (escala 0-10 en V1) |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | medio-alto |
| **confianza_minima_sugerida** | 0.45 |
| **hipótesis_causal** | la presión mediática extrema puede asociarse con peor rendimiento (efecto de "choking" bajo presión, fenómeno documentado en psicología del deporte en términos generales) — pero medir "presión mediática" vía conteo/tono de noticias es un proxy indirecto de ese efecto |
| **uso_modelo** | no entra en λ en esta versión. Candidata a bloque P en fase futura SI la calibración muestra correlación con sub-rendimiento (residuos negativos de xG) |
| **uso_calibrador** | se evalúa correlación con r_{i,m} = xG_real - xG_pred — esto es precisamente el "boost real" rediseñado del documento de calibración (sección 11.7): si `presion_mediatica` alta correlaciona con residuos negativos sostenidos, eso es evidencia para incorporarla |

---

## P005 — `lider_disponible`

| Campo | Valor |
|---|---|
| **nombre_legible** | Disponibilidad de jugador líder/referente |
| **bloque_modelo** | P_team |
| **tipo_proxy** | team_performance_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_leakage** | medio — depende de cuándo se confirma la baja/presencia vs. cuándo se genera el análisis (el día del partido, según la restricción ya implementada en V1) |
| **riesgo_sesgo** | medio |
| **confianza_minima_sugerida** | 0.60 |
| **hipótesis_causal** | la ausencia de un jugador clave (capitán, máximo goleador, etc.) reduce calidad efectiva del plantel — esto es, en esencia, una versión cualitativa de las "ausencias ofensivas/defensivas" del bloque E (ver P_LESIONES más abajo) |
| **uso_modelo** | no entra directo en λ — su contenido informativo se espera que esté mayormente capturado por P_LES_OFE / P_LES_DEF (más específicas y con destino claro en E001/E002). Se mantiene como variable de respaldo/contexto narrativo |
| **uso_calibrador** | se evalúa si aporta señal incremental MÁS ALLÁ de lo que ya capturan las variables de lesiones — si la correlación es redundante, se documenta y posiblemente se retira en fase futura (no ahora, sin evidencia) |

---

## P006 — `conflicto_interno`

| Campo | Valor |
|---|---|
| **nombre_legible** | Conflicto interno estimado en el plantel |
| **bloque_modelo** | P_team (con riesgo de ser P_media) |
| **tipo_proxy** | team_performance_proxy — **pero con bandera de revisión** |
| **tipo_dato** | float (escala 0-N en V1) |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | **alto** |
| **confianza_minima_sugerida** | 0.35 — la más baja del bloque |
| **hipótesis_causal** | si el conflicto es real y documentado (ej. sanción disciplinaria confirmada, declaraciones oficiales), afecta cohesión y rendimiento real. Si es solo rumor de prensa, es en realidad `media_narrative_proxy` |
| **uso_modelo** | no entra en λ |
| **uso_calibrador** | **esta variable es el ejemplo más claro de por qué `confianza_scraping` importa**: el documento 1 dice que si la confianza es baja, el peso efectivo debe reducirse o marcarse no confiable. Aquí, `confianza_minima_sugerida=0.35` significa que, salvo que Claude reporte explícitamente una fuente sólida (declaración oficial, sanción confirmada), esta variable entra al calibrador con peso casi nulo por defecto |

---

## P007 — `generacion_peak`

| Campo | Valor |
|---|---|
| **nombre_legible** | Plantel en su "generación dorada"/momento de máxima calidad |
| **bloque_modelo** | P_team |
| **tipo_proxy** | team_performance_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | medio |
| **confianza_minima_sugerida** | 0.50 |
| **hipótesis_causal** | señal de calidad de plantel que el ranking FIFA (E, rating_equipo) puede no capturar completamente si es reciente (ej. una generación de jugadores jóvenes que aún no se refleja del todo en el ranking) |
| **uso_modelo** | no entra en λ por ahora — candidata a ajuste menor de `ataque_i`/`defensa_i` si la calibración muestra que el ranking FIFA sistemáticamente subestima a estos equipos |
| **uso_calibrador** | se evalúa correlación con residuos de xG, igual que P004 |

---

## P008 — `underdog`

| Campo | Valor |
|---|---|
| **nombre_legible** | Narrativa de equipo "underdog" con momentum |
| **bloque_modelo** | **M (mercado)**, no P |
| **tipo_proxy** | market_bias_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | medio |
| **confianza_minima_sugerida** | 0.50 |
| **hipótesis_causal** | el documento 1 cita literatura (Na et al. 2018; Wheatcroft 2020a) sobre sobre-reacción del mercado a narrativas de underdog/momentum — el efecto esperado es sobre la **cuota**, no sobre el resultado real del partido |
| **uso_modelo** | **no entra en λ (Prediction Engine)**. Entra en el Betting Engine como input de B_A (sección 12 del doc matemático: capa de sesgo de mercado) |
| **uso_calibrador** | se evalúa correlación con epsilon^market_A = p_modelo - p_implicita_no_vig — es decir, si cuando `underdog=true`, el mercado sistemáticamente sobreestima a ese equipo (lo cual generaría edge a favor del modelo en el lado contrario) |

**Esta es la reclasificación más importante del bloque**, porque cambia DÓNDE vive la
variable en la arquitectura, no solo su etiqueta.

---

## P009 — `clasifico_sufriendo`

| Campo | Valor |
|---|---|
| **nombre_legible** | Forma de clasificación a esta fase (cómodo / sufriendo / último) |
| **bloque_modelo** | C (contextual) |
| **tipo_proxy** | contextual_proxy |
| **tipo_dato** | categórico (`comodo` / `ultimo` / otros valores en V1) |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search (verificable contra tabla de clasificación real) |
| **riesgo_sesgo** | bajo |
| **confianza_minima_sugerida** | 0.70 |
| **hipótesis_causal** | similar a P001 — incentivo/momentum de cómo se llegó a la fase actual |
| **uso_modelo** | bloque C, mismo tratamiento que P001 — pendiente de activación |
| **uso_calibrador** | evaluación de señal contextual |

---

## P010 — `humillacion_previa`

| Campo | Valor |
|---|---|
| **nombre_legible** | Derrota humillante reciente contra este rival u otro relevante |
| **bloque_modelo** | P_media |
| **tipo_proxy** | media_narrative_proxy |
| **tipo_dato** | boolean |
| **momento_captura** | prepartido |
| **fuente_primaria** | Claude + web search |
| **riesgo_sesgo** | medio-alto |
| **confianza_minima_sugerida** | 0.45 |
| **hipótesis_causal** | similar a P002/P003/P010 — entorno narrativo, mismo tratamiento |
| **uso_modelo** | no entra en λ |
| **uso_calibrador** | igual a P002 |

---

## Variables nuevas: resolución del placeholder E007 (lesiones/ausencias)

Como se acordó: versión de **2 sub-variables** (no 5, no 1), porque conecta directo con
E001/E002 y es razonable de estimar vía web search.

### P_LES_OFE — `ausencias_ofensivas`

| Campo | Valor |
|---|---|
| **nombre_legible** | Impacto estimado de ausencias en ataque/mediocampo ofensivo |
| **bloque_modelo** | P_team (con destino en E — bloque ataque) |
| **tipo_proxy** | team_performance_proxy |
| **tipo_dato** | float, escala 0-1 (0 = sin ausencias relevantes, 1 = ausencia máxima de jugadores ofensivos clave) |
| **momento_captura** | prepartido — el día del partido (mismo patrón cache-first de V1) |
| **frecuencia_actualización** | una vez por partido, regenerable si cambia algo significativo antes del kickoff (lesión de último momento) — esto requiere decisión operativa: ¿se permite regenerar el día del partido más de una vez? Se documenta como pregunta abierta, no se decide aquí |
| **fuente_primaria** | Claude + web search — se añade al mismo prompt de `analyzePsychology`, no es un pipeline nuevo |
| **riesgo_leakage** | medio — una lesión de último momento (calentamiento previo al partido) podría no estar disponible al momento de generar el análisis. Se documenta el riesgo, no se intenta resolver con polling en tiempo real (fuera de alcance) |
| **riesgo_sesgo** | medio |
| **confianza_minima_sugerida** | 0.55 |
| **hipótesis_causal** | ausencia de delanteros/mediocampistas ofensivos clave reduce la capacidad de generar xG por encima de lo que ya refleja el xG histórico (que se calculó CON esos jugadores presentes) |
| **uso_modelo** | ajuste multiplicativo sobre `ataque_i` antes de entrar a la fórmula de λ: `ataque_i_ajustado = ataque_i * (1 - peso_les_ofe * ausencias_ofensivas)`. El `peso_les_ofe` es un coeficiente a calibrar — **se fija inicialmente en un valor conservador pequeño (0.15)** y es candidato de Capa 2/3 de calibración (ajuste de pesos de bloque), nunca Capa 1 |
| **uso_calibrador** | se evalúa si el ajuste mejora o empeora Brier/log loss respecto a no aplicarlo — el documento de calibración exige medir esto antes de mantenerlo activo |

### P_LES_DEF — `ausencias_defensivas`

| Campo | Valor |
|---|---|
| **nombre_legible** | Impacto estimado de ausencias en defensa/arquero |
| **bloque_modelo** | P_team (con destino en E — bloque defensa) |
| **tipo_proxy** | team_performance_proxy |
| **tipo_dato** | float, escala 0-1 |
| **momento_captura** | prepartido, mismo patrón que P_LES_OFE |
| **fuente_primaria** | Claude + web search, mismo prompt extendido |
| **riesgo_leakage** | medio, mismo razonamiento |
| **riesgo_sesgo** | medio |
| **confianza_minima_sugerida** | 0.55 |
| **hipótesis_causal** | ausencia de defensores centrales clave o arquero titular incrementa la probabilidad de conceder más de lo que refleja `xg_concedido_promedio` histórico (calculado con esos jugadores presentes) |
| **uso_modelo** | ajuste multiplicativo sobre `defensa_i`: `defensa_i_ajustado = defensa_i * (1 + peso_les_def * ausencias_defensivas)` — nota el signo `+`: más ausencias defensivas, el equipo concede MÁS, así que `defensa_i` (que representa "xG concedido") debe AUMENTAR, no reducirse. `peso_les_def` mismo tratamiento que `peso_les_ofe`: valor inicial conservador (0.15), candidato a Capa 2/3 |
| **uso_calibrador** | igual a P_LES_OFE |

---

## Resumen del bloque P — qué entra a λ directamente vs. qué no

| Variable | ¿Entra a λ en el primer módulo? | Destino futuro |
|---|---|---|
| P001 necesita_ganar | No | Bloque C (contextual), activación futura |
| P002 venganza_narrativa | No | Evaluación calibrador — posible Betting Engine |
| P003 rival_maldito | No | Igual a P002 |
| P004 presion_mediatica | No | Bloque P futuro, condicionado a evidencia |
| P005 lider_disponible | No | Respaldo narrativo de P_LES_OFE/DEF |
| P006 conflicto_interno | No | Peso casi nulo por defecto (confianza baja) |
| P007 generacion_peak | No | Posible ajuste de rating, condicionado a evidencia |
| **P008 underdog** | No | **Betting Engine** (sesgo de mercado), no Prediction Engine |
| P009 clasifico_sufriendo | No | Bloque C, igual que P001 |
| P010 humillacion_previa | No | Igual a P002 |
| **P_LES_OFE** | **Sí, vía ajuste a `ataque_i`** | Activo desde el primer módulo extendido (peso inicial bajo, 0.15) |
| **P_LES_DEF** | **Sí, vía ajuste a `defensa_i`** | Activo desde el primer módulo extendido (peso inicial bajo, 0.15) |

---

## Por qué esta tabla es la pieza más importante del bloque P

De las 12 variables de este bloque (10 + 2 nuevas), **solo 2 entran al cálculo de goles
esperados en esta fase**, y con un peso deliberadamente bajo (0.15) que es candidato
temprano de calibración. Las otras 10 quedan **capturadas, almacenadas, clasificadas y
trazables** — pero no influyen en la predicción todavía.

Esto no es desperdiciar el trabajo de scraping de V1: es exactamente lo que pide el
documento de calibración (Módulo 1, auditoría de observaciones) — necesitamos que estas 10
variables estén guardadas con sus metadatos desde el primer partido, para que cuando
lleguemos a ~20-30 partidos calibrables, el módulo de evaluación de señales (sección 8 del
doc de calibración) tenga datos suficientes para decir, con evidencia, cuáles de estas 10
variables deberían activarse, con qué peso, y en qué bloque (P, C, o M/Betting Engine).

Programar esto ahora sin esa evidencia sería repetir el error de V1: pesos asignados por
intuición (`presion: 0.14, local: 0.10, liderazgo: 0.10, momentum: 0.06`) sin haber medido
si esas proporciones tienen algún fundamento.

---

## Pregunta abierta registrada (no bloqueante)

`P_LES_OFE`/`P_LES_DEF` requieren extender el prompt de `analyzePsychology` con 2 campos
nuevos. Esto es un cambio pequeño y de bajo riesgo (no es "rediseñar el prompt", es añadir
2 campos a un JSON que Claude ya devuelve). Se implementa junto con el Data Pipeline,
cuando se programe la captura — no bloquea el diseño del resto del diccionario.

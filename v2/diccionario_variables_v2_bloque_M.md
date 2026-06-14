# Diccionario de Variables V2 — Bloque Mercado (M)

**Proyecto Futboleros — Predictor Mundial 2026**

Cuarta y última parte del diccionario maestro de variables. Cubre el **Bloque Mercado
(M)**: cuotas reales de bookmakers (The Odds API), probabilidades implícitas, no-vig, y la
capa de sesgo de mercado donde aterriza `underdog` (P008) y las demás variables que el
bloque P reclasificó como `market_bias_proxy`.

**Diferencia fundamental con los bloques E/P/C**: este es el único bloque donde las
variables **NO alimentan λ (Prediction Engine)**. Todo lo de este bloque vive en el
**Betting Engine** — la capa que compara "lo que predice el modelo" contra "lo que dice el
mercado". Esta separación es la regla de oro del proyecto: *"¿Qué probabilidad tiene este
evento?" (Prediction Engine) es distinto de "¿Existe valor frente a la cuota disponible?"
(Betting Engine)*.

---

## M001 — `odds_1x2`

| Campo | Valor |
|---|---|
| **nombre_legible** | Cuotas decimales de mercado para 1X2 (gana local / empate / gana visitante) |
| **bloque_modelo** | M |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | objeto `{local: float, empate: float, visitante: float}` por bookmaker |
| **rango_esperado** | 1.01 – 50+ (cuotas decimales) |
| **momento_captura** | prepartido — múltiples snapshots posibles (ver M005) |
| **frecuencia_actualización** | según estrategia de snapshots (diario + pre-kickoff) |
| **fuente_primaria** | The Odds API, `sport_key=soccer_fifa_world_cup`, `markets=h2h`, `regions=eu` (Pinnacle disponible, confirmado en la búsqueda anterior) |
| **riesgo_leakage** | **ninguno si se usa el snapshot ANTERIOR al kickoff** — riesgo real si por error se usara un snapshot post-resultado (odds que ya reflejan el resultado conocido). El Data Pipeline debe filtrar por timestamp < kickoff |
| **riesgo_sesgo** | bajo — son precios de mercado real, no estimaciones |
| **confianza_minima_sugerida** | 1.0 — dato directo de mercado |
| **hipótesis_causal** | n/a — esto no es un predictor del partido, es el "punto de comparación" contra el cual se mide el modelo |
| **uso_modelo** | **no entra en λ**. Es el insumo principal del Betting Engine |
| **uso_calibrador** | base para CLV (Closing Line Value) si se guardan snapshots de apertura y cierre |

---

## M002 — `probabilidad_implicita`

| Campo | Valor |
|---|---|
| **nombre_legible** | Probabilidad implícita bruta (sin corregir por margen) |
| **bloque_modelo** | M |
| **tipo_proxy** | derived_variable |
| **tipo_dato** | float, 0-1 |
| **fórmula** | `p_imp = 1 / odds` |
| **fuente_primaria** | derivado de M001 |
| **uso_modelo** | paso intermedio hacia M003 (no-vig) |
| **uso_calibrador** | n/a directamente — ver M003 |

**Justificación de esta ficha separada (aunque sea trivial)**: el documento matemático
(sección 11) define explícitamente \(p_A^{imp} = 1/o_A\) como paso intermedio, distinto de
\(\tilde p_A^{imp}\) (no-vig). Mantener ambos pasos como variables separadas en el
diccionario evita que alguien programe el edge directamente contra `1/odds` sin corregir
el margen — que es exactamente el error que tenía V1 (su `calcularCuota` generaba cuotas
propias sin margen real de mercado, haciendo el EV casi tautológico).

---

## M003 — `probabilidad_no_vig`

| Campo | Valor |
|---|---|
| **nombre_legible** | Probabilidad implícita corregida por margen del bookmaker (no-vig / "fair") |
| **bloque_modelo** | M |
| **tipo_proxy** | derived_variable |
| **tipo_dato** | float, 0-1 (las 3 probabilidades 1X2 deben sumar exactamente 1) |
| **fórmula** | Para el mercado 1X2: `overround = sum(1/odds_local + 1/odds_empate + 1/odds_visitante)`. Luego: `p_no_vig_X = (1/odds_X) / overround` para cada resultado X |
| **fuente_primaria** | derivado de M001/M002 |
| **riesgo_sesgo** | bajo — es una normalización matemática estándar (hay métodos más sofisticados que la normalización proporcional simple, pero esta es la base) |
| **hipótesis_causal** | n/a |
| **uso_modelo** | **este es el valor que se compara contra `prob_1x2` del módulo Poisson** para calcular el edge |
| **uso_calibrador** | el documento de calibración usa esto para `epsilon^market_A = p_modelo - p_no_vig` — el "error del mercado" desde la perspectiva del modelo |

**Por qué la normalización proporcional simple, y no algo más complejo desde ya**: existen
métodos más sofisticados para repartir el margen entre outcomes (Shin's method, Power
method, etc.) que algunos de los repos evaluados podrían implementar (`penaltyblog` y
`goalmodel` incluyen "market probabilities" como funcionalidad). Pero igual que con
Bivariate Poisson en el bloque E: empezamos con el método simple, bien entendido y fácil de
auditar, y solo se sube de complejidad si la calibración muestra que la normalización
proporcional simple introduce sesgo sistemático medible. No hay evidencia de eso todavía
porque no hay datos del torneo aún.

---

## M004 — `edge` y M005 — `expected_value`

| Campo | Valor |
|---|---|
| **nombre_legible** | Edge (ventaja del modelo sobre el mercado) y Expected Value de la apuesta |
| **bloque_modelo** | M |
| **tipo_proxy** | derived_variable |
| **tipo_dato** | float |
| **fórmulas** | `Edge_A = p_modelo_A - p_no_vig_A` (M003) <br> `EV_A = p_modelo_A * odds_A - 1` |
| **fuente_primaria** | `prob_1x2`/`prob_over_under`/`prob_btts` del módulo Poisson (Prediction Engine) **+** M001/M003 (Betting Engine) |
| **uso_modelo** | **esta es la salida principal del Betting Engine** — la regla de decisión `Apostar(A_j) = 1(EV_j > tau)` del documento matemático (sección 19) se evalúa sobre estos valores |
| **uso_calibrador** | hit rate por mercado, ROI, yield — todas las métricas de rentabilidad del documento de calibración dependen de que EV/edge estén bien definidos desde el inicio (no como en V1, donde EV se calculaba contra una cuota auto-generada) |

**Diferencia central con V1, resumida aquí**: en V1, `calcularEV(prob, cuota)` usaba una
`cuota` generada por `calcularCuota(prob) = (1/prob) * (1 - margen)` — es decir, la cuota
era una función de la propia probabilidad del modelo, con un margen fijo de 5% inventado.
Esto significa que el EV de V1 medía, en esencia, *"qué tan lejos está mi probabilidad de
mi propia probabilidad ajustada por un margen fijo"* — casi tautológico, y nunca podía
reflejar una discrepancia real con el mercado. En V2, `odds_A` (M001) viene de The Odds
API — un precio real fijado por bookmakers reales — por lo que `EV_A` ahora mide algo
real: la discrepancia entre el modelo y el consenso del mercado.

---

## M005 — `odds_snapshot_apertura` y `odds_snapshot_cierre` (para CLV)

| Campo | Valor |
|---|---|
| **nombre_legible** | Snapshots de cuotas en distintos momentos (apertura del mercado vs. cierre pre-kickoff) |
| **bloque_modelo** | M |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | mismo formato que M001, con `timestamp_captura` |
| **momento_captura** | apertura: primer snapshot disponible tras publicación de odds. Cierre: snapshot más cercano al kickoff |
| **frecuencia_actualización** | estrategia de 2 snapshots/día propuesta en la conversación anterior (~150 credits/torneo de los 500 gratis) |
| **fuente_primaria** | The Odds API |
| **riesgo_leakage** | el snapshot de "cierre" debe capturarse ANTES del kickoff — si se captura después, deja de ser "cierre pre-partido" y pasa a reflejar información del partido en curso. El Data Pipeline debe validar `timestamp_captura < kickoff_time` |
| **uso_modelo** | n/a — Prediction Engine no usa esto |
| **uso_calibrador** | **CLV (Closing Line Value)**, explícitamente listado en el documento de calibración como métrica de desempeño (sección 14.2): \(CLV = \) comparación entre el precio tomado (apertura, si se "apostó" ahí) y el cierre. Si el modelo consistentemente identifica valor que el mercado luego corrige (cierre más cercano a la probabilidad del modelo que la apertura), eso es evidencia de que el modelo captura información real antes que el mercado |

---

## M006 — `sesgo_mercado_underdog` (conexión con P008)

| Campo | Valor |
|---|---|
| **nombre_legible** | Componente de sesgo de mercado atribuible a narrativa de underdog |
| **bloque_modelo** | M |
| **tipo_proxy** | market_bias_proxy (heredado de P008) |
| **tipo_dato** | boolean (heredado), usado como regresor |
| **fuente_primaria** | P008 (`underdog`, de `analyzePsychology`) — **no se captura de nuevo, se reutiliza** |
| **fórmula conceptual** | del documento matemático (sección 12): <br> `B_A = w1*SesgoPublico_A + w2*PopularidadEquipo_A + w3*SobreReaccionRacha_A + w4*IdentidadHincha_A + w5*SobreconfianzaNarrativa_A` <br> En esta primera versión, `underdog` (P008) es el único input disponible para `B_A` — los demás (`SesgoPublico`, `PopularidadEquipo`, etc.) NO están capturados todavía |
| **uso_modelo** | **no entra en λ**. Es un input candidato para ajustar `Edge_A` (M004): `Edge_A^adj = Edge_A + B_A` — pero con un solo input (`underdog`) y sin pesos `w_i` calibrados, **`B_A` no se activa en la primera versión**. Se documenta la fórmula completa para que la estructura esté lista cuando haya más inputs y evidencia |
| **uso_calibrador** | esto es exactamente lo que se mide en la evaluación de P008: ¿cuándo `underdog=true`, el `Edge_A` calculado (M004) tiende a ser sistemáticamente positivo o negativo? Si hay un patrón claro y estable, eso justifica activar `B_A` con un peso inicial pequeño para ese único input |

**Por qué esto cierra el círculo del diseño**: esta ficha conecta directamente lo que
dijimos sobre P008 en el bloque P ("no entra en λ, entra en el Betting Engine como input de
B_A") con la fórmula real del documento matemático. No es una promesa abstracta — aquí está
la fórmula exacta, con el estado real (1 de 5 inputs disponibles, B_A no activado), y el
criterio explícito para activarlo.

---

## Resumen del bloque M

| Variable | ¿Activa desde el inicio? | Rol |
|---|---|---|
| M001 odds_1x2 | **Sí** | Insumo crudo, base de todo lo demás |
| M002 probabilidad_implicita | **Sí** | Paso intermedio (no usar directo para edge) |
| M003 probabilidad_no_vig | **Sí** | Comparación válida contra el modelo |
| M004 edge / EV | **Sí** | Salida principal del Betting Engine |
| M005 snapshots apertura/cierre | Sí (captura), análisis pendiente | Para CLV, requiere historial |
| M006 sesgo_mercado_underdog (B_A) | No (estructura lista, 1/5 inputs, sin calibrar) | Ajuste futuro de edge |

**Este bloque es distinto a E/P/C**: aquí SÍ se activa la mayoría desde el primer momento
(M001-M004), porque son los componentes mínimos indispensables del Betting Engine — sin
ellos, no hay forma de responder "¿hay valor en esta apuesta?", que es la mitad de la
pregunta central del proyecto. Lo que queda pendiente (M006/B_A) es, igual que en los
otros bloques, una extensión que requiere más inputs y evidencia antes de activarse.

---

## Cierre del diccionario completo — mapa de los 4 bloques

Con E, P, C y M documentados, el panorama completo es:

| Bloque | Variables activas en λ/Betting Engine desde el inicio | Variables documentadas pero pendientes |
|---|---|---|
| **E** (estadístico) | xg_promedio, xg_concedido_promedio (E001, E002) | goles reales, corners, forma_reciente (roles secundarios definidos) |
| **P** (psicodeportivo) | ausencias_ofensivas, ausencias_defensivas (P_LES_OFE/DEF, peso inicial 0.15) | 10 variables de V1, reclasificadas y capturadas, sin activar |
| **C** (contextual) | ninguna | altitud, localía, fase, jornada, gap ranking — datos disponibles, mecanismo C_torneo pendiente de diseño con evidencia |
| **M** (mercado) | odds, prob. implícita, no-vig, edge/EV (M001-M004) | sesgo de mercado B_A (1/5 inputs, P008) |

**El patrón es consistente en los 4 bloques**: arrancamos con el **mínimo viable
matemáticamente coherente** (2 variables en E para λ, 4 derivaciones en M para
edge/EV), capturamos TODO lo demás desde el día uno con su trazabilidad completa, y cada
extensión futura tiene ya su lugar, su fórmula, y su criterio de activación documentado —
nada se activa "porque ya lo tenemos", todo se activa cuando la calibración con datos
reales del Mundial 2026 lo justifique.

---

## Próximo paso natural

Con el diccionario completo (E, P, C, M), el siguiente documento de diseño pendiente —
según el plan original — es el **esquema de Firestore**: las "cajas" donde se guarda cada
una de estas variables, las predicciones, los snapshots de odds, los resultados reales, y
las versiones del modelo. Este esquema debe reflejar fielmente la separación de bloques y
el estado activo/pendiente de cada variable, para que la trazabilidad (qué se usó, qué se
guardó, qué versión) sea real desde el primer partido analizado.

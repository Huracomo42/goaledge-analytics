# Diccionario de Variables V2 — Bloque Estadístico (E)

**Proyecto Futboleros — Predictor Mundial 2026**

Este documento es la primera parte del diccionario maestro de variables para V2.
Cubre únicamente el **Bloque Estadístico (E)**: las variables de rendimiento futbolístico
observacional que alimentan directamente el modelo Poisson de goles esperados (λ_local, λ_visitante).

Cada variable se describe con: qué es, por qué se incluye (con respaldo), de dónde sale,
cuándo se captura, y cómo entra al modelo. Esto sigue la plantilla del documento
`diccionario_maestro_variables_fuentes_BASE.md` y el principio acordado: nada se incluye
"porque sí" — todo tiene justificación trazable a los documentos base, papers citados en ellos,
o repos open source de referencia.

---

## Principio general del bloque E

El documento `formulacion_matematica_modelo_apuestas_futbol_BASE.md` (sección 22.1) define:

```
λ_L = exp(θ0 + θ_E^T E_L + θ_P^T P_L + θ_C^T C_L - θ_D^T D_V)
λ_V = exp(φ0 + φ_E^T E_V + φ_P^T P_V + φ_C^T C_V - φ_D^T D_L)
```

Es decir: el bloque E (estadístico) entra como covariables dentro de una función exponencial
que determina cuántos goles se espera que meta cada equipo. Las variables de este bloque
representan **capacidad ofensiva**, **capacidad defensiva**, y **fuerza estructural** —
no narrativa, no psicología, no mercado. Esa separación es la que permite, más adelante,
ajustar el peso del bloque E de forma independiente al bloque P (psicodeportivo) durante
la calibración, sin mezclar mecanismos causales distintos.

---

## Ventana temporal y ponderación (aplica a TODAS las variables de este bloque)

**Regla**: K = 10 partidos recientes máximo, ponderación exponencial decreciente.

```
Forma_i(t) = Σ(s=1 a K) w_s · R_i(t-s)
w_s = e^(-λs) / Σ(r=1 a K) e^(-λr)
```

**Justificación**: formulación matemática base, sección 17 ("Dinámica temporal"). Si un
equipo tiene menos de 10 partidos disponibles (común en selecciones nacionales, que juegan
pocos partidos al año), se usa el máximo disponible y se marca `muestra_pequena: true` en
los metadatos — esto es relevante para el calibrador (módulo de auditoría de observaciones,
`sistema_calibracion_incremental_BASE.md`).

**Referencia de repo**: `penaltyblog` implementa ponderación por recencia en sus ratings —
se usa como referencia de implementación, no como dependencia (Python vs. nuestro JS).

**Parámetro λ de decaimiento**: se fija inicialmente en un valor que da aproximadamente
estos pesos relativos para K=10 (el partido más reciente pesa ~3x el más antiguo). El valor
exacto de λ es uno de los "coeficientes internos" — según la secuencia de calibración del
documento 3, esto NO se ajusta hasta la Capa 4 (ajuste fino de coeficientes), con muestra
suficiente. Por ahora se fija un valor razonable de referencia y no se toca.

---

## E001 — `xg_promedio`

| Campo | Valor |
|---|---|
| **nombre_legible** | xG promedio (forma reciente) |
| **descripción** | Expected Goals promedio del equipo en sus últimos K partidos, ponderado por recencia |
| **bloque_modelo** | E |
| **subbloque** | ataque |
| **tipo_fuente** | api_externa (calculado sobre datos crudos) |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | float |
| **rango_esperado** | 0.3 – 3.5 (fútbol de selecciones) |
| **momento_captura** | prepartido |
| **frecuencia_actualización** | cada vez que el equipo juega un partido nuevo |
| **fuente_primaria** | FotMob (`stats_avanzadas.xg_local` / `xg_visitante`, vía `getAdvancedMatchStats` / `syncAdvancedStats`) |
| **fuentes_secundarias** | football-data.org (no provee xG directo — solo como fallback si FotMob falla, usando `xg_estimado = goles_promedio * 0.85 + 0.2`, ya implementado en V1) |
| **riesgo_leakage** | bajo, si solo se usan partidos ANTERIORES a la fecha del partido a predecir |
| **riesgo_sesgo** | medio — el xG de FotMob depende de su propio modelo de shot quality, que puede variar por liga |
| **hipótesis_causal** | el xG reciente predice mejor la capacidad ofensiva futura que los goles reales, porque corrige por suerte/eficiencia de finalización a corto plazo |
| **uso_modelo** | entra como covariable de ataque en λ del equipo |
| **uso_calibrador** | se compara contra goles reales postpartido para medir error de calibración del bloque E |
| **transformación_pre_modelo** | ponderación por recencia (ver sección anterior); ninguna normalización adicional — Poisson trabaja directamente con tasas de gol |

**Justificación de inclusión**: la formulación matemática base usa xG como insumo principal
del bloque ataque porque, a diferencia de goles reales, no está dominado por varianza de
finalización en muestras pequeñas (un Mundial son pocos partidos por equipo). El documento
de revisión conceptual (sección 3.2) lo marca como variable "a incorporar sí o sí" porque
el xG real (no pseudo-xG) mejora la robustez frente a depender solo de goles.

**Riesgo identificado y cómo se trata**: el documento de revisión también advierte que
"pseudo-xG" (estimado desde goles) es más débil que xG real de proveedor especializado
(`ML-KULeuven/soccer_xg` se cita como referencia de xG "serio"). Por eso FotMob es la
fuente primaria y football-data.org/pseudo-xG queda como fallback explícito, nunca oculto —
el campo `fuente` debe registrar cuál se usó, para que el calibrador pueda evaluar si el
fallback degrada la calidad de las predicciones de esos partidos específicos.

---

## E002 — `xg_concedido_promedio`

| Campo | Valor |
|---|---|
| **nombre_legible** | xG concedido promedio (forma reciente) |
| **descripción** | Expected Goals que el equipo permitió generar al rival, promedio ponderado de últimos K partidos |
| **bloque_modelo** | E |
| **subbloque** | defensa |
| **tipo_fuente** | api_externa |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | float |
| **rango_esperado** | 0.3 – 3.5 |
| **momento_captura** | prepartido |
| **fuente_primaria** | FotMob (`xg_visitante` desde la perspectiva del rival en cada partido histórico del equipo) |
| **fuentes_secundarias** | football-data.org (`goles_concedidos_promedio` como aproximación si no hay xG) |
| **riesgo_leakage** | bajo |
| **riesgo_sesgo** | medio — mismo origen que E001 |
| **hipótesis_causal** | la solidez defensiva reciente (medida en calidad de chances concedidas, no solo goles) predice cuánto le costará anotar al rival |
| **uso_modelo** | entra como covariable defensiva \(D_i\) en la fórmula de λ del rival (con signo negativo, según la formulación: `λ_L = exp(... - θ_D^T D_V)`) |
| **uso_calibrador** | comparación contra xG concedido real postpartido |
| **transformación_pre_modelo** | ponderación por recencia, igual que E001 |

**Justificación de inclusión**: es el complemento simétrico de E001 y es lo que permite que
el modelo capture la interacción ataque-vs-defensa explícita en la fórmula de λ, en vez de
tratar "fuerza del equipo" como un solo número (que era el defecto principal del score
heurístico de V1 — un score 1-10 no distingue si la ventaja viene de atacar bien o defender bien).

---

## E003 — `goles_promedio` y E004 — `goles_concedidos_promedio`

| Campo | Valor |
|---|---|
| **nombre_legible** | Goles a favor / en contra, promedio reciente |
| **bloque_modelo** | E |
| **subbloque** | ataque / defensa (resultado real, no esperado) |
| **tipo_fuente** | api_externa |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | float |
| **momento_captura** | prepartido |
| **fuente_primaria** | football-data.org (`getTeamStats`, ya implementado en V1) |
| **riesgo_leakage** | bajo |
| **riesgo_sesgo** | bajo — son datos duros, no modelados |
| **hipótesis_causal** | complementa al xG: si xG y goles reales difieren mucho de forma sostenida, puede indicar un sesgo de finalización del equipo (sobre o sub-rendimiento) |
| **uso_modelo** | **no entra directamente en λ** — su rol es servir de variable de control/diagnóstico para el calibrador |
| **uso_calibrador** | input directo para `calcularBoostReal` rediseñado (sección 11.7 del doc de calibración): \(r_{i,m} = xG_{i,m}^{real} - xG_{i,m}^{pred}\), donde "real" puede aproximarse con goles si falta xG |

**Justificación de no usarlo directamente en λ**: usar simultáneamente xG y goles reales
como covariables separadas en la misma fórmula de λ introduce **colinealidad** (ambos miden
lo mismo con distinto ruido) y duplicaría la señal de ataque/defensa. La formulación
matemática base prioriza xG como insumo de λ porque es menos ruidoso en muestras pequeñas;
goles reales se reserva para el calibrador, que es justamente donde se necesita comparar
"lo esperado" contra "lo que pasó" — eso es la definición misma de calibración.

---

## E005 — `forma_reciente_puntos`

| Campo | Valor |
|---|---|
| **nombre_legible** | Puntos obtenidos en últimos K partidos (ponderado) |
| **bloque_modelo** | E |
| **subbloque** | forma general |
| **tipo_fuente** | derived_variable (calculado desde resultados de football-data.org) |
| **tipo_proxy** | estimated_proxy |
| **tipo_dato** | float (no entero, por la ponderación) |
| **rango_esperado** | 0 – 3 (escala de puntos por partido ponderados) |
| **momento_captura** | prepartido |
| **fuente_primaria** | football-data.org (resultados FINISHED de partidos recientes) |
| **riesgo_leakage** | bajo |
| **riesgo_sesgo** | **alto si no se corrige por calidad de rival** — este es el problema que el documento de revisión señala explícitamente |
| **hipótesis_causal** | la forma reciente (rachas de victorias/derrotas) aporta señal sobre estado de ánimo/momentum del equipo, más allá de lo que captura el xG |
| **uso_modelo** | entra como covariable de ajuste menor dentro de C_i (contextual) o como modulador de varianza, NO como componente principal de λ |
| **uso_calibrador** | se evalúa su aporte marginal vía el módulo de evaluación de señales (sección 8 del doc de calibración) |
| **transformación_pre_modelo** | ponderación por recencia |

**Justificación de inclusión con advertencia explícita**: el documento de revisión (sección
3.2, "calidad_rival_reciente") es claro: *"forma sin calidad de rival es frágil"*. Por eso
esta variable se incluye pero con **rol secundario**, no como insumo directo de λ. La
corrección por calidad de rival (`calidad_rival_reciente`) que el documento recomienda
añadir requiere el ranking FIFA del rival en cada partido del histórico — es factible con
los datos que ya tenemos (rankings.json + resultados football-data), pero se implementa
como ajuste de E005, no como variable nueva separada, para no inflar el modelo con
variables redundantes antes de tener evidencia de que hace falta.

---

## E006 — `corners_promedio`

| Campo | Valor |
|---|---|
| **nombre_legible** | Corners promedio a favor, forma reciente |
| **bloque_modelo** | E |
| **subbloque** | ataque (volumen de juego ofensivo) |
| **tipo_fuente** | api_externa |
| **tipo_proxy** | direct_observable |
| **tipo_dato** | float |
| **momento_captura** | prepartido |
| **fuente_primaria** | FotMob (`stats_avanzadas.corners_local/visitante`) |
| **fuentes_secundarias** | valor default 4.5 si no hay datos (ya en V1, `getStatsDefault`) |
| **riesgo_leakage** | bajo |
| **riesgo_sesgo** | bajo |
| **hipótesis_causal** | volumen de corners correlaciona con presión ofensiva sostenida; útil para mercados derivados de corners, no para λ de goles |
| **uso_modelo** | **no entra en λ de goles** — se reserva como insumo de un sub-modelo de mercados secundarios (corners O/U), fuera del alcance del primer módulo Poisson |
| **uso_calibrador** | evaluación de mercados de corners cuando ese sub-modelo exista |

**Justificación de inclusión limitada**: V1 usaba corners como parte del score general
(15% del score estadístico), mezclándolo con goles en una sola escala 1-10. La formulación
matemática base no incluye corners en la derivación de λ_goles — son procesos distintos
(generar corners ≠ generar goles directamente). Se mantiene la variable porque FotMob ya la
provee y será útil para el mercado "corners O/U" cuando se construya ese sub-modelo
específico, pero **no se fuerza dentro de Poisson de goles** solo porque está disponible.

---

## E007 — `lesiones_impacto`

| Campo | Valor |
|---|---|
| **nombre_legible** | Impacto agregado de lesiones/ausencias |
| **bloque_modelo** | E |
| **subbloque** | disponibilidad |
| **tipo_fuente** | scraping_news / manual_input (vía análisis IA de Claude) |
| **tipo_proxy** | estimated_proxy |
| **tipo_dato** | float |
| **rango_esperado** | 0 – 1 |
| **momento_captura** | prepartido — pero el documento de revisión exige granularidad |
| **riesgo_leakage** | medio — depende de cuándo se anuncia la ausencia vs. cuándo se genera el análisis |
| **riesgo_sesgo** | medio-alto |
| **hipótesis_causal** | la ausencia de jugadores clave reduce el rendimiento esperado, especialmente si son titulares ofensivos/defensivos relevantes |
| **uso_modelo** | ajuste multiplicativo o additivo pequeño sobre λ — **pendiente de definir la forma exacta hasta diseñar el sub-bloque de disponibilidad** |
| **uso_calibrador** | se evalúa junto con las proxies psicodeportivas en el módulo de auditoría de señales scrapeadas |

**Justificación de inclusión con reserva**: el documento de revisión (sección 3.1) es claro
en que la versión actual está "muy comprimida en una sola variable" y recomienda dividir en:
ausencias ofensivas, ausencias defensivas, ausencias del arquero, minutos perdidos
esperados, titular clave sí/no. **Esta variable E007 queda registrada en el diccionario
como placeholder del bloque E**, pero su diseño detallado (las 5 sub-variables recomendadas)
se trabaja en conjunto con el Bloque Psicodeportivo (P), porque la fuente de captura
(análisis IA de Claude con web search) es la misma infraestructura que ya usa V1 para
`analisis_psicologico`. No se duplica el pipeline de captura — se generaliza.

---

## Resumen del bloque E — qué entra a λ directamente vs. qué no

| Variable | ¿Entra directo a λ? | Rol si no |
|---|---|---|
| E001 xg_promedio | **Sí** — covariable principal de ataque | — |
| E002 xg_concedido_promedio | **Sí** — covariable principal de defensa (signo negativo en rival) | — |
| E003/E004 goles reales | No | Insumo del calibrador (residuos vs. xG) |
| E005 forma_reciente_puntos | Ajuste menor / contextual | Evaluado en calibración antes de decidir peso |
| E006 corners_promedio | No | Insumo de sub-modelo de mercados secundarios |
| E007 lesiones_impacto | Pendiente de diseño detallado | Se define junto al bloque P |

**Por qué esta tabla importa**: esto es exactamente la disciplina que pediste — no todas
las variables "estadísticas" disponibles entran al modelo de la misma forma. El documento
matemático base es explícito en que λ debe construirse con pocas covariables bien
justificadas (E001, E002 como mínimo), no con todo lo que tengamos a mano. Esto también
respeta la regla de calibración: menos parámetros iniciales = menos riesgo de sobreajuste
con la muestra pequeña de un Mundial (~104 partidos, y cada equipo juega solo 3-7 de ellos).

---

## Siguiente paso

Con E001 y E002 definidas como las dos covariables centrales, ya tenemos lo mínimo
necesario para escribir la fórmula completa de λ_local y λ_visitante del primer módulo
Poisson (`core/prediction/poisson.js`). Las variables E005-E007 quedan documentadas pero
"en espera" — no bloquean el primer módulo, que puede construirse y probarse con E001/E002
únicamente, y los demás bloques (P, C, M) se añaden incrementalmente sobre esa base,
siguiendo la misma forma exponencial-aditiva de la fórmula 22.1.

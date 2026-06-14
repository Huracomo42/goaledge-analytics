# Diccionario maestro de variables, fuentes y reglas de captura del proyecto

Este documento constituye el **cuarto archivo base** del proyecto y complementa a los tres anteriores:

1. revisión conceptual del modelo,
2. formulación matemática,
3. sistema de calibración y aprendizaje incremental,
4. y ahora el **diccionario maestro de variables, fuentes y reglas de captura**.

Su objetivo es fijar una ontología estable del sistema: qué variables existen, de dónde salen, qué significan, cuándo se capturan, qué riesgo de sesgo tienen y en qué capa del modelo deben entrar.

---

# 1. Propósito del diccionario maestro

Este archivo cumple seis funciones críticas:

## A. Unificar lenguaje
Evita que una misma idea aparezca con nombres distintos.

## B. Controlar semántica
Cada variable debe significar exactamente lo mismo en todo el proyecto.

## C. Gobernar captura de datos
Define cuándo, cómo y desde dónde debe extraerse cada señal.

## D. Separar mecanismos causales
No es lo mismo una variable que explica:
- rendimiento del partido,
- narrativa pública,
- sesgo de mercado,
- o calibración posterior.

## E. Reducir fuga metodológica
Evita leakage temporal, duplicación de señales y mezcla de capas incompatibles.

## F. Facilitar auditoría y expansión
Permite que cualquier experto externo entienda:
- qué mide el sistema,
- cómo lo mide,
- y qué tan confiable es cada proxy.

---

# 2. Estructura general del diccionario

Cada variable del proyecto debe registrarse con esta plantilla mínima:

## Plantilla oficial

- **id_variable**
- **nombre_tecnico**
- **nombre_legible**
- **descripcion**
- **bloque_modelo**
- **subbloque**
- **tipo_fuente**
- **tipo_proxy**
- **unidad / escala**
- **rango_esperado**
- **tipo_dato**
- **momento_captura**
- **frecuencia_actualizacion**
- **fuente_primaria**
- **fuentes_secundarias**
- **metodo_extraccion**
- **confianza_minima**
- **riesgo_leakage**
- **riesgo_sesgo**
- **hipotesis_causal**
- **uso_modelo**
- **uso_calibrador**
- **transformacion_pre_modelo**
- **notas_operativas**

---

# 3. Clasificación obligatoria de variables

Todas las variables deben pertenecer a uno de estos bloques principales.

## 3.1 Bloque estadístico (`E`)
Variables de rendimiento futbolístico observacional.

Ejemplos:
- xG promedio
- goles promedio
- goles concedidos
- tiros al arco
- corners
- rating del equipo
- forma reciente ajustada

## 3.2 Bloque psicodeportivo del equipo (`P_team`)
Señales sobre estado competitivo real del equipo, muchas veces derivadas por scraping.

Ejemplos:
- necesita ganar
- presión competitiva
- estabilidad del vestuario
- liderazgo disponible
- conflicto interno
- cohesión estimada

## 3.3 Bloque narrativo / mediático (`P_media`)
Señales narrativas públicas que no necesariamente reflejan estado real del equipo.

Ejemplos:
- venganza narrativa
- humillación previa
- generación dorada
- “partido de vida o muerte”

## 3.4 Bloque de sesgo de mercado (`P_market`)
Señales que pueden afectar más la percepción del mercado que el rendimiento real.

Ejemplos:
- favoritismo público
- identidad de hincha
- hype mediático
- sobre-reacción a rachas

## 3.5 Bloque contextual / torneo (`C`)
Variables de entorno competitivo.

Ejemplos:
- fase del torneo
- jornada
- localía
- altitud
- stake del partido
- stakelessness
- gap de ranking

## 3.6 Bloque de mercado (`M`)
Variables objetivas del entorno de apuestas.

Ejemplos:
- opening odds
- closing odds
- line movement
- implied probability
- dispersión entre casas

## 3.7 Bloque de calibración (`K`)
Variables usadas no para predecir directamente, sino para auditar y recalibrar.

Ejemplos:
- confianza de scraping
- completitud de señales
- sample size
- Brier score local por subgrupo
- CLV histórico

---

# 4. Tipología de fuentes

Toda variable debe clasificarse según su fuente.

## 4.1 `stats_feed`
Fuente estructurada de estadísticas deportivas.

## 4.2 `market_feed`
Fuente estructurada de cuotas o mercados.

## 4.3 `scraping_news`
Noticias, portales, medios.

## 4.4 `scraping_social`
Redes, foros, publicaciones públicas.

## 4.5 `scraping_official`
Federaciones, clubes, cuentas oficiales, conferencias de prensa.

## 4.6 `manual_input`
Variable ingresada manualmente.

## 4.7 `derived_variable`
Variable derivada de otras.

Ejemplo:
- `edge_modelo_vs_mercado`
- `indice_presion_competitiva`
- `indice_sesgo_publico`

---

# 5. Tipología de proxy

Como el proyecto usa scraping, esta sección es obligatoria.

## 5.1 `direct_observable`
Dato casi directo y estructurado.

Ejemplo:
- goles
- xG
- cuota de cierre

## 5.2 `estimated_proxy`
Proxy inferida desde varias señales observables.

Ejemplo:
- cohesión estimada
- presión mediática estimada

## 5.3 `narrative_proxy`
Señal textual o simbólica con alto componente interpretativo.

Ejemplo:
- venganza narrativa
- humillación previa

## 5.4 `market_bias_proxy`
Señal cuyo efecto esperado principal es sobre la cuota o el público.

Ejemplo:
- favoritismo de hinchas
- hype mediático

## 5.5 `contextual_proxy`
Señal exógena del entorno competitivo.

Ejemplo:
- necesita ganar
- partido de clasificación
- última jornada de grupo

---

# 6. Reglas generales de captura

Estas reglas aplican a todas las variables del proyecto.

## 6.1 Regla temporal
Toda variable debe registrar:
- `timestamp_extraccion`
- `timestamp_evento`
- `timestamp_disponibilidad_real`

Porque no es lo mismo:
- cuándo ocurrió el hecho,
- cuándo se publicó,
- cuándo la vio el modelo.

Esto es esencial para evitar leakage temporal.

## 6.2 Regla de fuente
Toda variable scrapeada debe guardar:
- fuente primaria,
- URL o identificador,
- medio,
- tipo de fuente,
- idioma,
- timestamp.

## 6.3 Regla de confianza
Toda variable no estructurada debe incluir:

\[
c \in [0,1]
\]

como `confianza_extraccion`.

## 6.4 Regla de trazabilidad
Toda transformación derivada debe ser reproducible.

## 6.5 Regla de no colapso semántico
Dos variables con distinto mecanismo causal no deben fusionarse solo porque “se parecen”.

---

# 7. Ficha maestra de variables: plantilla expandida

A continuación se define la plantilla recomendada.

---

## FICHA DE VARIABLE

### 1. Identificación
- **id_variable**:
- **nombre_tecnico**:
- **nombre_legible**:

### 2. Definición
- **descripcion_corta**:
- **descripcion_larga**:
- **hipotesis_causal**:

### 3. Posición en la arquitectura
- **bloque_modelo**:
- **subbloque**:
- **entra_en_prediccion_partido**: sí / no
- **entra_en_modelo_mercado**: sí / no
- **entra_en_calibracion**: sí / no

### 4. Fuente y captura
- **tipo_fuente**:
- **fuente_primaria**:
- **fuentes_secundarias**:
- **metodo_extraccion**:
- **momento_captura**:
- **frecuencia_actualizacion**:

### 5. Naturaleza de la variable
- **tipo_proxy**:
- **tipo_dato**:
- **unidad_escala**:
- **rango_esperado**:
- **direccion_esperada**:

### 6. Calidad y riesgo
- **confianza_minima**:
- **riesgo_leakage**:
- **riesgo_sesgo**:
- **riesgo_duplicidad**:
- **riesgo_inestabilidad_fuente**:

### 7. Ingeniería de features
- **transformacion_pre_modelo**:
- **normalizacion**:
- **interacciones_recomendadas**:
- **versionado_dependencias**:

### 8. Uso operativo
- **uso_modelo**:
- **uso_selector_apuestas**:
- **uso_calibrador**:
- **notas_operativas**:

---

# 8. Variables núcleo del proyecto

A continuación dejo una primera propuesta de variables base del proyecto, alineadas con los tres documentos anteriores.

---

## 8.1 Variables estadísticas núcleo

### Variable: `xg_promedio`
- **id_variable**: E001
- **nombre_tecnico**: xg_promedio
- **nombre_legible**: xG promedio
- **descripcion**: expected goals promedio del equipo en ventana temporal definida
- **bloque_modelo**: E
- **subbloque**: ataque
- **tipo_fuente**: stats_feed
- **tipo_proxy**: direct_observable
- **unidad / escala**: goles esperados por partido
- **rango_esperado**: 0.0 a 3.5
- **tipo_dato**: float
- **momento_captura**: prepartido
- **frecuencia_actualizacion**: por partido
- **fuente_primaria**: feed estadístico oficial/externo
- **metodo_extraccion**: API o scraping estructurado
- **confianza_minima**: 0.95
- **riesgo_leakage**: bajo
- **riesgo_sesgo**: bajo
- **hipotesis_causal**: mayor xG ofensivo implica mayor capacidad de generar goles
- **uso_modelo**: predicción de partido y mercados de goles
- **uso_calibrador**: comparar xG esperado vs observado
- **transformacion_pre_modelo**: suavizado por recencia
- **notas_operativas**: ideal separar local/visitante

### Variable: `xga_promedio`
- **id_variable**: E002
- **nombre_tecnico**: xga_promedio
- **nombre_legible**: xGA promedio
- **descripcion**: expected goals concedidos promedio
- **bloque_modelo**: E
- **subbloque**: defensa
- **tipo_fuente**: stats_feed
- **tipo_proxy**: direct_observable
- **unidad / escala**: goles esperados recibidos por partido
- **rango_esperado**: 0.0 a 3.5
- **tipo_dato**: float
- **momento_captura**: prepartido
- **frecuencia_actualizacion**: por partido
- **confianza_minima**: 0.95
- **riesgo_leakage**: bajo
- **hipotesis_causal**: menor xGA sugiere mejor solidez defensiva
- **uso_modelo**: predicción 1X2, BTTS, unders
- **uso_calibrador**: error defensivo sistemático

### Variable: `forma_ajustada`
- **id_variable**: E003
- **nombre_tecnico**: forma_ajustada
- **nombre_legible**: forma reciente ajustada por rival
- **descripcion**: rendimiento reciente ponderado por fuerza del rival y localía
- **bloque_modelo**: E
- **subbloque**: forma
- **tipo_fuente**: derived_variable
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: -3 a +3
- **riesgo_sesgo**: medio
- **hipotesis_causal**: la forma reciente aporta señal, pero debe corregirse por calidad de oposición

### Variable: `rating_equipo`
- **id_variable**: E004
- **nombre_tecnico**: rating_equipo
- **nombre_legible**: rating estructural del equipo
- **descripcion**: índice de fuerza estructural tipo ELO / Poisson rating / pi-rating
- **bloque_modelo**: E
- **subbloque**: fuerza
- **tipo_fuente**: derived_variable
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: dependiente del sistema
- **hipotesis_causal**: representa calidad base del equipo más allá de la racha

### Variable: `lesiones_impacto`
- **id_variable**: E005
- **nombre_tecnico**: lesiones_impacto
- **nombre_legible**: impacto de lesiones y ausencias
- **descripcion**: penalización agregada por ausencias relevantes
- **bloque_modelo**: E
- **subbloque**: disponibilidad
- **tipo_fuente**: scraping_official / scraping_news / manual_input
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: 0 a 1
- **riesgo_sesgo**: medio
- **riesgo_inestabilidad_fuente**: medio
- **hipotesis_causal**: más ausencias clave reducen rendimiento esperado

---

## 8.2 Variables psicodeportivas del equipo

### Variable: `necesita_ganar`
- **id_variable**: P001
- **nombre_tecnico**: necesita_ganar
- **nombre_legible**: necesidad competitiva de victoria
- **descripcion**: indica si el equipo necesita ganar para clasificar, sobrevivir o cumplir un objetivo fuerte
- **bloque_modelo**: P_team
- **subbloque**: incentivo
- **tipo_fuente**: derived_variable
- **tipo_proxy**: contextual_proxy
- **tipo_dato**: boolean / ordinal
- **momento_captura**: prepartido
- **riesgo_leakage**: bajo
- **hipotesis_causal**: mayor incentivo competitivo puede alterar esfuerzo, planteamiento y presión

### Variable: `presion_competitiva`
- **id_variable**: P002
- **nombre_tecnico**: presion_competitiva
- **nombre_legible**: presión competitiva estimada
- **descripcion**: índice de presión por contexto de torneo, racha, entorno y exigencia
- **bloque_modelo**: P_team
- **subbloque**: presión
- **tipo_fuente**: scraping_news + derived_variable
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: 0 a 1
- **confianza_minima**: 0.60
- **riesgo_sesgo**: alto
- **hipotesis_causal**: contextos de alta presión pueden alterar rendimiento y estabilidad táctica

### Variable: `liderazgo_disponible`
- **id_variable**: P003
- **nombre_tecnico**: liderazgo_disponible
- **nombre_legible**: liderazgo disponible
- **descripcion**: disponibilidad de referentes clave de equipo o estructura de liderazgo
- **bloque_modelo**: P_team
- **subbloque**: liderazgo
- **tipo_fuente**: scraping_official / scraping_news
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: boolean / ordinal
- **riesgo_sesgo**: medio
- **hipotesis_causal**: ausencia de líderes puede reducir orden competitivo

### Variable: `conflicto_interno_estimado`
- **id_variable**: P004
- **nombre_tecnico**: conflicto_interno_estimado
- **nombre_legible**: conflicto interno estimado
- **descripcion**: señal agregada de tensión interna en vestuario, DT, dirigencia o entorno
- **bloque_modelo**: P_team
- **subbloque**: estabilidad
- **tipo_fuente**: scraping_news / scraping_social
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: 0 a 1
- **confianza_minima**: 0.55
- **riesgo_sesgo**: alto
- **riesgo_inestabilidad_fuente**: alto
- **hipotesis_causal**: más conflicto reduce cohesión y estabilidad de ejecución

### Variable: `cohesion_estimadа`
- **id_variable**: P005
- **nombre_tecnico**: cohesion_estimada
- **nombre_legible**: cohesión estimada del equipo
- **descripcion**: índice compuesto de estabilidad, continuidad y ausencia de conflicto
- **bloque_modelo**: P_team
- **subbloque**: cohesión
- **tipo_fuente**: derived_variable
- **tipo_proxy**: estimated_proxy
- **tipo_dato**: float
- **rango_esperado**: 0 a 1

---

## 8.3 Variables narrativas públicas

### Variable: `venganza_narrativa`
- **id_variable**: PM001
- **nombre_tecnico**: venganza_narrativa
- **nombre_legible**: narrativa de revancha
- **descripcion**: presencia de narrativa pública de revancha o desquite
- **bloque_modelo**: P_media
- **subbloque**: narrativa simbólica
- **tipo_fuente**: scraping_news / scraping_social
- **tipo_proxy**: narrative_proxy
- **tipo_dato**: boolean / ordinal
- **riesgo_sesgo**: muy alto
- **riesgo_leakage**: medio
- **hipotesis_causal**: más útil como narrativa contextual que como predictor directo fuerte
- **uso_modelo**: con mucha cautela
- **uso_calibrador**: evaluar si explica partido o solo ruido / mercado

### Variable: `humillacion_previa`
- **id_variable**: PM002
- **nombre_tecnico**: humillacion_previa
- **nombre_legible**: humillación previa relevante
- **descripcion**: señal de derrota reciente con fuerte carga narrativa
- **bloque_modelo**: P_media
- **subbloque**: memoria narrativa
- **tipo_fuente**: scraping_news
- **tipo_proxy**: narrative_proxy
- **tipo_dato**: boolean / ordinal
- **riesgo_sesgo**: alto
- **hipotesis_causal**: puede influir en narrativa y presión más que en capacidad real

### Variable: `generacion_dorada_narrativa`
- **id_variable**: PM003
- **nombre_tecnico**: generacion_dorada_narrativa
- **nombre_legible**: narrativa de generación dorada
- **descripcion**: señal mediática que presenta al plantel como generación histórica o especial
- **bloque_modelo**: P_media
- **tipo_proxy**: narrative_proxy
- **uso_modelo**: preferentemente no directa
- **uso_calibrador**: medir si afecta más mercado que partido

---

## 8.4 Variables de sesgo de mercado

### Variable: `sesgo_hincha_mercado`
- **id_variable**: MK001
- **nombre_tecnico**: sesgo_hincha_mercado
- **nombre_legible**: sesgo de hincha en mercado
- **descripcion**: presión de favoritismo público por identificación emocional con el equipo
- **bloque_modelo**: P_market
- **subbloque**: sesgo público
- **tipo_fuente**: scraping_social / market_feed / derived_variable
- **tipo_proxy**: market_bias_proxy
- **tipo_dato**: float
- **rango_esperado**: 0 a 1
- **hipotesis_causal**: puede inflar cuota implícita percibida o mover el mercado sin reflejar fuerza real
- **uso_modelo**: no para partido real directo
- **uso_calibrador**: sí para edge de mercado

### Variable: `hype_mediatico`
- **id_variable**: MK002
- **nombre_tecnico**: hype_mediatico
- **nombre_legible**: hype mediático
- **descripcion**: intensidad de narrativa pública favorable a un equipo
- **bloque_modelo**: P_market
- **tipo_fuente**: scraping_news / scraping_social
- **tipo_proxy**: market_bias_proxy
- **riesgo_sesgo**: alto
- **hipotesis_causal**: afecta percepción y precio de mercado

### Variable: `sobre_reaccion_racha`
- **id_variable**: MK003
- **nombre_tecnico**: sobre_reaccion_racha
- **nombre_legible**: sobre-reacción del mercado a la racha
- **descripcion**: desviación del precio de mercado respecto a lo que justificaría el rendimiento subyacente
- **bloque_modelo**: P_market
- **tipo_fuente**: derived_variable
- **tipo_proxy**: market_bias_proxy
- **hipotesis_causal**: el mercado puede exagerar resultados recientes

---

## 8.5 Variables contextuales

### Variable: `localia`
- **id_variable**: C001
- **nombre_tecnico**: localia
- **nombre_legible**: condición de localía
- **descripcion**: local, visitante o sede neutral
- **bloque_modelo**: C
- **subbloque**: entorno
- **tipo_fuente**: direct_observable
- **tipo_proxy**: contextual_proxy
- **tipo_dato**: categórica
- **riesgo_leakage**: bajo

### Variable: `altitud_estadio`
- **id_variable**: C002
- **nombre_tecnico**: altitud_estadio
- **nombre_legible**: altitud del estadio
- **descripcion**: altitud del escenario competitivo
- **bloque_modelo**: C
- **subbloque**: entorno físico
- **tipo_fuente**: static_lookup / manual_input
- **tipo_proxy**: contextual_proxy
- **tipo_dato**: entero
- **unidad / escala**: metros sobre el nivel del mar

### Variable: `fase_torneo`
- **id_variable**: C003
- **nombre_tecnico**: fase_torneo
- **nombre_legible**: fase de competición
- **descripcion**: grupos, octavos, cuartos, semifinal, final, etc.
- **bloque_modelo**: C
- **tipo_fuente**: direct_observable
- **tipo_proxy**: contextual_proxy

### Variable: `stake_partido`
- **id_variable**: C004
- **nombre_tecnico**: stake_partido
- **nombre_legible**: stake competitivo del partido
- **descripcion**: importancia estratégica real del partido para ambos equipos
- **bloque_modelo**: C
- **tipo_fuente**: derived_variable
- **tipo_proxy**: contextual_proxy
- **tipo_dato**: ordinal / float

### Variable: `partido_stakeless`
- **id_variable**: C005
- **nombre_tecnico**: partido_stakeless
- **nombre_legible**: partido sin incentivo fuerte
- **descripcion**: indicador de partido con bajo impacto competitivo real
- **bloque_modelo**: C
- **tipo_fuente**: derived_variable
- **tipo_proxy**: contextual_proxy

---

## 8.6 Variables de mercado

### Variable: `opening_odds`
- **id_variable**: M001
- **nombre_tecnico**: opening_odds
- **nombre_legible**: cuotas de apertura
- **descripcion**: primera cuota observada del mercado relevante
- **bloque_modelo**: M
- **tipo_fuente**: market_feed
- **tipo_proxy**: direct_observable
- **tipo_dato**: float / vector
- **riesgo_leakage**: bajo si timestamp correcto

### Variable: `closing_odds`
- **id_variable**: M002
- **nombre_tecnico**: closing_odds
- **nombre_legible**: cuotas de cierre
- **descripcion**: última cuota antes del inicio del partido
- **bloque_modelo**: M
- **tipo_fuente**: market_feed
- **tipo_proxy**: direct_observable
- **uso_modelo**: benchmark, edge, CLV

### Variable: `line_movement`
- **id_variable**: M003
- **nombre_tecnico**: line_movement
- **nombre_legible**: movimiento de línea
- **descripcion**: cambio entre apertura y cierre
- **bloque_modelo**: M
- **tipo_fuente**: derived_variable
- **tipo_proxy**: direct_observable

### Variable: `implied_probability`
- **id_variable**: M004
- **nombre_tecnico**: implied_probability
- **nombre_legible**: probabilidad implícita de mercado
- **descripcion**: probabilidad derivada de las cuotas
- **bloque_modelo**: M
- **tipo_fuente**: derived_variable
- **tipo_proxy**: direct_observable

### Variable: `edge_modelo_mercado`
- **id_variable**: M005
- **nombre_tecnico**: edge_modelo_mercado
- **nombre_legible**: edge del modelo contra el mercado
- **descripcion**: diferencia entre probabilidad modelada y probabilidad implícita
- **bloque_modelo**: M
- **tipo_fuente**: derived_variable
- **tipo_proxy**: estimated_proxy

---

## 8.7 Variables de calibración

### Variable: `confianza_scraping`
- **id_variable**: K001
- **nombre_tecnico**: confianza_scraping
- **nombre_legible**: confianza de extracción scraping
- **descripcion**: confianza agregada de la señal scrapeada
- **bloque_modelo**: K
- **tipo_fuente**: derived_variable
- **tipo_proxy**: direct_observable
- **uso_modelo**: ponderación indirecta
- **uso_calibrador**: filtro y weighting

### Variable: `completitud_senales`
- **id_variable**: K002
- **nombre_tecnico**: completitud_senales
- **nombre_legible**: completitud de señales del partido
- **descripcion**: porcentaje de campos críticos presentes
- **bloque_modelo**: K
- **tipo_fuente**: derived_variable

### Variable: `version_modelo_origen`
- **id_variable**: K003
- **nombre_tecnico**: version_modelo_origen
- **nombre_legible**: versión del modelo de origen
- **descripcion**: versión exacta que produjo la predicción
- **bloque_modelo**: K
- **tipo_fuente**: direct_observable

### Variable: `timestamp_prediccion`
- **id_variable**: K004
- **nombre_tecnico**: timestamp_prediccion
- **nombre_legible**: timestamp de predicción
- **descripcion**: momento exacto en que la predicción fue emitida
- **bloque_modelo**: K
- **tipo_fuente**: direct_observable

---

# 9. Reglas especiales para variables scrapeadas

## 9.1 Nunca usar una variable scrapeada sin timestamp
## 9.2 Nunca usar una variable scrapeada sin fuente
## 9.3 Nunca usar una variable scrapeada de tipo narrativo como si fuera equivalente a una variable estructurada
## 9.4 Toda variable scrapeada debe tener confianza mínima configurable
## 9.5 Toda variable scrapeada debe poder reasignarse de bloque si el calibrador demuestra que explica mercado y no partido

---

# 10. Reglas especiales para evitar leakage temporal

Toda variable debe etiquetarse con riesgo de leakage:

- **bajo**
- **medio**
- **alto**
- **prohibido**

## Ejemplo de `prohibido`
- usar cuota de cierre si la decisión real se tomó muchas horas antes y no estaba disponible
- usar noticias posteriores a la apuesta
- usar alineación oficial si el pick se emitió antes de que se anunciara

---

# 11. Reglas de gobernanza y versionado

## 11.1 Toda variable nueva debe pasar por el diccionario antes de entrar al modelo
## 11.2 Toda variable debe tener ID estable
## 11.3 Si cambia su definición, debe versionarse
## 11.4 Si una variable cambia de bloque, debe quedar registrado
## 11.5 Si una variable se depreca, no se borra: se marca como `deprecated`

---

# 12. Variables candidatas futuras

Este proyecto puede crecer con variables futuras, pero deben entrar por este archivo.

## Posibles futuras:
- fatiga de viaje
- rotación esperada
- densidad de calendario
- arbitraje esperado
- clima meteorológico
- crowd intensity proxy
- calidad semántica de cobertura mediática
- dispersión de narrativa entre fuentes
- estabilidad institucional
- confianza del mercado en cierre

---

# 13. Cierre metodológico

Este archivo debe operar como la **constitución semántica y operativa** del proyecto.

Si los otros tres archivos responden:

1. qué es el modelo,
2. cómo se formaliza,
3. cómo se calibra,

este cuarto archivo responde:

> **qué significa exactamente cada variable y bajo qué reglas puede existir dentro del sistema**

Eso lo vuelve crítico, porque en proyectos como este el mayor riesgo no es solo equivocarse en una predicción, sino dejar que el sistema se desordene semánticamente con el tiempo.

---

# 14. Recomendación final de uso

Este archivo debería usarse como:

- checklist antes de agregar variables,
- referencia oficial de scrapers,
- referencia oficial del modelador,
- referencia oficial del calibrador,
- y documento de auditoría para cualquier experto externo.

En términos prácticos, ningún dato nuevo debería entrar al sistema sin tener su ficha definida aquí.

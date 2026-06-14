# Sistema base de calibración, validación y aprendizaje incremental del modelo

Base revisada: archivo del usuario `calibrador.js`.  
Referencia al archivo original en la conversación: fileciteturn1file0

Este documento define la **tercera base formal del proyecto**, alineada con:

1. la revisión conceptual del modelo,
2. la formulación matemática del modelo,
3. y ahora el **sistema de calibración y mejora continua**.

La idea central es transformar el calibrador actual —que hoy funciona más como panel heurístico de retroalimentación— en un **subsistema formal de aprendizaje incremental, calibración probabilística, auditoría de señales scrapeadas y validación de mercado**.

---

# 1. Rol exacto de este tercer archivo dentro del proyecto

Los dos documentos anteriores dejan definidos:

- qué variables existen y cómo deben entenderse,
- cómo se formaliza el modelo matemáticamente,
- cómo se separa partido real, narrativa, psicología scrapeada y sesgo de mercado.

Este tercer archivo responde otra pregunta:

> **¿Cómo se corrige, calibra y mejora el modelo a medida que se observan partidos reales dentro de una competición?**

Por tanto, este archivo no debe ser entendido como un simple panel administrativo. Debe ser la **arquitectura de aprendizaje del sistema**.

---

# 2. Diagnóstico del calibrador actual

El archivo actual contiene varias piezas útiles:

- carga de pesos actuales,
- edición manual de sliders,
- guardado de versiones,
- conteo de predicciones calibrables,
- sugerencias automáticas simples,
- cálculo exploratorio de impacto por variable,
- estimación casera de un “boost real”,
- y navegación por métricas globales. fileciteturn1file0

## 2.1 Lo mejor del diseño actual

### A. Existe memoria histórica del modelo
La presencia de `versiones`, `pesos`, `version_modelo` y UI para guardar versiones es una muy buena base. fileciteturn1file0

### B. Existe una noción de muestra válida para calibrar
El sistema no usa cualquier partido; intenta filtrar por:

- resultado real disponible,
- señal IA/analítica real,
- consistencia mínima. fileciteturn1file0

### C. Existe idea de mejora dentro de la competición
Eso es exactamente lo correcto si el proyecto quiere aprender del torneo mientras avanza.

## 2.2 Límite principal del diseño actual

Aunque el archivo se presenta como “calibrador”, todavía **no calibra parámetros de forma estadística rigurosa**.

En su estado actual, hace principalmente esto:

- inspecciona resultados,
- calcula asociaciones exploratorias,
- genera sugerencias heurísticas,
- y permite ajustar sliders manualmente. fileciteturn1file0

Eso lo convierte más en un:

- monitor de aprendizaje,
- dashboard de retroalimentación,
- o asistente de recalibración manual,

que en un calibrador probabilístico formal.

---

# 3. Replanteamiento de nombre y función

## 3.1 Qué no debería ser

No debería entenderse como:

- un simple panel de sliders,
- una caja negra que “aprende sola” sin trazabilidad,
- ni un sistema que modifica pesos bruscamente por unas pocas observaciones.

## 3.2 Qué sí debería ser

Debería definirse como:

## **Sistema de calibración y aprendizaje incremental del modelo**

o, si quieres un nombre técnico consistente:

- `sistema_calibracion_incremental`
- `motor_calibracion_modelo`
- `subsistema_validacion_y_reajuste`

Su misión sería:

1. **auditar la calidad de los datos observados**,  
2. **medir el desempeño real del modelo**,  
3. **recalibrar probabilidades**,  
4. **estimar el valor informativo de las señales scrapeadas**,  
5. **actualizar parámetros de forma controlada**,  
6. **proteger al modelo contra sobreajuste intra-torneo**.

---

# 4. Principio rector: no toda mejora es ajuste de pesos

Uno de los errores más comunes en proyectos de predicción deportiva es pensar que mejorar el modelo significa solo tocar pesos.

Aquí eso sería insuficiente.

El sistema de calibración debe distinguir al menos cuatro tipos de mejora:

## A. Mejora de datos
- más fuentes,
- mejor scraping,
- mejor extracción,
- mejor normalización,
- mayor confianza de proxy.

## B. Mejora de calibración probabilística
- las probabilidades predichas deben parecerse a las frecuencias observadas.

## C. Mejora estructural del modelo
- redefinir variables,
- mover variables entre bloques,
- separar mercado de rendimiento,
- corregir interacciones.

## D. Mejora de selección de apuestas
- no basta con predecir mejor el partido;
- hay que decidir mejor cuándo existe edge real.

Por eso este tercer documento debe ser mucho más amplio que un sistema de ajuste de sliders.

---

# 5. Arquitectura conceptual del calibrador rediseñado

La forma correcta de rediseñarlo es dividirlo en cinco módulos.

---

## Módulo 1. Auditoría de observaciones

Pregunta central:

> **¿Qué partidos y qué señales son realmente utilizables para aprendizaje?**

Esto es crítico porque tus variables psicológicas provienen de **scraping** y no todas tendrán la misma calidad.

## 5.1 Objetivo

Determinar qué observaciones entran al dataset de calibración.

## 5.2 Condiciones mínimas de un partido calibrable

Un partido \(m\) entra al sistema de calibración solo si cumple:

- resultado real disponible,
- variables estadísticas completas o suficientes,
- variables scrapeadas con trazabilidad,
- timestamp correcto,
- cuota real disponible si se quiere calibrar betting edge,
- predicción original preservada sin sobrescritura.

## 5.3 Estructura formal del registro calibrable

Cada partido debería almacenarse como:

\[
D_m = (\text{id}, X_m, \hat p_m, y_m, O_m, S_m, V_m, T_m)
\]

donde:

- \(X_m\): features originales utilizadas en la predicción
- \(\hat p_m\): probabilidad o distribución predicha
- \(y_m\): resultado real observado
- \(O_m\): odds reales de mercado
- \(S_m\): señales scrapeadas y su metadata
- \(V_m\): versión del modelo que generó la predicción
- \(T_m\): timestamps y metadatos temporales

## 5.4 Estructura formal de una señal scrapeada

Toda variable scrapeada debería guardarse como:

\[
s = (\text{valor}, \text{tipo\_proxy}, \text{confianza}, \text{fuente}, \text{timestamp})
\]

Esto es clave para alinear el calibrador con los dos documentos anteriores.

---

## Módulo 2. Calibración del modelo de partido

Pregunta central:

> **¿Qué tan bien estuvo calibrado el modelo para explicar el partido real?**

Este módulo no mira apuestas todavía. Mira predicción futbolística.

## 6.1 Qué debe calibrarse aquí

- probabilidad de 1X2,
- goles esperados,
- BTTS,
- over/under,
- score de fuerza local vs visitante.

## 6.2 Qué no debe mezclarse aquí

No debe mezclarse todavía:
- rentabilidad,
- cuotas,
- valor esperado,
- sesgo del público.

Eso va en otro módulo.

## 6.3 Calibración probabilística recomendada

Si el modelo genera una probabilidad \(\hat p\), el objetivo es construir una probabilidad calibrada \(p^{cal}\).

### Opción A. Platt scaling
\[
p^{cal} = \sigma(a + b \cdot logit(\hat p))
\]

### Opción B. Isotonic regression
Ajuste no paramétrico sobre \(\hat p\).

### Opción C. Beta calibration
Más flexible que Platt en algunos contextos.

## 6.4 Métricas obligatorias

### Brier score
\[
BS = \frac{1}{N}\sum_{n=1}^N (\hat p_n - y_n)^2
\]

### Log loss
\[
LL = -\frac{1}{N}\sum_{n=1}^N [y_n \log(\hat p_n) + (1-y_n)\log(1-\hat p_n)]
\]

### Calibration curve
Comparar bins de probabilidad predicha vs frecuencia real.

### Error de goles esperados
\[
EG = \frac{1}{N}\sum_{n=1}^N |\hat \lambda_n - g_n|
\]

donde \(\hat \lambda_n\) es xG o intensidad predicha y \(g_n\) es el gol o xG observado según el caso.

---

## Módulo 3. Calibración del modelo de mercado

Pregunta central:

> **¿El modelo detectó realmente valor frente a las cuotas?**

Aquí sí entra el betting layer.

## 7.1 Variables necesarias

- opening odds,
- closing odds,
- probabilidad implícita,
- margen del book,
- closing line value,
- resultado del mercado recomendado.

## 7.2 Magnitudes clave

Si para un evento \(A\):

- el modelo da \(\hat p_A\),
- la cuota es \(o_A\),

entonces:

\[
p_A^{imp} = \frac{1}{o_A}
\]

\[
Edge_A = \hat p_A - \tilde p_A^{imp}
\]

\[
EV_A = \hat p_A \cdot o_A - 1
\]

## 7.3 Métricas del calibrador de mercado

### ROI
\[
ROI = \frac{\text{beneficio neto}}{\text{stake total}}
\]

### Yield
\[
Yield = \frac{\text{beneficio neto}}{\text{número de apuestas}}
\]

### CLV
Comparar la cuota tomada con la cuota de cierre.

### Precision por mercado
No como criterio final, pero sí como señal auxiliar.

## 7.4 Punto clave

Este módulo debe separar:

- **el modelo acertó el partido**
- de
- **el modelo encontró una apuesta con valor**

No son equivalentes.

---

## Módulo 4. Evaluación de señales scrapeadas

Pregunta central:

> **¿Qué señales scrapeadas realmente agregan información?**

Este módulo es crucial porque tu proyecto depende del scraping psicodeportivo.

## 8.1 Error del calibrador actual

Hoy el archivo usa algo parecido a una pseudo-correlación definida artesanalmente. fileciteturn1file0

Eso debe reemplazarse por métodos más sólidos.

## 8.2 Marco correcto

Sea una señal scrapeada \(s_j\). Queremos medir su valor incremental para explicar:

- resultado de partido,
- goles,
- edge de mercado,
- o selección correcta de apuesta.

### Enfoque recomendado 1: regresión incremental
Comparar:

\[
Model_0: y \sim X_{base}
\]

contra

\[
Model_1: y \sim X_{base} + s_j
\]

y medir mejora en:
- log loss,
- Brier,
- AUC,
- o uplift de ROI.

### Enfoque recomendado 2: importance por permutation
Medir cuánto empeora el desempeño si se permuta la señal.

### Enfoque recomendado 3: SHAP / feature attribution
Si usas modelos más complejos.

## 8.3 Taxonomía obligatoria de señales scrapeadas

El calibrador debe evaluar por separado:

### A. `team_performance_proxy`
Afecta partido real.

### B. `media_narrative_proxy`
Afecta percepción pública y a veces el partido.

### C. `market_bias_proxy`
Afecta cuota o mispricing más que el partido.

### D. `contextual_proxy`
Afecta el contexto general.

No conviene medirlas todas con la misma función objetivo.

## 8.4 Error de medición y confianza de extracción

Si una señal scrapeada \(s_j\) tiene confianza \(c_j\), entonces su impacto observado debe ponderarse.

Por ejemplo:

\[
s_j^{adj} = c_j \cdot s_j
\]

o bien:

\[
w_j^{eff} = w_j \cdot c_j
\]

Esto alinea el calibrador con la formulación matemática base del proyecto.

---

## Módulo 5. Actualización controlada del modelo

Pregunta central:

> **¿Cómo cambia el modelo sin volverse loco por poca muestra?**

Este es el corazón del rediseño.

## 9.1 Qué no hacer

No conviene:

- cambiar pesos grandes con pocos partidos,
- mover sliders por precisión superficial,
- aumentar o reducir una variable solo porque “apareció en partidos acertados”,
- ni autocalibrar sin control de muestra mínima.

## 9.2 Qué sí hacer

Hay tres niveles posibles de actualización.

### Nivel A. Recalibración externa de probabilidades
No tocas el modelo interno. Solo corriges la salida.

Ejemplo:

\[
p^{cal} = \sigma(a + b \cdot logit(\hat p))
\]

Ventaja:
- muy estable,
- poco riesgoso,
- ideal como primera etapa.

### Nivel B. Actualización de pesos de bloques
Ajustar pesos macro:

- bloque estadístico,
- bloque psicodeportivo,
- bloque contextual,
- bloque mercado.

Esto puede hacerse con regularización fuerte.

### Nivel C. Actualización de coeficientes internos
Más potente pero más riesgoso. Requiere muestra suficiente.

## 9.3 Recomendación estratégica

Para este proyecto, la mejor secuencia es:

1. recalibración externa,
2. luego ajuste de bloques,
3. y solo más adelante ajuste fino de coeficientes.

---

# 6. Relación formal entre este calibrador y los otros dos documentos

Este tercer archivo debe estar explícitamente acoplado a los otros dos.

## 10.1 Conexión con el documento de revisión conceptual

El primer documento define:

- qué variables existen,
- cuáles conservar,
- cuáles reformular,
- cuáles son narrativas,
- cuáles son proxies scrapeadas.

Este calibrador debe respetar esas categorías.

## 10.2 Conexión con el documento matemático

El segundo documento define:

- bloques \(E_i, P_i, C_i, M_i\),
- constructos latentes,
- error de medición,
- edge y EV,
- separación entre partido y mercado.

Este calibrador debe operar sobre esa estructura, no inventar una lógica paralela.

## 10.3 Principio de coherencia

El calibrador no puede “aprender” con una ontología distinta a la del modelo base.

Si el modelo distingue:

- \(P_i^{team}\),
- \(P_i^{media}\),
- \(P_i^{market}\),

el calibrador también debe distinguirlas.

---

# 7. Reformulación crítica de las funciones actuales del archivo

Ahora reescribo la lógica del archivo actual en términos de qué conservar y qué reemplazar.

---

## 11.1 `getPesos`, `guardarPesos`, `getVersionesModelo`
**Estado:** conservar. fileciteturn1file0

### Razón
Son la base del versionado y del gobierno del modelo.

### Mejora recomendada
Cada versión debería guardar no solo pesos, sino también:

- fecha,
- torneo,
- tamaño de muestra usado para calibrar,
- métricas pre y post calibración,
- método de actualización aplicado.

---

## 11.2 `actualizarPesos` y sliders de UI
**Estado:** conservar como herramienta manual, no como calibración principal. fileciteturn1file0

### Nuevo rol
- interfaz de supervisión humana,
- no núcleo matemático del aprendizaje.

---

## 11.3 `guardarPesos`
**Estado:** conservar, pero enriquecer metadatos. fileciteturn1file0

### Nuevo contrato lógico
Guardar:

\[
\text{version} = (\text{pesos}, \text{método\_update}, \text{dataset\_usado}, \text{métricas})
\]

---

## 11.4 `verificarCalibrador`
**Estado:** conservar como punto de entrada, rehacer lógica interna. fileciteturn1file0

### Debe pasar a coordinar:
1. auditoría de datos,
2. carga de dataset calibrable,
3. métricas de partido,
4. métricas de mercado,
5. evaluación de proxies scrapeadas,
6. propuesta de actualización.

---

## 11.5 `tieneIAReal`
**Estado:** conservar y generalizar. fileciteturn1file0

### Mejora
No basta con “hay IA real”; conviene tener:

- confianza de scraping,
- completitud,
- fuente,
- timestamp,
- consistencia semántica.

---

## 11.6 `generarSugerencias`
**Estado:** rehacer casi por completo. fileciteturn1file0

### Problema actual
Sube o baja peso según precisión heurística.

### Reemplazo recomendado
Un módulo de actualización con esta salida:

- señal evaluada,
- muestra efectiva,
- mejora marginal de log loss / Brier / ROI,
- robustez,
- recomendación:
  - conservar,
  - bajar,
  - subir,
  - mover de bloque,
  - reclasificar como sesgo de mercado.

---

## 11.7 `calcularBoostReal`
**Estado:** conservar la intuición, rehacer la estadística. fileciteturn1file0

### Qué intenta hacer
Capturar si un equipo rindió sistemáticamente por encima o por debajo de lo esperado.

### Problema
Hoy usa un cociente promedio muy simple.

### Rediseño correcto
Trabajar con residuos:

\[
r_{i,m} = xG_{i,m}^{real} - xG_{i,m}^{pred}
\]

Luego modelar:

\[
r_{i,m} = \beta_0 + \beta_1 Incentivo_{i,m} + \beta_2 Fase_{m} + \beta_3 GapRanking_{m} + \beta_4 Presion_{i,m} + u_{i,m}
\]

Entonces el antiguo “boost” deja de ser un multiplicador intuitivo y pasa a ser un **efecto residual estimado**.

---

## 11.8 `calcularImpactoPorVariable`
**Estado:** reemplazar. fileciteturn1file0

### Problema
La “correlación” actual no es una correlación estadística.

### Sustitución recomendada
Para cada variable scrapeada:

- mejora marginal en log loss,
- mejora marginal en Brier,
- mejora marginal en ROI,
- importance por permutation,
- estabilidad por bootstrap.

---

## 11.9 `cargarMetricasNav`
**Estado:** conservar. fileciteturn1file0

### Mejora
Agregar métricas de:
- calibración,
- CLV,
- muestra calibrable,
- drift del modelo,
- drift de mercado.

---

# 8. Rediseño matemático del calibrador

Aquí lo conectamos con la “biblia” matemática del proyecto.

---

## 12.1 Dataset incremental

Sea el conjunto de partidos observados hasta tiempo \(t\):

\[
\mathcal{D}_t = \{(X_n, \hat p_n, y_n, O_n, S_n, V_n)\}_{n=1}^{N_t}
\]

donde:

- \(X_n\): features de predicción del partido
- \(\hat p_n\): probabilidades predichas
- \(y_n\): resultado real
- \(O_n\): cuotas observadas
- \(S_n\): señales scrapeadas y metadatos
- \(V_n\): versión del modelo

---

## 12.2 Capa de recalibración externa

En vez de tocar el modelo original enseguida, aplicar:

\[
p_n^{cal} = \sigma(a_t + b_t \cdot logit(\hat p_n))
\]

Los parámetros \(a_t, b_t\) se reestiman periódicamente.

### Ventaja
- aprendizaje estable,
- poco sobreajuste,
- trazabilidad clara.

---

## 12.3 Actualización bayesiana opcional

Si quieres que el modelo aprenda de forma gradual, podrías tratar ciertos pesos como aleatorios:

\[
w_j^{(t)} \sim \mathcal{N}(w_j^{(t-1)}, \tau_j^2)
\]

y actualizar con nueva evidencia.

Esto sería ideal para un sistema verdaderamente secuencial, pero como fase posterior.

---

## 12.4 Drift detection

El calibrador no solo debe actualizar. También debe detectar si el torneo está comportándose distinto.

### Drift de partido
\[
Drift_{match}(t) = BS_t - BS_{historico}
\]

### Drift de mercado
\[
Drift_{market}(t) = ROI_t - ROI_{historico}
\]

### Drift de scraping
\[
Drift_{scrape}(t) = \mathbb{E}[c_t] - \mathbb{E}[c_{hist}]
\]

Si hay drift fuerte, se recalibra con más prudencia.

---

# 9. Política de actualización: cuándo sí y cuándo no

Este sistema necesita reglas duras de gobernanza.

## 13.1 No actualizar si
- la muestra calibrable es muy pequeña,
- la confianza media del scraping es baja,
- el mercado está incompleto,
- hay gran varianza en resultados,
- la mejora observada no es robusta.

## 13.2 Sí actualizar si
- hay muestra mínima suficiente,
- la mejora es estable,
- mejora partido y/o mercado de forma consistente,
- la señal tiene trazabilidad y buen score de calidad.

## 13.3 Actualización por capas

### Capa 1
Recalibración de probabilidades.

### Capa 2
Ajuste de pesos macro.

### Capa 3
Reasignación de variables entre bloques.

### Capa 4
Ajuste fino de coeficientes.

---

# 10. Qué debe producir este sistema en la práctica

El rediseño del calibrador debería producir cuatro salidas formales.

## 14.1 Reporte de calidad de datos
- cuántos partidos son utilizables,
- qué variables faltan,
- qué scraping es confiable.

## 14.2 Reporte de desempeño
- Brier,
- log loss,
- calibration curve,
- ROI,
- yield,
- CLV,
- drawdown.

## 14.3 Reporte de valor de señales
Para cada proxy scrapeada:
- tipo de proxy,
- muestra,
- mejora marginal,
- robustez,
- recomendación de uso.

## 14.4 Recomendación de actualización
Ejemplo:

- mantener pesos,
- recalibrar salidas,
- bajar peso de narrativa,
- mover “venganza” a bloque de mercado,
- aumentar peso de incentivo competitivo,
- no actualizar por falta de muestra.

---

# 11. Propuesta formal de nuevo rol del archivo

En términos de proyecto, este tercer archivo debería definirse así:

## **Documento base del subsistema de calibración, validación y aprendizaje incremental**

Su función es garantizar que el modelo:

- aprenda del torneo,
- no sobreajuste,
- mida el valor real de las señales scrapeadas,
- se mantenga coherente con la formulación matemática,
- y mejore de forma trazable.

---

# 12. Veredicto final sobre el archivo actual

## Como intuición
Muy buena.

## Como pieza del proyecto
Sí debe quedarse como tercera base.

## Como implementación actual
Todavía está demasiado heurística.

## Como dirección correcta
Debe evolucionar desde:

**“panel que sugiere subir o bajar pesos”**

hacia:

**“sistema formal de auditoría, calibración probabilística y aprendizaje incremental controlado”**

---

# 13. Resumen ejecutivo final

### Qué conservar
- versionado,
- métricas,
- noción de muestra calibrable,
- interfaz manual,
- idea de mejora secuencial.

### Qué rehacer
- sugerencias heurísticas,
- pseudo-correlaciones,
- cálculo simple del boost real,
- mezcla entre partido y apuesta,
- lógica de actualización.

### Qué añadir
- auditoría de scraping,
- calidad de proxy,
- recalibración externa,
- separación partido / mercado,
- evaluación formal de señales,
- drift detection,
- política de actualización robusta.

### Qué debe ser este archivo en la biblia del proyecto
El archivo que define **cómo el modelo aprende sin traicionarse a sí mismo**.

---

# 14. Relación operativa con los otros dos archivos base

## Archivo 1
Define qué variables existen y cómo deben clasificarse.

## Archivo 2
Define cómo esas variables entran al modelo matemático.

## Archivo 3 (este)
Define cómo esas variables, probabilidades y decisiones se corrigen, validan y actualizan a lo largo del torneo.

Los tres juntos forman una arquitectura coherente:

1. **ontología del modelo**  
2. **formalización matemática**  
3. **calibración y aprendizaje incremental**

---

# 15. Cierre metodológico

Dado que este proyecto depende mucho de variables scrapeadas, este tercer documento debe dejar asentado un principio definitivo:

> El modelo no aprende solo de resultados. Aprende de resultados **más calidad de observación**.

Por tanto, el calibrador no debe ser solo un sistema de ajuste de pesos, sino un sistema que evalúa simultáneamente:

- la calidad de los datos,
- la calidad del modelo,
- la calidad de las probabilidades,
- la calidad del edge,
- y la calidad de las señales scrapeadas.

Ese debe ser el corazón del tercer archivo base.

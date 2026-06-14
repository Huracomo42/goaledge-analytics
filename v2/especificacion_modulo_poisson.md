# Especificación Matemática — Módulo Poisson de Predicción

**Proyecto Futboleros — Predictor Mundial 2026**
**Módulo objetivo**: `core/prediction/poisson.js`

Este documento especifica, de forma completa y autocontenida, la primera versión del
"cerebro" matemático de predicción. Cubre: cálculo de λ (goles esperados), derivación de
1X2, Over/Under, BTTS y marcadores exactos, y los parámetros que se fijan vs. los que se
calibran después. Cada decisión está justificada contra los documentos base y, cuando
aplica, contra los repos de referencia ya evaluados.

---

## 1. Insumos del módulo (recordatorio del diccionario E)

Para cada equipo `i` (local L, visitante V):

- `ataque_i` = `xg_promedio` (E001) — ponderado por recencia, K=10 partidos
- `defensa_i` = `xg_concedido_promedio` (E002) — ponderado por recencia, K=10 partidos

Estas son, para esta primera versión, las **únicas** covariables que entran a λ. Los bloques
P (psicodeportivo), C (contextual) y M (mercado) se incorporan en versiones posteriores del
mismo módulo, siguiendo la misma forma aditiva — esto se explica en la sección 7.

---

## 2. Parámetros del modelo: fijos vs. calibrables

Esta distinción es central y viene directo de la "Política de actualización" del documento
de calibración (sección 13): no todos los números del modelo tienen el mismo estatus.

### 2.1 Parámetros FIJOS al inicio (constantes de referencia de literatura)

| Parámetro | Símbolo | Valor inicial | Justificación |
|---|---|---|---|
| Promedio de goles por equipo en fútbol de selecciones / Mundiales | `mu_liga` | **1.35** | Mundiales recientes (2018, 2022) rondan ~2.5-2.7 goles totales por partido → ~1.3 por equipo. Este es el "ancla" alrededor de la cual se ajustan los λ individuales. |
| Ventaja de jugar como local | `factor_local` | **1.10** | La ventaja de local en torneos cortos/neutrales (varios partidos del Mundial 2026 se juegan en sede pero no necesariamente "en casa" salvo México/USA/Canadá) es menor que en ligas domésticas. Se usa un valor conservador (+10%) en vez del +30-35% típico de ligas locales. |
| Desventaja de visitante | `factor_visitante` | **0.95** | Complementario y conservador, mismo razonamiento. |

**Por qué estos valores y no otros**: son valores de **arranque**, elegidos para que el
modelo produzca números razonables desde el primer partido (sin esperar 20 partidos de
calibración para tener algo utilizable). El documento de calibración es explícito: "no
ajustes pesos grandes con pocos partidos" — pero eso aplica a *cambiar* valores ya en uso
con poca evidencia, no a *fijar un punto de partida razonable* basado en literatura. Una vez
haya ~20 partidos del propio Mundial 2026 jugados, estos 3 valores son los **primeros
candidatos** para la Capa 1 de calibración (recalibración externa), porque son pocos,
globales, y de bajo riesgo de sobreajuste.

**Referencia de repos**: tanto `goalmodel` como `Hicruben/world-cup-2026-prediction-model`
usan esta misma estructura de "fuerza de ataque relativa al promedio de la competición" —
no es una invención nuestra, es el patrón estándar en modelos de goles esperados para fútbol.

### 2.2 Parámetros que NO existen todavía (deliberadamente)

No hay parámetro de "dependencia entre goles" (el λ₃ del Bivariate Poisson). Se usa
**Poisson independiente** para L y V. Esto se justifica en la sección 6.

---

## 3. Cálculo de λ (goles esperados)

### 3.1 Fórmula

```
λ_local     = mu_liga × (ataque_L / mu_liga) × (defensa_V / mu_liga) × factor_local
λ_visitante = mu_liga × (ataque_V / mu_liga) × (defensa_L / mu_liga) × factor_visitante
```

Simplificando (el `mu_liga` se cancela parcialmente):

```
λ_local     = (ataque_L × defensa_V / mu_liga) × factor_local
λ_visitante = (ataque_V × defensa_L / mu_liga) × factor_visitante
```

### 3.2 Lectura de la fórmula

- `ataque_L / mu_liga` → "¿este equipo ataca mejor o peor que el promedio del torneo?"
  (un valor > 1 significa que ataca por encima del promedio)
- `defensa_V / mu_liga` → "¿el rival defiende mejor o peor que el promedio?" (un valor > 1
  significa que el rival concede MÁS de lo normal, lo cual favorece al atacante)
- El producto de ambos ajusta el `mu_liga` base hacia arriba o abajo según el matchup
  específico.
- `factor_local` / `factor_visitante` aplican el ajuste de jugar en casa/fuera.

### 3.3 Verificación con el ejemplo anterior (Argentina vs Arabia Saudita)

Con `ataque_L=1.9`, `defensa_V=1.8`, `ataque_V=0.9`, `defensa_L=0.7`, `mu_liga=1.35`:

```
λ_local     = (1.9 × 1.8 / 1.35) × 1.10 = (3.42/1.35) × 1.10 = 2.533 × 1.10 ≈ 2.79
λ_visitante = (0.9 × 0.7 / 1.35) × 0.95 = (0.63/1.35) × 0.95 = 0.467 × 0.95 ≈ 0.44
```

Resultado muy cercano al ejemplo ilustrativo anterior (2.85 / 0.47) — la diferencia es por
usar `mu_liga=1.35` (valor justificado) en vez del `1.2` que era solo ilustrativo.

### 3.4 Salvaguarda de rango

Para evitar λ extremos por datos atípicos (ej. un equipo con xG=0.1 por muestra muy
pequeña), se aplica un clamp:

```
λ_local, λ_visitante ∈ [0.15, 4.5]
```

**Justificación**: λ=0 rompe la distribución Poisson (un equipo con 0% de probabilidad de
anotar nunca es realista en fútbol de selecciones); λ>4.5 representa más de 4.5 goles
esperados, un escenario extremo que normalmente indica dato de entrada erróneo más que una
expectativa real. Este clamp es una salvaguarda de ingeniería, no un parámetro de modelado
— se documenta para que el calibrador pueda detectar si se activa con frecuencia (señal de
datos de entrada problemáticos).

---

## 4. Distribución de Poisson y matriz de marcadores

### 4.1 Fórmula de Poisson

Para un equipo con tasa esperada λ, la probabilidad de que anote exactamente `g` goles es:

```
P(G = g) = (e^(-λ) × λ^g) / g!
```

### 4.2 Matriz conjunta de marcadores

Asumiendo independencia entre goles local y visitante (justificado en sección 6):

```
P(G_L = g, G_V = h) = P(G_L = g) × P(G_V = h)
```

Se calcula esta matriz para `g, h = 0..6` (7×7 = 49 combinaciones). Marcadores con 7+ goles
de un equipo son estadísticamente despreciables (con λ≈2.8, P(G=7) < 0.5%) y se agrupan en
una categoría "otros" para que las probabilidades sumen exactamente 1.

```
P(otros) = 1 - Σ(g=0..6, h=0..6) P(G_L=g, G_V=h)
```

### 4.3 Ejemplo con λ_local=2.79, λ_visitante=0.44

Algunas celdas de la matriz (ilustrativas, redondeadas):

| | G_V=0 | G_V=1 | G_V=2 |
|---|---|---|---|
| G_L=0 | 0.040 | 0.018 | 0.004 |
| G_L=1 | 0.112 | 0.049 | 0.011 |
| G_L=2 | 0.156 | 0.069 | 0.015 |
| G_L=3 | 0.145 | 0.064 | 0.014 |

(Estos números se calculan exactamente en código; aquí solo ilustran la forma de la matriz.)

---

## 5. Derivación de mercados desde la matriz

Todo lo siguiente se calcula **sumando celdas de la misma matriz** — esto es lo que
garantiza consistencia interna (a diferencia de V1, donde cada mercado tenía su propia
probabilidad inventada por separado).

### 5.1 Mercado 1X2

```
P(Local gana) = Σ(g>h) P(G_L=g, G_V=h)
P(Empate)     = Σ(g=h) P(G_L=g, G_V=h)
P(Visitante gana) = Σ(g<h) P(G_L=g, G_V=h)
```

Verificación: estas tres probabilidades **siempre suman 1** (menos el residual "otros", que
se reparte proporcionalmente o se asigna al resultado más probable de esa franja — detalle
de implementación, no de modelado).

### 5.2 Over/Under (ejemplo: 2.5 goles)

```
P(Over 2.5) = Σ(g+h ≥ 3) P(G_L=g, G_V=h)
P(Under 2.5) = 1 - P(Over 2.5)
```

Generalizable a cualquier línea (1.5, 2.5, 3.5, 4.5) cambiando el umbral. Esto es relevante
porque The Odds API puede devolver distintas líneas según el bookmaker — el modelo puede
responder a cualquiera de ellas con la misma matriz, sin recalcular nada.

### 5.3 BTTS (ambos anotan)

```
P(BTTS) = Σ(g≥1, h≥1) P(G_L=g, G_V=h)
        = 1 - P(G_L=0) - P(G_V=0) + P(G_L=0, G_V=0)
```

(la segunda forma usa inclusión-exclusión y es más eficiente de calcular)

### 5.4 Marcador exacto

```
P(marcador = "g-h") = P(G_L=g, G_V=h)
```

Directo de la matriz. El "marcador más probable" es simplemente la celda con mayor
probabilidad — para nuestro ejemplo, probablemente 2-0 o 3-0 dado λ_local≈2.79.

---

## 6. Por qué Poisson independiente (no Bivariate Poisson) en esta versión

Esta es una decisión que requiere justificación explícita porque el documento matemático
base presenta el Bivariate Poisson como extensión "más correcta" (sección 8).

**El Bivariate Poisson** modela los goles como:

```
G_L = U1 + U3,  G_V = U2 + U3
```

donde `U3` captura un componente **compartido** entre ambos equipos (ritmo de partido,
apertura táctica, arbitraje) — esto introduce covarianza entre G_L y G_V, lo cual el
Poisson independiente asume = 0.

**Por qué NO lo usamos todavía**:

1. **Parámetros adicionales = más riesgo de sobreajuste.** El Bivariate Poisson requiere
   estimar `λ3` (la covarianza), un parámetro extra que no existe en el modelo independiente.
   El documento de calibración (Módulo 5, "Qué no hacer") es explícito: no añadir
   complejidad que requiera estimación con la muestra pequeña de un Mundial (~104 partidos
   totales, y los parámetros de λ3 suelen estimarse por liga/competición — con un solo
   Mundial como dataset, la estimación de λ3 sería muy inestable).

2. **El propio documento matemático (sección 21, "Qué modelo elegir") dice**: *"Opción B
   (Poisson/Bivariate Poisson): mejor si quieres derivar muchos mercados desde una
   estructura futbolera coherente"* — no distingue ahí entre Poisson simple y bivariado
   como obligatorio; ambos caen en la "Opción B". Empezar con el caso simple (independiente)
   es la forma más directa de obtener esa estructura coherente sin el parámetro extra.

3. **Precedente en repos de referencia**: `goalmodel` y `mezzala` ofrecen ambas variantes,
   pero documentan el Poisson independiente como punto de partida estándar. Dixon-Coles
   (que sí es un tipo de ajuste por dependencia, pero más simple que Bivariate Poisson
   completo) es el siguiente paso natural si la calibración muestra que el supuesto de
   independencia genera errores sistemáticos — específicamente, Dixon-Coles corrige un
   sesgo conocido: Poisson independiente tiende a **subestimar empates de 0-0 y 1-1**.

**Plan de evolución concreto**: una vez haya ~20-30 partidos reales del Mundial 2026
calibrables, el módulo de calibración (Capa 2/3 del doc 3) evalúa específicamente: ¿el
modelo está subestimando empates? Si sí, el siguiente paso es el **ajuste de Dixon-Coles**
(un factor de corrección τ(g,h) que se aplica solo a las celdas (0,0), (1,0), (0,1), (1,1)
de la matriz) — esto es una mejora incremental sobre la matriz que ya tenemos, no un
cambio de arquitectura. Bivariate Poisson completo queda como posibilidad de fase posterior,
solo si Dixon-Coles resulta insuficiente.

---

## 7. Cómo se incorporan los bloques P, C, M más adelante (sin romper esto)

La fórmula de la sección 3 es deliberadamente la versión mínima de la fórmula general del
documento matemático (sección 22.1):

```
λ_L = exp(θ0 + θ_E^T E_L + θ_P^T P_L + θ_C^T C_L - θ_D^T D_V)
```

Nuestra versión actual es el caso donde solo `θ_E` (bloque E) está activo, y usamos forma
multiplicativa de ratios en vez de exponencial de suma — ambas son matemáticamente
equivalentes si se toma logaritmo (`exp(suma de logs) = producto`), por lo que migrar de
"ratios multiplicativos" a "exponencial de suma de covariables" cuando se añadan P/C/M es
un cambio de forma, no de fondo. Esto significa: **el módulo Poisson actual no se reescribe
desde cero cuando lleguen las variables psicodeportivas** — se extiende.

Ejemplo de cómo se vería con un ajuste de contexto de torneo (`C_i^torneo`, sección 10 del
doc matemático) ya definido en una fase futura:

```
λ_local = (ataque_L × defensa_V / mu_liga) × factor_local × exp(C_local^torneo - C_visitante^torneo)
```

El término `exp(...)` de ajuste contextual se multiplica sobre la base ya calculada — no
reemplaza nada de lo que ya existe.

---

## 8. Resumen de lo que el módulo `poisson.js` debe exponer

Para que quede claro de cara a la implementación en Claude Code (sin escribir código todavía):

**Entrada**:
```
{
  ataque_local, defensa_local,        // E001, E002 del equipo local
  ataque_visitante, defensa_visitante // E001, E002 del equipo visitante
}
```

**Salida**:
```
{
  lambda_local, lambda_visitante,
  matriz_marcadores,          // 7x7 + "otros"
  prob_1x2: { local, empate, visitante },
  prob_over_under: { "1.5": {over, under}, "2.5": {...}, "3.5": {...} },
  prob_btts: { si, no },
  marcador_mas_probable: { local, visitante, prob },
  metadata: {
    mu_liga, factor_local, factor_visitante,  // parámetros usados, para trazabilidad
    version_modelo,
    clamps_activados: []  // si algún lambda fue ajustado por el rango [0.15, 4.5]
  }
}
```

El campo `metadata` es importante porque conecta directamente con la regla de trazabilidad
del prompt original: cada predicción debe guardar qué parámetros y versión se usaron, para
que el calibrador pueda comparar entre versiones del modelo más adelante.

---

## 9. Lo que este módulo NO hace (deliberadamente, por ahora)

- No calcula EV, edge, ni compara contra odds — eso es el Betting Engine, módulo separado
  que consume la salida de este módulo.
- No incorpora variables psicodeportivas, contextuales ni de mercado — bloques futuros,
  incorporables sin romper esta base (sección 7).
- No corrige el sesgo de subestimación de empates (Dixon-Coles) — pendiente de evidencia
  de calibración.
- No pondera por recencia dentro del módulo mismo — esa ponderación ocurre **antes**, al
  calcular `ataque_i` y `defensa_i` (en el Data Pipeline), por lo que este módulo recibe
  esos valores ya procesados.

Esta lista existe para que, si en Claude Code alguien (incluido un futuro yo) tiene la
tentación de "mejorar" el módulo añadiendo cosas, quede explícito que esas adiciones son
**decisiones de diseño pendientes**, no omisiones accidentales.

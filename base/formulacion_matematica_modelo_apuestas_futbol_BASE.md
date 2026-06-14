# Formulación matemática completa del modelo de predicción y apuestas en fútbol

Este documento desarrolla una formulación matemática rigurosa para un modelo de predicción de partidos de fútbol y decisión de apuestas que combina:

1. variables estadísticas de rendimiento,
2. variables psicológicas y psicodeportivas,
3. variables contextuales de torneo,
4. variables de mercado y cuotas,
5. y una capa final de decisión de apuesta.

La intención es pasar de un modelo heurístico a un modelo **probabilístico, estimable, calibrable y validable**.

---

## 1. Punto de partida: por qué formalizar el modelo

Un modelo artesanal de scores, boosts y reglas puede ser útil como prototipo, pero para sostenerlo matemáticamente conviene que cumpla al menos estas condiciones:

- tener **variables definidas formalmente**,
- tener una **función objetivo probabilística**,
- tener **parámetros estimables**,
- permitir **inferencia y validación**,
- y estar conectado con una **regla de decisión de apuesta**.

La literatura de predicción en fútbol y apuestas muestra que los modelos más defendibles suelen apoyarse en enfoques como regresión logística, softmax multinomial, Poisson/Bivariate Poisson, ratings dinámicos, random forests y modelos híbridos [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt), [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt), [(Groll et al., 2015)](https://consensus.app/papers/prediction-of-major-international-soccer-tournaments-groll-schauberger/ebdde05a48be523bb7d5ceb73719d46c/?utm_source=chatgpt), [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt), [(Bunker et al., 2024)](https://consensus.app/papers/machine-learning-for-soccer-match-result-prediction-bunker-yeung/f5f054ca137f55e8ac663427938bdbb0/?utm_source=chatgpt).

---

## 2. Notación general

Sea un partido \(m\) entre dos equipos:

- \(L\): equipo local
- \(V\): equipo visitante

Definimos un vector de covariables para cada equipo:

\[
X_i = (X_i^{(E)}, X_i^{(P)}, X_i^{(C)}, X_i^{(M)})
\]

donde:

- \(X_i^{(E)}\): bloque **estadístico**
- \(X_i^{(P)}\): bloque **psicológico / psicodeportivo**
- \(X_i^{(C)}\): bloque **contextual / torneo / entorno**
- \(X_i^{(M)}\): bloque **mercado / cuotas / sesgos del mercado**

con \(i \in \{L, V\}\).

---


## 2.1 Naturaleza epistemológica de las variables psicológicas scrapeadas

En este proyecto, las llamadas variables psicológicas **no son mediciones directas** del estado mental de jugadores o equipos. No provienen, por ejemplo, de escalas psicométricas administradas directamente a los sujetos. Provienen de **web scraping** y extracción de señales desde fuentes públicas como:

- noticias,
- entrevistas,
- conferencias de prensa,
- titulares,
- alineaciones,
- contexto de torneo,
- lenguaje mediático,
- y narrativa pública.

Por tanto, desde un punto de vista matemático y metodológico, estas variables deben entenderse como **proxies observacionales indirectas**.

Si \(P_i^{true}\) representa un estado psicodeportivo latente real del equipo \(i\), y \(P_i^{obs}\) representa la variable obtenida mediante scraping, entonces:

\[
P_i^{obs} = P_i^{true} + \varepsilon_i
\]

donde:

- \(P_i^{true}\): constructo latente real no observado directamente,
- \(P_i^{obs}\): proxy observada vía scraping,
- \(\varepsilon_i\): error de medición, error semántico, ruido de cobertura o sesgo de fuente.

Esto implica que la capa psicológica scrapeada no debe tratarse como una variable exacta, sino como una observación con incertidumbre.

### Ajuste por confiabilidad de extracción

Si se dispone de una medida de confianza \(c_i \in [0,1]\), se puede definir una versión ponderada:

\[
P_i^{adj} = c_i \cdot P_i^{obs}
\]

o, más generalmente:

\[
P_i^{adj} = c_i \cdot P_i^{obs} + (1-c_i)\cdot \bar P
\]

donde \(\bar P\) puede ser un prior neutro o el promedio histórico.

### Taxonomía recomendada de variables scrapeadas

Las variables derivadas de scraping deberían clasificarse en al menos cuatro grupos:

1. **Proxies del estado competitivo real del equipo**
   - conflicto interno,
   - liderazgo,
   - presión competitiva,
   - necesidad de ganar,
   - estabilidad del grupo.

2. **Proxies narrativas públicas**
   - venganza,
   - humillación previa,
   - generación dorada,
   - partido de vida o muerte.

3. **Proxies de sesgo de mercado**
   - favoritismo público,
   - identidad de hincha,
   - hype mediático,
   - sobre-reacción del mercado.

4. **Proxies contextuales**
   - importancia del partido,
   - fase del torneo,
   - contexto institucional,
   - información exógena pública.

### Consecuencia formal

No todas las variables scrapeadas deben entrar en el mismo bloque \(P_i\).  
Una descomposición más realista es:

\[
P_i^{obs} = P_i^{team} + P_i^{media} + P_i^{market} + P_i^{context}
\]

donde:

- \(P_i^{team}\): proxies orientadas al rendimiento real del equipo,
- \(P_i^{media}\): narrativa pública,
- \(P_i^{market}\): sesgo potencial sobre cuotas,
- \(P_i^{context}\): señales exógenas de contexto competitivo.

Esto es especialmente importante porque algunas señales scrapeadas mejoran la predicción del partido, mientras que otras explican mejor el desajuste del mercado que el partido mismo [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt), [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt), [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt), [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt).


## 3. Descomposición por bloques

## 3.1 Bloque estadístico \(E_i\)

Sea:

\[
E_i = \alpha_1 xG_i + \alpha_2 Forma_i + \alpha_3 Defensa_i + \alpha_4 Lesiones_i + \alpha_5 Rating_i + \alpha_6 CalidadRival_i + \alpha_7 Fatiga_i
\]

### Interpretación de variables

- \(xG_i\): expected goals ofensivo reciente o ponderado
- \(Forma_i\): forma reciente ajustada por rival
- \(Defensa_i\): solidez defensiva, por ejemplo \(-xGA_i\) o un índice equivalente
- \(Lesiones_i\): penalización por ausencias relevantes
- \(Rating_i\): rating estructural del equipo, tipo ELO, Poisson rating, pi-rating o similar
- \(CalidadRival_i\): calidad de oposición enfrentada recientemente
- \(Fatiga_i\): carga competitiva o descanso corto

La literatura de predicción de partidos y apuestas respalda ampliamente la importancia de variables de rendimiento, ratings de fuerza y características de plantilla [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt), [(Yang, 2021)](https://consensus.app/papers/predict-soccer-match-outcome-based-on-player-performance-yang/0894d3dd650755caad6d2a97863af884/?utm_source=chatgpt), [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt), [(Ley et al., 2017)](https://consensus.app/papers/ranking-soccer-teams-on-basis-of-their-current-strength-a-ley-wiele/05a25fc33779551eb0ff507f3ad321df/?utm_source=chatgpt).

---

## 3.2 Bloque psicológico / psicodeportivo \(P_i\)

En esta formulación, \(P_i\) debe entenderse como un bloque de **constructos latentes aproximados mediante scraping**, no como mediciones directas. En una implementación más refinada, parte de este bloque debería redistribuirse entre rendimiento real del equipo y sesgo de mercado.

Sea:

\[
P_i = \gamma_1 Incentivo_i + \gamma_2 Cohesion_i + \gamma_3 Liderazgo_i + \gamma_4 Presion_i + \gamma_5 RecuperacionMental_i + \gamma_6 Estabilidad_i
\]

### Interpretación

- \(Incentivo_i\): necesidad real de ganar, utilidad del empate, clasificación, eliminación, etc.
- \(Cohesion_i\): estabilidad del grupo, continuidad del once, ausencia de conflicto
- \(Liderazgo_i\): disponibilidad de líderes, capitán, DT estable, estructura interna
- \(Presion_i\): presión mediática, presión competitiva, presión por resultados
- \(RecuperacionMental_i\): carga psicológica, rachas, estrés acumulado
- \(Estabilidad_i\): crisis institucional, cambio de DT, tensión interna

La literatura sobre fútbol y psicología del rendimiento respalda el rol de clima motivacional, estrés, cohesión, liderazgo y entorno de equipo [(Pettersen et al., 2023)](https://consensus.app/papers/beyond-physical-abilitypredicting-womens-football-pettersen-martinussen/127dbbf65654595c9e35841d9a7f49a8/?utm_source=chatgpt), [(Pettersen et al., 2021)](https://consensus.app/papers/psychological-factors-and-performance-in-womens-football-pettersen-adolfsen/650e9080f3075ff282c4fa25fde747a8/?utm_source=chatgpt), [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt), [(Engan & Sæther, 2018)](https://consensus.app/papers/goal-orientations-motivational-climate-and-stress-engan-sther/31678cc4dc7052ae9a103d595bcf019d/?utm_source=chatgpt), [(Olmedilla et al., 2019)](https://consensus.app/papers/psychological-intervention-program-to-control-stress-in-olmedilla-moreno-fernndez/5b48a89f076b5dbba5c6475ee4a70c42/?utm_source=chatgpt), [(Rausch et al., 2026)](https://consensus.app/papers/rethinking-performance-crises-in-professional-soccer-rausch-fritsch/539e5ea914b05e53910514fe53f2e83d/?utm_source=chatgpt).

---

## 3.3 Bloque contextual / torneo \(C_i\)

Sea:

\[
C_i = \delta_1 Localia_i + \delta_2 Altitud_i + \delta_3 FaseTorneo_i + \delta_4 GapRanking_i + \delta_5 Stake_i + \delta_6 Stakeless_i
\]

### Interpretación

- \(Localia_i\): condición de local, sede neutral, visitante
- \(Altitud_i\): entorno fisiológico y adaptación
- \(FaseTorneo_i\): grupos, eliminación directa, jornada 1, 2, 3, etc.
- \(GapRanking_i\): diferencia de ranking o fuerza estructural
- \(Stake_i\): magnitud estratégica del partido
- \(Stakeless_i\): si el partido tiene poco o ningún incentivo efectivo

La literatura sobre incentivos y diseño de torneos apoya que el stake del partido y la estructura competitiva afectan el comportamiento, el esfuerzo y las cuotas [(Feddersen et al., 2021)](https://consensus.app/papers/contest-incentives-team-effort-and-betting-market-feddersen-humphreys/3a146fb469135d92860e60e457f284ec/?utm_source=chatgpt), [(Csató et al., 2022)](https://consensus.app/papers/tournament-schedules-and-incentives-in-a-double-csato-molontay/3a2b83166b3958518819fd884c679276/?utm_source=chatgpt), [(Lenten et al., 2013)](https://consensus.app/papers/policy-timing-and-footballers-incentives-lenten-libich/9e13e5adadc95b6b93ea45e915cad4d7/?utm_source=chatgpt), [(Wunderlich & Memmert, 2016)](https://consensus.app/papers/analysis-of-the-predictive-qualities-of-betting-odds-and-wunderlich-memmert/a4d8f53026035f0da8f8958adc0f865b/?utm_source=chatgpt).

---

## 3.4 Bloque de mercado \(M_i\)

Aquí conviene separar la información del equipo de la información de mercado.

Sea:

\[
M_i = \eta_1 OddsOpen_i + \eta_2 OddsClose_i + \eta_3 LineMove_i + \eta_4 Dispersion_i + \eta_5 SesgoPublico_i + \eta_6 Overreaction_i
\]

### Interpretación

- \(OddsOpen_i\): opening odds
- \(OddsClose_i\): closing odds
- \(LineMove_i\): movimiento de línea
- \(Dispersion_i\): dispersión entre casas
- \(SesgoPublico_i\): sesgo de hincha, popularidad, favoritismo público
- \(Overreaction_i\): sobre-reacción del mercado a rachas, resultados o narrativas

La literatura muestra que las cuotas contienen mucha información, y también que el mercado puede sobrerreaccionar o sesgarse bajo ciertas condiciones [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt), [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt), [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt), [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt), [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt).

---

## 4. Score latente del equipo

La formulación más simple y clara es una suma de bloques:

\[
S_i = \beta_0 + E_i + P_i + C_i
\]

o, si se desea usar todos los bloques incluyendo mercado en la capa de valor:

\[
S_i^{match} = \beta_0 + E_i + P_i + C_i
\]

\[
S_i^{market} = \kappa_0 + M_i
\]

Esto permite separar:

- **capacidad real del equipo en el partido**,
- y **valor o sesgo de mercado**.

### Diferencia entre equipos

\[
\Delta S = S_L^{match} - S_V^{match}
\]

Esta diferencia puede alimentar distintos modelos.

---

## 5. Primer marco formal: regresión logística binaria

Si el objetivo fuera solo “local gana” vs “no local gana”, entonces:

\[
Pr(Y=1 \mid X) = \sigma(\Delta S) = \frac{1}{1+e^{-\Delta S}}
\]

donde:

- \(Y = 1\) si gana el local
- \(Y = 0\) si no gana

Esto es una formulación limpia, interpretable y estimable.

### Ventaja matemática

- simple de estimar,
- fácil de regularizar,
- fácil de interpretar,
- produce probabilidades.

### Limitación

No modela explícitamente el empate como clase propia.

---

## 6. Segundo marco formal: modelo multinomial 1X2

Para fútbol, una formulación más natural es un modelo multinomial.

Sea \(Y \in \{H, D, A\}\), donde:

- \(H\): local gana
- \(D\): empate
- \(A\): visitante gana

Definimos tres índices lineales:

\[
\eta_H = \theta_H^\top Z
\]

\[
\eta_D = \theta_D^\top Z
\]

\[
\eta_A = \theta_A^\top Z
\]

donde \(Z\) puede incluir:

- diferencias entre bloques \((E_L-E_V), (P_L-P_V), (C_L-C_V)\)
- variables del partido
- variables del mercado

Entonces:

\[
Pr(Y=k \mid Z) = \frac{e^{\eta_k}}{e^{\eta_H}+e^{\eta_D}+e^{\eta_A}}
\]

con \(k \in \{H,D,A\}\).

### Ventaja

- modela directamente 1X2,
- da probabilidades consistentes que suman 1.

### Limitación

- menos natural para mercados de goles,
- menos estructuralmente futbolero que Poisson.

---

## 7. Tercer marco formal: modelo de goles esperados con Poisson

Este es, matemáticamente, uno de los enfoques más naturales para fútbol.

## 7.1 Intensidades esperadas

Sea:

\[
\lambda_L = \exp(\mu_L)
\]

\[
\lambda_V = \exp(\mu_V)
\]

donde:

\[
\mu_L = \theta_{0L} + \theta_1 Ataque_L - \theta_2 Defensa_V + \theta_3 P_L + \theta_4 C_L
\]

\[
\mu_V = \theta_{0V} + \phi_1 Ataque_V - \phi_2 Defensa_L + \phi_3 P_V + \phi_4 C_V
\]

Aquí la psicología y el contexto no entran como “magia”, sino como **covariables del proceso generador de goles**.

## 7.2 Distribuciones de goles

\[
G_L \sim Poisson(\lambda_L)
\]

\[
G_V \sim Poisson(\lambda_V)
\]

Luego:

\[
Pr(G_L = g) = \frac{e^{-\lambda_L}\lambda_L^g}{g!}
\]

\[
Pr(G_V = h) = \frac{e^{-\lambda_V}\lambda_V^h}{h!}
\]

Si se asume independencia:

\[
Pr(G_L=g, G_V=h) = Pr(G_L=g)\cdot Pr(G_V=h)
\]

### Derivación de mercados

A partir de esto se obtienen:

#### Probabilidad de local ganar
\[
Pr(H)=\sum_{g>h} Pr(G_L=g,G_V=h)
\]

#### Probabilidad de empate
\[
Pr(D)=\sum_{g=h} Pr(G_L=g,G_V=h)
\]

#### Probabilidad de visitante ganar
\[
Pr(A)=\sum_{h>g} Pr(G_L=g,G_V=h)
\]

#### Over 2.5
\[
Pr(Over\,2.5)=Pr(G_L+G_V \ge 3)
\]

#### Ambos anotan
\[
Pr(BTTS)=Pr(G_L \ge 1, G_V \ge 1)
\]

#### Marcador exacto \(g:h\)
\[
Pr(g:h)=Pr(G_L=g,G_V=h)
\]

Este enfoque es especialmente fuerte porque conecta de forma natural con los mercados.

La literatura sobre modelado de fútbol y torneos internacionales ha usado extensamente variantes Poisson, GLM y modelos híbridos [(Groll et al., 2015)](https://consensus.app/papers/prediction-of-major-international-soccer-tournaments-groll-schauberger/ebdde05a48be523bb7d5ceb73719d46c/?utm_source=chatgpt), [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt).

---

## 8. Extensión: Bivariate Poisson y dependencia entre goles

El supuesto de independencia entre goles local y visitante puede ser limitado.

En su forma más conocida, se puede modelar:

\[
G_L = U_1 + U_3
\]

\[
G_V = U_2 + U_3
\]

donde:

- \(U_1 \sim Poisson(\lambda_1)\)
- \(U_2 \sim Poisson(\lambda_2)\)
- \(U_3 \sim Poisson(\lambda_3)\)

e independientes entre sí.

Entonces:

- \(G_L \sim Poisson(\lambda_1+\lambda_3)\)
- \(G_V \sim Poisson(\lambda_2+\lambda_3)\)
- y la covarianza es:

\[
Cov(G_L,G_V)=\lambda_3
\]

Esto permite capturar dependencia compartida del partido: ritmo, apertura táctica, arbitraje, contexto competitivo, etc.

---

## 9. Crítica formal al modelo heurístico actual

Una formulación heurística típica sería:

\[
T_i = (w_E E_i + w_P P_i)\cdot B_i
\]

donde \(B_i\) es un boost.

Eso es válido algebraicamente, pero presenta varios problemas formales:

## 9.1 Multiplicación del boost

Si \(B_i\) multiplica todo el score, entonces cualquier error en \(B_i\) escala toda la predicción. Además, amplifica simultáneamente variables estadísticas y psicológicas, aunque el boost quizá solo represente contexto de torneo.

## 9.2 Ausencia de vínculo natural con una probabilidad

El score \(T_i\) por sí mismo no es una probabilidad ni una intensidad de goles.

## 9.3 No separación entre rendimiento y mercado

Mezclar en un solo número componentes que explican el partido y componentes que explican la cuota puede dificultar la interpretación.

---

## 10. Reformulación recomendada del “boost mundialista”

En lugar de un boost multiplicativo bruto, es más sólido formalizar un **ajuste de contexto de torneo** como suma de covariables:

\[
C_i^{torneo} = \rho_1 IncentivoClasificacion_i + \rho_2 GapRanking_i + \rho_3 Fase_i + \rho_4 Stake_i + \rho_5 Stakeless_i
\]

Entonces:

\[
S_i = \beta_0 + E_i + P_i + C_i^{entorno} + C_i^{torneo}
\]

Esto mantiene la intuición del “boost”, pero con una forma lineal/additiva mucho más estable e interpretable.

---

## 11. Construcción matemática del edge de apuesta

Sea un evento \(A\) cualquiera:

- local gana,
- over 2.5,
- ambos anotan,
- etc.

Si el modelo genera:

\[
\hat p_A = Pr(A \mid X)
\]

y la cuota decimal del mercado es \(o_A\), entonces la probabilidad implícita bruta es:

\[
p_A^{imp} = \frac{1}{o_A}
\]

Si se corrige por vigorish o margen del book, se obtiene una probabilidad implícita ajustada \(\tilde p_A^{imp}\).

## 11.1 Edge simple

\[
Edge_A = \hat p_A - \tilde p_A^{imp}
\]

## 11.2 Valor esperado

Para una apuesta unitaria:

\[
EV_A = \hat p_A(o_A - 1) - (1-\hat p_A)
\]

equivalentemente:

\[
EV_A = \hat p_A \cdot o_A - 1
\]

### Regla básica

Apuesta candidata si:

\[
EV_A > 0
\]

o mejor aún si:

\[
EV_A > \tau
\]

para un umbral \(\tau > 0\) elegido según robustez histórica.

La literatura de apuestas enfatiza que el punto central es la comparación entre la probabilidad estimada y la probabilidad implícita del mercado [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt), [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt).

---

## 12. Capa de sesgo de mercado y psicología del apostador

Aquí no se modela tanto el partido como el **error probable del mercado**.

Definamos un desajuste esperado de cuota:

\[
B_A = \omega_1 SesgoPublico_A + \omega_2 PopularidadEquipo_A + \omega_3 SobreReaccionRacha_A + \omega_4 IdentidadHincha_A + \omega_5 SobreconfianzaNarrativa_A
\]

Entonces, una forma de corregir el valor observado sería:

\[
\hat p_A^{adj} = \hat p_A + B_A
\]

o bien modelar directamente el error del mercado:

\[
\varepsilon_A^{market} = \hat p_A - \tilde p_A^{imp}
\]

y estimar:

\[
\varepsilon_A^{market} = \omega^\top W_A + u_A
\]

donde \(W_A\) incluye variables de sesgo público y comportamiento del mercado.

La evidencia sobre sesgos de hinchas, ilusión de control, sobreconfianza y sobre-reacción sugiere que esta capa tiene sentido [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt), [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt), [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt), [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt).

---

## 13. Estimación de parámetros

Un modelo formal requiere estimar parámetros como:

- \(\alpha_j\),
- \(\gamma_j\),
- \(\delta_j\),
- \(\eta_j\),
- \(\theta_j\),
- \(\omega_j\).

## 13.1 Máxima verosimilitud

En logística:

\[
\ell(\beta)=\sum_{n=1}^N \left[y_n \log p_n + (1-y_n)\log(1-p_n)\right]
\]

donde:

\[
p_n = \sigma(X_n^\top \beta)
\]

En multinomial, la log-verosimilitud análoga es:

\[
\ell(\Theta)=\sum_{n=1}^N \sum_{k} \mathbf{1}(y_n=k)\log Pr(Y_n=k\mid X_n)
\]

En Poisson:

\[
\ell(\theta)=\sum_{n=1}^N \left[g_n \log \lambda_n - \lambda_n - \log(g_n!)\right]
\]

## 13.2 Regularización

Para evitar sobreajuste:

### Ridge
\[
\ell_{ridge} = \ell - \lambda \|\beta\|_2^2
\]

### Lasso
\[
\ell_{lasso} = \ell - \lambda \|\beta\|_1
\]

### Elastic net
\[
\ell_{EN} = \ell - \lambda_1 \|\beta\|_1 - \lambda_2 \|\beta\|_2^2
\]

Esto es especialmente útil cuando se incorporan muchas variables psicológicas y contextuales.

---

## 14. Estandarización y construcción de índices

Muchas variables pueden venir en escalas distintas. Conviene estandarizar:

\[
Z_j = \frac{X_j - \mu_j}{\sigma_j}
\]

o normalizar a \([0,1]\).

### Índices compuestos

Por ejemplo, un índice de cohesión:

\[
Cohesion_i = \pi_1 ContinuidadOnce_i + \pi_2 EstabilidadDT_i + \pi_3 AusenciaConflicto_i + \pi_4 ContinuidadNucleo_i
\]

Un índice de presión:

\[
Presion_i = \psi_1 RachaNegativa_i + \psi_2 PresionMediatica_i + \psi_3 RiesgoEliminacion_i + \psi_4 ExigenciaEntorno_i
\]

Así las variables psicológicas se vuelven más objetivables.

---

## 15. Interacciones

Uno de los mayores beneficios de formalizar el modelo es permitir **interacciones**.

## 15.1 Ejemplos

### Incentivo x gap de fuerza
\[
\gamma_{12}(Incentivo_i \cdot GapRanking_i)
\]

### Presión x localía
\[
\gamma_{13}(Presion_i \cdot Localia_i)
\]

### Racha x sobre-reacción de mercado
\[
\omega_{12}(Racha_i \cdot Overreaction_i)
\]

### Cohesión x liderazgo
\[
\gamma_{14}(Cohesion_i \cdot Liderazgo_i)
\]

Estas interacciones pueden capturar fenómenos que un modelo puramente aditivo pierde.

---

## 16. Modelos jerárquicos y multinivel

Si hay ligas, torneos o temporadas diferentes, una formulación multinivel puede ser útil.

Por ejemplo:

\[
\beta_{0,\ell} \sim \mathcal{N}(\mu_{\beta_0}, \sigma_{\beta_0}^2)
\]

donde \(\ell\) indica liga o torneo.

Así, las ligas o torneos tienen interceptos distintos, pero comparten información.

Esto es útil porque el comportamiento del mercado, la frecuencia del empate o el peso de la localía puede variar entre contextos.

---

## 17. Dinámica temporal

Las variables deportivas son temporales. Conviene usar ponderación por recencia.

Por ejemplo:

\[
Forma_i(t)=\sum_{s=1}^{K} w_s \cdot R_i(t-s)
\]

con pesos decrecientes:

\[
w_s = \frac{e^{-\lambda s}}{\sum_{r=1}^{K} e^{-\lambda r}}
\]

Esto puede aplicarse a:

- forma reciente,
- xG reciente,
- lesiones,
- presión,
- ratings.

---

## 18. Validación matemática y estadística

Un modelo formal no se sostiene solo por tener fórmula. Debe validarse.

## 18.1 Calibración

Si predice una probabilidad \(0.70\), debería ocurrir aproximadamente el 70% de las veces.

### Brier score
\[
BS = \frac{1}{N}\sum_{n=1}^N (\hat p_n - y_n)^2
\]

### Log loss
\[
LL = -\frac{1}{N}\sum_{n=1}^N \left[y_n\log \hat p_n + (1-y_n)\log(1-\hat p_n)\right]
\]

## 18.2 Rentabilidad

### ROI
\[
ROI = \frac{\text{ganancia neta}}{\text{stake total}}
\]

### Yield
\[
Yield = \frac{\text{beneficio total}}{\text{número de apuestas}}
\]

### Closing line value
Comparar el precio tomado con el cierre de mercado.

La literatura remarca que buena precisión no equivale automáticamente a buena rentabilidad [(Zimmermann, 2024)](https://consensus.app/papers/learning-predictive-models-for-match-outcomes-in-us-sports-zimmermann/70376aa915a15b3e8045e293a75d1b87/?utm_source=chatgpt), [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt).

---

## 19. Regla final de decisión de apuesta

Una formulación general sería:

Sea un conjunto de mercados \(A_1,\dots,A_J\).

Para cada mercado \(A_j\), calcular:

\[
\hat p_j = Pr(A_j \mid X)
\]

\[
EV_j = \hat p_j o_j - 1
\]

\[
R_j = f(\text{riesgo, varianza, calibración histórica})
\]

Entonces la utilidad de apuesta podría ser:

\[
U_j = EV_j - \lambda_R R_j
\]

y se apuesta solo si:

\[
U_j > \tau
\]

con \(\tau\) umbral.

Esto ya convierte el sistema en una regla de decisión formal.

---

## 20. Kelly criterion como extensión de stake sizing

Si se desea optimizar fracción apostada:

Sea \(b = o_j - 1\), \(p=\hat p_j\), \(q=1-p\).

Entonces la fracción de Kelly es:

\[
f^* = \frac{bp-q}{b}
\]

En la práctica podría usarse:

- Kelly fraccional,
- medio Kelly,
- cuarto Kelly,

para controlar volatilidad.

---

## 21. Qué modelo elegir

## Opción A: logística / softmax
Mejor si quieres simplicidad, interpretabilidad y una primera versión estable.

## Opción B: Poisson / Bivariate Poisson
Mejor si quieres derivar muchos mercados desde una estructura futbolera coherente.

## Opción C: modelo híbrido
Primero Poisson o rating para el partido, luego una segunda capa para edge de mercado.

La literatura reciente en fútbol muestra buenos resultados con modelos híbridos y combinaciones de ratings + ML [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt), [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt), [(Bunker et al., 2024)](https://consensus.app/papers/machine-learning-for-soccer-match-result-prediction-bunker-yeung/f5f054ca137f55e8ac663427938bdbb0/?utm_source=chatgpt).

---

## 22. Formulación recomendada final

Si el objetivo es mantener tu intuición pero llevarla a una forma rigurosa, la formulación recomendada sería:

## 22.1 Capa de intensidades

\[
\lambda_L = \exp(\theta_0 + \theta_E^\top E_L + \theta_P^\top P_L + \theta_C^\top C_L - \theta_D^\top D_V)
\]

\[
\lambda_V = \exp(\phi_0 + \phi_E^\top E_V + \phi_P^\top P_V + \phi_C^\top C_V - \phi_D^\top D_L)
\]

donde \(D_i\) representa la fortaleza defensiva del equipo \(i\).

## 22.2 Goles

\[
G_L \sim Poisson(\lambda_L), \qquad G_V \sim Poisson(\lambda_V)
\]

## 22.3 Mercados

\[
\hat p_{1X2}, \hat p_{OU}, \hat p_{BTTS}, \hat p_{CS}
\]

derivados de la distribución conjunta.

## 22.4 Capa de mercado

\[
Edge_j = \hat p_j - \tilde p_j^{imp}
\]

y eventualmente:

\[
Edge_j^{adj} = Edge_j + \omega^\top W_j
\]

donde \(W_j\) incluye sesgo público, popularidad, sobre-reacción, line movement, etc.

## 22.5 Regla final

\[
Apostar(A_j)=\mathbf{1}(U_j>\tau)
\]

con

\[
U_j = EV_j - \lambda_R R_j
\]

---

## 23. Veredicto matemático final

Sí, el modelo **sí se puede sostener matemáticamente**.

Pero la forma más defendible no es una suma arbitraria de scores con boost multiplicativo, sino una formulación como:

- **score latente + logística**, o
- **goles esperados + Poisson**, o
- **modelo híbrido partido + mercado**.

La gran idea de tu enfoque —mezclar fútbol, psicología y apuestas— sí puede formalizarse. La clave es:

1. definir bien las variables,
2. darles una función probabilística,
3. estimar parámetros con datos,
4. separar partido real de sesgo de mercado,
5. y validar calibración y rentabilidad.

---

## 24. Fuentes clave citadas

- [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt)
- [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt)
- [(Groll et al., 2015)](https://consensus.app/papers/prediction-of-major-international-soccer-tournaments-groll-schauberger/ebdde05a48be523bb7d5ceb73719d46c/?utm_source=chatgpt)
- [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt)
- [(Bunker et al., 2024)](https://consensus.app/papers/machine-learning-for-soccer-match-result-prediction-bunker-yeung/f5f054ca137f55e8ac663427938bdbb0/?utm_source=chatgpt)
- [(Yang, 2021)](https://consensus.app/papers/predict-soccer-match-outcome-based-on-player-performance-yang/0894d3dd650755caad6d2a97863af884/?utm_source=chatgpt)
- [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt)
- [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt)
- [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt)
- [(Wunderlich & Memmert, 2016)](https://consensus.app/papers/analysis-of-the-predictive-qualities-of-betting-odds-and-wunderlich-memmert/a4d8f53026035f0da8f8958adc0f865b/?utm_source=chatgpt)
- [(Ley et al., 2017)](https://consensus.app/papers/ranking-soccer-teams-on-basis-of-their-current-strength-a-ley-wiele/05a25fc33779551eb0ff507f3ad321df/?utm_source=chatgpt)
- [(Feddersen et al., 2021)](https://consensus.app/papers/contest-incentives-team-effort-and-betting-market-feddersen-humphreys/3a146fb469135d92860e60e457f284ec/?utm_source=chatgpt)
- [(Csató et al., 2022)](https://consensus.app/papers/tournament-schedules-and-incentives-in-a-double-csato-molontay/3a2b83166b3958518819fd884c679276/?utm_source=chatgpt)
- [(Lenten et al., 2013)](https://consensus.app/papers/policy-timing-and-footballers-incentives-lenten-libich/9e13e5adadc95b6b93ea45e915cad4d7/?utm_source=chatgpt)
- [(Pettersen et al., 2023)](https://consensus.app/papers/beyond-physical-abilitypredicting-womens-football-pettersen-martinussen/127dbbf65654595c9e35841d9a7f49a8/?utm_source=chatgpt)
- [(Pettersen et al., 2021)](https://consensus.app/papers/psychological-factors-and-performance-in-womens-football-pettersen-adolfsen/650e9080f3075ff282c4fa25fde747a8/?utm_source=chatgpt)
- [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt)
- [(Engan & Sæther, 2018)](https://consensus.app/papers/goal-orientations-motivational-climate-and-stress-engan-sther/31678cc4dc7052ae9a103d595bcf019d/?utm_source=chatgpt)
- [(Olmedilla et al., 2019)](https://consensus.app/papers/psychological-intervention-program-to-control-stress-in-olmedilla-moreno-fernndez/5b48a89f076b5dbba5c6475ee4a70c42/?utm_source=chatgpt)
- [(Rausch et al., 2026)](https://consensus.app/papers/rethinking-performance-crises-in-professional-soccer-rausch-fritsch/539e5ea914b05e53910514fe53f2e83d/?utm_source=chatgpt)
- [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt)
- [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt)
- [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt)


## 24.1 Cierre metodológico sobre scraping y error de medición

Dado que estos documentos serán base del modelo, debe quedar asentado que la capa psicológica y parte de la capa contextual se alimentan de **señales scrapeadas**. Matemáticamente eso implica:

1. observación indirecta del constructo;
2. presencia de error de medición;
3. heterogeneidad de calidad entre fuentes;
4. necesidad de modelar confiabilidad de extracción;
5. y conveniencia de separar señales que explican:
   - el partido,
   - la narrativa,
   - y el mercado.

Formalmente, una buena práctica sería almacenar cada variable scrapeada como una tupla:

\[
(\text{valor}, \text{tipo\_de\_proxy}, \text{confianza}, \text{fuente}, \text{timestamp})
\]

Esto mejora la trazabilidad y, en futuras versiones, permitiría ponderación bayesiana, filtros por calidad de fuente o modelos con error en variables.

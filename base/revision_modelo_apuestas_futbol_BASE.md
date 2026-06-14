# Revisión hiper completa del modelo de predicción y apuestas

Base revisada: archivo del usuario `modelo.js`.  
Referencia al archivo original en la conversación: fileciteturn0file0

---

## 1. Aclaración sobre la variable de los hinchas y las cuotas

Sí, la variable a la que me refería era algo como:

- **sesgo de hincha**
- **identidad con el equipo**
- **favoritismo público**
- **public betting bias**
- **fan identity-based bias**

La idea es esta:

> No siempre afecta directamente el rendimiento real del equipo, pero **sí puede afectar la forma en que apostadores y mercado valoran al equipo**, y por eso puede distorsionar la cuota.

Eso aparece muy claro en estudios donde los aficionados **sobreestiman a su equipo favorito**, sesgan sus predicciones y reducen su precisión [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt). También se relaciona con la **ilusión de control** y la creencia de que ser “experto” o muy conocedor del fútbol mejora mucho la capacidad de acertar apuestas, algo que no quedó respaldado en la evidencia [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt). A eso se suman sesgos como la **sobreconfianza** y la **conjunction fallacy** en apuestas futboleras [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt).

### Cómo se traduce al modelo

Esta variable **no debería entrar principalmente como predictor del partido**, sino como predictor de **desajuste de mercado**:

- equipo con mucha masa de hinchas
- club o selección muy popular
- narrativa pública muy favorable
- sobre-reacción a una racha reciente
- favoritismo emocional del mercado

Eso encaja con trabajos sobre **sobre-reacción de cuotas** y sesgos del mercado [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt), además del uso de cuotas como condensado de información colectiva [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt).

**Nombre recomendado para esa variable/capa:**

- `sesgo_publico`
- `sesgo_hincha_mercado`
- `fan_bias_market`
- `market_popularity_bias`

---


## 1.1 Naturaleza real de las variables psicológicas: son proxies scrapeadas, no mediciones directas

En este proyecto, las llamadas “variables psicológicas” **no provienen de instrumentos psicométricos directos**, sino de **web scraping** y extracción de señales desde:

- noticias,
- entrevistas,
- titulares,
- declaraciones,
- contexto de torneo,
- alineaciones y ausencias,
- narrativa mediática,
- y otras fuentes públicas.

Por tanto, metodológicamente **no deben tratarse como mediciones psicológicas puras**, sino como:

- **proxies psicodeportivas del equipo**,
- **proxies narrativas públicas**,
- **proxies mediáticas**,
- y, en muchos casos, **proxies de sesgo de mercado**.

Esto implica que una variable scrapeada puede reflejar al menos tres mecanismos distintos:

### A. Estado real del equipo
Ejemplos:
- conflicto interno,
- presión competitiva,
- liderazgo,
- necesidad de ganar,
- estabilidad del grupo.

Estas señales pueden contribuir a predecir el partido.

### B. Narrativa pública
Ejemplos:
- venganza,
- humillación previa,
- generación dorada,
- partido de vida o muerte.

Estas señales no siempre predicen bien el rendimiento real, pero sí pueden capturar el entorno simbólico del partido.

### C. Sesgo del mercado
Ejemplos:
- favoritismo público,
- identidad de hincha,
- hype mediático,
- sobre-reacción a una racha.

Estas señales pueden afectar más la **cuota** que el rendimiento real del equipo [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt), [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt), [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt), [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt).

### Consecuencia metodológica central

No conviene meter todas las variables scrapeadas dentro de una sola bolsa llamada “psicología”.  
Conviene clasificarlas explícitamente como:

- `team_performance_proxy`
- `psychological_proxy`
- `media_narrative_proxy`
- `market_bias_proxy`
- `contextual_proxy`

### Recomendación práctica de modelado

Toda variable scrapeada debería guardar, además de su valor, dos metadatos:

1. **tipo de proxy**  
2. **confianza de extracción**

Por ejemplo:

- `presion_mediatica = 0.78`
- `tipo = media_narrative_proxy`
- `confianza_scraping = 0.61`

Esto permitiría ponderar mejor su uso en el modelo.


## 2. Diagnóstico general del modelo

Tu modelo tiene una estructura potente:

1. score estadístico  
2. score psicológico  
3. boost contextual / mundialista  
4. total por equipo  
5. traducción a mercados de apuesta  

Esa arquitectura es valiosa porque separa **fuerza futbolística**, **contexto psicodeportivo** y **decisión de mercado**. La literatura sí respalda que pronosticar bien un partido no es exactamente lo mismo que encontrar una apuesta rentable [(Zimmermann, 2024)](https://consensus.app/papers/learning-predictive-models-for-match-outcomes-in-us-sports-zimmermann/70376aa915a15b3e8045e293a75d1b87/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt).

### Juicio general

- **La idea de fondo es buena y defendible.**
- **La capa estadística está bien encaminada.**
- **La capa psicológica tiene intuiciones buenas, pero mezcla variables fuertes con variables demasiado narrativas.**
- **El boost mundialista tiene lógica, pero hoy es más heurístico que validado.**
- **Lo que más te falta es una capa de mercado con odds reales.**
- **También te falta validación empírica fuerte de pesos, umbrales y probabilidades.**

---

## 3. Matriz completa variable por variable

## 3.1 Bloque estadístico principal

### `xg_promedio`
**Función actual:** base ofensiva principal del score estadístico.  
**Estado:** mantener.  
**Respaldo:** muy sólido. La literatura de predicción moderna valora variables informativas de rendimiento más allá de goles simples [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt), [(Bunker et al., 2024)](https://consensus.app/papers/machine-learning-for-soccer-match-result-prediction-bunker-yeung/f5f054ca137f55e8ac663427938bdbb0/?utm_source=chatgpt).  
**Problema actual:** usas un promedio normalizado a mano.  
**Recomendación:** mantenerlo, pero separarlo en:
- xG a favor
- xG en contra
- xG local/visitante
- xG reciente vs temporada

### `puntos_ultimos7`
**Función actual:** forma reciente.  
**Estado:** mantener, pero reformular.  
**Respaldo:** la forma reciente sí importa, pero las rachas pueden inducir sobre-reacción [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt).  
**Problema actual:** no ajusta por calidad del rival ni por local/visita.  
**Recomendación:** usar:
- puntos recientes ajustados por rival
- xG reciente ajustado por rival
- rendimiento real menos rendimiento esperado

### `h2h_victorias`
**Función actual:** head-to-head histórico.  
**Estado:** reformular fuerte o bajar peso.  
**Respaldo:** débil y muy contextual.  
**Problema actual:** puede arrastrar historias viejas que ya no explican el presente.  
**Recomendación:** si se usa, que sea:
- solo últimos 2–4 enfrentamientos
- solo si la base de plantillas/DT sigue parecida
- o reemplazarlo por “compatibilidad táctica reciente”

### `corners_promedio`
**Función actual:** entra al score principal y además alimenta mercados secundarios.  
**Estado:** mantener, pero moverlo de jerarquía.  
**Respaldo:** útil sobre todo para mercados específicos.  
**Problema actual:** puede contaminar demasiado el score central del ganador.  
**Recomendación:** usarlo más como predictor de:
- corners
- presión ofensiva
- over de volumen ofensivo  
y no como componente muy pesado del ganador.

### `goles_concedidos_promedio`
**Función actual:** proxy defensivo.  
**Estado:** mantener.  
**Respaldo:** sólido; defensa esperada es clave para 1X2 y mercados de goles [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt).  
**Problema actual:** promedio crudo.  
**Recomendación:** partirlo en:
- goles recibidos
- xGA si puedes
- concedidos local/visitante
- concedidos recientes

### `lesiones_impacto`
**Función actual:** penalización al score.  
**Estado:** mantener y ampliar.  
**Respaldo:** las ausencias de jugadores importan mucho y los papers de player characteristics y player performance las vuelven plausibles [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt), [(Yang, 2021)](https://consensus.app/papers/predict-soccer-match-outcome-based-on-player-performance-yang/0894d3dd650755caad6d2a97863af884/?utm_source=chatgpt).  
**Problema actual:** está muy comprimido en una sola variable.  
**Recomendación:** dividir en:
- ausencias ofensivas
- ausencias defensivas
- ausencias del arquero
- minutos perdidos esperados
- titular clave sí/no

---

## 3.2 Variables estadísticas faltantes que deberías añadir

### `rating_equipo`
**Estado:** añadir sí o sí.  
**Respaldo:** modelos ELO, Poisson, pi-ratings y rankings de fuerza mejoran mucho robustez [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt), [(Ley et al., 2017)](https://consensus.app/papers/ranking-soccer-teams-on-basis-of-their-current-strength-a-ley-wiele/05a25fc33779551eb0ff507f3ad321df/?utm_source=chatgpt), [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt).  
**Recomendación:** incorporar un rating estructural del equipo y que no todo dependa de promedios cortos.

### `calidad_rival_reciente`
**Estado:** añadir.  
**Respaldo:** forma sin calidad de rival es frágil.  
**Recomendación:** calcular la forma ajustada por nivel de oposición.

### `fatiga_calendario`
**Estado:** añadir.  
**Respaldo:** calendario, parones e interrupciones alteran equilibrio y rendimiento [(Pérez, 2023)](https://consensus.app/papers/on-the-design-of-international-match-calendar-the-effect-of-prez/137a371120c6560b99cd85499becc802/?utm_source=chatgpt), [(Thiem, 2020)](https://consensus.app/papers/spillover-effects-in-contests-with-heterogeneous-players-thiem/c38a0e9e3f4a5dbbbc83cbd80f1b8eb9/?utm_source=chatgpt).  
**Recomendación:** días de descanso, viajes, partido anterior exigente, acumulación reciente.

### `ataque_esperado` y `defensa_esperada`
**Estado:** añadir.  
**Respaldo:** mejor que comprimir todo en una sola nota 1–10.  
**Recomendación:** modelar por separado producción ofensiva y concesión defensiva.

---

## 3.3 Bloque psicológico actual

**Advertencia metodológica:** en este documento, el bloque psicológico debe entenderse como un bloque de **proxies psicodeportivas scrapeadas**, no como mediciones clínicas o psicométricas directas.


### `necesita_ganar`
**Función actual:** suma presión/incentivo.  
**Estado:** mantener y ampliar.  
**Respaldo:** muy fuerte. Incentivos competitivos afectan esfuerzo, comportamiento táctico y cuotas [(Feddersen et al., 2021)](https://consensus.app/papers/contest-incentives-team-effort-and-betting-market-feddersen-humphreys/3a146fb469135d92860e60e457f284ec/?utm_source=chatgpt), [(Csató et al., 2022)](https://consensus.app/papers/tournament-schedules-and-incentives-in-a-double-csato-molontay/3a2b83166b3958518819fd884c679276/?utm_source=chatgpt).  
**Recomendación:** convertirla en una mini capa:
- debe ganar sí o sí
- empate sirve
- ya clasificado
- ya eliminado
- rival directo
- diferencia de goles relevante

### `venganza_narrativa`
**Estado:** reformular o sacar.  
**Respaldo:** muy débil como variable objetiva.  
**Problema:** demasiado subjetiva.  
**Recomendación:** reemplazar por algo medible como:
- revancha con antecedente reciente y mismo núcleo competitivo
- o directamente no usarla en modelo principal

### `rival_maldito`
**Estado:** reformular o sacar.  
**Respaldo:** escaso como predictor formal.  
**Problema:** narrativa difícil de operacionalizar.  
**Recomendación:** si quieres conservar algo parecido, usar “desempeño consistentemente inferior al esperado contra este estilo/rival” en vez de “maldición”.

### `presion_mediatica`
**Estado:** mantener, pero con proxy observable.  
**Respaldo:** el estrés, la presión y el escrutinio externo importan en fútbol de alto nivel [(Smith et al., 2020)](https://consensus.app/papers/stress-burnout-and-perfectionism-in-soccer-players-smith-hill/fed87a6d1bbc57338cf3e1e762e1f7b1/?utm_source=chatgpt), [(Olmedilla et al., 2019a)](https://consensus.app/papers/psychological-intervention-program-to-control-stress-in-olmedilla-moreno-fernndez/5b48a89f076b5dbba5c6475ee4a70c42/?utm_source=chatgpt).  
**Recomendación:** construirla con:
- racha negativa
- críticas públicas recientes
- situación de DT
- instancia del torneo
- expectativa nacional o de prensa

### `lider_disponible`
**Estado:** mantener.  
**Respaldo:** liderazgo, cohesión y entorno de equipo sí importan [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt), [(Di Corrado & Tušak, 2026)](https://consensus.app/papers/editorial-determinants-of-achievement-in-top-sport-corrado-tuak/6fdbeb1187a25d888eca88d5848275c6/?utm_source=chatgpt).  
**Recomendación:** ampliar a:
- capitán disponible
- arquero líder disponible
- DT estable
- eje defensivo estable

### `conflicto_interno`
**Estado:** mantener, pero con mejor medición.  
**Respaldo:** cohesión y estabilidad organizacional son relevantes [(Rausch et al., 2026)](https://consensus.app/papers/rethinking-performance-crises-in-professional-soccer-rausch-fritsch/539e5ea914b05e53910514fe53f2e83d/?utm_source=chatgpt), [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt).  
**Recomendación:** construir con proxies:
- cambio reciente de DT
- sanción interna
- conflicto prensa-vestuario
- fractura dirigencia-plantel
- derrota + declaraciones públicas tensas

### `generacion_peak`
**Estado:** reformular.  
**Respaldo:** escaso en la forma actual.  
**Recomendación:** convertirlo en:
- pico generacional medido por edad óptima + continuidad + experiencia compartida
- o “ventana competitiva” del plantel

### `underdog`
**Estado:** mantener solo como contexto, no como premio automático.  
**Respaldo:** el efecto underdog puede existir, pero debe diferenciarse del sesgo del mercado y de la narrativa.  
**Recomendación:** usarlo junto con:
- gap de fuerza
- incentivo real
- precio de mercado
- contexto de torneo

### `clasifico_sufriendo`
**Estado:** reformular.  
**Problema:** mezcla resiliencia con desgaste y puede apuntar a dos direcciones opuestas.  
**Recomendación:** separar en:
- resiliencia competitiva
- desgaste acumulado
- clasificación dramática reciente

### `humillacion_previa`
**Estado:** reformular.  
**Respaldo:** puede ser proxy de presión o reacción emocional, pero también gatilla sobre-reacción pública.  
**Recomendación:** no usarla como suma o resta simple; úsala como bandera contextual que interactúe con mercado y presión.

---

## 3.4 Variables psicológicas faltantes que deberías añadir

### `cohesion_equipo`
**Respaldo:** la cohesión aparece de forma repetida en la literatura de rendimiento y entorno [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt), [(Sansone et al., 2024)](https://consensus.app/papers/editorial-multidisciplinary-perspectives-on-team-sports-sansone-rago/8fc9d8e51f3a5870ab909f5f3d095054/?utm_source=chatgpt), [(Zhao et al., 2025)](https://consensus.app/papers/the-relationship-between-soccer-participation-and-team-zhao-che/75b16b1e3f145cc7b770ef944051623b/?utm_source=chatgpt).  
**Proxies sugeridos:**
- continuidad del once
- continuidad del DT
- pocos cambios forzados
- estabilidad institucional
- ausencia de conflicto público

### `estres_competitivo`
**Respaldo:** fuerte [(Olmedilla et al., 2019a)](https://consensus.app/papers/psychological-intervention-program-to-control-stress-in-olmedilla-moreno-fernndez/5b48a89f076b5dbba5c6475ee4a70c42/?utm_source=chatgpt), [(Engan & Sæther, 2018)](https://consensus.app/papers/goal-orientations-motivational-climate-and-stress-engan-sther/31678cc4dc7052ae9a103d595bcf019d/?utm_source=chatgpt), [(Smith et al., 2020)](https://consensus.app/papers/stress-burnout-and-perfectionism-in-soccer-players-smith-hill/fed87a6d1bbc57338cf3e1e762e1f7b1/?utm_source=chatgpt).  
**Proxies sugeridos:**
- partido decisivo
- racha mala
- presión sobre el DT
- rivalidad fuerte
- entorno mediático tenso

### `motivacion_y_autoeficacia`
**Respaldo:** alto; el clima motivacional y ciertas formas de confianza sí importan [(Pettersen et al., 2023)](https://consensus.app/papers/beyond-physical-abilitypredicting-womens-football-pettersen-martinussen/127dbbf65654595c9e35841d9a7f49a8/?utm_source=chatgpt), [(Di Corrado & Tušak, 2026)](https://consensus.app/papers/editorial-determinants-of-achievement-in-top-sport-corrado-tuak/6fdbeb1187a25d888eca88d5848275c6/?utm_source=chatgpt).  
**Recomendación:** no meter “mental toughness” genérica como variable reina; la evidencia reciente sugiere que algunos climas motivacionales son más útiles que constructos más vagos.

### `fatiga_mental_recuperacion`
**Respaldo:** estrés, sobreentrenamiento y recuperación se relacionan con motivación y rendimiento [(Fagundes et al., 2021)](https://consensus.app/papers/monitoring-of-overtraining-and-motivation-in-elite-soccer-fagundes-costa/95f2a3177b165ea2b71db22f796dee51/?utm_source=chatgpt).  
**Recomendación:** agregar:
- descanso mental
- congestión de partidos
- recuperación corta
- viaje

---

## 3.5 Localía, estadio y altitud

### `tipoLocalidad`
**Estado:** mantener, pero mover a bloque contextual-físico.  
**Problema:** no es solo psicológico.  
**Recomendación:** usarlo como parte del bloque de entorno competitivo.

### `ESTADIOS_ALTITUD`
**Estado:** mantener.  
**Respaldo:** muy razonable como variable contextual-física.  
**Problema:** en tu modelo está dentro del score psico, cuando en realidad es más bien fisiológica y contextual.  
**Recomendación:** moverla a bloque `contexto_fisico`.

---

## 3.6 Boost mundialista

### `calcularBoost(rankingFIFA, jornada)`
**Estado:** mantener como idea, reconstruir como implementación.  
**Respaldo indirecto:** la literatura sí respalda:
- incentivos de torneo
- stake del partido
- estructura de grupos
- fuerza relativa
- importancia del contexto internacional [(Feddersen et al., 2021)](https://consensus.app/papers/contest-incentives-team-effort-and-betting-market-feddersen-humphreys/3a146fb469135d92860e60e457f284ec/?utm_source=chatgpt), [(Csató et al., 2022)](https://consensus.app/papers/tournament-schedules-and-incentives-in-a-double-csato-molontay/3a2b83166b3958518819fd884c679276/?utm_source=chatgpt), [(Wunderlich & Memmert, 2016)](https://consensus.app/papers/analysis-of-the-predictive-qualities-of-betting-odds-and-wunderlich-memmert/a4d8f53026035f0da8f8958adc0f865b/?utm_source=chatgpt), [(Groll et al., 2015)](https://consensus.app/papers/prediction-of-major-international-soccer-tournaments-groll-schauberger/ebdde05a48be523bb7d5ceb73719d46c/?utm_source=chatgpt).  
**Lo débil:** no encontré validación directa para:
- boost automático al peor ranking
- fórmula decreciente por jornada
- multiplicar el total final entero

### Rediseño recomendado
Renombrarlo a:

- `ajuste_contexto_torneo`

Y separarlo en:
- `ajuste_incentivo_clasificacion`
- `ajuste_gap_fuerza`
- `ajuste_fase_torneo`
- `ajuste_partido_stakeless`
- `ajuste_gap_ranking`

Usarlo como:
- feature adicional
- o ajuste del bloque contextual/psicológico  
pero no como multiplicador bruto de todo.

---

## 3.7 Variables de mercado: lo que hoy más te falta

Este es el gran vacío del modelo.

### `odds_reales`
**Estado:** añadir sí o sí.  
**Respaldo:** fortísimo. Las cuotas condensan información muy valiosa y suelen ser benchmark serio [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt), [(Wunderlich & Memmert, 2016)](https://consensus.app/papers/analysis-of-the-predictive-qualities-of-betting-odds-and-wunderlich-memmert/a4d8f53026035f0da8f8958adc0f865b/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt).  
**Recomendación:** tener opening y closing odds.

### `probabilidad_implicita`
**Estado:** añadir.  
**Función:** comparar tu modelo contra la cuota real.

### `line_movement`
**Estado:** añadir.  
**Función:** detectar información nueva o sesgo del mercado.

### `dispersion_casas`
**Estado:** añadir.  
**Función:** medir incertidumbre y consenso real del mercado.

### `edge_modelo_vs_mercado`
**Estado:** añadir.  
**Función:** esta debería ser la verdadera llave de recomendación.

---

## 3.8 Psicología del apostador / mercado

Este bloque hoy no está separado en tu modelo, y debería estarlo.

### `sesgo_hincha_mercado`
**Estado:** añadir.  
**Respaldo:** los hinchas sobreestiman a su equipo favorito y reducen precisión [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt).  
**Uso correcto:** no como predictor principal del partido, sino como predictor de cuota inflada o valor distorsionado.

### `ilusion_control_expertise`
**Estado:** añadir como concepto de capa de mercado.  
**Respaldo:** la expertise percibida no necesariamente mejora la capacidad predictiva [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt).  
**Uso correcto:** detectar zonas donde el mercado puede “creerse demasiado” una narrativa.

### `sobreconfianza_apostadora`
**Estado:** añadir como concepto.  
**Respaldo:** sobreconfianza y conjunction fallacy sí aparecen en apuestas futboleras [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt).  
**Uso correcto:** vigilar mercados complejos, narrativas demasiado seductoras y combinadas.

### `sobre_reaccion_racha`
**Estado:** añadir sí o sí.  
**Respaldo:** evidencia directa de sobre-reacción de odds a rachas recientes [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt).  
**Uso correcto:** si un equipo viene “demasiado bien” o “demasiado mal”, revisar si el mercado ya exageró.

---

## 3.9 Mercados de apuesta actuales

### Ganador directo
**Estado:** mantener, pero endurecer umbrales.  
**Problema:** necesita mejor calibración de probabilidad real.

### Doble oportunidad
**Estado:** mantener.  
**Valor:** muy útil cuando hay ventaja moderada y contexto incierto.

### Hándicap underdog
**Estado:** mantener.  
**Valor:** muy coherente con tu filosofía de corregir favoritismos sobreestimados.

### Over/Under goles
**Estado:** mantener y priorizar.  
**Valor:** probablemente de tus mercados mejor sustentados porque derivan de xG, goles y defensa.

### Ambos anotan
**Estado:** mantener.  
**Mejora:** calibrarlo mejor con xG de ambos, no solo goles promedio.

### Corners / tiros / tarjetas
**Estado:** mantener, pero preferir modelos más específicos por mercado.  
**Problema:** no conviene que dependan demasiado del score general.

### Marcador exacto
**Estado:** mantener solo como mercado de altísimo riesgo.  
**Problema:** muy sensible a errores de calibración.

---

## 4. Problema metodológico central: las probabilidades de mercado

Tu modelo hoy arma probabilidades con reglas expertas y luego calcula EV con una cuota estimada por ti. Eso sirve como prototipo, pero no como evaluación fuerte de valor.

La secuencia correcta sería:

1. estimar probabilidad del evento  
2. tomar cuota real del mercado  
3. remover margen si corresponde  
4. comparar tu probabilidad vs probabilidad implícita  
5. apostar solo si hay edge real y validado históricamente

Esto es consistente con la literatura de apuestas y forecasting [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt), [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt).

---

## 5. Validación: qué falta medir

Hoy te falta una batería seria de validación.

### Métricas recomendadas
- accuracy 1X2
- Brier score
- log loss
- calibration curve
- ROI por mercado
- yield
- drawdown
- closing line value
- robustez por liga y temporada

### Por qué importa
Porque varios papers dejan claro que:
- acertar más no siempre es ganar más
- una alta accuracy no garantiza rentabilidad
- el mercado ya incorpora mucha información [(Zimmermann, 2024)](https://consensus.app/papers/learning-predictive-models-for-match-outcomes-in-us-sports-zimmermann/70376aa915a15b3e8045e293a75d1b87/?utm_source=chatgpt), [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt), [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt).

---

## 6. Rediseño ideal del modelo

## Capa 1. Fuerza futbolística base
- ataque esperado
- defensa esperada
- rating del equipo
- forma ajustada por rival
- lesiones / ausencias
- localía / altitud / fatiga

## Capa 2. Contexto psicodeportivo del equipo
- incentivo competitivo real
- cohesión y estabilidad
- estrés / presión
- liderazgo
- recuperación / carga mental

## Capa 3. Contexto de torneo
- fase del torneo
- stake del partido
- stakelessness
- gap de fuerza
- situación exacta de clasificación

## Capa 4. Mercado
- opening odds
- closing odds
- probabilidad implícita
- movimiento de línea
- dispersión entre casas
- sesgo público / sesgo hincha
- sobre-reacción a rachas

## Capa 5. Selector de apuestas
- edge real
- filtro por calibración histórica
- filtro por mercado
- stake sizing
- control de riesgo

---

## 7. Resumen ejecutivo final

### Lo que está bien y debes mantener
- estructura general del modelo
- uso de xG
- defensa, lesiones y forma
- intento de modelar psicología
- uso de incentivos y contexto
- traducción a mercados en vez de solo 1X2

### Lo que debes corregir
- pesos fijos sin calibración
- varias variables narrativas
- boost mundialista como multiplicador bruto
- probabilidades heurísticas por mercado
- EV sin odds reales

### Lo que debes añadir sí o sí
- odds reales
- implied probabilities
- line movement
- rating de equipo
- calidad del rival
- fatiga/calendario
- cohesión/estabilidad
- sesgo de hincha / sesgo del mercado
- sobre-reacción a rachas
- validación robusta

### Veredicto final
Tu modelo **sí está bien orientado conceptualmente**. No es una mala idea ni un invento sin base. Al contrario: va en una dirección interesante que la literatura todavía no integra del todo. Pero hoy sigue siendo más un **modelo experto-heurístico prometedor** que un sistema empíricamente calibrado y validado.

La mejora más grande no está en cambiar la intuición, sino en:
- medir mejor lo psicológico,
- separar rendimiento real de sesgo de mercado,
- y meter odds reales como benchmark obligatorio.

---

## 8. Fuentes clave citadas

- [(Rodrigues & Pinto, 2022)](https://consensus.app/papers/prediction-of-football-match-results-with-machine-rodrigues-pinto/e77f38a2efb55bcdbb5bac49763b4f58/?utm_source=chatgpt)
- [(Stübinger et al., 2019)](https://consensus.app/papers/machine-learning-in-football-betting-prediction-of-match-stbinger-mangold/e33b4fe61b405ad0b0553e2ee62654ee/?utm_source=chatgpt)
- [(Wheatcroft, 2020a)](https://consensus.app/papers/profiting-from-overreaction-in-soccer-betting-odds-wheatcroft/f3bc15c70f265a1293bc1b4005aaea1d/?utm_source=chatgpt)
- [(Wheatcroft, 2020b)](https://consensus.app/papers/forecasting-football-matches-by-predicting-match-wheatcroft/9627a9ec743a5fbab9afaaf46b17b3ad/?utm_source=chatgpt)
- [(Wunderlich & Memmert, 2018)](https://consensus.app/papers/the-betting-odds-rating-system-using-soccer-forecasts-to-wunderlich-memmert/6fe6f0d52ca75981938e0b61322cebd7/?utm_source=chatgpt)
- [(Wunderlich & Memmert, 2016)](https://consensus.app/papers/analysis-of-the-predictive-qualities-of-betting-odds-and-wunderlich-memmert/a4d8f53026035f0da8f8958adc0f865b/?utm_source=chatgpt)
- [(Groll et al., 2015)](https://consensus.app/papers/prediction-of-major-international-soccer-tournaments-groll-schauberger/ebdde05a48be523bb7d5ceb73719d46c/?utm_source=chatgpt)
- [(Groll et al., 2019)](https://consensus.app/papers/a-hybrid-random-forest-to-predict-soccer-matches-in-groll-ley/6a0ed6d08ea75ca6924bbc55ae820df6/?utm_source=chatgpt)
- [(Bunker et al., 2024)](https://consensus.app/papers/machine-learning-for-soccer-match-result-prediction-bunker-yeung/f5f054ca137f55e8ac663427938bdbb0/?utm_source=chatgpt)
- [(Yang, 2021)](https://consensus.app/papers/predict-soccer-match-outcome-based-on-player-performance-yang/0894d3dd650755caad6d2a97863af884/?utm_source=chatgpt)
- [(Feddersen et al., 2021)](https://consensus.app/papers/contest-incentives-team-effort-and-betting-market-feddersen-humphreys/3a146fb469135d92860e60e457f284ec/?utm_source=chatgpt)
- [(Csató et al., 2022)](https://consensus.app/papers/tournament-schedules-and-incentives-in-a-double-csato-molontay/3a2b83166b3958518819fd884c679276/?utm_source=chatgpt)
- [(Pérez, 2023)](https://consensus.app/papers/on-the-design-of-international-match-calendar-the-effect-of-prez/137a371120c6560b99cd85499becc802/?utm_source=chatgpt)
- [(Thiem, 2020)](https://consensus.app/papers/spillover-effects-in-contests-with-heterogeneous-players-thiem/c38a0e9e3f4a5dbbbc83cbd80f1b8eb9/?utm_source=chatgpt)
- [(Pettersen et al., 2023)](https://consensus.app/papers/beyond-physical-abilitypredicting-womens-football-pettersen-martinussen/127dbbf65654595c9e35841d9a7f49a8/?utm_source=chatgpt)
- [(Pettersen et al., 2021)](https://consensus.app/papers/psychological-factors-and-performance-in-womens-football-pettersen-adolfsen/650e9080f3075ff282c4fa25fde747a8/?utm_source=chatgpt)
- [(Olmedilla et al., 2019a)](https://consensus.app/papers/psychological-intervention-program-to-control-stress-in-olmedilla-moreno-fernndez/5b48a89f076b5dbba5c6475ee4a70c42/?utm_source=chatgpt)
- [(Engan & Sæther, 2018)](https://consensus.app/papers/goal-orientations-motivational-climate-and-stress-engan-sther/31678cc4dc7052ae9a103d595bcf019d/?utm_source=chatgpt)
- [(Pain & Harwood, 2007)](https://consensus.app/papers/the-performance-environment-of-the-england-youth-soccer-pain-harwood/542b0e8a44b354838b12a5fca715c362/?utm_source=chatgpt)
- [(Fagundes et al., 2021)](https://consensus.app/papers/monitoring-of-overtraining-and-motivation-in-elite-soccer-fagundes-costa/95f2a3177b165ea2b71db22f796dee51/?utm_source=chatgpt)
- [(Sansone et al., 2024)](https://consensus.app/papers/editorial-multidisciplinary-perspectives-on-team-sports-sansone-rago/8fc9d8e51f3a5870ab909f5f3d095054/?utm_source=chatgpt)
- [(Di Corrado & Tušak, 2026)](https://consensus.app/papers/editorial-determinants-of-achievement-in-top-sport-corrado-tuak/6fdbeb1187a25d888eca88d5848275c6/?utm_source=chatgpt)
- [(Rausch et al., 2026)](https://consensus.app/papers/rethinking-performance-crises-in-professional-soccer-rausch-fritsch/539e5ea914b05e53910514fe53f2e83d/?utm_source=chatgpt)
- [(Na et al., 2018)](https://consensus.app/papers/do-not-bet-on-your-favourite-football-team-the-influence-of-na-su/a2d715dac11d5f54ac50c016ac0bb06e/?utm_source=chatgpt)
- [(Khazaal et al., 2012)](https://consensus.app/papers/effects-of-expertise-on-football-betting-khazaal-chatton/393b210488395c7389085cda7d4350c0/?utm_source=chatgpt)
- [(Erceg & Galić, 2014)](https://consensus.app/papers/overconfidence-bias-and-conjunction-fallacy-in-erceg-gali/0e1c49c5a8d7512da5967bddeffd9ba7/?utm_source=chatgpt)


## 7.1 Cierre metodológico sobre scraping

Como estos dos documentos serán base del modelo, debe quedar explícito:

- las variables “psicológicas” provienen de scraping;
- por tanto, son **observaciones indirectas**;
- tienen **error de medición**;
- y deben separarse entre:
  - señales del estado competitivo del equipo,
  - señales narrativas públicas,
  - y señales de sesgo del mercado.

En otras palabras: el modelo no asume que está midiendo la mente del jugador o del equipo de forma directa; asume que está extrayendo **señales observacionales parciales** desde el ecosistema mediático y competitivo del partido.

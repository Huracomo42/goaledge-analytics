# Repositorios open source para estudiar — Predictor Mundial 2026, betting analytics y football modelling

**Fecha de preparación:** 13 de junio de 2026  
**Objetivo:** ordenar repositorios útiles para construir una aplicación web que prediga partidos del Mundial 2026 usando datos reales, modelos matemáticos, probabilidades, apuestas con valor esperado y calibración continua.

---

## Conclusión estratégica

No existe un repositorio único que resuelva bien todo el proyecto. La decisión correcta es construir tu sistema combinando piezas:

1. **Motor matemático:** `penaltyblog`, `goalmodel`, `mezzala`.
2. **Motor Mundial 2026 / simulación:** `Hicruben/world-cup-2026-prediction-model`, `zvizdo/fifa-wc-2026-simulation`, `FIFA-World-Cup-2026-Predictor`.
3. **Motor betting / EV / edge:** `bundesliga-predictor`, `half-time-draw-predictor`, `OddsHarvester`.
4. **xG y football analytics:** `soccer_xg`, `football_analytics`, `worldfootballR`.
5. **App web / dashboard:** `mls-predictions`, `TheODDYSEY/EPL-Predictor`, `football-league-predictions`.

El riesgo principal no es Firebase. El riesgo es mezclar datos, predicción, cuotas, calibración y frontend en un solo bloque desordenado. El proyecto debe separarse en módulos.

---

## Arquitectura recomendada para tu proyecto

```text
app/
├── frontend/
│   ├── Next.js / React / Vite
│   └── visualización de partidos, probabilidades y apuestas
│
├── backend/
│   ├── API de predicción
│   ├── API de cuotas
│   ├── API de simulación de torneo
│   └── API de historial/backtesting
│
├── models/
│   ├── poisson_model.py
│   ├── dixon_coles_model.py
│   ├── elo_model.py
│   ├── xg_model.py
│   └── calibration_model.py
│
├── betting/
│   ├── implied_probability.py
│   ├── no_vig.py
│   ├── fair_odds.py
│   ├── expected_value.py
│   └── edge.py
│
├── data/
│   ├── sports_api_client.py
│   ├── scraper.py
│   ├── firebase_repository.js
│   └── data_validation.py
│
├── backtesting/
│   ├── brier_score.py
│   ├── log_loss.py
│   ├── calibration_curve.py
│   └── profit_simulation.py
│
└── firebase/
    ├── matches
    ├── teams
    ├── predictions
    ├── odds
    ├── analysis_cache
    └── backtests
```

---

# Ranking de repositorios

> Nota: las estrellas y fechas son aproximadas porque GitHub cambia constantemente. La prioridad real se basa en utilidad para tu proyecto, no solo popularidad.

| # | Repositorio | Link | Stars aprox. | Lenguaje principal | Última actualización aprox. | Categoría principal | Parecido al proyecto | ¿Vale la pena? |
|---:|---|---|---:|---|---|---|---:|---|
| 1 | penaltyblog | https://github.com/martineastwood/penaltyblog | 175+ | Python/Cython | Jun 2026 | Modelos Poisson / Betting | 90% | Sí, prioridad 1 |
| 2 | world-cup-2026-prediction-model | https://github.com/Hicruben/world-cup-2026-prediction-model | 35+ | JavaScript | 2026 | Mundial 2026 / Simulación | 95% | Sí, prioridad 2 |
| 3 | bundesliga-predictor | https://github.com/kontainer-sh/bundesliga-predictor | N/D | Python | 2025/2026 | Betting / Backtesting | 88% | Sí |
| 4 | mls-predictions | https://github.com/gmalbert/mls-predictions | N/D | Python / Streamlit | 2026 | xG / App / Betting | 82% | Sí |
| 5 | fifa-wc-2026-simulation | https://github.com/zvizdo/fifa-wc-2026-simulation | 8+ | Python / Jupyter | 2026 | Simulación Mundial | 86% | Sí |
| 6 | soccer_xg | https://github.com/ML-KULeuven/soccer_xg | 250+ | Python | N/D | xG académico | 72% | Sí |
| 7 | half-time-draw-predictor | https://github.com/raulduk3/half-time | N/D | Python | 2026 | Betting / Edge | 78% | Sí |
| 8 | EPL-Predictor | https://github.com/TheODDYSEY/EPL-Predictor | N/D | Python / Streamlit | 2026 | App predictiva | 75% | Sí |
| 9 | football-league-predictions | https://github.com/vickyfriss/football-league-predictions | N/D | Python / Streamlit | 2026 | Simulación / Dashboard | 76% | Sí |
| 10 | ProphitBet Soccer Bets Predictor | https://github.com/kochlisGit/ProphitBet-Soccer-Bets-Predictor | 500+ | Python | Abr 2026 | Betting ML | 74% | Sí, con cautela |
| 11 | transfermarkt-datasets | https://github.com/dcaribou/transfermarkt-datasets | 400+ | Python / dbt | Jun 2026 | Data pipeline | 62% | Sí |
| 12 | worldfootballR | https://github.com/JaseZiv/worldfootballR | 590+ | R | Sep 2025 | Data extraction / xG | 60% | Sí, como referencia |
| 13 | football_analytics | https://github.com/eddwebster/football_analytics | 2.6k+ | Jupyter / Python | Oct 2025 | Recursos football analytics | 58% | Sí |
| 14 | OddsHarvester | https://github.com/jordantete/OddsHarvester | 190+ | Python | 2025/2026 | Odds scraping | 65% | Sí, con cuidado legal/TOS |
| 15 | pl-matches-predictor | https://github.com/Caldass/pl-matches-predictor | N/D | Python / Flask | Antiguo | End-to-end betting | 70% | Sí, como patrón |
| 16 | mezzala | https://github.com/Torvaney/mezzala | N/D | Python | N/D | Dixon-Coles / scorelines | 72% | Sí |
| 17 | goalmodel | https://github.com/opisthokonta/goalmodel | N/D | R | N/D | Modelos de goles | 78% | Sí |
| 18 | Football-match-prediction | https://github.com/CYehLu/Football-match-prediction | 1+ | Python / Notebook | Antiguo | Poisson básico | 55% | Solo didáctico |
| 19 | football_basic_poisson | https://github.com/maxantcliff/football_basic_poisson | N/D | Python | Antiguo | Poisson básico | 50% | Solo didáctico |
| 20 | soccer-predictor | https://github.com/cookpete/soccer-predictor | 29+ | JavaScript | 2017 | Poisson JS | 48% | Solo referencia ligera |

---

# Fichas por repositorio

## 1. penaltyblog

**Link:** https://github.com/martineastwood/penaltyblog  
**Lenguaje:** Python / Cython  
**Categorías:** A. Modelos Poisson, C. Betting Models, E. Backtesting parcial, F. Data Collection  
**Problema que resuelve:** librería de football modelling para análisis de datos, outcome modelling, rankings, predicción y betting insights.

**Componentes reutilizables:**
- Poisson.
- Dixon-Coles.
- Bivariate Poisson.
- Negative Binomial.
- Weibull Count.
- Market probabilities.
- Expected goals a partir de probabilidades.
- Scoring rules.
- Herramientas de scraping y football data.

**Limitaciones:**
- No es una app web.
- No está diseñada específicamente para Mundial 2026.
- Necesitas integrarla con Firebase, frontend y tus APIs.

**Parecido al proyecto:** 90%  
**Decisión:** estudiarlo sí o sí. Debe ser una de tus bases matemáticas.

---

## 2. Hicruben/world-cup-2026-prediction-model

**Link:** https://github.com/Hicruben/world-cup-2026-prediction-model  
**Lenguaje:** JavaScript  
**Categorías:** A. Modelos Poisson, D. World Cup Simulator, E. Backtesting  
**Problema que resuelve:** modelo open source para pronosticar partidos y probabilidades del Mundial 2026 con Elo, Dixon-Coles bivariate Poisson y Monte Carlo.

**Componentes reutilizables:**
- Estructura para Mundial 2026.
- Elo ratings.
- Dixon-Coles bivariate Poisson.
- Monte Carlo simulation.
- Backtesting.
- Brier Score.
- Log Loss.
- RPS.
- Expected Calibration Error.
- Scripts separados de calibración y simulación.

**Limitaciones:**
- No tiene betting engine completo.
- No parece estar orientado a Firebase.
- No resuelve scraping de odds.
- Pocos stars, por lo que debe auditarse el código.

**Parecido al proyecto:** 95%  
**Decisión:** prioridad 2. Es el más parecido conceptualmente.

---

## 3. kontainer-sh/bundesliga-predictor

**Link:** https://github.com/kontainer-sh/bundesliga-predictor  
**Lenguaje:** Python  
**Categorías:** A. Poisson, C. Betting Models, E. Backtesting  
**Problema que resuelve:** predicción de Bundesliga usando Dixon-Coles, odds de mercado y backtesting.

**Componentes reutilizables:**
- Conexión entre modelo estadístico y cuotas.
- Uso de Pinnacle odds / The Odds API.
- Backtesting con mercado real.
- Mezcla entre probabilidades del modelo y probabilidades del mercado.
- Evaluación histórica.

**Limitaciones:**
- Está enfocado en Bundesliga.
- Parte del contenido está en alemán.
- No tiene estructura de torneo Mundial.
- No es una app web moderna completa.

**Parecido al proyecto:** 88%  
**Decisión:** muy útil para la parte de betting. Estudiar después de penaltyblog y Hicruben.

---

## 4. gmalbert/mls-predictions

**Link:** https://github.com/gmalbert/mls-predictions  
**Lenguaje:** Python / Streamlit  
**Categorías:** B. xG, C. Betting, G. End-to-End Prediction Platform  
**Problema que resuelve:** aplicación Streamlit para predecir partidos MLS usando machine learning, expected goals, datos estructurales y odds.

**Componentes reutilizables:**
- Arquitectura de app predictiva.
- Integración con datos xG.
- Integración con The Odds API.
- Features de descanso, viajes, localía y estructura de liga.
- Dashboard.
- Flujo predicción → visualización.

**Limitaciones:**
- MLS no es Mundial.
- Puede tener features demasiado específicas.
- No necesariamente usa modelos Poisson como base principal.
- Streamlit puede no ser el frontend final si quieres web pública robusta.

**Parecido al proyecto:** 82%  
**Decisión:** estudiar para arquitectura de app y pipeline.

---

## 5. zvizdo/fifa-wc-2026-simulation

**Link:** https://github.com/zvizdo/fifa-wc-2026-simulation  
**Lenguaje:** Python / Jupyter  
**Categorías:** A. Poisson, D. Tournament Simulation, G. App/Simulation  
**Problema que resuelve:** simulación del Mundial 2026 usando modelos de goles, rankings dinámicos y Monte Carlo.

**Componentes reutilizables:**
- Simulación del formato de torneo.
- Modelos Poisson / bivariate Poisson / Dixon-Coles.
- Ranking dinámico.
- Host advantage.
- Streamlit dashboard.
- Optimización de parámetros.

**Limitaciones:**
- Pocos stars.
- Probablemente requiere revisión profunda.
- Puede estar en etapa experimental.

**Parecido al proyecto:** 86%  
**Decisión:** estudiarlo, pero no usarlo como base principal sin auditar.

---

## 6. ML-KULeuven/soccer_xg

**Link:** https://github.com/ML-KULeuven/soccer_xg  
**Lenguaje:** Python / Jupyter  
**Categorías:** B. xG y Football Analytics  
**Problema que resuelve:** entrenamiento y evaluación de modelos de expected goals usando datos de eventos.

**Componentes reutilizables:**
- Construcción de modelo xG.
- Features de tiros.
- Entrenamiento con Opta, Wyscout o StatsBomb.
- Evaluación de modelos.
- Pipeline académico más serio.

**Limitaciones:**
- No predice partidos directamente.
- No calcula EV ni apuestas.
- Requiere datos de eventos de calidad.

**Parecido al proyecto:** 72%  
**Decisión:** usar como referencia si vas a incorporar xG real, no pseudo-xG.

---

## 7. raulduk3/half-time-draw-predictor

**Link:** https://github.com/raulduk3/half-time  
**Lenguaje:** Python  
**Categorías:** C. Betting Models, E. Backtesting  
**Problema que resuelve:** sistema especializado para detectar apuestas de empate al descanso usando ML, Elo, Dixon-Coles, odds y backtesting.

**Componentes reutilizables:**
- Lógica de edge.
- Separación entre mercado y modelo.
- Backtesting ROI.
- Features pre-match.
- Evaluación de rentabilidad.

**Limitaciones:**
- Mercado muy específico.
- No sirve directamente para 1X2, O/U, BTTS o scorelines.
- Puede sobreajustar si no se audita.

**Parecido al proyecto:** 78%  
**Decisión:** sí, para aprender diseño de betting engine.

---

## 8. TheODDYSEY/EPL-Predictor

**Link:** https://github.com/TheODDYSEY/EPL-Predictor  
**Lenguaje:** Python / Streamlit  
**Categorías:** A. Poisson, B. xG, G. End-to-End App  
**Problema que resuelve:** predicción de partidos EPL usando Poisson, Random Forest, XGBoost y ensemble.

**Componentes reutilizables:**
- Interfaz Streamlit.
- Predicción 1X2.
- Score projection.
- Comparación de modelos.
- Pipeline simple de usuario final.

**Limitaciones:**
- No tiene betting engine serio.
- No necesariamente incluye calibración robusta.
- EPL no es Mundial.

**Parecido al proyecto:** 75%  
**Decisión:** útil para frontend/prototipo, no para núcleo matemático.

---

## 9. vickyfriss/football-league-predictions

**Link:** https://github.com/vickyfriss/football-league-predictions  
**Lenguaje:** Python / Streamlit  
**Categorías:** A. Poisson, D. Simulation, G. Dashboard  
**Problema que resuelve:** simulación Monte Carlo de ligas europeas usando Poisson, fixtures y dashboard.

**Componentes reutilizables:**
- Simulación masiva.
- Dashboard de probabilidades.
- Automatización de actualización.
- Probabilidades de posiciones/escenarios.

**Limitaciones:**
- Liga larga, no torneo corto.
- No tiene betting EV profundo.
- No resuelve xG ni odds avanzadas.

**Parecido al proyecto:** 76%  
**Decisión:** sí, para aprender simulación y reporting.

---

## 10. kochlisGit/ProphitBet-Soccer-Bets-Predictor

**Link:** https://github.com/kochlisGit/ProphitBet-Soccer-Bets-Predictor  
**Lenguaje:** Python  
**Categorías:** C. Betting Models, G. Prediction Platform  
**Problema que resuelve:** predicción de apuestas de fútbol usando ML, redes neuronales, Random Forest y ensembles.

**Componentes reutilizables:**
- Pipeline ML.
- Feature engineering.
- Feature importance.
- Predicción de próximos partidos.
- Estructura para recomendaciones de apuestas.

**Limitaciones:**
- Puede ser demasiado caja negra.
- El enfoque ML puede no estar bien calibrado.
- Debe revisarse si realmente mide profit out-of-sample.

**Parecido al proyecto:** 74%  
**Decisión:** estudiar, pero no convertirlo en tu base central.

---

## 11. dcaribou/transfermarkt-datasets

**Link:** https://github.com/dcaribou/transfermarkt-datasets  
**Lenguaje:** Python / dbt  
**Categorías:** F. Data Collection / Scraping  
**Problema que resuelve:** extracción y preparación de datasets desde Transfermarkt.

**Componentes reutilizables:**
- Pipeline de datos de jugadores.
- Datos de mercado.
- Datos de equipos.
- Posible enriquecimiento de features de fuerza de plantilla.

**Limitaciones:**
- No predice.
- No calcula probabilidades.
- Transfermarkt puede no ser suficiente para rendimiento deportivo real.

**Parecido al proyecto:** 62%  
**Decisión:** sí, como fuente complementaria.

---

## 12. JaseZiv/worldfootballR

**Link:** https://github.com/JaseZiv/worldfootballR  
**Lenguaje:** R  
**Categorías:** B. xG, F. Data Extraction  
**Problema que resuelve:** extracción de datos desde FBref, Transfermarkt, Understat y otras fuentes.

**Componentes reutilizables:**
- Identificación de fuentes.
- Funciones de extracción.
- xG histórico.
- Stats avanzadas.

**Limitaciones:**
- Está en R.
- No es app web.
- No predice por sí solo.

**Parecido al proyecto:** 60%  
**Decisión:** usar como mapa de fuentes, aunque programes en JS/Python.

---

## 13. eddwebster/football_analytics

**Link:** https://github.com/eddwebster/football_analytics  
**Lenguaje:** Jupyter / Python  
**Categorías:** B. xG, F. Recursos football analytics  
**Problema que resuelve:** colección curada de recursos, notebooks, datos y ejemplos de football analytics.

**Componentes reutilizables:**
- Fuentes de datos.
- Notebooks.
- Referencias sobre Dixon-Coles.
- Referencias sobre xG.
- Ejemplos de visualización.

**Limitaciones:**
- No es una aplicación.
- No tiene arquitectura única.
- Requiere seleccionar piezas.

**Parecido al proyecto:** 58%  
**Decisión:** sí, como biblioteca de investigación.

---

## 14. jordantete/OddsHarvester

**Link:** https://github.com/jordantete/OddsHarvester  
**Lenguaje:** Python  
**Categorías:** C. Betting, F. Odds Scraping  
**Problema que resuelve:** scraping de cuotas desde OddsPortal usando Playwright. Exporta a JSON, CSV o S3.

**Componentes reutilizables:**
- Extracción de odds históricas y próximas.
- Múltiples deportes y mercados.
- Playwright automation.
- Output estructurado.
- Base para implied probability, no-vig, EV y edge.

**Limitaciones:**
- Scraping puede romperse.
- Posibles restricciones de términos de uso.
- No predice; solo recolecta odds.

**Parecido al proyecto:** 65%  
**Decisión:** sí, pero úsalo con cautela. Para producción, mejor API pagada si el presupuesto lo permite.

---

## 15. Caldass/pl-matches-predictor

**Link:** https://github.com/Caldass/pl-matches-predictor  
**Lenguaje:** Python / Flask  
**Categorías:** C. Betting, E. Backtesting, G. End-to-End  
**Problema que resuelve:** predicción de partidos EPL, scraping de odds, features y simulación de profit.

**Componentes reutilizables:**
- Flujo end-to-end.
- Scraping → features → modelo → predicción → profit simulation.
- Flask app.
- Ideas para historial de apuestas.

**Limitaciones:**
- Antiguo.
- Puede tener dependencias rotas.
- No usar como producción.

**Parecido al proyecto:** 70%  
**Decisión:** sí, como referencia estructural.

---

## 16. Torvaney/mezzala

**Link:** https://github.com/Torvaney/mezzala  
**Lenguaje:** Python  
**Categorías:** A. Dixon-Coles / Scorelines  
**Problema que resuelve:** modelado de fortaleza de equipos y predicción de scorelines con Dixon-Coles.

**Componentes reutilizables:**
- Modelos de goles.
- Scorelines exactos.
- Team strength.
- Probabilidades derivadas.

**Limitaciones:**
- No betting.
- No app.
- No torneo.
- Puede requerir adaptación importante.

**Parecido al proyecto:** 72%  
**Decisión:** sí, especialmente para entender scorelines.

---

## 17. opisthokonta/goalmodel

**Link:** https://github.com/opisthokonta/goalmodel  
**Lenguaje:** R  
**Categorías:** A. Modelos de goles, B. xG, E. Scoring Rules  
**Problema que resuelve:** paquete/modelo para fútbol con Poisson, Dixon-Coles, BTTS, WDL, scoring rules y reverse engineering de xG desde cuotas.

**Componentes reutilizables:**
- Probabilidades 1X2.
- BTTS.
- Over/Under.
- Scorelines.
- Scoring rules.
- Conversión cuotas → probabilidades esperadas.

**Limitaciones:**
- Está en R.
- No es app web.
- No está pensado para Firebase.

**Parecido al proyecto:** 78%  
**Decisión:** sí, aunque no sea el stack final. Matemáticamente vale mucho.

---

## 18. CYehLu/Football-match-prediction

**Link:** https://github.com/CYehLu/Football-match-prediction  
**Lenguaje:** Python / Jupyter Notebook  
**Categorías:** A. Poisson básico, D. Simulación  
**Problema que resuelve:** predicción de goles y simulación de temporada usando Poisson regression.

**Componentes reutilizables:**
- Ejemplo simple de Poisson.
- Estimación de goles por equipo.
- Simulación básica de partidos.

**Limitaciones:**
- Muy básico.
- No betting.
- No calibración seria.
- No app.

**Parecido al proyecto:** 55%  
**Decisión:** solo para entender la base.

---

## 19. maxantcliff/football_basic_poisson

**Link:** https://github.com/maxantcliff/football_basic_poisson  
**Lenguaje:** Python  
**Categorías:** A. Poisson básico, C. Betting básico  
**Problema que resuelve:** modelo Poisson simple para predicción de resultados y mercados básicos.

**Componentes reutilizables:**
- Matriz de scorelines.
- Probabilidades 1X2.
- Over/Under derivado de distribución de goles.
- Correct score.

**Limitaciones:**
- Demasiado simple.
- No calibra.
- No backtesting robusto.
- No xG.

**Parecido al proyecto:** 50%  
**Decisión:** sí, como ejemplo didáctico.

---

## 20. cookpete/soccer-predictor

**Link:** https://github.com/cookpete/soccer-predictor  
**Lenguaje:** JavaScript  
**Categorías:** A. Poisson JS, G. Lógica simple frontend/backend  
**Problema que resuelve:** predicción básica de fútbol con JavaScript.

**Componentes reutilizables:**
- Lógica JS simple.
- Posible inspiración para frontend o API Node.
- Cálculos básicos en el cliente.

**Limitaciones:**
- Obsoleto.
- Muy básico.
- No betting profesional.
- No calibración.
- No scraping.
- No Mundial.

**Parecido al proyecto:** 48%  
**Decisión:** solo referencia ligera.

---

# Clasificación por categorías

## A. Modelos Poisson

- `penaltyblog`
- `Hicruben/world-cup-2026-prediction-model`
- `bundesliga-predictor`
- `zvizdo/fifa-wc-2026-simulation`
- `Torvaney/mezzala`
- `opisthokonta/goalmodel`
- `CYehLu/Football-match-prediction`
- `maxantcliff/football_basic_poisson`
- `cookpete/soccer-predictor`

## B. xG y Football Analytics

- `ML-KULeuven/soccer_xg`
- `gmalbert/mls-predictions`
- `eddwebster/football_analytics`
- `JaseZiv/worldfootballR`
- `TheODDYSEY/EPL-Predictor`

## C. Betting Models

- `kontainer-sh/bundesliga-predictor`
- `raulduk3/half-time`
- `kochlisGit/ProphitBet-Soccer-Bets-Predictor`
- `Caldass/pl-matches-predictor`
- `jordantete/OddsHarvester`
- `penaltyblog`

## D. Tournament / World Cup Simulators

- `Hicruben/world-cup-2026-prediction-model`
- `zvizdo/fifa-wc-2026-simulation`
- `Trishgupta44/FIFA-World-Cup-2026-Predictor`
- `vickyfriss/football-league-predictions`
- `pedr0torcivia/World-Cup-2026-Simulation`
- `felixyustian/wc2026-prediction-dashboard`

## E. Backtesting Systems

- `Hicruben/world-cup-2026-prediction-model`
- `kontainer-sh/bundesliga-predictor`
- `raulduk3/half-time`
- `Caldass/pl-matches-predictor`
- `penaltyblog`

## F. Data Collection / Scraping

- `jordantete/OddsHarvester`
- `dcaribou/transfermarkt-datasets`
- `JaseZiv/worldfootballR`
- `eddwebster/football_analytics`
- `ML-KULeuven/soccer_xg`
- `gustavofariaa/FlashscoreScraping`
- `manucabral/EasySoccerData`

## G. Full End-to-End Prediction Platforms

- `gmalbert/mls-predictions`
- `TheODDYSEY/EPL-Predictor`
- `kochlisGit/ProphitBet-Soccer-Bets-Predictor`
- `vickyfriss/football-league-predictions`
- `Hicruben/world-cup-2026-prediction-model`

---

# Qué estudiar primero

## Semana 1: núcleo matemático

1. `penaltyblog`
2. `Hicruben/world-cup-2026-prediction-model`
3. `goalmodel`
4. `mezzala`

**Resultado esperado:** tener claro cómo vas a calcular:

- Probabilidad local / empate / visita.
- Over/Under.
- BTTS.
- Scorelines exactos.
- Cuota justa.
- Probabilidad calibrada.

---

## Semana 2: betting engine

1. `bundesliga-predictor`
2. `OddsHarvester`
3. `half-time-draw-predictor`
4. `pl-matches-predictor`

**Resultado esperado:** construir funciones propias para:

```text
implied_probability
no_vig_probability
fair_odds
expected_value
edge
kelly_fraction opcional
```

---

## Semana 3: Mundial 2026 y simulación

1. `Hicruben/world-cup-2026-prediction-model`
2. `zvizdo/fifa-wc-2026-simulation`
3. `Trishgupta44/FIFA-World-Cup-2026-Predictor`
4. `pedr0torcivia/World-Cup-2026-Simulation`

**Resultado esperado:** construir:

- Simulador de fase de grupos.
- Simulador de eliminatorias.
- Monte Carlo tournament simulation.
- Probabilidades de campeón.
- Probabilidades de clasificación.

---

## Semana 4: app web y Firebase

1. `mls-predictions`
2. `TheODDYSEY/EPL-Predictor`
3. `football-league-predictions`

**Resultado esperado:** definir:

- Colecciones Firebase.
- Cache de análisis por partido.
- Página de partido.
- Página de historial.
- Página de backtesting.
- Panel de calibración.

---

# Funciones mínimas que debes construir

## Motor de predicción

```text
predict_match(home_team, away_team, match_context)
```

Debe devolver:

```json
{
  "home_win": 0.42,
  "draw": 0.28,
  "away_win": 0.30,
  "over_1_5": 0.74,
  "over_2_5": 0.51,
  "under_3_5": 0.68,
  "btts_yes": 0.56,
  "correct_scores": [
    {"score": "1-1", "prob": 0.12},
    {"score": "2-1", "prob": 0.10}
  ],
  "fair_odds": {
    "home_win": 2.38,
    "draw": 3.57,
    "away_win": 3.33
  }
}
```

---

## Motor de apuestas

```text
evaluate_bet(model_probability, bookmaker_odds)
```

Debe devolver:

```json
{
  "implied_probability": 0.40,
  "no_vig_probability": 0.38,
  "model_probability": 0.45,
  "fair_odds": 2.22,
  "bookmaker_odds": 2.50,
  "edge": 0.07,
  "expected_value": 0.125,
  "is_value_bet": true
}
```

---

## Motor de calibración

```text
calibrate_predictions(predictions, results)
```

Debe calcular:

- Brier Score.
- Log Loss.
- Calibration curve.
- Expected Calibration Error.
- Accuracy.
- ROI si hay apuestas.

---

## Motor de Firebase

Colecciones recomendadas:

```text
teams
matches
team_stats
odds_snapshots
predictions
betting_recommendations
analysis_cache
match_results
backtests
calibration_reports
model_versions
```

---

# Repositorios que debes ignorar o tomar con pinzas

Evita usar como base principal repositorios que:

- No tengan README claro.
- Solo predigan ganador sin probabilidades.
- No tengan backtesting.
- No separen training/test.
- Hablen de “accuracy alta” pero no midan Brier, Log Loss o calibración.
- Usen cuotas del bookmaker como variable target sin controlar leakage.
- Tengan casino/afiliados/marketing de apuestas disfrazado de modelo.
- No expliquen fuentes de datos.
- No indiquen fecha de actualización.

---

# Decisión final

Tu proyecto debe tomar esta forma:

```text
Firebase + Web App
        ↓
Data Pipeline
        ↓
Prediction Engine
        ↓
Betting Engine
        ↓
Calibration Engine
        ↓
Backtesting Dashboard
```

La ruta correcta:

1. Copiar estructura conceptual de `Hicruben/world-cup-2026-prediction-model`.
2. Usar `penaltyblog` como referencia matemática fuerte.
3. Usar `bundesliga-predictor` para la lógica modelo vs mercado.
4. Usar `OddsHarvester` solo para aprender scraping de cuotas.
5. Usar `soccer_xg` para no inventar xG mal.
6. Integrar todo en tu propia arquitectura Firebase.

**No clones un repo y modifiques encima. Construye tu propio proyecto con estos repositorios como biblioteca de patrones.**

---

# Fuentes consultadas

- penaltyblog: https://github.com/martineastwood/penaltyblog
- Documentación penaltyblog: https://penaltyblog.readthedocs.io/
- Hicruben World Cup 2026 Prediction Model: https://github.com/Hicruben/world-cup-2026-prediction-model
- gmalbert MLS Predictions: https://github.com/gmalbert/mls-predictions
- OddsHarvester: https://github.com/jordantete/OddsHarvester
- GitHub Topic xG: https://github.com/topics/xg
- GitHub Topic FIFA World Cup 2026: https://github.com/topics/fifa-world-cup-2026
- GitHub Topic World Cup 2026: https://github.com/topics/world-cup-2026
- GitHub Topic soccer-data: https://github.com/topics/soccer-data

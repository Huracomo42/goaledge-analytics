# GoalEdge Analytics — Inicio de Fase 3: Calibration Engine

## 1. Contexto general del proyecto

Este documento sirve como punto de partida para continuar el desarrollo de **GoalEdge Analytics / Futboleros V2** desde Claude Code.

Repositorio público:

```text
https://github.com/Huracomo42/goaledge-analytics
```

Estado general del proyecto:

| Fase | Estado |
|---|---|
| Fase 0 — Diseño conceptual | COMPLETA |
| Fase 1 — Prediction Engine + Data Pipeline | COMPLETA |
| Fase 2 — Betting Engine | COMPLETA en núcleo matemático |
| Fase 3 — Calibration Engine | PENDIENTE / se inicia ahora |
| Fase 4 — Scraping / Proxy Engine psicodeportivo | NO iniciada |
| Fase 5 — Frontend V2 | Pendiente de diagnóstico |

---

## 2. Lo que ya está logrado

### 2.1 Modelo Poisson funcional

El modelo Poisson ya funciona como núcleo del Prediction Engine.

Actualmente permite:

- Calcular `lambda_local`.
- Calcular `lambda_visitante`.
- Generar matriz de marcadores.
- Derivar probabilidades:
  - 1X2.
  - Over/Under.
  - BTTS.
  - Marcador más probable.

Flujo conceptual actual:

```text
datos de equipo
→ ataque/defensa
→ lambda_local / lambda_visitante
→ matriz Poisson
→ probabilidades de mercado
```

---

### 2.2 Data Pipeline funcional

El Data Pipeline ya está implementado con las siguientes fuentes y componentes:

- `football-data.org`
  - Fixture del Mundial 2026.
  - Identificación de partidos.
  - Fechas y equipos.

- FotMob
  - xG.
  - Detalle de partidos.
  - Historial de equipos.
  - Partidos pre-Mundial y Mundial 2026.

- Cálculo de ataque/defensa:
  - Usa `K=5` partidos.
  - Combina J1 del Mundial 2026 con historial pre-Mundial cuando corresponde.
  - Usa ponderación exponencial.
  - Aplica fallback `default_mu_liga` cuando no hay xG disponible.

- Caché de xG:
  - No guarda partidos no iniciados.
  - No guarda partidos en curso.
  - Solo cachea partidos finalizados con xG válido.
  - Evita contaminar futuras predicciones con xG parcial o inexistente.

---

### 2.3 Betting Engine funcional

El núcleo matemático del Betting Engine ya está implementado.

Incluye:

- `impliedProbability`.
- `noVigProbability` provisional.
- `edge`.
- `expectedValue`.
- `fairOdds`.
- `evaluateBet`.
- `kellyFraction` como utilidad opcional.
- `TAU = 0` como umbral provisional.

Separación conceptual ya definida:

```text
Prediction Engine
→ genera probabilidad del modelo

Betting Engine
→ compara probabilidad del modelo contra cuotas de mercado
→ calcula edge, EV y value bet
```

Regla importante:

> El Betting Engine no debe saber fútbol. Solo recibe probabilidades y cuotas.

---

### 2.4 The Odds API integrada

La integración con The Odds API ya funciona.

Estado actual:

- Sport key confirmado:
  - `soccer_fifa_world_cup`
- Matching de partidos J2:
  - 24/24 partidos encontrados correctamente.
- Se transforman cuotas reales al formato interno.
- Se agregan cuotas por mediana de bookmakers.
- Se guarda trazabilidad con `n_bookmakers`.

---

### 2.5 Firestore operativo

Colecciones principales ya utilizadas:

```text
predicciones/{matchId}
odds_snapshots/{matchId}_{timestamp}
```

Campo adicional en predicciones:

```text
ultimo_odds_snapshot_id
```

Regla importante:

- `predicciones/{matchId}` puede recibir documentos completos V2 desde el Prediction Engine.
- `odds_snapshots` se guarda aparte.
- La actualización de `ultimo_odds_snapshot_id` debe hacerse sin pisar el documento completo de predicción.

---

### 2.6 Incidente V1 mitigado

Se detectó que la V1 podía sobrescribir documentos V2 en:

```text
predicciones/{matchId}
```

Estado actual:

- V1 fue parcheada.
- Se añadió un guard `[V1 BLOCKED]`.
- Si existe una predicción V2, V1 ya no debe sobrescribirla.
- Auditoría J2 confirmó:
  - 24/24 documentos V2 limpios.
  - 0 contaminados.
  - 0 ausentes.
- Corrida post-incidente:
  - 24/24 predicciones guardadas.
  - 0 errores.

---

### 2.7 Repo público limpio

El repo ya fue publicado como proyecto público.

Se excluyó correctamente:

- `.env`
- credenciales Firebase
- `data/cache/`
- `reports/`
- `traspaso_chatgpt.md`
- `.claude/settings.local.json`
- `node_modules/`

---

## 3. Punto clave antes de iniciar Fase 3

El modelo matemático **ya funciona**, pero todavía **no está calibrado empíricamente**.

Esto significa:

```text
Sí genera probabilidades.
Sí genera predicciones.
Sí evalúa apuestas contra cuotas.
Pero todavía no sabemos qué tan bien calibradas están sus probabilidades.
```

La Fase 3 debe responder preguntas como:

- ¿Cuando el modelo dice 60%, gana aproximadamente 60% de las veces?
- ¿El modelo sobreestima favoritos?
- ¿Subestima empates?
- ¿Qué mercados predice mejor?
- ¿1X2 está mejor calibrado que Over/Under?
- ¿El modelo supera al mercado?
- ¿El edge calculado realmente se traduce en valor?
- ¿El cierre de cuotas confirma o contradice la señal del modelo?
- ¿Qué ajustes deben hacerse a `TAU`, no-vig, lambdas o pesos?

---

## 4. Lo psicodeportivo todavía NO está implementado

La parte psicodeportiva corresponde a la Fase 4.

No debe mezclarse todavía con Fase 3.

Estado actual:

| Componente | Estado |
|---|---|
| Scraping de prensa | No iniciado |
| Proxies narrativos | No iniciado |
| Proxies psicológicos | No iniciado |
| Ajuste contextual psicodeportivo sobre lambda | No iniciado |
| Comparación modelo base vs modelo psicodeportivo | Pendiente |

Regla para esta fase:

> La Fase 3 debe calibrar primero el modelo base actual antes de introducir ajustes psicodeportivos.

---

## 5. Objetivo de la Fase 3

Diseñar e implementar el **Calibration Engine**.

Su función será evaluar, registrar y mejorar el rendimiento del modelo con datos reales ya observados.

La Fase 3 debe permitir:

1. Guardar resultados reales de partidos.
2. Comparar predicciones contra resultados reales.
3. Calcular métricas de calibración.
4. Calcular métricas de error.
5. Comparar el modelo contra el mercado.
6. Evaluar si las apuestas con edge positivo fueron realmente razonables.
7. Preparar una base para ajustar parámetros futuros.

---

## 6. Métricas principales a diseñar

### 6.1 Brier Score

Aplicable especialmente a mercados probabilísticos como:

- 1X2.
- Over/Under.
- BTTS.

Uso esperado:

```text
Brier menor = mejor predicción probabilística
```

Debe calcularse por:

- Partido.
- Mercado.
- Fecha.
- Fase del torneo.
- Versión del modelo.

---

### 6.2 Log Loss

Métrica más severa con predicciones muy confiadas y equivocadas.

Uso esperado:

```text
Log Loss menor = mejor
```

Debe servir para detectar si el modelo asigna probabilidades demasiado extremas.

---

### 6.3 Calibration Curves

Permiten evaluar si las probabilidades del modelo están bien calibradas.

Ejemplo conceptual:

```text
Predicciones entre 0.60 y 0.70
→ deberían ocurrir aproximadamente 60%-70% de las veces
```

Se debe diseñar por bins:

```text
0.00-0.10
0.10-0.20
...
0.90-1.00
```

---

### 6.4 Error de goles esperados

Comparar:

```text
lambda_local vs goles_local_real
lambda_visitante vs goles_visitante_real
```

Métricas posibles:

- Error absoluto.
- Error cuadrático.
- Sesgo promedio.
- Error por equipo.
- Error por confederación.
- Error por fase.

---

### 6.5 Error de marcador

Comparar marcador más probable contra marcador real.

No debe evaluarse solo como acierto exacto, porque el marcador exacto es muy difícil.

Métricas sugeridas:

- Acierto exacto.
- Distancia absoluta total:

```text
abs(goles_local_pred - goles_local_real) + abs(goles_visitante_pred - goles_visitante_real)
```

- Error de diferencia de goles.
- Acierto de signo:
  - local gana,
  - empate,
  - visitante gana.

---

### 6.6 CLV — Closing Line Value

Solo aplicable cuando existan snapshots de odds.

Debe comparar:

```text
odds tomadas / odds evaluadas por el modelo
vs
odds de cierre
```

Objetivo:

- Ver si el modelo detectaba valor antes de que el mercado se moviera.
- Evaluar si el edge fue confirmado por el cierre.

---

### 6.7 Comparación modelo vs mercado

Comparar:

```text
probabilidad_modelo
vs
probabilidad_no_vig_mercado
```

Y luego evaluar cuál predijo mejor el resultado real.

Métricas sugeridas:

- Brier modelo vs Brier mercado.
- Log Loss modelo vs Log Loss mercado.
- Diferencia de calibración.
- Edge realizado.
- Value bets acertados/fallidos.

---

## 7. Datos reales que deben guardarse después de cada partido

Para calibrar se necesita capturar resultados reales.

Datos mínimos por partido:

```text
matchId
fecha_partido
equipo_local
equipo_visitante
goles_local_real
goles_visitante_real
resultado_1x2_real
over_under_real
btts_real
estado_partido
fuente_resultado
capturado_en
```

Datos recomendados adicionales:

```text
xg_local_real
xg_visitante_real
posesion
tiros
tiros_al_arco
tarjetas
expulsiones
penales
fase_torneo
grupo
```

---

## 8. Esquema Firestore sugerido

### 8.1 Colección de resultados reales

```text
resultados_partidos/{matchId}
```

Estructura sugerida:

```js
{
  matchId: "537353",
  fecha_partido: "2026-06-20",
  equipo_local: "Germany",
  equipo_visitante: "Ivory Coast",

  goles_local_real: 2,
  goles_visitante_real: 1,

  resultado_1x2_real: "1",
  btts_real: true,

  totales_real: {
    goles_totales: 3,
    over_1_5: true,
    over_2_5: true,
    over_3_5: false,
    over_4_5: false
  },

  xg_real: {
    local: 1.8,
    visitante: 0.9,
    fuente: "fotmob"
  },

  estado_partido: "finished",
  fuente_resultado: "football-data/fotmob",
  capturado_en: "timestamp"
}
```

---

### 8.2 Colección de métricas por partido

```text
calibracion_partidos/{matchId}_{version_modelo}
```

Estructura sugerida:

```js
{
  matchId: "537353",
  version_modelo: "2.0",
  fecha_partido: "2026-06-20",

  prediccion_ref: "predicciones/537353",
  resultado_ref: "resultados_partidos/537353",

  metricas_1x2: {
    brier: 0.21,
    log_loss: 0.74,
    prob_evento_observado: 0.48,
    predicho: "1",
    observado: "1",
    acierto_signo: true
  },

  metricas_goles: {
    lambda_local: 1.65,
    lambda_visitante: 0.95,
    goles_local_real: 2,
    goles_visitante_real: 1,
    mae_local: 0.35,
    mae_visitante: 0.05,
    mae_total: 0.40
  },

  metricas_marcador: {
    marcador_mas_probable: "1-0",
    marcador_real: "2-1",
    acierto_exacto: false,
    distancia_goles: 2
  },

  metricas_mercado: {
    disponible: true,
    snapshot_usado: "odds_snapshots/537353_...",
    brier_modelo: 0.21,
    brier_mercado: 0.24,
    ventaja_modelo: true
  },

  creado_en: "timestamp"
}
```

---

### 8.3 Colección de resumen agregado

```text
calibracion_resumen/{version_modelo}_{fecha_corte}
```

Estructura sugerida:

```js
{
  version_modelo: "2.0",
  fecha_corte: "2026-06-25",

  n_partidos_evaluados: 24,

  resumen_1x2: {
    brier_promedio: 0.22,
    log_loss_promedio: 0.68,
    accuracy_signo: 0.54
  },

  resumen_goles: {
    mae_lambda_local: 0.44,
    mae_lambda_visitante: 0.51,
    sesgo_local: 0.10,
    sesgo_visitante: -0.08
  },

  resumen_mercado: {
    n_partidos_con_odds: 20,
    brier_modelo_promedio: 0.22,
    brier_mercado_promedio: 0.24,
    modelo_supera_mercado_pct: 0.55
  },

  calibration_bins: {
    mercado_1x2: [
      {
        bin: "0.50-0.60",
        n: 8,
        prob_media: 0.55,
        frecuencia_observada: 0.50
      }
    ]
  },

  creado_en: "timestamp"
}
```

---

## 9. Scripts sugeridos para Fase 3

### 9.1 Captura de resultados reales

```text
scripts/guardarResultadosFinales.js
```

Objetivo:

- Buscar partidos finalizados.
- Guardar marcador real.
- Guardar resultado 1X2 real.
- Guardar Over/Under real.
- Guardar BTTS real.
- Guardar xG final si FotMob lo entrega.

---

### 9.2 Calibración por partido

```text
scripts/calibrarPartido.js
```

Objetivo:

- Leer `predicciones/{matchId}`.
- Leer `resultados_partidos/{matchId}`.
- Leer odds snapshot si existe.
- Calcular métricas.
- Guardar en `calibracion_partidos/{matchId}_{version_modelo}`.

---

### 9.3 Calibración por lote

```text
scripts/calibrarPartidosFinalizados.js
```

Objetivo:

- Buscar todos los partidos con resultado real y predicción V2.
- Calcular métricas pendientes.
- Evitar duplicados.
- Recalcular si cambia la versión del modelo.

---

### 9.4 Resumen agregado

```text
scripts/generarResumenCalibracion.js
```

Objetivo:

- Leer métricas por partido.
- Agrupar por versión de modelo.
- Calcular promedios.
- Generar bins de calibración.
- Guardar resumen agregado.

---

### 9.5 Auditoría de calibración

```text
scripts/auditarCalibracion.js
```

Objetivo:

- Detectar partidos finalizados sin resultado guardado.
- Detectar resultados sin predicción.
- Detectar predicciones sin calibración.
- Detectar odds snapshots no enlazados.
- Reportar inconsistencias.

---

## 10. Qué se puede implementar ahora

Se puede implementar ahora:

1. Diseño de esquema Firestore.
2. Funciones matemáticas puras:
   - Brier Score.
   - Log Loss.
   - MAE de goles.
   - distancia de marcador.
   - bins de calibración.
3. Scripts base que no dependan de muchos resultados.
4. Captura de resultados finalizados.
5. Calibración individual de partidos que ya tengan:
   - predicción,
   - resultado final,
   - odds snapshot opcional.

---

## 11. Qué debe esperar

Debe esperar:

1. Ajuste real de `TAU`.
2. Backtesting serio.
3. Calibration curves estables.
4. Comparación robusta contra mercado.
5. CLV completo.
6. Reponderación de variables.
7. Ajustes automáticos de lambda.
8. Incorporación psicodeportiva.

Razón:

> Todavía faltan suficientes partidos finalizados con predicción previa y odds asociadas.

---

## 12. Reglas de arquitectura para Claude Code

Durante Fase 3, respetar estas reglas:

1. No modificar el Prediction Engine salvo que se detecte un bug real.
2. No modificar el Betting Engine salvo que sea para exportar funciones puras necesarias.
3. No mezclar calibración con scraping psicodeportivo.
4. No introducir ajustes automáticos al modelo antes de medir.
5. No recalibrar parámetros sin evidencia.
6. No usar datos de resultado futuro para predicciones pasadas.
7. Mantener trazabilidad por `version_modelo`.
8. Todo cálculo de calibración debe ser reproducible.
9. Todo script que escriba en Firestore debe tener logs claros.
10. Todo script de auditoría debe poder ejecutarse sin escribir datos.

---

## 13. Primera tarea sugerida para Claude Code

Antes de escribir código, hacer diagnóstico del repo.

Prompt sugerido:

```text
Estamos iniciando Fase 3 — Calibration Engine.

Primero no escribas código.

Revisa el repo y responde:

1. Qué archivos actuales se pueden reutilizar para calibración.
2. Qué funciones matemáticas ya existen y cuáles faltan.
3. Qué datos guarda actualmente predicciones/{matchId}.
4. Qué datos guarda actualmente odds_snapshots.
5. Qué campos faltan para poder calcular Brier, Log Loss, error de goles y comparación contra mercado.
6. Propón arquitectura de carpetas para Fase 3.
7. Propón el primer script a implementar.
8. No modifiques archivos todavía.
```

---

## 14. Objetivo final de Fase 3

Al cerrar Fase 3, el proyecto debe poder responder:

```text
¿Qué tan bueno es el modelo?
¿Está bien calibrado?
¿Dónde falla?
¿Supera al mercado?
¿Qué mercados predice mejor?
¿El edge detectado genera valor real?
¿Qué parámetros deben ajustarse con evidencia?
```

La Fase 3 no busca que el modelo “acierte más por intuición”.

Busca convertir el sistema en un modelo medible, auditable y mejorable.

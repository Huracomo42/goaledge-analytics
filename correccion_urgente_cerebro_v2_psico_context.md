# Corrección urgente del cerebro V2 — Integración psicodeportiva y boost mundialista

**Proyecto:** GoalEdge Analytics / Futboleros V2  
**Fecha:** 14 de junio de 2026  
**Prioridad:** URGENTE  
**Objetivo:** corregir la brecha crítica entre el modelo conceptual definido en los documentos base y el cerebro actualmente implementado.

---

## 0. Diagnóstico ejecutivo

El cerebro V2 actual está funcionando principalmente como un **modelo Poisson estadístico base**:

```txt
ataque_local + defensa_visitante → lambda_local
ataque_visitante + defensa_local → lambda_visitante
lambda_local / lambda_visitante → matriz de marcadores → 1X2, O/U, BTTS
```

Eso es correcto como base matemática, pero **NO representa todavía el modelo completo definido para GoalEdge Analytics**.

El problema crítico es que el sistema dejó fuera, o dejó pendiente, dos componentes que eran centrales desde el diseño original:

1. **Capa psicodeportiva**
2. **Boost mundialista / contexto de torneo / ranking FIFA**

Esto es grave porque el diferencial del proyecto no era ser solo un predictor estadístico con xG y Poisson. El diferencial era integrar:

```txt
rendimiento estadístico
+ señales psicodeportivas
+ contexto mundialista
+ comparación contra mercado
+ calibración incremental
```

Por tanto, este documento define cómo corregir el cerebro V2 sin volver al modelo heurístico de V1.

---

## 1. Qué está mal hoy

### 1.1 El modelo actual quedó demasiado estadístico

Hoy el cerebro implementado usa principalmente:

```txt
xG ofensivo reciente
xG concedido reciente
mu_liga
factor_local
factor_visitante
```

Esto produce una base probabilística limpia, pero incompleta.

### 1.2 El bloque psicodeportivo existe, pero no impacta realmente el modelo

El proyecto ya diseñó y documentó el bloque P con señales como:

```txt
necesita_ganar
venganza_narrativa
rival_maldito
presion_mediatica
lider_disponible
conflicto_interno
generacion_peak
underdog
clasifico_sufriendo
humillacion_previa
ausencias_ofensivas
ausencias_defensivas
```

Pero en la implementación actual, estas señales no están correctamente integradas en la generación de lambda, salvo que haya alguna conexión parcial todavía por verificar.

### 1.3 El boost mundialista fue descartado como multiplicador, pero no fue reemplazado

En V1 existía una lógica de boost mundialista ligada a:

```txt
jornada del grupo
ranking FIFA
diferencia de ranking
contexto de Mundial
```

En V2 se tomó una decisión correcta: **no usarlo como multiplicador bruto del score total**.

El error fue que la reformulación correcta como bloque contextual `C_torneo` quedó pendiente y no se activó.

---

## 2. Decisión técnica correcta

No se debe volver al boost heurístico de V1.

La solución correcta es:

```txt
Mantener Poisson como base.
Integrar psicodeportivo y contexto mundialista como ajustes exponenciales sobre lambda.
Separar señales de rendimiento, señales narrativas y señales de mercado.
Usar pesos iniciales conservadores.
Guardar trazabilidad completa.
Permitir calibración posterior.
```

La fórmula objetivo debe ser un **Poisson enriquecido**, no un score heurístico.

---

## 3. Modelo actual base

La fórmula base actual debe mantenerse como punto de partida:

```txt
lambda_base_local =
(xG_local * xGA_visitante / MU_LIGA) * FACTOR_LOCAL

lambda_base_visitante =
(xG_visitante * xGA_local / MU_LIGA) * FACTOR_VISITANTE
```

Con parámetros actuales:

```txt
MU_LIGA = 1.35
FACTOR_LOCAL = 1.10
FACTOR_VISITANTE = 0.95
lambda_min = 0.15
lambda_max = 4.5
```

---

## 4. Nueva fórmula objetivo V2

La nueva fórmula debe ser:

```txt
lambda_local =
lambda_base_local
* exp(AJUSTE_PSICO_LOCAL + AJUSTE_CONTEXTO_LOCAL + AJUSTE_RIESGO_VISITANTE)

lambda_visitante =
lambda_base_visitante
* exp(AJUSTE_PSICO_VISITANTE + AJUSTE_CONTEXTO_VISITANTE + AJUSTE_RIESGO_LOCAL)
```

Donde:

```txt
AJUSTE_PSICO_i
= beta_liderazgo * liderazgo_i
+ beta_incentivo * necesita_ganar_i
+ beta_generacion * generacion_peak_i
- beta_presion * presion_negativa_i
- beta_conflicto * conflicto_interno_i
- beta_ausencias_ofe * ausencias_ofensivas_i

AJUSTE_RIESGO_i
= beta_ausencias_def * ausencias_defensivas_i
+ beta_conflicto_def * conflicto_interno_i
- beta_liderazgo_def * liderazgo_i

AJUSTE_CONTEXTO_i
= alpha_necesita_ganar * necesita_ganar_i
+ alpha_jornada * efecto_jornada_grupo_i
+ alpha_gap_ranking * gap_ranking_fifa_i
+ alpha_interaccion * necesita_ganar_i * gap_ranking_fifa_i
+ alpha_sede * tipo_localidad_i
+ alpha_fase * fase_torneo_i
```

En implementación inicial, no deben activarse todos los términos con fuerza. Deben entrar por fases.

---

## 5. Principio clave: no todas las señales psicodeportivas entran igual

El error no es decir que lo psicodeportivo afecta. Sí afecta.

El error sería tratar todas las variables como si tuvieran la misma naturaleza.

Clasificación correcta:

| Variable | Tipo | Uso recomendado |
|---|---|---|
| `ausencias_ofensivas` | team_performance_proxy | Ajusta ataque propio |
| `ausencias_defensivas` | team_performance_proxy | Ajusta defensa propia / ataque rival |
| `lider_disponible` | team_performance_proxy | Ajuste positivo pequeño |
| `conflicto_interno` | team_performance_proxy con alto riesgo | Penalización si confianza suficiente |
| `necesita_ganar` | contextual_proxy | Ajuste contextual/incentivo |
| `presion_mediatica` | media_narrative_proxy | Penalización o alerta; peso bajo inicial |
| `generacion_peak` | team_performance_proxy | Ajuste positivo pequeño |
| `clasifico_sufriendo` | contextual_proxy | Señal de desgaste/resiliencia; no activar fuerte aún |
| `venganza_narrativa` | media_narrative_proxy | Registrar; no mover lambda al inicio |
| `rival_maldito` | media_narrative_proxy | Registrar; no mover lambda al inicio |
| `humillacion_previa` | media_narrative_proxy | Registrar; no mover lambda al inicio |
| `underdog` | market_bias_proxy | Betting Engine, no Prediction Engine |

---

## 6. Prioridad de implementación

### Fase urgente 1 — integrar ausencias

Implementar primero:

```txt
ausencias_ofensivas
ausencias_defensivas
```

Porque son las señales psicodeportivas más directamente conectadas con rendimiento.

Propuesta inicial:

```txt
ataque_ajustado_i =
ataque_i * (1 - PESO_AUSENCIAS_OFENSIVAS * ausencias_ofensivas_i * confianza_i)

defensa_ajustada_i =
defensa_i * (1 + PESO_AUSENCIAS_DEFENSIVAS * ausencias_defensivas_i * confianza_i)
```

Valores iniciales conservadores:

```txt
PESO_AUSENCIAS_OFENSIVAS = 0.15
PESO_AUSENCIAS_DEFENSIVAS = 0.15
```

Luego:

```txt
lambda_local =
(ataque_ajustado_local * defensa_ajustada_visitante / MU_LIGA) * FACTOR_LOCAL

lambda_visitante =
(ataque_ajustado_visitante * defensa_ajustada_local / MU_LIGA) * FACTOR_VISITANTE
```

Esto corrige la ausencia más grave sin reventar el modelo.

---

### Fase urgente 2 — integrar necesidad competitiva

Implementar:

```txt
necesita_ganar
```

No como boost emocional bruto, sino como ajuste pequeño sobre lambda.

Propuesta:

```txt
lambda_i = lambda_i * exp(PESO_NECESITA_GANAR * necesita_ganar_i * confianza_i)
```

Valor inicial:

```txt
PESO_NECESITA_GANAR = 0.05
```

Interpretación aproximada:

```txt
exp(0.05) ≈ 1.051
```

Es decir, alrededor de +5.1% sobre lambda, si la señal tiene confianza 1.

---

### Fase urgente 3 — reformular boost mundialista

El boost mundialista debe entrar como `C_torneo`, no como multiplicador general.

Variables mínimas:

```txt
ranking_fifa_local
ranking_fifa_visitante
gap_ranking_fifa
jornada_grupo
fase_torneo
tipo_localidad
```

Propuesta inicial:

```txt
gap_ranking_fifa_i =
ranking_rival - ranking_i
```

Si el equipo tiene mejor ranking que el rival, `gap_ranking_fifa_i` será positivo.

Normalización sugerida:

```txt
gap_norm_i = clamp(gap_ranking_fifa_i / 100, -1, 1)
```

Ajuste:

```txt
ajuste_ranking_i =
PESO_GAP_RANKING * gap_norm_i
```

Valor inicial conservador:

```txt
PESO_GAP_RANKING = 0.04
```

Ajuste por jornada:

```txt
efecto_jornada =
J1: 1.00
J2: 0.70
J3: 0.40
Eliminatorias: 0.60
```

Ajuste final:

```txt
lambda_i =
lambda_i * exp(PESO_GAP_RANKING * gap_norm_i * efecto_jornada)
```

Esto reemplaza formalmente el viejo boost mundialista.

---

### Fase urgente 4 — integrar liderazgo/conflicto con confianza

Después de ausencias y ranking, activar con pesos pequeños:

```txt
lider_disponible
conflicto_interno
presion_mediatica
generacion_peak
```

Propuesta:

```txt
ajuste_psico_i =
+ 0.03 * lider_disponible_i * confianza_lider
+ 0.03 * generacion_peak_i * confianza_generacion
- 0.04 * conflicto_interno_i * confianza_conflicto
- 0.02 * presion_mediatica_norm_i * confianza_presion
```

Luego:

```txt
lambda_i = lambda_i * exp(ajuste_psico_i)
```

Regla dura:

```txt
Si confianza < confianza_minima, el peso efectivo debe reducirse o anularse.
```

---

## 7. Qué NO debe implementarse todavía

No implementar todavía como ajuste directo de lambda:

```txt
venganza_narrativa
rival_maldito
humillacion_previa
underdog
```

Razón:

- `venganza_narrativa`, `rival_maldito` y `humillacion_previa` son narrativas mediáticas. Pueden afectar presión o mercado, pero su dirección causal no es estable.
- `underdog` es principalmente `market_bias_proxy`, por tanto pertenece al Betting Engine, no al Prediction Engine.

Estas variables sí deben mostrarse en la interfaz y guardarse en Firestore, pero no deben mover lambda en esta fase.

---

## 8. Archivos que Claude Code debe revisar

Revisar primero:

```txt
src/core/prediction/poisson.js
src/core/prediction/predecirPartidoCompleto.js
src/data/pipeline/equipoStats.js
src/data/pipeline/footballData.js
src/data/pipeline/fotmob.js
src/core/betting/bettingMath.js
scripts/predecirJ2ConHistorial.js
scripts/generarAnalisisPsicologicoPartido.js
```

Buscar además si existen:

```txt
src/core/psychology/
src/data/pipeline/psychology.js
src/firebase/analisisPsicologico.js
src/firebase/predicciones.js
data/rankings.json
config.js
```

---

## 9. Nuevos módulos recomendados

Crear un módulo separado para no ensuciar `poisson.js`:

```txt
src/core/prediction/contextAdjustments.js
```

Debe exportar funciones como:

```js
ajustarAtaqueDefensaPorAusencias({
  ataque,
  defensa,
  ausenciasOfensivas,
  ausenciasDefensivas,
  confianzaOfensivas,
  confianzaDefensivas
})

calcularAjustePsicodeportivo({
  liderDisponible,
  conflictoInterno,
  presionMediatica,
  generacionPeak,
  confianza
})

calcularAjusteMundialista({
  rankingEquipo,
  rankingRival,
  jornadaGrupo,
  faseTorneo,
  necesitaGanar,
  tipoLocalidad
})

aplicarAjusteExponencial(lambdaBase, ajuste)
```

---

## 10. Campos que deben guardarse en Firestore

En `predicciones/{matchId}`, agregar trazabilidad:

```js
ajustes_modelo: {
  psicodeportivo_activo: true,
  contexto_mundialista_activo: true,

  ataque_original_local: number,
  defensa_original_local: number,
  ataque_original_visitante: number,
  defensa_original_visitante: number,

  ataque_ajustado_local: number,
  defensa_ajustada_local: number,
  ataque_ajustado_visitante: number,
  defensa_ajustada_visitante: number,

  ajuste_psico_local: number,
  ajuste_psico_visitante: number,

  ajuste_contexto_local: number,
  ajuste_contexto_visitante: number,

  variables_psico_usadas: {
    ausencias_ofensivas_local: number,
    ausencias_defensivas_local: number,
    ausencias_ofensivas_visitante: number,
    ausencias_defensivas_visitante: number,
    necesita_ganar_local: boolean,
    necesita_ganar_visitante: boolean,
    lider_disponible_local: boolean,
    lider_disponible_visitante: boolean,
    conflicto_interno_local: number,
    conflicto_interno_visitante: number,
    presion_mediatica_local: number,
    presion_mediatica_visitante: number
  },

  variables_contexto_usadas: {
    ranking_fifa_local: number,
    ranking_fifa_visitante: number,
    gap_ranking_local: number,
    gap_ranking_visitante: number,
    jornada_grupo: number | null,
    fase_torneo: string,
    tipo_localidad: string
  },

  pesos_usados: {
    peso_ausencias_ofensivas: number,
    peso_ausencias_defensivas: number,
    peso_necesita_ganar: number,
    peso_gap_ranking: number,
    peso_liderazgo: number,
    peso_conflicto: number,
    peso_presion: number
  }
}
```

Regla: ninguna predicción enriquecida debe guardarse sin metadata de ajustes.

---

## 11. Reglas de seguridad metodológica

### 11.1 No sobrescribir V2 con estructura V1

El flujo de V1 no debe escribir en:

```txt
predicciones/{matchId}
```

Si se usa alguna parte de V1, solo debe reutilizarse la generación de análisis psicodeportivo, escribiendo en:

```txt
analisis_psicologico/{matchId}
```

### 11.2 No recalcular análisis psicodeportivo sin cache

Regla:

```txt
Si analisis_psicologico/{matchId} existe y estado == "completo":
    reutilizar
Si no existe y es día del partido:
    generar
Si no es día del partido:
    no generar
```

### 11.3 No activar narrativa débil como predictor fuerte

Las variables narrativas deben guardarse, auditarse y mostrarse, pero no deben mover lambda sin evidencia.

---

## 12. Pruebas obligatorias

Claude Code debe crear o ejecutar pruebas para validar:

### 12.1 Sanidad de lambda

```txt
lambda_local > 0
lambda_visitante > 0
lambda_local <= 4.5
lambda_visitante <= 4.5
no NaN
no Infinity
```

### 12.2 Comparación base vs enriquecido

Para un partido test:

```txt
lambda_base_local
lambda_enriquecido_local
delta_local

lambda_base_visitante
lambda_enriquecido_visitante
delta_visitante
```

El delta debe ser razonable.

Regla:

```txt
Si abs(delta_lambda / lambda_base) > 0.25:
    advertir ajuste excesivo
```

### 12.3 Ausencias

Caso test:

```txt
ausencias_ofensivas = 0.5
confianza = 1
peso = 0.15
```

Debe reducir ataque en:

```txt
7.5%
```

### 12.4 Ranking FIFA

Caso test:

```txt
ranking_equipo = 5
ranking_rival = 45
gap = 40
gap_norm = 0.40
peso = 0.04
efecto_jornada = 1
ajuste = 0.016
exp(0.016) ≈ 1.016
```

Debe aumentar lambda alrededor de 1.6%.

### 12.5 Necesita ganar

Caso test:

```txt
necesita_ganar = true
peso = 0.05
confianza = 1
exp(0.05) ≈ 1.051
```

Debe aumentar lambda alrededor de 5.1%.

---

## 13. Plan de implementación recomendado

### Paso 1 — Auditoría

Claude Code debe revisar el repo y responder:

```txt
1. ¿Dónde se calcula lambda?
2. ¿Dónde se arma la predicción completa?
3. ¿Dónde se lee analisis_psicologico?
4. ¿Dónde se guardan predicciones?
5. ¿Existe ya data/rankings.json?
6. ¿Qué variables P están disponibles hoy en Firestore o scripts?
7. ¿Las ausencias ya afectan ataque/defensa?
8. ¿ranking FIFA afecta algo hoy?
```

No programar antes de responder eso.

### Paso 2 — Crear módulo de ajustes

Crear:

```txt
src/core/prediction/contextAdjustments.js
```

Con funciones puras, testeables.

### Paso 3 — Integrar en `predecirPartidoCompleto.js`

Flujo correcto:

```txt
1. obtener ataque/defensa base
2. obtener análisis psicodeportivo si existe
3. obtener ranking FIFA y contexto del partido
4. calcular ataque/defensa ajustados
5. calcular lambda con Poisson
6. guardar metadata completa
```

### Paso 4 — Recalcular J2

Ejecutar:

```bash
node scripts/predecirJ2ConHistorial.js
```

Luego validar que `predicciones/{matchId}` tenga:

```txt
version_modelo >= 2.1
ajustes_modelo
lambda_local
lambda_visitante
prob_1x2
metadata_poisson
```

### Paso 5 — Documentar versión

Actualizar modelo a:

```txt
version_modelo: "2.1-psico-context"
```

O similar.

---

## 14. Prompt para Claude Code

Copiar y pegar esto en Claude Code:

```txt
Necesito corregir urgentemente el cerebro V2 de GoalEdge Analytics.

Diagnóstico:
El modelo actual quedó como Poisson estadístico base y no está integrando correctamente dos componentes centrales definidos en los documentos base:
1) capa psicodeportiva
2) boost mundialista / ranking FIFA / contexto de torneo

No quiero volver al modelo heurístico de V1.
Quiero mantener Poisson, pero enriquecer lambda con ajustes psicodeportivos y contextuales trazables.

Primero audita el repo y responde:
- dónde se calcula lambda
- dónde se arma la predicción completa
- dónde se lee analisis_psicologico
- dónde se guardan predicciones
- si ausencias_ofensivas / ausencias_defensivas ya afectan ataque/defensa
- si ranking FIFA / jornada / boost mundialista afectan el modelo actual
- qué archivos deben modificarse

No programes todavía hasta terminar esa auditoría.

Luego implementaremos:
- módulo separado contextAdjustments.js
- ajuste por ausencias ofensivas/defensivas
- ajuste por necesita_ganar
- ajuste por ranking FIFA / gap ranking / jornada
- metadata completa en Firestore
- versión_modelo 2.1-psico-context
- pruebas de sanidad de lambda y delta máximo

Reglas:
- no tocar Betting Engine salvo que sea necesario
- no mezclar narrativa débil como predictor fuerte
- no usar flujo V1 para escribir en predicciones
- no recalcular análisis psicodeportivo si ya existe cache
- todo ajuste debe guardar trazabilidad
```

---

## 15. Veredicto final

La V2 no debe quedar como un predictor estadístico simple.

La arquitectura correcta de GoalEdge Analytics es:

```txt
Poisson estadístico
+ ajuste psicodeportivo auditado
+ contexto mundialista formalizado
+ comparación contra mercado
+ calibración incremental
```

El error no fue crear Poisson. Poisson es la base correcta.

El error fue no conectar todavía las capas que hacían único al proyecto.

Este documento corrige el rumbo.

# Fase 3 — Calibration Engine: Checkpoint

**Fecha:** 2026-06-14
**Rama:** master
**Modelo activo:** v2.0 (Poisson, K=5, exponential weighting)

---

## 1. Estado general

| Componente | Estado |
|---|---|
| Métricas matemáticas puras (`calibrationMath.js`) | Implementado |
| Capa de lectura Firebase (`leerPrediccion`, `leerOddsSnapshot`) | Implementado |
| Persistencia de resultados reales (`resultados.js`) | Implementado |
| Auditoría de predicciones calibrables (Fase 3.0) | Implementado |
| Ingesta de resultados desde FotMob (Fase 3.1) | Preparado — dry-run |
| Dataset calibrable (Fase 3.2) | Implementado |
| Persistencia Firebase de calibración (Fase 3.3) | Implementado |
| **Calibración real ejecutada** | **No — J2 no se ha jugado** |

J2 comienza el 2026-06-18. Hasta entonces no hay resultados reales que calibrar.

---

## 2. Archivos creados

### Núcleo matemático
- `src/core/calibration/calibrationMath.js` — Brier Score, Log Loss, MAE goles, distancia marcador, calibration bins. Trabaja solo con 0/1 numérico.
- `scripts/probarCalibrationMath.js` — 54 checks, 0 fallos.

### Dataset calibrable
- `src/core/calibration/buildCalibrationDataset.js` — Une predicción V2 + resultado real + odds opcional en observaciones calibrables. Sin Firestore, sin APIs.
- `scripts/probarBuildCalibrationDataset.js` — 7 secciones, 0 fallos.

### Persistencia de resultados
- `src/firebase/resultados.js` — Colección `resultados/{matchId}`. Calcula derivados internamente (resultado_1x2, total_goles, over_under_result, btts_result).
- `scripts/probarResultadosFirebase.js` — 34 checks, 0 fallos. Documentos TEST_* quedan en Firestore.

### Auditoría
- `scripts/auditarCalibracion.js` — Lectura sola. Clasifica cada partido de J2 según disponibilidad de predicción V2, resultado y odds.

### Ingesta de resultados reales
- `scripts/guardarResultadosFinales.js` — Dry-run por defecto. Mapea football-data ↔ FotMob por fecha + fuzzy match de nombres.

### Persistencia de calibración
- `src/firebase/calibracion.js` — Colecciones `calibracion_partidos` y `calibracion_runs`. Sin cálculo de métricas.
- `scripts/probarFirebaseCalibracion.js` — 22 checks, 0 fallos.

---

## 3. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/firebase/predicciones.js` | Añadida `leerPrediccion(matchId)` antes de `guardarPrediccion` |
| `src/firebase/oddsSnapshots.js` | Añadida `leerOddsSnapshot(snapshotId)` antes de `guardarOddsSnapshot` |

---

## 4. Colecciones Firestore nuevas

| Colección | Clave | Propósito |
|---|---|---|
| `resultados/{matchId}` | matchId de football-data.org | Resultado real de cada partido |
| `calibracion_partidos/{matchId}_{version_modelo}` | p.ej. `537329_2.0` | Métricas de calibración por partido |
| `calibracion_runs/{runId}` | p.ej. `v2.0_20260618` | Resúmenes agregados por corrida |

Colecciones preexistentes usadas (sin modificar esquema):
- `predicciones/{matchId}`
- `odds_snapshots/{matchId}_{timestamp}`

---

## 5. Decisiones técnicas

### Parámetros del modelo — sin tocar
- No se ajustan pesos todavía.
- No se cambia `mu_liga`, `factor_local`, `factor_visitante`, ni `TAU`.
- Fase 3 solo mide. No modifica el motor de predicción.

### Separación de responsabilidades
- `calibrationMath.js` trabaja con `0/1` numérico exclusivamente. No acepta booleanos. No conoce Firestore.
- La conversión de `btts_result: true/false` → `0/1` ocurre en `buildCalibrationDataset.js`, no dentro de `calibrationMath.js`.
- `buildCalibrationDataset.js` no tiene efectos secundarios. Entrada y salida en memoria.

### Colecciones y campos
- Colección oficial de resultados: `resultados/{matchId}` (no `resultados_partidos`).
- `odds_snapshots` usa colección flat con clave `{matchId}_{timestamp}`.
- `marcador_mas_probable` usa campo `prob` como principal y `probabilidad` como fallback defensivo (hallazgo Paso 2: el campo real en Firestore es `prob`).

### Guard TEST_
- Todos los scripts de calibración ignoran matchIds que empiecen con `TEST_`.
- `guardarCalibracionPartido` rechaza activamente matchIds `TEST_*` con error explícito.
- Los documentos `TEST_*` en `resultados/` quedan en Firestore pero nunca entran al pipeline real.

### guardarResultadosFinales.js
- Dry-run por defecto: imprime lo que haría, no escribe.
- `--write` habilita escritura real.
- `--force` permite sobrescribir resultados existentes (solo con `--write`).
- Idempotente sin `--force`: omite partidos ya escritos.

---

## 6. Auditoría actual (ejecutada 2026-06-14)

**Fuente:** football-data.org matchday=2 (24 partidos)
**Reporte:** `reports/auditoria_calibracion_20260614233627.json`

| Clasificación | Cantidad |
|---|---|
| V2 limpias totales | 24 / 24 |
| Contaminadas V1 | 0 |
| Incompletas | 0 |
| `listo_calibracion_completa` (predicción + resultado + odds) | 0 |
| `listo_calibracion_partido` (predicción + resultado, sin odds) | 0 |
| `falta_resultado` | 24 |

Las 24 predicciones J2 están V2 limpias. Bloqueo único: J2 no se ha jugado.

---

## 7. Próximo paso cuando haya resultados J2

J2 comienza 2026-06-18. Secuencia de comandos:

```bash
# 1. Verificar qué partidos terminaron (dry-run)
node scripts/guardarResultadosFinales.js

# 2. Escribir resultados reales
node scripts/guardarResultadosFinales.js --write

# 3. Re-auditar para confirmar que pasaron a listo_calibracion_*
node scripts/auditarCalibracion.js
```

Con resultados cargados, el paso siguiente es implementar `calibrarPartidosFinalizados.js` que leerá predicciones + resultados, construirá el dataset con `buildCalibrationDataset`, calculará métricas con `calibrationMath` y persistirá en `calibracion_partidos` via `calibracion.js`.

---

## 8. Pendiente — no implementado todavía

- `scripts/calibrarPartido.js` — calibrar un partido individual
- `scripts/calibrarPartidosFinalizados.js` — batch de calibración
- `scripts/generarResumenCalibracion.js` — métricas agregadas y reporte de salud del modelo
- CLV real (Closing Line Value vs odds de cierre)
- Métricas agregadas reales (Brier Score global, calibration curve)
- Recomendaciones automáticas de ajuste
- Ajuste de parámetros del modelo
- Integración psicodeportiva (Fase 4)

---

## 9. Regla de avance

**No implementar ajuste automático hasta tener muestra suficiente.**

| Muestra | Acción permitida |
|---|---|
| < 49 partidos | Solo medir. No ajustar. |
| 49+ partidos | Evaluar recalibración externa (Brier, Log Loss). |
| 70+ partidos | Considerar ajuste de parámetros globales. |
| 104 partidos | Evaluación completa del torneo. Versión 2.1. |

La recalibración de Platt scaling u otras técnicas externas no modifica los pesos internos del modelo Poisson; opera sobre las probabilidades de salida. Cualquier ajuste de parámetros internos (K, TAU, factores) requiere decisión explícita fuera de este engine.

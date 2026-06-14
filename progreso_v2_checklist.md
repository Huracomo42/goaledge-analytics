# Progreso V2 — Checklist y Estado

**Proyecto Futboleros — Predictor Mundial 2026**
**Última actualización**: 14 de junio de 2026

Este documento resume qué se construyó, qué está pendiente, y por qué — para retomar
sin perder el hilo después de una pausa.

---

## Estado general

Fase de diseño (5 documentos del diccionario + esquema Firestore + especificación
Poisson) **completa**. Fase de implementación: **núcleo Prediction Engine funcionando
de punta a punta con datos reales**, primeras 24 predicciones de J2 guardadas en
Firestore.

---

## ✅ Lo que YA está construido y probado

### 1. Módulo Poisson (`src/core/prediction/poisson.js`)
- Calcula λ_local / λ_visitante desde ataque/defensa (E001/E002).
- Matriz de marcadores 7×7 + "otros".
- Deriva 1X2, Over/Under (1.5/2.5/3.5/4.5), BTTS, marcador más probable.
- Parámetros fijos: `MU_LIGA=1.35`, `FACTOR_LOCAL=1.10`, `FACTOR_VISIT=0.95`,
  clamps `[0.15, 4.5]`.
- Verificado contra el ejemplo Argentina vs Arabia Saudita (sección 3.3 de la
  especificación) — números coincidieron.
- `MU_LIGA` exportado para reuso en otros módulos (evita duplicación).

### 2. Conexión a football-data.org (`src/data/pipeline/footballData.js`)
- `obtenerPartidosMundial()` — fixture completo (104 partidos), con cache de proceso.
- Token funcionando (aunque **sigue siendo el token viejo, expuesto en V1 — ver
  sección de pendientes de seguridad**).
- Confirmado: el tier gratis NO da historial pre-Mundial de equipos (solo partidos
  del propio Mundial 2026) — esto cambió el diseño del cálculo de ataque/defensa.

### 3. Conexión a FotMob (`src/data/pipeline/fotmob.js`)
- `obtenerPartidosFotmobPorFecha(fecha)` y `obtenerDetallePartido(matchId)`.
- Funciona sin nodriver, con headers de V1 (User-Agent/Referer falsos) — sigue
  funcionando igual que en V1.
- xG confirmado disponible y más detallado que lo que V1 usaba (xG total, open play,
  set play, non-penalty, xGOT).

### 4. Cálculo de ataque/defensa (`src/data/pipeline/equipoStats.js`)
- `calcularAtaqueDefensa(equipoIdFotmob, fechaCorte)`.
- **Decisión de diseño clave**: el "historial" de cada equipo viene de sus PROPIOS
  partidos del Mundial 2026 ya jugados (no de clasificatorias/amistosos pre-Mundial,
  que el tier gratis de football-data no expone).
- Ponderación exponencial `w_s = e^(-0.1·s)` ya implementada (con n=1 o n=2 el efecto
  es mínimo, pero la fórmula está lista para cuando n crezca).
- Fallback a `MU_LIGA` con `fuente: "default_mu_liga"` cuando `n_partidos === 0`.
- Flag `muestra_pequena: true` cuando `n_partidos < 10` (siempre cierto por ahora).

### 5. Predicción completa por partido (`src/core/prediction/predecirPartidoCompleto.js`)
- Une fixture (football-data) + ataque/defensa de ambos equipos (FotMob) + Poisson.
- Incluye matching de nombres entre football-data y FotMob (función `normalizar` /
  `simNombres`) — funcionó sin necesidad de tabla de alias manual para los nombres
  vistos hasta ahora.

### 6. Firestore (`src/firebase/`)
- `init.js` — conexión vía Firebase Admin SDK, credenciales leídas desde
  `FIREBASE_CREDENTIALS_PATH` en `.env`.
- `predicciones.js` — `guardarPrediccion(matchId, datos)` → `setDoc` en
  `predicciones/{matchId}`.
- **24/24 predicciones de Jornada 2 guardadas**, con `version_modelo: "2.0"`,
  `generado_en` (timestamp del servidor), `fuentes_p_disponibles: false`.

### 7. Resultado de la corrida de J2 (14 jun 2026, ~07:16 UTC)
| Grupo de partidos | Cantidad | Fuente de ataque/defensa |
|---|---|---|
| J1 ya jugados al momento de generar (Czechia/SA, Suiza/Bosnia, Canadá/Qatar, México/Corea, USA/Australia, Escocia/Marruecos, Brasil/Haití, Turquía/Paraguay) | 8 | `fotmob_mundial_2026`, n=1 |
| J1 aún no jugados al momento de generar | 16 | `default_mu_liga`, n=0 |

Los 16 con `default_mu_liga` se sobrescribirán automáticamente (mismo script,
`setDoc` sin merge = reemplazo completo) cuando se jueguen sus J1 respectivos
(16-17 junio).

---

## ⚠️ Pendientes de seguridad (anotados, decisión consciente de NO resolver ahora)

- **Token de football-data.org**: valor en `.env`, el mismo expuesto en el repo de V1.
  Decisión explícita: no rotar por
  ahora. Si en algún momento el token deja de funcionar (rate limit, revocación por
  Anthropic/terceros), este es el primer lugar a revisar.
- **`.env.example`**: contiene el nombre real del archivo de credenciales de Firebase
  (`predictor-mundial-2026-cfbfe-firebase-adminsdk-fbsvc-11815c9d61....json`) en vez
  de un placeholder genérico. Revela el ID del proyecto Firebase. Decisión explícita:
  no corregir por ahora.
- **`.gitignore`** sí está bien configurado para `.env` y `*firebase-adminsdk*.json`
  — estos dos archivos NUNCA se suben a git, eso está protegido.

---

## 🔲 Pendiente — no depende del calendario (se puede hacer ya)

### Betting Engine (`src/core/betting/`)
- M002 `probabilidadImplicita` — `1/odds`.
- M003 `probabilidadNoVig` — normalización proporcional del overround.
- M004 `edge` y `expectedValue`.
- Conexión a The Odds API (`sport_key=soccer_fifa_world_cup`, `markets=h2h,totals`,
  key ya está en `.env` como `THE_ODDS_API_KEY`).
- Guardar snapshots en `odds_snapshots/{matchId}/{snapshotId}`.
- Extender `predicciones/{matchId}` con `comparacion_mercado` y `recomendaciones`.

### Colecciones faltantes del esquema
- `matches/{matchId}` — actualmente los datos de fixture viven embebidos dentro de
  `predicciones`. Falta su propia colección (C001/C003/C004/C005 del diccionario).
- `equipos/{equipoId}` — estado "vivo" de ataque/defensa por equipo, con
  `adaptado_altitud` (corrigiendo el bug de V1 documentado en C002).

### Bloque P (psicodeportivo)
- Extender/portar `analyzePsychology` (de V1) a V2.
- Las 10 variables de V1 + las 2 nuevas (`ausencias_ofensivas`, `ausencias_defensivas`
  — P_LES_OFE/DEF).
- Reclasificación con `tipo_proxy` y `confianza` (sin cambiar el prompt de Claude,
  según lo acordado).
- Colección `analisis_psicologico/{matchId}`.
- Activar el ajuste de `ataque_i`/`defensa_i` por ausencias (peso inicial 0.15) en
  `predecirPartidoCompleto.js`.

---

## 🔲 Pendiente — depende del calendario (esperar resultados reales)

| Fecha aprox. | Qué pasa | Qué hacer cuando pase |
|---|---|---|
| 15-17 jun 2026 | Se juegan los J1 restantes (los 16 grupos cuyo J1 faltaba) | Re-correr `scripts/predecirYGuardarJornada2.js` — los 16 docs `default_mu_liga` se actualizan a `fotmob_mundial_2026, n=1` |
| 18-20 jun 2026 | Se juega J2 completa (los 24 partidos ya predichos) | Guardar resultados reales en `resultados/{matchId}` (vía `getAdvancedMatchStats`/`syncAdvancedStats`, portado de V1). Comparar contra `prob_1x2` guardado — primer ejercicio real de evaluación (no calibración todavía, solo "mirar qué pasó") |
| Después de J2 | Cada equipo tiene n=2 partidos de historial | Las predicciones de J3 ya no tendrán el "duplicado de λ" que se vio en J2 (con n=1, varios pares de partidos daban λ idénticos por coincidencia numérica — con n=2 eso se diluye) |
| ~20+ partidos calibrables (con resultado + bloque P disponible) | Muestra mínima para calibración según el documento 3 | Recién ahí: Módulo 1 de calibración (auditoría de observaciones) tiene sentido ejecutarse |

---

## Recordatorios de diseño para no perder al retomar

1. **`backtest_v2` ya no es el camino** — se reemplazó por el enfoque "el historial de
   cada equipo viene de sus propios partidos del Mundial ya jugados", que es el MISMO
   pipeline para todo el torneo (no hay "modo backtest" separado de "modo producción").
   El documento `esquema_firestore_v2.md` menciona `backtest_v2` pero quedó obsoleto
   por esta decisión — no es necesario crear esa colección.

2. **"No entra a λ todavía" sigue aplicando** a: las 10 variables P de V1 (bloque P),
   todo el bloque C (altitud, localía, fase, gap ranking), y `B_A` (sesgo de mercado,
   M006). Solo E001/E002 (puros, sin ajuste de lesiones) están activos en λ hoy.

3. **El "duplicado de λ" en J2** fue, lo más probable, coincidencia numérica con n=1
   (no una ley matemática general como se sugirió en el momento) — si reaparece en J3
   con n=2, ahí sí valdría investigarlo; por ahora no es una alarma.

4. **Solo última versión activa del modelo** — confirmado, `predicciones/{matchId}` se
   sobrescribe con `setDoc` (reemplazo completo, no merge).

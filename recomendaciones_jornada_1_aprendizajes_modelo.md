# Recomendaciones y aprendizajes de Jornada 1 — GoalEdge / Futboleros V2

**Fecha de consolidación:** 17 de junio de 2026  
**Origen:** recomendaciones operativas observadas durante la Jornada 1 del Mundial 2026  
**Uso previsto:** carpeta `aprendizajes/` del proyecto, para que Claude Code traduzca estos hallazgos en reglas medibles, auditorías y ajustes de calibración para J2.

---

## 0. Conclusión ejecutiva

La Jornada 1 mostró que el problema principal no es solo “predecir mejor ganadores”. El error más peligroso fue recomendar combinadas rígidas del tipo **equipo gana + under/over**, cuando el partido tenía señales de cierre, incertidumbre o resistencia del underdog.

La corrección central para J2 es esta:

> Cuando el modelo detecta superioridad de un favorito pero también señales de partido cerrado, no debe forzar ganador. Debe migrar hacia mercados de protección: hándicap positivo del underdog, doble oportunidad, under/over moderado, tiros/corners o combinaciones conservadoras de goles.

Esto no reemplaza al modelo matemático. Es una capa de aprendizaje operativo para el Betting Engine y el Calibration Engine.

---

# 1. Aprendizaje 1 — No combinar ganador seco con partido cerrado

## Observación original

En partidos donde el análisis sugería un favorito, pero el contexto real era defensivo, cerrado o emocionalmente parejo, se recomendó algo como:

- gana Bélgica + under 2.5
- favorito gana + baja cantidad de goles

Durante Bélgica vs Egipto, el partido iba 1-1 y quedó claro que una combinación así era frágil. El usuario señaló que hubiera sido mejor usar un hándicap a favor del favorito o del equipo resistente, no un ganador seco.

## Problema detectado

El modelo trataba dos señales como si fueran compatibles automáticamente:

1. El favorito tiene mayor probabilidad de ganar.
2. El partido tiene perfil cerrado o under.

Pero en fútbol, un partido cerrado aumenta la probabilidad relativa de empate y reduce la seguridad del ganador. Por tanto, combinar “gana favorito” con “under” puede ser contradictorio si el diferencial esperado de goles es bajo.

## Regla operativa propuesta

Si se cumplen estas condiciones:

- favorito claro en probabilidad 1X2,
- diferencia esperada de goles baja o moderada,
- probabilidad de under relevante,
- underdog con señales de resistencia,
- partido de J1 o contexto mundialista de incertidumbre,

entonces el sistema debe bloquear o degradar recomendaciones del tipo:

```text
Favorito gana + Under 2.5
Favorito gana + marcador corto
```

Y debe priorizar:

```text
Favorito +0.0 / DNB
Favorito +0.5
Underdog +1.5
Underdog +2.0
Doble oportunidad del favorito
Under 3.5 en vez de Under 2.5
```

## Traducción técnica sugerida

Crear una bandera:

```js
partido_cerrado_con_favorito = true
```

Condiciones candidatas:

```js
prob_favorito > 0.45
lambda_total <= 2.6
prob_empate >= 0.25
gap_lambda <= 0.70
prob_under_3_5 >= 0.65
```

Si esta bandera está activa, el Betting Engine debe penalizar:

```js
mercado === "favorito_gana" && mercado_secundario === "under_2_5"
```

Y promover mercados protegidos.

---

# 2. Aprendizaje 2 — El “boost mundialista” existe, pero no aparece siempre

## Observación original

España vs Cabo Verde terminó 0-0. El usuario lo identificó como el ejemplo más claro del **boost mundialista** propuesto desde la V1: equipos inferiores pueden elevar su rendimiento competitivo en J1 por motivación, orden defensivo, orgullo nacional y baja presión.

Pero también se observó que no siempre ocurre: Alemania vs Curazao terminó en goleada. Por tanto, el boost no puede ser automático.

## Problema detectado

El modelo no debe aplicar un boost fijo al underdog solo por ser Mundial o solo por ser J1. Eso generaría falsos positivos en partidos donde la diferencia estructural sí se expresa en el marcador.

## Regla operativa propuesta

El boost mundialista debe tratarse como una **probabilidad condicional**, no como multiplicador automático.

Debe activarse solo cuando haya señales combinadas:

- Jornada 1.
- Underdog con baja presión externa.
- Favorito con presión de debut o expectativa alta.
- Underdog con bloque defensivo probable.
- Diferencia de ranking alta, pero no necesariamente diferencia extrema de xG reciente.
- Mercado inflado hacia el favorito.
- Narrativa de “partido histórico” para el underdog.

## Traducción técnica sugerida

Crear una variable:

```js
boost_mundialista_condicional
```

No debe modificar directamente el ganador. Debe afectar principalmente estos mercados:

```text
Underdog +1.5
Underdog +2.0
Underdog +2.5
Under 3.5
Favorito gana por margen bajo
No apostar ganador seco
```

## Advertencia clave

El boost mundialista no significa que el underdog vaya a ganar. Significa que el mercado puede estar subestimando su capacidad de resistir, especialmente en hándicaps amplios.

---

# 3. Aprendizaje 3 — En superioridad clara, mirar métricas de dominio antes que ganador

## Observación original

En España vs Cabo Verde, aunque el resultado fue 0-0, España sí fue superior. El usuario señaló que bastaba ver los disparos del partido para notar dominio real.

Por tanto, cuando hay superioridad clara pero el gol puede no llegar, conviene evitar “gana favorito” y mirar mercados de volumen:

- tiros,
- tiros al arco,
- corners,
- posesión territorial,
- presión ofensiva.

## Problema detectado

El modelo puede acertar la lectura futbolística —favorito domina— pero fallar el mercado si traduce dominio directamente en victoria.

Dominio ≠ gol.  
Dominio ≠ victoria.  
Dominio sí puede traducirse mejor en volumen ofensivo.

## Regla operativa propuesta

Cuando el favorito tenga superioridad estadística clara pero haya señales de baja conversión o bloque bajo rival, el sistema debe considerar mercados alternativos:

```text
favorito más tiros
favorito más tiros al arco
favorito más corners
over corners del favorito
handicap de corners
under goles + over tiros/corners del favorito
```

## Traducción técnica sugerida

Crear bandera:

```js
dominio_sin_garantia_de_gol = true
```

Condiciones candidatas:

```js
prob_favorito > 0.55
lambda_favorito >= 1.4
prob_under_3_5 >= 0.60
underdog_bloque_bajo === true
riesgo_baja_efectividad === true
```

Si está activa, reducir prioridad de:

```text
favorito gana
favorito -1.5
over 2.5
```

Y aumentar prioridad de:

```text
corners favorito
tiros favorito
handicap corners favorito
under 3.5
```

---

# 4. Aprendizaje 4 — El modelo puede acertar la lectura aunque pierda la apuesta

## Observación original

En Francia vs Senegal, el usuario apostó:

- goles totales under 3.5,
- hándicap +4 Senegal,
- más de 5.5 corners,
- menos de 5.5 tarjetas.

El partido fue cerrado. Senegal incluso tuvo goles anulados. El gol que mató una parte de la apuesta llegó al minuto 96, después de +8 minutos agregados. El usuario concluyó que técnicamente el modelo no falló en la lectura: fue un partido cerrado y Senegal compitió.

## Problema detectado

La evaluación del modelo no puede ser binaria tipo “ganó/perdió apuesta”. Hay apuestas que pierden por eventos de cola:

- gol tardío,
- descuento largo,
- VAR,
- goles anulados,
- expulsión,
- penal aislado,
- error puntual del arquero.

Si el partido cumplió la estructura esperada, el modelo debe registrar un acierto parcial de lectura, aunque el ticket haya perdido.

## Regla operativa propuesta

Separar tres evaluaciones:

1. **Resultado de apuesta:** ganó/perdió.
2. **Lectura del partido:** cerrado/abierto, dominio, resistencia, ritmo.
3. **Calidad de recomendación:** si el mercado elegido era robusto frente al escenario.

## Traducción técnica sugerida

Agregar al calibrador postpartido:

```js
lectura_partido_correcta: boolean
perdio_por_evento_tardio: boolean
minuto_evento_decisivo: number
var_relevante: boolean
goles_anulados_relevantes: number
```

Y una categoría:

```js
resultado_calibracion = "modelo_bien_ticket_mal";
```

## Uso recomendado

No ajustar negativamente el modelo principal si:

- el partido fue cerrado como se esperaba,
- el underdog resistió como se esperaba,
- el mercado elegido perdió por un evento extremo tardío.

Sí ajustar el Betting Engine si el mercado tenía poca protección ante ese riesgo.

---

# 5. Aprendizaje 5 — Los hándicaps amplios del underdog son útiles en J1

## Observación original

El usuario detectó valor en hándicaps como:

- Senegal +4,
- Nueva Zelanda +2,
- underdog +1.5 / +2 / +2.5,
- hándicaps positivos combinados con goles mínimos.

La lógica: en J1, muchos equipos inferiores todavía llegan vivos, ordenados y emocionalmente enteros. El favorito puede dominar, pero no necesariamente golear.

## Problema detectado

El modelo V1/V2 inicial no tenía una capa clara para transformar “partido cerrado con favorito” en “hándicap positivo del underdog”. Tenía mercados separados, pero no lógica combinada.

## Regla operativa propuesta

Para J1 y J2 temprana, priorizar hándicaps positivos cuando:

- el underdog llega con titulares,
- no hay crisis interna,
- el favorito tiene presión alta,
- el lambda total no sugiere goleada,
- el mercado ofrece margen amplio,
- el underdog tiene incentivo de competir, no de especular sin intensidad.

## Traducción técnica sugerida

Crear un selector:

```js
seleccionarHandicapUnderdog(match) {
  if (
    match.jornada_grupo <= 2 &&
    match.underdog_resistente &&
    match.lambda_total <= 3.0 &&
    match.gap_lambda <= 1.25 &&
    match.sin_crisis_underdog
  ) {
    return ["underdog +1.5", "underdog +2.0", "underdog +2.5"];
  }
}
```

La línea exacta debe depender de cuota y EV real, no de intuición.

---

# 6. Aprendizaje 6 — Combinaciones conservadoras: hándicap + goles mínimos

## Observación original

Para Irán vs Nueva Zelanda, se exploró una jugada como:

- hándicap +2 Nueva Zelanda,
- más de 0.5 goles totales.

También se consideró:

- Irán o empate + ambos anotan,
- aunque esa combinación es más agresiva.

## Problema detectado

El modelo necesita diferenciar entre combinadas agresivas y combinadas de protección.

No es lo mismo:

```text
favorito gana + ambos anotan
```

que:

```text
underdog +2 + over 0.5 goles
```

La segunda no exige acertar ganador ni marcador exacto; solo exige que el partido no sea una goleada extrema y que haya al menos un gol.

## Regla operativa propuesta

Para partidos con underdog competitivo, usar combinaciones de baja exigencia:

```text
underdog +1.5 / +2 / +2.5
+ over 0.5 goles totales
```

O, si el favorito es muy superior pero el underdog puede aguantar:

```text
favorito +0.5
+ over 0.5 goles totales
```

## Traducción técnica sugerida

Crear clasificación de combinadas:

```js
combinada_tipo = "proteccion" | "moderada" | "agresiva"
```

Ejemplos:

```text
Protección: handicap +2 underdog + over 0.5 goles
Moderada: favorito +0.5 + over 0.5 goles
Agresiva: favorito gana + BTTS
Muy agresiva: favorito gana + under 2.5 + marcador exacto implícito
```

El Betting Engine debe limitar combinadas agresivas si el partido tiene alta incertidumbre.

---

# 7. Aprendizaje 7 — “Apuesta segura” no debe significar ganador; debe significar baja fragilidad

## Observación original

Para Argentina vs Argelia, se buscó algo “seguro”. La opción más conservadora fue:

- Argentina +0.5,
- total partido +0.5 goles.

La cuota aproximada fue 1.13 primero y luego 1.35 según combinación disponible.

## Problema detectado

El usuario detectó correctamente que “seguro” no debe traducirse como “Argentina gana”. En apuestas, seguridad significa reducir condiciones de fallo.

Argentina +0.5 falla solo si Argentina pierde.  
Over 0.5 falla solo si el partido queda 0-0.  
La combinación evita depender de margen, marcador exacto o victoria obligatoria.

## Regla operativa propuesta

Crear una categoría de recomendación:

```text
apuesta_segura_operativa
```

Criterios:

- no exige ganador seco,
- no exige muchos goles,
- no exige ambos anotan,
- no depende de margen amplio,
- tolera empate o marcador corto.

## Traducción técnica sugerida

Variables de fragilidad:

```js
fragilidad_ganador_seco
fragilidad_linea_goles
fragilidad_btts
fragilidad_handicap_negativo
fragilidad_evento_raro
```

Score:

```js
fragilidad_total = suma_ponderada(fragilidades)
```

Una apuesta “segura” debe tener:

```js
fragilidad_total <= umbral_bajo
EV >= 0 || cuota_aceptable_para_experimento
```

---

# 8. Aprendizaje 8 — Evitar desviarse durante el experimento de S/70

## Observación original

Durante el experimento de S/70, el usuario notó que se estaba desviando al explorar muchas combinadas y mercados. La recomendación correcta fue volver al objetivo del proyecto: aprender del modelo, no maximizar adrenalina ni armar tickets por impulso.

## Problema detectado

El mayor riesgo operativo no es solo el error del modelo. Es la dispersión del apostador:

- cambiar de plan,
- agregar combinadas de último minuto,
- perseguir cuota,
- mezclar señales no compatibles,
- duplicar exposición al mismo supuesto.

## Regla operativa propuesta

Cada experimento debe tener:

```text
bankroll fijo
número máximo de apuestas
stake fijo o regla simple
mercados permitidos
mercados prohibidos
criterio de registro postpartido
```

## Traducción técnica sugerida

Crear un archivo de experimento:

```json
{
  "experimento": "J1_70_soles",
  "bankroll": 70,
  "stake_unitario": 10,
  "max_apuestas": 7,
  "mercados_permitidos": ["handicap positivo", "under 3.5", "over 0.5", "doble oportunidad"],
  "mercados_bloqueados": ["marcador exacto", "favorito gana + under 2.5 sin protección", "combinadas de más de 3 eventos"]
}
```

---

# 9. Aprendizaje 9 — El modelo necesita registrar recomendaciones humanas como capa adicional

## Observación original

El usuario preguntó si estos aprendizajes son adicionales a lo que el modelo tiene que aprender. La respuesta correcta es sí: estos aprendizajes no reemplazan el modelo, pero sí deben convertirse en reglas medibles, features o criterios de auditoría.

## Problema detectado

Hay dos tipos de aprendizaje:

1. Aprendizaje estadístico del modelo: pesos, probabilidades, calibración.
2. Aprendizaje táctico-operativo humano: qué mercados son más robustos según el tipo de partido.

Si no se registran por separado, el proyecto pierde una de sus ventajas: combinar modelo probabilístico con inteligencia de mercado observada en vivo.

## Regla operativa propuesta

Crear una colección o carpeta:

```text
aprendizajes/
```

Y dentro registrar cada aprendizaje con:

```text
id_aprendizaje
partido_origen
observacion_humana
problema_detectado
regla_propuesta
variables_afectadas
mercados_afectados
prioridad
estado_implementacion
```

## Traducción técnica sugerida

Estructura JSON equivalente:

```json
{
  "id": "J1_A04",
  "titulo": "Modelo bien, ticket mal por evento tardio",
  "partidos_origen": ["France vs Senegal"],
  "tipo": "calibracion_postpartido",
  "afecta": ["Calibration Engine", "Betting Engine"],
  "regla": "Separar lectura correcta del partido del resultado binario de la apuesta",
  "prioridad": "alta",
  "estado": "pendiente_codigo"
}
```

---

# 10. Priorización para implementación en J2

## Prioridad 1 — Bloqueo de combinadas contradictorias

Implementar primero.

```text
No recomendar favorito gana + under fuerte si el partido tiene señales de cierre y empate relevante.
```

Impacto: alto.  
Dificultad: media.  
Riesgo: bajo.

---

## Prioridad 2 — Selector de hándicap positivo del underdog

Implementar segundo.

```text
Cuando el favorito domina pero el partido no proyecta goleada, evaluar underdog +1.5 / +2 / +2.5.
```

Impacto: alto.  
Dificultad: media.  
Riesgo: bajo.

---

## Prioridad 3 — Registro de lectura postpartido

Implementar tercero.

```text
Separar acierto del modelo, acierto del mercado y resultado del ticket.
```

Impacto: alto para calibración.  
Dificultad: media-alta.  
Riesgo: bajo.

---

## Prioridad 4 — Mercados de dominio: tiros/corners

Implementar cuando haya datos confiables.

```text
Si el favorito domina pero puede no convertir, mover recomendación hacia tiros/corners.
```

Impacto: medio-alto.  
Dificultad: alta porque depende de disponibilidad de cuotas y datos.  
Riesgo: medio.

---

## Prioridad 5 — Clasificación de fragilidad de apuestas

Implementar como capa de explicación.

```text
No basta EV positivo. También medir cuántas condiciones deben cumplirse para ganar la apuesta.
```

Impacto: alto en disciplina operativa.  
Dificultad: media.  
Riesgo: bajo.

---

# 11. Reglas finales para Claude Code

## 11.1 No tocar pesos del modelo todavía

Estos aprendizajes no justifican recalibrar pesos grandes con pocos partidos. Primero deben entrar como:

- flags,
- auditorías,
- filtros de recomendación,
- criterios de clasificación de mercados,
- metadata postpartido.

## 11.2 No convertir intuiciones en fórmulas duras sin logging

Toda regla nueva debe registrar cuándo se activó y qué habría recomendado el sistema sin esa regla.

Ejemplo:

```js
regla_activada: "bloqueo_favorito_gana_under"
recomendacion_original: "Belgium gana + Under 2.5"
recomendacion_reemplazo: "Belgium +0.0 / Egypt +1.5 / Under 3.5"
```

## 11.3 Toda recomendación debe indicar mercado alternativo

No basta con bloquear. Si una apuesta se considera frágil, el sistema debe explicar cuál es el mercado más robusto equivalente.

## 11.4 Separar evaluación de predicción y evaluación de apuesta

Un partido puede tener:

```text
predicción futbolística correcta
selección de mercado incorrecta
apuesta perdida por evento extremo
```

Eso debe quedar registrado.

---

# 12. Resumen corto de aprendizajes

| ID | Aprendizaje | Acción principal |
|---|---|---|
| J1_A01 | No combinar ganador seco con partido cerrado | Bloquear favorito gana + under fuerte si empate/under alto |
| J1_A02 | Boost mundialista condicional | Usarlo para hándicaps/unders, no para ganador automático |
| J1_A03 | Dominio no siempre es victoria | Usar tiros/corners cuando hay dominio sin garantía de gol |
| J1_A04 | Modelo puede acertar aunque pierda ticket | Separar lectura del partido vs resultado de apuesta |
| J1_A05 | Hándicaps amplios del underdog son útiles en J1 | Crear selector underdog +1.5/+2/+2.5 |
| J1_A06 | Combinadas de protección son distintas de agresivas | Clasificar combinadas por fragilidad |
| J1_A07 | “Seguro” significa baja fragilidad, no ganador | Crear score de fragilidad de apuesta |
| J1_A08 | Evitar desviación del experimento | Definir bankroll, número de apuestas y mercados permitidos |
| J1_A09 | Aprendizajes humanos deben versionarse | Crear carpeta/colección de aprendizajes |

---

# 13. Recomendación única

La mejor decisión para J2 es no tocar el corazón Poisson todavía. Primero hay que fortalecer el Betting Engine con una capa de **selección robusta de mercado**.

El modelo puede estar leyendo bien los partidos, pero si traduce esa lectura al mercado equivocado, el proyecto pierde dinero y aprende mal.


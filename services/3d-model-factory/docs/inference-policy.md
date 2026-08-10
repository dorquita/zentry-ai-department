# 3D Model Factory — Política de inferencia

Regla dura de todo el sistema: **nunca presentar una inferencia como si fuera un dato confirmado.** Cada afirmación sobre un producto cae en una de 4 categorías, y el manifest (`manifest.json`) las mantiene siempre separadas — nunca mezcladas en una sola lista genérica de "datos del producto".

## Las 4 categorías

| Categoría | Qué significa | Campo en el manifest |
|---|---|---|
| **Verificado** | Confirmado por una fuente directa: una foto clara, una medida real dada por el cliente, una ficha técnica oficial del fabricante. Debe poder trazarse a esa fuente. | `verifiedFacts[]` — cada entrada lleva `source` |
| **Inferido** | Deducción razonada a partir de datos parciales (ej. proporciones típicas del sector, comparación de una foto con un objeto de tamaño conocido en la misma imagen). Siempre con el razonamiento explícito y, cuando aplique, un rango en vez de un valor único. | `inferredFacts[]` — cada entrada lleva `reasoning` y opcionalmente `confidenceRange` |
| **Supuesto** | Trabajo de partida sin evidencia directa (ej. "la parte trasera replica la estructura frontal" cuando solo hay una foto frontal). Debe poder revisarse o descartarse sin rehacer todo el modelo, y lleva un nivel de riesgo. | `assumptions[]` — cada entrada lleva `risk: low/medium/high` |
| **Pendiente de validar** | Preguntas abiertas que un humano debe confirmar antes de dar el modelo por definitivo. | `pendingValidation[]` |

## Ejemplo (del propio encargo, banco de vestuario con una sola foto)

- **Verificado:** el asiento es de listones de madera. *(se ve claramente en la foto)*
- **Inferido:** la profundidad parece entre 350 y 450 mm. *(comparado con la altura típica de un banco de vestuario, 450mm, y la proporción visual asiento/altura en la foto)*
- **Supuesto:** la parte trasera replica la estructura frontal. *(no hay foto trasera — se asume simetría porque es el diseño habitual en bancos de este tipo, riesgo bajo)*
- **Pendiente:** grosor exacto del listón. *(no se puede estimar con fiabilidad suficiente desde una foto sin referencia de escala — requiere que el cliente lo mida o aporte ficha técnica)*

## Qué se puede inferir con una sola foto (política, no automatizada todavía en O24.1)

Cuando solo hay una foto disponible, es razonable:
- Asumir simetría si el tipo de producto lo justifica (un banco, una taquilla — no necesariamente una pieza decorativa asimétrica).
- Inferir profundidad aproximada a partir de la perspectiva y de proporciones típicas del sector.
- Inferir grosor de piezas estructurales a partir de referencias visuales (grosor relativo al resto de la pieza).
- Reconstruir partes ocultas con geometría industrial razonable (una pata que se ve solo parcialmente, pero cuyo diseño es predecible).
- Usar proporciones típicas del sector como punto de partida, nunca como sustituto de una medida real si el cliente puede aportarla.

Todo lo anterior son **inferencias o supuestos**, nunca datos verificados — y siempre se documentan con su razonamiento, no solo con el resultado.

## `inference_tolerance` del request

Controla **cuánto** está dispuesto a asumir el sistema antes de dejar una etapa en `pending_input`/`blocked` en vez de avanzar con un supuesto documentado — nunca cambia el requisito de etiquetar todo:

- **`low`**: solo avanzar con datos verificados o inferencias de bajo riesgo. Si falta demasiado, la etapa se queda pendiente en vez de rellenar huecos con supuestos.
- **`medium`** (por defecto): inferir con prudencia, documentar siempre. Es el equilibrio recomendado para la mayoría de productos.
- **`high`**: permitir más supuestos para poder llegar a un primer modelo aproximado rápido, todavía siempre con su etiqueta de riesgo — pensado para prototipos exploratorios rápidos, no para el modelo que se llevará a `approved_staging`.

## Umbral de confianza global (`confidence` del manifest)

Derivado (heurísticamente, en O24.1 de forma muy simple — cuántas etapas del pipeline llegaron a `done`) de la proporción entre hechos verificados y el resto. No sustituye la lectura de `verifiedFacts`/`inferredFacts`/`assumptions` — es un resumen rápido para priorizar qué modelos necesitan más trabajo humano antes de aprobarse, nunca un criterio de aprobación automática.

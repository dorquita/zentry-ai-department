# Informe — Banco de vestuario de pino simple (banco-vestuario-pino)

Cliente: `zentry` · Proyecto: `zentry-lockers` · Generado: 2026-08-09T15:12:25.678Z

**qaStatus:** pending_human_approval · **confidence:** medium · **modelingStrategy:** blender_parametric

## Verificado

- Material del asiento: madera de pino de Suecia, cepillada. _(fuente: producto-woocommerce-staging.md (WooCommerce staging, producto id 1988))_
- Grosor de cada listón del asiento: 25mm. _(fuente: producto-woocommerce-staging.md)_
- Patas de tubo de acero de sección CUADRADA 30x30x1.5mm, soldadas, pintura epoxi 60 micras. _(fuente: producto-woocommerce-staging.md)_
- El modelo simple lleva un refuerzo/listón metálico de unión entre patas (no lleva zapatero). _(fuente: producto-woocommerce-staging.md)_
- Longitudes reales disponibles: 1000mm, 1500mm, 2000mm. _(fuente: producto-woocommerce-staging.md + atributo WooCommerce 'Longitud')_
- Tacos antideslizantes y herrajes de acero inoxidable (NO modelados como geometría separada en este MVP). _(fuente: producto-woocommerce-staging.md)_

## Inferido

- Altura del asiento sobre el suelo: 450mm (usada en el modelo). _(No confirmado en ninguna fuente real. Mismo valor que el prototipo JS de O23 (SEAT_HEIGHT), dentro del rango ergonómico estándar de bancos de vestuario., rango: 420-460mm)_
- Profundidad del asiento: 300mm (usada en el modelo). _(No confirmado en ninguna fuente real. Mismo valor que el prototipo JS de O23 (SEAT_DEPTH), compatible visualmente con la imagen de referencia no verificada., rango: 280-320mm)_
- El asiento tiene 4 listones de madera (usado en el modelo). _(Contado visualmente en referencia-visual-o21-NO-VERIFICADA.webp (imagen IA de marketing de O21, no una foto real)., rango: 3-5 listones)_

## Supuestos

- Las patas se modelan con sección CUADRADA (30x30mm, fuente verificada) -- la imagen de referencia no verificada muestra patas de sección redonda, discrepancia no resuelta. _(riesgo: low)_
- El refuerzo metálico se modela como una barra horizontal a 80mm de altura, corriendo a lo largo de la longitud entre las dos patas -- ninguna foto confirma su posición/forma real. _(riesgo: medium)_
- Las patas están insertadas 80mm hacia dentro desde cada extremo del asiento. _(riesgo: low)_
- Gap de 6mm entre listones del asiento (no medido, valor de diseño razonable). _(riesgo: low)_
- Tono de madera/color de pintura metálica aproximados (presets de src/lib/materials.ts), no calibrados contra una muestra real. _(riesgo: low)_

## Pendiente de validar

- Confirmar con una foto real si las patas son de sección cuadrada (texto oficial) o redonda (imagen IA de marketing) -- discrepancia real detectada, no resuelta.
- Confirmar altura y profundidad reales del banco.
- Confirmar posición/forma exacta del refuerzo metálico entre patas.
- Confirmar número real de listones del asiento.
- Aprobación humana explícita (Agente 12) -- todavía no concedida.

## Componentes del modelo

- `asiento` — Empty padre -- escalar en X escala la longitud completa del conjunto de listones.
- `asiento_liston_1`
- `asiento_liston_2`
- `asiento_liston_3`
- `asiento_liston_4`
- `pata_izquierda`
- `pata_derecha`
- `refuerzo_metalico` — Pieza verificada por texto, posición geométrica inferida -- ver assumptions.

## Archivos de salida

- GLB: `clients/zentry/outputs/3d-models/banco-vestuario-pino/banco-vestuario-pino.glb` (11380 bytes, 84 caras)
- Script fuente: `clients/zentry/outputs/3d-models/banco-vestuario-pino/source/blender-generate.py`
- Preview: `clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/front.png`
- Preview: `clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/side.png`
- Preview: `clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/perspective.png`

## Siguientes acciones

- Revisar visualmente previews/*.png contra la imagen de referencia y confirmar que el resultado es aceptable.
- Decidir cómo resolver la discrepancia sección cuadrada vs redonda de las patas (idealmente con una foto real).
- Confirmar altura/profundidad reales si el cliente puede medir un banco físico.
- Aprobación humana explícita antes de considerar este modelo listo para cualquier uso posterior (conexión con O23, subida a WordPress) -- ninguna de las dos cosas se ha hecho todavía.

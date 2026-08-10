# O22.1 — Auditoría y plan: Cerraduras Zentry (Tanda 2)

**Fecha:** 2026-08-07
**Alcance de esta fase:** solo lectura. No se ha creado ni modificado ningún producto, categoría, imagen, página, menú ni fichero de theme/functions.php en staging ni en producción.
**Fuente del catálogo:** `catalogo-zentry.pdf` ("TARIFA TAQUILLAS Y COMPLEMENTOS 2025"), página 34 — única página del PDF (44 páginas totales, verificado escaneando las 44) que menciona cerraduras.

## 1. Catálogo — familia Cerraduras (dato real, sin inventar)

**Aviso de integridad de datos:** la primera extracción de texto automática del PDF confundió dos precios por un problema de columnas (leyó "70€"/"76€"). Se corrigió renderizando la página como imagen y leyendo los precios visualmente. Los valores de abajo son los verificados visualmente.

### Cerraduras para taquilla (mecánicas)
| Modelo | SKU cerradura | Precio | SKU llave maestra | Precio llave | Restricción |
|---|---|---|---|---|---|
| Cerradura de bombillo | VCERBOM | 10 € | VCERBOM-LL | 7 € | Solo taquillas metálicas |
| Cerradura de resbalón | VCERRES | 25 € | VCERRES-LL | 7 € | No disponible en metálicas |
| Cerradura de moneda | VCERMON | 34 € | VCERMON-LL | 7 € | — |
| Cerradura candado | VCERCAN | 16 € | (no se muestra llave maestra separada) | — | No disponible en metálicas |

### Cerraduras inteligentes con APP Tukandado
| Modelo | Tecnología | Precio | SKU en catálogo |
|---|---|---|---|
| BOXIS | Cabinet invisible — APP, RFID | 30 € | No indicado |
| CODE | Con teclado — APP, RFID, PIN | 55 € | No indicado |
| YR TITAN | Candado IP67 — APP y huella digital | 45 € | No indicado |
| NEO | Con teclado — APP, RFID | 38 € | No indicado |
| NF ZERO | NFC — APP sin batería | 28 € | No indicado |

Nota del catálogo (footer de la página): *"Consultar nuevas incorporaciones y precios por cantidades"* — sugiere que la tarifa puede no ser exhaustiva y que hay precios por volumen no reflejados aquí.

**Dato ausente que no se debe inventar:** ninguno de los 5 modelos Tukandado tiene SKU asignado en el catálogo (a diferencia de las 4 mecánicas, que sí lo tienen). Habrá que decidir/confirmar SKUs antes de crear productos.

## 2. Auditoría de la web actual (staging + producción, solo lectura)

### WooCommerce — productos
- **Producción y staging:** 0 productos dedicados a cerraduras. La única coincidencia al buscar "cerradura" es un producto de taquilla (id 334) cuya descripción menciona el término, no un producto de cerradura.

### WooCommerce — categorías
- **Producción y staging:** 0 categorías de producto relacionadas con cerraduras.

### WooCommerce — atributo existente (hallazgo importante)
Ya existe un **atributo global** `Tipo de cerradura` (id 4, slug `pa_tipo-de-cerradura`) en producción, con estos términos:

| Término | id | count (nº productos que lo usan) |
|---|---|---|
| Ares | 65 | 1 |
| Boxis | 64 | 1 |
| Neo | 70 | 1 |
| Orbis | 72 | 1 |
| YR Titan | 71 | 1 |
| Cerradura estándard | 73 | 0 |

Este atributo está configurado en **54 de los 63 productos** de taquillas de producción (variable products) como opción de configuración al comprar una taquilla — es decir, hoy el cliente ya elige "qué cerradura quiere" al comprar una taquilla, pero no puede comprar la cerradura como producto independiente, trazable o sustituible por separado.

### Páginas de contenido (las 3 pedidas + 2 enlazadas desde ellas)
| URL | Tipo | id | Status | HTTP live | Contenido |
|---|---|---|---|---|---|
| `/cerraduras/` | Página (Kadence builder) | 1751 | publish | 200 | Landing con 4 modelos: **BOXIS, ARES, NEO, ORBIS** (imágenes + descripción + botón "Pedir información" → `/contacto/`) |
| `/cerraduras-inteligentes-taquillas/` | Página | 1865 | publish | 200 | Contenido educativo (qué son, tipos de apertura, sectores, FAQ Yoast), menciona los mismos 4 modelos |
| `/digitalizacion-taquillas/` | Página | 1867 | publish | 200 | Servicio de retrofit sobre taquillas existentes, FAQ Yoast |
| `/cerraduras-inteligentes-taquillas-pin-rfid-app/` | **Entrada de blog** (no página) | 1915 | — | 200 | Comparativa PIN vs RFID vs app, enlazada desde las 2 páginas anteriores |
| `/digitalizar-taquillas-existentes/` | **Entrada de blog** (no página) | 1912 | — | 200 | Guía de digitalización, enlazada desde las 2 páginas anteriores |

Ninguna de las 5 URLs enlaza a ningún `/product/` (confirma que no hay productos de cerraduras todavía). Contenido de calidad ya publicado y con FAQ/schema — no es contenido a descartar, es contenido a **conectar** con productos reales.

### Imágenes ya existentes (contenido, no producto)
8 imágenes ya subidas y en uso en las 3 páginas: `KERONG-BOXIS-1.jpg` (1757), `ARES-11.jpg` (1760), `NEO-1-1.avif` (1765), `KERONG-CAMBIO-2-1.png` (1764), `cerradura-inteligente-taquilla-electronica.webp` (1895), `modelos-cerraduras-inteligentes-taquillas-ares-orbis-boxis.webp` (1905), `digitalizacion-taquillas-existentes-cerradura-electronica.webp` (1896), `proceso-digitalizacion-taquillas-existentes.webp` (1906).

**Hallazgo de marca en los nombres de archivo:** varias imágenes usan el prefijo `KERONG-` (fabricante de hardware), no `TUKANDADO-` (marca/app usada en el catálogo 2025). Ver sección 6.

### Menú
Ítem "Cerraduras" ya existe (id 307, `menu_order:10`, entre Bancos de vestuario y Sectores) → `/cerraduras/`. **Sin submenú** (0 hijos).

### Enlaces internos actuales
- `/taquillas/` y `/taquillas-por-sector/`: ya mencionan "cerradura" (coherente con el botón "Ver cerraduras inteligentes" documentado en fases anteriores).
- Las 6 páginas de sector (`taquillas-para-gimnasios/colegios/empresas/centros-deportivos/industria/oficinas`): las 6 mencionan "cerradura" en el texto de producto.
- `/bancos-de-vestuario/`: **no** menciona cerraduras — hueco de enlazado, no crítico.

## 3. Tabla comparativa: catálogo vs web

| Modelo/producto | ¿En catálogo 2025? | ¿Producto WC? | ¿Atributo WC? | ¿En página `/cerraduras/`? | Categoría recomendada | Prioridad |
|---|---|---|---|---|---|---|
| Cerradura de bombillo (VCERBOM) | Sí, 10€ | No | No | No | Cerraduras mecánicas | Media |
| Cerradura de resbalón (VCERRES) | Sí, 25€ | No | No | No | Cerraduras mecánicas | Media |
| Cerradura de moneda (VCERMON) | Sí, 34€ | No | No | No | Cerraduras mecánicas | Media |
| Cerradura candado (VCERCAN) | Sí, 16€ | No | No | No | Cerraduras mecánicas | Baja |
| Llaves maestras (3 SKU) | Sí, 7€ c/u | No | No | No | Accesorio | Baja — fuera del MVP |
| **BOXIS** | Sí, 30€ | No | Sí (count 1) | Sí | Inteligente RFID | **Alta** |
| **NEO** | Sí, 38€ | No | Sí (count 1) | Sí | Inteligente RFID | **Alta** |
| **CODE** | Sí, 55€ | No | No | No | Inteligente PIN/RFID | **Alta** |
| **YR TITAN** | Sí, 45€ | No | Sí (count 1) | No (falta en la página, sí en el atributo) | Candado inteligente | Media-alta |
| **NF ZERO** | Sí, 28€ | No | No | No | Inteligente NFC | Media |
| ARES | **No aparece en la tarifa 2025** | No | Sí (count 1) | Sí | Sin confirmar | ⚠️ Aclarar antes de crear |
| ORBIS | **No aparece en la tarifa 2025** | No | Sí (count 1) | Sí | Sin confirmar | ⚠️ Aclarar antes de crear |
| Cerradura estándard | No | No | Sí (count 0) | No | Mecánica genérica (ya incluida en taquilla) | Baja |

## 4. Arquitectura propuesta

```
Cerraduras (categoría padre)
├── Cerraduras inteligentes (BOXIS, NEO, CODE, YR TITAN, NF ZERO)
│     └── posible sub-agrupación por tecnología: RFID/teclado | Candado IP67 | NFC
└── Cerraduras mecánicas (Bombillo, Resbalón, Moneda, Candado)
```

**Tipo de producto recomendado: productos SIMPLES, no variables.** Razón: a diferencia de Bancos (donde Longitud×Cara generaban variaciones reales del mismo modelo), aquí cada modelo (BOXIS, NEO, CODE...) es un producto distinto con precio propio y sin combinaciones — no hay "tallas" de una cerradura. Cada modelo = una ficha de producto simple, con SKU propio. Esto es más simple que el patrón de Bancos, no lo repite mecánicamente.

**Sobre el atributo `Tipo de cerradura` ya existente:** no se debe tocar sin decisión explícita. Convive perfectamente con productos simples nuevos: el atributo sigue sirviendo para "qué cerradura llevará tu taquilla" al comprar una taquilla; los productos nuevos servirían para "comprar/reponer/mejorar una cerradura por separado". Son dos casos de uso distintos y compatibles, no hay que fusionarlos en esta fase.

## 5. MVP propuesto — Tanda 2 (9 productos, dentro del rango 6-10 pedido)

Propuesta: **cubrir el 100% del catálogo verificado, ni un producto más ni uno menos** — evita inventar y evita dejar catálogo real sin representar:

1. BOXIS (30€) — inteligente, ya tiene imagen y contenido en la web
2. NEO (38€) — inteligente, ya tiene imagen y contenido en la web
3. CODE (55€) — inteligente, mayor intención comercial (PIN+RFID+APP, precio más alto)
4. YR TITAN (45€) — inteligente, candado IP67, caso de uso distinto (exterior/intensivo)
5. NF ZERO (28€) — inteligente, entrada de precio de la gama NFC
6. Cerradura de bombillo VCERBOM (10€) — mecánica, solo metálicas
7. Cerradura de resbalón VCERRES (25€) — mecánica
8. Cerradura de moneda VCERMON (34€) — mecánica
9. Cerradura candado VCERCAN (16€) — mecánica

**Deliberadamente fuera del MVP:** ARES y ORBIS (no confirmados en la tarifa 2025 — ver riesgo 1) y las 3 llaves maestras como producto independiente (se pueden añadir en una fase posterior sin bloquear el MVP).

## 6. Encaje con marcas — Zentry vs Tukandado

- **Zentry**: marca del catálogo/tienda — taquillas, bancos, lockers, "solución completa". Las 4 cerraduras mecánicas son 100% Zentry (SKU propio VCERxxx, sin marca de terceros).
- **Tukandado**: tecnología/marca especializada en cerraduras inteligentes (confirmado por el propio catálogo: "Cerraduras inteligentes con APP TUKANDADO"). Los 5 modelos inteligentes deben presentarse como **"cerradura inteligente compatible con taquillas Zentry, tecnología Tukandado"** — nunca reescribir el producto como si fuera 100% Zentry, ni tampoco convertir la ficha en una landing de la marca Tukandado.
- **Punto a resolver, no a decidir aquí:** las imágenes actuales de `/cerraduras/` usan el prefijo de archivo `KERONG-` (fabricante de hardware, ej. `KERONG-BOXIS-1.jpg`), mientras que el catálogo 2025 habla de "APP TUKANDADO". Puede ser perfectamente correcto (Kerong = fabricante del hardware, Tukandado = marca/app de Zentry sobre ese hardware — coherente con el archivo local `Tukandado_KERONG_Presentation.pptx` que ya existe en el proyecto), pero antes de generar imágenes/copy nuevo conviene que confirmes esta relación para no introducir un mensaje de marca inconsistente.

## 7. Encaje con O19 (confirmado, mismo patrón que Bancos)

- **Anónimo:** sin precio, sin cantidad, sin carrito — igual que taquillas y bancos hoy.
- **CTA contextual propuesto** (frase dada por ti, se usaría tal cual): *"Te preparamos precio según modelo, cantidad e integración."*
- **Logueado:** precio y compra normal, vía el mismo mu-plugin `zentry-hide-prices-guests.php` v1.5.0-O21.1c ya activo — no requiere ningún cambio en el plugin, solo que los productos existan con categoría/atributos correctos (el plugin actúa sobre WooCommerce en general, no por producto).
- Confirmado por diseño, no por prueba todavía (no hay productos que probar en esta fase).

## 8. Imágenes necesarias (lista, sin generar todavía)

Por cada uno de los 9 productos del MVP: imagen principal + 1 imagen de detalle/uso en taquilla. Además: 1 imagen de familia para "inteligentes", 1 para "mecánicas", 1 hero de landing.

| Producto | Imagen principal | Imagen de detalle/uso | Partida de la web actual |
|---|---|---|---|
| BOXIS | Sí, generar (estilo producto consistente) | Instalada en puerta de taquilla | Ya existe `KERONG-BOXIS-1.jpg` como referencia visual, no como asset final de producto |
| NEO | Sí, generar | Apertura sin contacto (tarjeta/pulsera) | Ya existe `NEO-1-1.avif` como referencia |
| CODE | Sí, generar | Teclado + módulo, detalle del "+" (dos piezas) | Sin imagen previa |
| YR TITAN | Sí, generar | Candado cerrado en argolla | Sin imagen previa |
| NF ZERO | Sí, generar | Gesto de acercar tarjeta/móvil (NFC) | Sin imagen previa |
| Bombillo/Resbalón/Moneda/Candado (4) | Sí, generar cada una | Instalada en puerta de taquilla metálica/fenólica | Catálogo PDF pág. 34 tiene foto de referencia de cada una (baja resolución, no usable como asset final) |

**Prompts sugeridos (temática, a validar en fase de generación, no ahora):** fotografía de producto estilo catálogo Zentry ya usado en Bancos (fondo neutro, sin texto ni logos de terceros visibles, iluminación de estudio), + una foto de contexto mostrando la cerradura instalada en una puerta de taquilla Zentry real (metálica para las mecánicas compatibles, fenólica/melamina donde aplique).

## 9. Landing y menú — propuesta a decidir contigo, no ejecutada

- **Mantener las 3 páginas existentes tal cual** (`/cerraduras/`, `/cerraduras-inteligentes-taquillas/`, `/digitalizacion-taquillas/`): tienen contenido bueno, FAQ con schema, y ya indexan. No hay motivo para tocarlas por defecto.
- **Decisión pendiente (no resuelta aquí):** ¿el "grid" comercial de las 9 fichas de producto vive dentro de `/cerraduras/` (evolucionando la página actual), o se crea una landing nueva tipo `/cerraduras-para-taquillas/` (mismo patrón que se usó para Bancos), dejando `/cerraduras/` como está y enlazándola? Recomiendo la segunda opción por menor riesgo (no se toca una página que ya funciona), pero es tu decisión.
- **Menú:** el ítem "Cerraduras" ya existe y ya está bien posicionado (orden 10, tras Bancos). No hace falta añadir nada a nivel superior. Si se crea una landing comercial nueva, valorar un submenú con 2 hijos ("Inteligentes" / "Mecánicas") — opcional, no bloqueante.
- **Enlaces internos:** replicar el patrón ya probado en O21 (Etapa J) añadiendo enlaces desde `/taquillas/`, `/taquillas-por-sector/`, las 6 páginas de sector y `/bancos-de-vestuario/` hacia la nueva landing comercial de cerraduras, una vez exista.

## 10. Riesgos detectados

1. **ARES y ORBIS existen en la web (contenido + atributo) pero NO aparecen en la tarifa 2025.** Podrían estar descontinuados, ser una omisión del PDF, o tener otro nombre comercial en el catálogo. No crear productos para ellos hasta confirmar.
2. **El atributo `Tipo de cerradura` ya vive en 54 productos de producción.** Cualquier cambio futuro sobre ese atributo (renombrar términos, etc.) tiene impacto real en catálogo ya publicado — en esta fase no se toca, pero hay que tenerlo presente en la fase de ejecución.
3. **Sin SKU para los 5 modelos Tukandado en el catálogo.** Hay que definir/confirmar SKUs antes de crear productos (no se deben inventar).
4. **Los precios del catálogo llevan nota "consultar... por cantidades"** — confirmar si son precio final de venta al público o base para presupuesto, antes de publicarlos como `regular_price`.
5. **Naming Kerong vs Tukandado** en los assets existentes — ver sección 6, aclarar antes de generar contenido nuevo.
6. **Diferencia de punto de partida respecto a Bancos:** Bancos ya estaba completamente construido y validado en **staging** antes de tocar producción (O21 solo replicó). Cerraduras **no existe todavía ni en staging** — hay que construirlo ahí primero, con su propio ciclo de QA, antes de replicar a producción. El plan de fases de abajo lo refleja.

## 11. Plan de ejecución por fases (propuesto, ninguna ejecutada todavía)

| Fase | Contenido | Entorno |
|---|---|---|
| O22.1 | Auditoría y plan (este informe) | Solo lectura — completado |
| O22.2 | Aprobación de Pau: confirmar SKUs Tukandado, resolver Ares/Orbis, confirmar precios, confirmar arquitectura de categorías, confirmar landing (opción A/B) | Decisión, sin escritura |
| O22.3 | Construir en **staging**: categorías, atributos (si hacen falta nuevos, o reutilizar existentes), 9 productos simples con datos reales del catálogo | Staging |
| O22.4 | Generación de imágenes IA (9 productos + familia + hero) y asociación en staging | Staging |
| O22.5 | Landing comercial + QA visual completo en staging (igual que se hizo con Bancos antes de tocar producción) | Staging |
| O22.6 | Réplica a producción: categorías → atributos → media → productos (patrón idéntico a O21 Etapas C-G) | Producción, dry-run+backup+aprobación por etapa |
| O22.7 | Landing en producción como draft → publicación manual por Pau | Producción |
| O22.8 | Menú (si aplica submenú) + enlaces internos | Producción |
| O22.9 | Cierre documental O22 | Documentación |

## Siguiente aprobación necesaria

Antes de tocar staging siquiera, necesito que confirmes (O22.2):
1. Qué hacer con **ARES** y **ORBIS** (crear igualmente, descartar, o confirmar que hay una tarifa más reciente que no tengo).
2. **SKUs** para BOXIS, CODE, YR TITAN, NEO, NF ZERO (o confirmar que los invento siguiendo el patrón `VCERxxx` — no lo haré sin tu confirmación explícita).
3. Si los precios del catálogo (10€/25€/34€/16€ mecánicas; 30€/55€/45€/38€/28€ inteligentes) son el precio final a publicar.
4. Landing: opción A (evolucionar `/cerraduras/`) u opción B (nueva landing tipo `/cerraduras-para-taquillas/`), recomiendo B.
5. Confirmación del MVP de 9 productos tal como propuesto, o ajuste.

No he ejecutado ningún cambio. Este documento es el único artefacto producido en esta fase.

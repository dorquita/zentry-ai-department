# O23.1 — Auditoría técnica y propuesta MVP: Configurador 3D de Bancos de vestuario

**Fecha:** 2026-08-08
**Alcance de esta fase:** solo auditoría, investigación técnica y diseño de plan. **No se ha creado ni modificado ningún fichero, plugin, página, producto ni configuración en staging ni en producción.** No se ha instalado nada. No se ha tocado WooCommerce, el theme, functions.php ni WPCode.

**Nota operativa encontrada durante esta fase (no bloquea la auditoría, pero bloqueará O23.2 si no se resuelve antes):** las credenciales `WORDPRESS_USERNAME`/`WORDPRESS_APP_PASSWORD` de **staging** guardadas en `.env` del proyecto de automatización devuelven `401 incorrect_password` (Application Password inválida) al probarlas contra `staging.zentrylockers.com`, tanto en `wp/v2` como en `wc/v3`. No se ha intentado corregir ni regenerar nada — es una decisión de Pau (regenerar el Application Password en `staging.zentrylockers.com/wp-admin/` → Usuarios → Perfil → Application Passwords, y actualizar `.env`). Producción no se ha probado en esta fase (no hacía falta), no hay indicio de que le afecte. Esta auditoría se ha completado igualmente porque no requería escritura ni lectura en vivo de staging — los datos de producto usados (Bancos) vienen de la documentación ya cerrada de O21.

---

## 1. Análisis funcional de la referencia (Adico)

La URL dada (`adico.pt/pt/configurator/?sku=...&origin=...&options=...`) es en realidad una página WordPress/Elementor "envoltorio" que contiene un `<iframe id="configurator_frame">` vacío; un script inline lee los query params `sku`/`options`/idioma y construye dinámicamente la URL real del configurador: `https://www.adico.pt/conf/?sku=...&options=...&lang=...`. Se investigó esa app directamente (fetch de su HTML/JS, sin ejecutar el visor):

- **Tecnología real: Babylon.js** (`js/b/babylon.js`, `babylonjs.loaders.min.js`, más una librería de materiales `shadowOnlyMaterial` para sombras de contacto realistas). App propia en JS + jQuery, sin framework (no React/Vue).
- **Modelo 3D:** un único fichero `Adico_5008_asset.glb` por producto — no un modelo distinto por combinación. El GLB contiene varios *nodos* (piezas) nombrados; las opciones actúan sobre esos nodos:
  - `seat`/`coxim` (cojín) → `"action_type":"change_node"` (probablemente mostrar/ocultar una pieza del propio GLB, ej. con o sin cojín).
  - `color`/`coxim_material` → swap de material/textura sobre el nodo correspondiente (miniaturas de color en `assets/thumbs/*_thumb.jpg`).
- **Estructura de URL (patrón reutilizable, independiente de Babylon.js):**
  - `sku` — identifica el producto base.
  - `origin` — base64 de la URL de la ficha de producto de origen (para el breadcrumb "volver a" y probablemente analítica).
  - `options` — base64 de un JSON plano `{clave: valor}` de la configuración seleccionada (`{"seat":"metal","coxim":"coxim","color":"2012","coxim_material":"122-1010"}`).
  - Este patrón (JSON→base64→query param) es exactamente lo que pide el punto 8 del encargo ("JSON base64 como Adico") y es trivial de replicar sin ninguna librería nueva.
- **Controles de cámara:** no se pudo confirmar en detalle sin ejecutar WebGL (fuera de alcance de esta fase), pero Babylon.js en este tipo de configurador usa casi siempre `ArcRotateCamera` (equivalente a `OrbitControls` de Three.js: arrastrar para orbitar, rueda/pinch para zoom). Se detectó la palabra "zoom" en el bundle, consistente.
- **Móvil:** la página envoltorio fuerza un aviso "para mejor experiencia, navega en vertical" — es decir, el configurador está pensado principalmente para retrato en móvil, con el visor probablemente arriba y los selectores de opciones debajo o en un panel deslizante.
- **Flujo comercial:** no hay "añadir al carrito" directo — el configurador termina en un **formulario de solicitud de presupuesto** (país + tipo de perfil profesional: arquitecto/diseñador/particular/hostelería/revendedor + RGPD + newsletter), con mensaje de confirmación "te contactaremos pronto". Esto encaja de forma casi literal con el modelo de Zentry (guest sin precio, CTA "solicitar presupuesto") — no hace falta inventar un flujo nuevo, se puede reutilizar el mismo patrón CTA ya usado en O21/O22.

**Qué replicar de Adico:** el patrón de URL compartible con opciones en base64, el modelo de "un GLB con nodos configurables" en vez de un GLB por combinación, terminar en solicitud de presupuesto en vez de compra directa, y la lógica de cámara tipo orbit+zoom.
**Qué NO replicar:** la complejidad de Babylon.js completa (más pesado de lo que Zentry necesita para un MVP de un solo producto), el guardado de perfil profesional (over-engineering para esta fase), ni el diseño visual de Adico (el encargo ya pide "una versión Zentry profesional y más sencilla", no una copia).

---

## 2. Opciones técnicas comparadas

| Vía | Qué es | Pros para este caso | Contras para este caso |
|---|---|---|---|
| **A) Three.js + OrbitControls** | Librería 3D de bajo nivel, `OrbitControls` ya viene en `three/examples/jsm/` (no hace falta paquete aparte) | Máximo control; ecosistema enorme; loaders GLTF/GLB maduros (`GLTFLoader`); fácil intercambiar materiales por nodo (igual que hace Adico); comunidad/documentación muy amplia; se puede empezar con geometría paramétrica simple (cajas/cilindros) sin esperar a tener modelos reales | Más código propio que escribir (cámara, luces, controles, UI de opciones) |
| **B) `<model-viewer>` (Google/web component)** | Web component `<model-viewer>` que envuelve Three.js internamente, con cámara/zoom/AR ya integrados | Integración casi cero código (una etiqueta HTML); AR en móvil gratis; muy ligero de implementar | Configuración de materiales/nodos en tiempo real es más limitada/indirecta (hay que manipular la escena vía su API `model-viewer.model.materials`, funciona pero es menos flexible que Three.js puro para un configurador con muchas combinaciones); menos control fino sobre cámara/UI a medida |
| **C) Babylon.js** | Motor 3D completo (lo que usa Adico), con editor visual propio (Playground/NME) | Muy potente para configuradores complejos, buen soporte de materiales PBR y nodos; es literalmente lo que usa la referencia | Más pesado (bundle mayor que Three.js básico); curva de aprendizaje similar o mayor; para UN producto MVP es sobredimensionado |
| **D) Plugin externo (solo investigado, no instalado)** | Ej. "3D Product Customizer & Configurator" (WordPress.org, gratis, sube GLB por producto WooCommerce, guarda la config como line-item meta en el pedido), STAGGS, WCB Configurator Builder, WP Configurator, o SaaS embebido tipo Simplio3D | Cero desarrollo propio; algunos ya integran WooCommerce (precio dinámico, carrito) | Dependencia de un plugin de terceros (riesgo de mantenimiento/compatibilidad con LiteSpeed Cache y el theme actual, ya visto en O22 que este sitio tiene bastantes plugins activos); coste en las versiones PRO; menos control de marca/UX; **no se puede evaluar el riesgo real sin instalarlo**, y instalar plugins de terceros está explícitamente prohibido en esta fase sin aprobación — queda como opción de fase futura, no para el MVP |

### Recomendación para el MVP: **Three.js + OrbitControls + GLTFLoader (Opción A)**

Motivos:
1. Es la vía con más control para exactamente lo que pide el encargo (rotar, zoom, cambiar color/material por pieza, sin AR ni animaciones complejas).
2. Permite empezar HOY con geometría paramétrica simple (ver sección 4) sin depender de que exista ya un modelo GLB real de un banco Zentry — con `model-viewer` también se podría, pero manipular materiales por pieza en tiempo real es más directo en Three.js.
3. Es la opción con menor huella (`three` core + `OrbitControls` + `GLTFLoader`, sin motor de físicas ni editor visual) — importante dado que el sitio ya usa Elementor, Kadence Blocks, WooCommerce, LiteSpeed Cache, etc.; menos JS es menos riesgo de conflicto.
4. Camino de migración claro: si en el futuro se necesita algo más avanzado (materiales PBR complejos, animaciones), Three.js lo soporta igualmente sin cambiar de librería.
5. No depende de ningún plugin de terceros, cumpliendo la condición "no instalar plugins sin aprobación" de raíz — el código vive enteramente en un plugin propio aislado (sección 5).

---

## 3. MVP para Bancos — producto inicial recomendado

De los 9 productos banco ya creados y publicados en producción (O21, `docs/o21-bancos-vestuario-production-closure.md`): 3 materiales (pino / fenólico / melamina) × 3 configuraciones (simple / con perchero / con zapatero).

**Recomendación: "Banco de vestuario de pino"** (el simple, sin accesorios) como modelo/vista **por defecto** del configurador, dejando que el propio configurador permita añadir "con perchero" / "con zapatero" como una opción más (exactamente el selector de "configuración" que pide el encargo).

Por qué el pino simple y no el de perchero:
- Es la geometría más simple posible (banco + patas, sin barra de perchero ni balda de zapatero) → mejor punto de partida para el prototipo paramétrico (menos piezas que modelar a mano).
- El resto de configuraciones (perchero, zapatero) se pueden representar como piezas adicionales que se muestran/ocultan sobre esa misma base — exactamente el patrón "change_node" que usa Adico — en vez de tener que construir 3 geometrías completas distintas desde el minuto uno.
- Ya tiene contenido/imágenes reales en la web (a diferencia de partir de cero).

**Aviso importante para O23.2 (no bloqueante ahora):** el atributo real de WooCommerce en estos 9 productos es **Longitud** (variaciones de medida) **y Cara** (id 9 y 10 respectivamente, ver O21) — el encargo pide simular longitud 1000/1500/2000mm, lo cual encaja con "Longitud", pero existe un segundo atributo "Cara" que el MVP tal como está descrito no contempla. No es un problema para el prototipo visual (que no necesita mapear a variaciones reales todavía), pero si en una fase futura se conecta el configurador a WooCommerce de verdad, habrá que decidir qué hacer con "Cara" (ignorarlo, fijarlo a un valor por defecto, o añadirlo como cuarta opción).

---

## 4. Activos 3D — recomendación

**Opción 2 (prototipo paramétrico con Three.js) es la recomendada para arrancar.** Motivos:

- No depende de que exista ya un modelo CAD/3D real del banco (no se ha mencionado que exista) ni de contratar a un diseñador 3D — evita bloquear todo el proyecto en un activo externo.
- Permite validar TODA la funcionalidad (rotar, zoom, cambiar color, cambiar longitud, mostrar/ocultar perchero y zapatero) con formas simples: el tablero del asiento como una caja (`BoxGeometry`) alargada, las patas como cilindros o cajas finas, la barra del perchero como un cilindro horizontal, la balda del zapatero como otra caja — con materiales de color plano o madera simple (`MeshStandardMaterial` con color/roughness, sin necesidad de texturas fotorrealistas todavía).
- El color/material se puede simular ya mismo sobre estas formas simples (cambiar el `color`/`map` del material), que es literalmente uno de los requisitos del MVP.
- La longitud (1000/1500/2000mm) se puede simular escalando o reposicionando la geometría del tablero y redistribuyendo las patas — deja probado el flujo de "seleccionar opción → cambio visual en tiempo real" sin depender de activos externos.
- Sustitución futura sin rehacer nada: cuando exista un GLB real (Opción 1), solo cambia la función que construye la escena (de "generar geometría" a "cargar GLTFLoader + mapear nodos"), la capa de UI/estado/URL no cambia.

**Opción 1 (GLB real)** queda como objetivo de una fase posterior, cuando Pau decida encargar el modelado 3D (diseñador 3D, fabricante, o conversión desde CAD si existe). **Opción 3 (imagen 2D/360 falso)** se descarta para el MVP: no permite de verdad "cambio visual en tiempo real" combinando color+longitud+accesorios a la vez sin generar una imagen por cada combinación posible (27 combinaciones mínimo: 3 materiales × 3 longitudes × 3 configuraciones), lo cual es más trabajo, no menos, y no es reutilizable para otros productos futuros.

---

## 5. Arquitectura recomendada (propuesta, no creada todavía)

Módulo aislado tal como lo pide el encargo, sin tocar theme/functions.php/WPCode:

```
wp-content/plugins/zentry-3d-configurator/
  zentry-3d-configurator.php        (plugin propio mínimo: registra el shortcode + encola assets solo cuando el shortcode está presente)
  assets/js/vendor/three.module.js  (Three.js servido localmente, sin CDN externo -- evita dependencia de terceros en tiempo de carga)
  assets/js/vendor/OrbitControls.js
  assets/js/vendor/GLTFLoader.js    (preparado para la Opción 1 futura, aunque el MVP no lo use todavía)
  assets/js/configurator.js         (construye la escena paramétrica, lee/escribe el estado, gestiona la UI de opciones)
  assets/css/configurator.css       (estilos scoped, prefijo .zentry-3d-configurator para no colisionar con el theme)
  assets/models/                    (vacío en el MVP, listo para GLBs reales en el futuro)
  data/bancos.json                  (config de producto: dimensiones base, colores/materiales disponibles, mapeo a los 9 slugs de WooCommerce ya existentes)
```

- Shortcode: `[zentry_3d_configurator product="banco-vestuario-pino"]` — el atributo `product` selecciona la entrada de `data/bancos.json`, no un product ID de WooCommerce todavía (eso es la fase de integración, punto 7).
- Carga de scripts **solo** en la página donde se usa el shortcode (`wp_enqueue_scripts` condicionado a `has_shortcode()`), nunca global — así no afecta al resto del sitio, a O19 ni al rendimiento general.
- Sin llamadas a APIs externas, sin analítica de terceros, sin credenciales — el plugin no necesita ningún secreto, así que "logs sin secretos" se cumple por diseño (no hay nada que loguear que sea sensible).
- 100% reversible: es un plugin nuevo y aislado; desactivarlo/borrarlo no deja rastro en theme, base de datos de otros plugins, ni WooCommerce.

**No se ha creado nada de esto todavía** — queda pendiente de tu confirmación explícita antes de O23.2, tal como pediste.

---

## 6. Página de prueba propuesta

**`/configurador-bancos/`** (staging), como página WordPress normal con el shortcode `[zentry_3d_configurator product="banco-vestuario-pino"]` en el contenido — no `/staging/configurador-bancos/` (ese patrón de subcarpeta no aplica aquí, `staging.zentrylockers.com` ya es el dominio completo de staging).

Condiciones ya acordadas y que se respetarán al crearla en O23.2:
- Página nueva, `status: draft` primero (mismo patrón ya usado en todas las landings de este proyecto).
- **Sin enlazar desde ningún menú** todavía.
- `noindex` heredado del propio entorno de staging (todo staging ya es `noindex` de fábrica, confirmado en fases anteriores).

---

## 7. Integración con WooCommerce — análisis

Para el MVP: **página independiente**, no incrustada en la ficha de producto. Motivos:
- Las fichas de producto de los 9 bancos ya están live en producción (O21) — modificarlas para incrustar un configurador experimental sería tocar producción, prohibido en esta fase.
- Una página independiente permite iterar libremente sin ningún riesgo para el catálogo real.
- Si el prototipo funciona bien, la evolución natural (fase futura, no O23.2) es incrustar el mismo shortcode dentro de la plantilla de producto vía un hook de WooCommerce (`woocommerce_single_product_summary`), sin tocar functions.php directamente si se hace desde el propio plugin `zentry-3d-configurator` (un plugin SÍ puede engancharse a hooks de WooCommerce sin que eso cuente como "tocar WooCommerce core" ni "tocar el theme" — el core y el theme no se modifican, solo se añade un hook desde fuera).

## 8. Integración con presupuesto — propuesta (no implementar todavía)

Combinación recomendada, en capas (cada una es opcional/incremental, no hace falta todo a la vez):
1. **Query params legibles** para lo esencial (`?material=pino&longitud=1500&config=perchero`) — mejor para SEO/depuración y para que la URL sea entendible a simple vista.
2. **JSON en base64 en un único parámetro** (`?config=eyJ...`) como hace Adico, para cuando el número de opciones crezca (más simple de generar/parsear que mantener muchos query params sueltos) — se puede usar cualquiera de las dos, o ambas (base64 como parámetro adicional de respaldo).
3. **`sessionStorage`** como caché local mientras el usuario navega entre el configurador y el formulario de contacto, para no perder la selección si abre el formulario en la misma pestaña.
4. **Campos ocultos (`hidden input`) en el formulario de contacto existente** — igual que ya se hace con `origen`/`ubicacion` en las landings de O21/O22 (`?origen=landing_bancos_vestuario&ubicacion=hero`), se añadiría un campo más con el resumen de la configuración (texto plano legible, ej. "Banco pino, 1500mm, con perchero, color roble"), no el JSON crudo — así el equipo comercial lo lee sin tener que decodificar nada.
5. **Botón "Solicitar presupuesto"** que enlaza al formulario de contacto ya existente con esos parámetros añadidos — reutiliza infraestructura ya construida, no crea un formulario nuevo.

No se implementa nada de esto en O23.1 — queda propuesto para aprobación explícita en O23.2.

---

## 9. Rendimiento y seguridad

- **Peso de librerías:** Three.js "core" + `OrbitControls` + `GLTFLoader` (aunque no se use en el MVP) rondan conjuntamente unos **150–200 KB minificados** (sin gzip aplicado veríamos más, con gzip bastante menos) — asumible para una página dedicada sin enlazar desde el menú, siempre que se cargue SOLO ahí (ver sección 5, `has_shortcode()`).
- **Carga móvil:** el prototipo paramétrico (sin texturas grandes) es mucho más ligero que un GLB real con texturas 4K — buen punto de partida para no penalizar móvil desde el día uno. Cuando lleguen modelos reales (Opción 1 futura), habrá que vigilar peso de GLB + compresión Draco/KTX2.
- **Lazy load:** cargar el `<canvas>`/inicializar Three.js solo cuando el bloque entra en viewport (`IntersectionObserver`), y encolar el JS con `defer`, para no bloquear el render inicial de la página.
- **Compatibilidad WordPress:** al ser un plugin propio con su propio namespace de funciones/clases (prefijo `zentry_3d_`), no debería colisionar con Elementor/Kadence Blocks/WooCommerce ya instalados.
- **Compatibilidad LiteSpeed Cache:** una página `draft` no se cachea (no es pública); cuando pase a estar en `publish` para pruebas, LiteSpeed cacheará el HTML normalmente (el JS/canvas se ejecuta en el navegador del visitante, no afecta al cacheo del HTML) — sin necesidad de excluir la página de la caché, salvo que se observe algún problema real de purga (como ya ocurrió con el snippet de redirección en O22 — vigilar si aparece algo parecido).
- **No exponer datos sensibles:** el plugin no maneja credenciales, no llama a APIs externas, no envía datos a terceros — no hay superficie de secretos que proteger ni que loguear.
- **No romper O19:** el configurador es una página nueva, aislada, sin tocar el mu-plugin `zentry-hide-prices-guests.php` ni ningún producto — cero superficie de contacto con O19 mientras no se incruste en una ficha de producto real (fase futura).
- **SEO:** página nueva sin enlazar desde menú y en staging (`noindex` heredado) — impacto SEO nulo en esta fase por diseño.

---

## 10. Resumen del entregable

- **Producto banco inicial:** Banco de vestuario de pino (simple), con perchero/zapatero como opciones añadibles desde el propio configurador.
- **Activos 3D:** empezar con **prototipo paramétrico** (cajas/cilindros con Three.js), sin esperar a modelos GLB reales.
- **Vía técnica:** **Three.js + OrbitControls + GLTFLoader** (preparado para el futuro aunque no se use todavía), sin plugins de terceros.
- **Arquitectura:** plugin propio aislado `zentry-3d-configurator`, shortcode `[zentry_3d_configurator product="..."]`, assets scoped, sin tocar theme/functions.php/WPCode/WooCommerce core.
- **Página de prueba:** `/configurador-bancos/` en staging, como `draft` primero, sin enlazar en menú.
- **Integración WooCommerce:** página independiente para el MVP; incrustar en fichas de producto queda para una fase posterior.
- **Presupuesto:** query params + JSON base64 + hidden inputs en el formulario de contacto ya existente — propuesto, no implementado.

### Fases de ejecución propuestas (ninguna ejecutada todavía)

| Fase | Contenido |
|---|---|
| O23.1 | Esta auditoría — completada |
| O23.2 | Crear el plugin `zentry-3d-configurator` (esqueleto + shortcode + enqueue condicional), sin geometría todavía, verificar que carga en staging sin romper nada |
| O23.3 | Construir el prototipo paramétrico del banco de pino simple (geometría + rotar + zoom) |
| O23.4 | Añadir selectores de color/material, longitud y configuración (perchero/zapatero) con cambio visual en tiempo real |
| O23.5 | Guardar configuración en URL (query params + base64) |
| O23.6 | Botón "Solicitar presupuesto" con hidden inputs hacia el formulario de contacto existente |
| O23.7 | QA completo en staging (visual, rendimiento, móvil, no rotura de O19/menú/otras páginas) |
| O23.8 | Decisión sobre siguiente paso: modelos GLB reales, incrustar en ficha de producto, o ampliar a más bancos |

### Riesgos detectados

1. **Credenciales de staging inválidas** (ver nota operativa al inicio) — bloqueará cualquier ejecución de O23.2 hasta que Pau las regenere.
2. **Prototipo paramétrico no será fotorrealista** — riesgo de expectativas si se presenta como "así se verá el banco final"; hay que dejar claro desde el principio que es una prueba de funcionalidad, no de diseño final.
3. **Peso de Three.js** aunque moderado, sigue siendo JS adicional en una web con ya bastantes plugins activos (LiteSpeed Cache, Elementor, WooCommerce...) — mitigado por carga condicional solo en esa página.
4. **Atributo "Cara"** de los productos reales no contemplado en el MVP — no bloquea el prototipo visual, sí habrá que resolverlo antes de conectar con WooCommerce de verdad.
5. **Sin modelo 3D real todavía** — el prototipo paramétrico mitiga esto, pero en algún momento hará falta encargar el modelado real para que esto sea presentable a clientes finales.

### Esfuerzo estimado (orientativo, sin comprometerse a fechas)

- O23.2 (esqueleto plugin): pequeño, 1 sesión.
- O23.3 (prototipo geométrico + cámara): medio, 1-2 sesiones.
- O23.4 (selectores + cambio visual): medio, 1-2 sesiones.
- O23.5-O23.6 (URL + presupuesto): pequeño, 1 sesión.
- O23.7 (QA): pequeño, 1 sesión.

### Qué aprobación necesito para O23.2

1. Confirmar que arrancamos por **Three.js + prototipo paramétrico** (no plugin de terceros, no esperar a modelos GLB reales).
2. Confirmar el producto inicial: **Banco de vestuario de pino** (simple, con perchero/zapatero como opciones dentro del propio configurador).
3. Confirmar la ruta de prueba **`/configurador-bancos/`** en staging, sin menú.
4. Luz verde para crear el plugin `zentry-3d-configurator` (esqueleto vacío, sin geometría todavía) como primer paso verificable.
5. Que regeneres el Application Password de staging (bloqueante técnico, no de diseño) antes de que pueda ejecutar nada en O23.2.

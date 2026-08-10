# Checklist de inputs — banco-vestuario-pino (Zentry)

Estado a 2026-08-09 (Fase O24.1). Lo que ya hay en esta carpeta, y lo que falta antes de poder pasar de las etapas documentales a una generación real en O24.2.

## Ya disponible (en esta carpeta)

- ✅ `producto-woocommerce-staging.md` — descripción real y verificada del producto (WooCommerce staging id 1988): material del asiento (pino de Suecia, listón de 25mm), material y sección de las patas (tubo de acero 30×30×1,5mm), acabados, longitudes reales (1000/1500/2000mm). Ver ese fichero para el detalle completo y la fuente exacta.

## Falta — bloqueante para generar geometría real

- ❌ **Fotos.** Cero fotos disponibles localmente en este repo para este producto. Sin al menos 1 foto, el Product Understanding Agent (Agente 2) no tiene con qué confirmar visualmente proporciones, forma exacta de las patas, cómo se une el refuerzo metálico mencionado en la descripción, etc.
  - **Mínimo recomendado:** 1 foto frontal.
  - **Ideal:** frontal + lateral + perspectiva (3/4), para poder verificar profundidad sin tener que inferirla a ciegas.
  - **Nota importante, no una foto lista para usar todavía:** en la Fase O21 se generaron imágenes de producto por IA para este mismo banco y ya están subidas a la Media Library de staging (ids **2021** — principal, **2027** — variante con perchero, **2028** — variante con zapatero; ver `docs/o21-bancos-vestuario-production-closure.md` y `scripts/o213-create-landing.ts` en el repo del VPS). **No se han descargado a esta carpeta en O24.1** porque el encargo pide usar solo referencias ya localizadas y documentadas en el proyecto, y esa era una decisión de la fase siguiente, no de esta. Si se aprueba, en O24.2 se pueden traer esas imágenes como primera referencia visual sin depender de que el cliente aporte fotos nuevas — son imágenes generadas por IA para marketing, no fotos reales del producto físico, así que seguirían marcándose como referencia visual de apoyo, no como "foto real verificada".

## Falta — no bloqueante, mejora la precisión

- ⚠️ Profundidad real del banco (mm) — no está en la ficha de WooCommerce.
- ⚠️ Altura real del banco (mm) — no está en la ficha de WooCommerce.
- ⚠️ Medidas exactas del refuerzo/listón metálico entre patas (la descripción lo menciona pero no lo cuantifica).
- ⚠️ PDF de catálogo o ficha técnica del fabricante, si existe uno más detallado que la descripción web.

## Cómo aportar estos datos

Añadir directamente en esta carpeta:
- `foto-frontal.jpg`, `foto-lateral.jpg`, `foto-perspectiva.jpg` (o los nombres que sean, el Intake Agent clasifica por extensión, no por nombre exacto).
- `medidas.txt` con cualquier medida real conocida (profundidad, altura, etc.).
- `catalogo.pdf` si existe.

Después, volver a ejecutar el pipeline (`docs/pipeline.md`) — las etapas que dependían de estos datos pasarán de `pending_input` a poder avanzar.

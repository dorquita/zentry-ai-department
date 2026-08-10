# 3D Model Factory — Agentes / etapas del pipeline

Cada "agente" es una etapa del pipeline (`services/3d-model-factory/src/lib/pipeline-stages.ts`), no necesariamente una llamada a un modelo de IA independiente — en esta fase, las etapas que requieren juicio (análisis visual, investigación, planificación de geometría, inferencia) están implementadas como **plantillas estructuradas** que un humano o una sesión de IA con capacidad de visión debe completar; el código automatiza el resto: dónde vive cada plantilla, cómo se combinan, y qué desbloquea qué.

## 1. Intake Agent — `src/lib/intake.ts` (implementado, determinista)

- **Input:** ruta de la carpeta `clients/<client_id>/input/o24-products/<product_slug>/`.
- **Hace:** lista los ficheros presentes, los clasifica por tipo (`photo` / `pdf` / `notes` / `measurements` / `other`) según extensión y pistas de nombre.
- **Output:** inventario tipado (`SourceFileEntry[]`), usado por el resto del pipeline y volcado en `manifest.json → sourceFiles`.
- **Nunca bloquea** — si la carpeta no existe o está vacía, lo documenta y el pipeline sigue (las etapas siguientes son las que deciden si pueden avanzar sin input).

## 2. Product Understanding Agent (plantilla — requiere visión/juicio)

- **Input:** el inventario del Agente 1.
- **Debería hacer:** identificar tipo de producto, piezas visibles, y extraer cualquier info textual de notas/PDF/nombres de archivo.
- **Estado en O24.1:** si no existe ya un `stages/product-understanding.json` en la carpeta de output, el pipeline crea la plantilla vacía y marca la etapa `pending_input`. Rellenarla es trabajo de una sesión de Claude con las fotos reales delante (o de un humano), no de código determinista — no hay integración de una API de visión en este proyecto todavía.

## 3. Research Agent (plantilla — requiere acceso a fuentes externas)

- **Cuándo actúa:** solo si el Agente 2 detectó huecos que ameritan buscar información (ej. "es una silla de un fabricante concreto, buscar ficha técnica").
- **Debe:** priorizar fuentes oficiales (fabricante, catálogo real), documentar explícitamente qué fuente dijo qué, y nunca tratar una fuente dudosa como verdad absoluta.
- **Estado en O24.1:** si no hay `stages/research-notes.md`, se asume que no hizo falta (no se fuerza su creación) — a diferencia de las demás plantillas, esta es opcional por diseño.

## 4. Geometry Planner Agent (plantilla — requiere juicio)

- **Input:** `product-understanding.json` ya completado.
- **Debe:** decidir qué piezas/componentes tendrá el modelo (asiento, patas, respaldo, perchero, zapatero, puertas, cerradura...) y cuáles son configurables (visibles/ocultables, con material intercambiable).
- **Estado en O24.1:** plantilla `stages/geometry-plan.json`, misma lógica que el Agente 2.

## 5. Inference Agent (plantilla — documental, obligatoria)

- **Input:** el plan de geometría.
- **Debe:** para cada medida/pieza que no esté 100% confirmada, documentar si es **verificado** / **inferido** (con el rango y el razonamiento) / **supuesto** (con su nivel de riesgo) / **pendiente de validar**. Ver `docs/inference-policy.md` para el formato exacto y ejemplos.
- **Estado en O24.1:** plantilla `stages/inference-manifest.json`, siempre obligatoria antes de generar geometría real (a diferencia del Research Agent, esta no se puede saltar).

## 6. Blender Generation Agent (bloqueado — Blender no instalado)

- **Debería:** generar un script Python (`bpy`) que construya la geometría paramétrica pieza por pieza, con nodos nombrados según el plan del Agente 4.
- **Estado en O24.1:** `src/lib/blender-check.ts` comprueba si el binario `blender` existe en el PATH. Hoy no existe → la etapa siempre se marca `blocked`, con referencia a `docs/blender-setup.md`. Ni siquiera con todos los datos del producto completos se intenta generar nada — no hay ninguna vía de "simular" un `.glb` real sin Blender.
- Plantilla de referencia (no ejecutable todavía): `templates/blender-generate.template.py`.

## 7. Material Agent — `src/lib/materials.ts` (implementado, determinista)

- **Input:** `known_materials` del request (ej. `["pino", "metal"]`).
- **Hace:** resuelve cada nombre contra una pequeña librería de presets (`MATERIAL_PRESETS`) con color base + roughness/metalness compatibles tanto con Three.js (`MeshStandardMaterial`) como con el shader Principled BSDF de Blender.
- **Importante:** un preset resuelto se marca `source: "assumed"` en el manifest, nunca `"verified"` — salvo que el cliente aporte una muestra de color/acabado real, esto siempre es una aproximación razonable, no un dato confirmado.

## 8. GLB Export Agent (depende del 6)

- **Debería:** exportar `.glb`/`.gltf` desde Blender garantizando escala en metros, pivote centrado en la base del objeto (para que el `y=0` del modelo coincida con el suelo en el configurador), y orientación consistente (eje Z arriba en Blender → eje Y arriba al exportar a glTF, conversión estándar).
- **Estado en O24.1:** bloqueado en cascada (depende del Agente 6).

## 9. Optimization Agent (depende del 8)

- **Debería:** reducir polycount si hace falta, limpiar geometría duplicada/no usada, comprobar el peso final del archivo antes de darlo por listo para web.
- **Estado en O24.1:** bloqueado en cascada.

## 10. Visual QA Agent (depende del 8)

- **Debería:** generar capturas (frontal, lateral, perspectiva, superior si aplica) del `.glb` ya exportado y compararlas razonablemente con las fotos de input.
- **Estado en O24.1:** bloqueado en cascada (necesita un `.glb` real).

## 11. Web Integration Agent — `src/lib/integration.ts` (implementado, determinista)

- **Input:** `integration_target` + `target_website` del request.
- **Hace:** genera una lista de notas de "próximos pasos" específicas según el destino (configurador de O23, ficha de producto WooCommerce, embed standalone, o solo subida a Media Library) — **documental únicamente**, no toca ningún sitio real.

## 12. Human Approval Gate (siempre pendiente, por diseño)

- **Regla dura:** ningún modelo alcanza `qaStatus: "approved_staging"` sin que un humano lo confirme explícitamente. No existe ningún camino de auto-aprobación en el código — esta etapa siempre devuelve `pending_input`, sin excepción, sea cual sea el estado del resto del pipeline.
- **No existe `"approved_production"`** en el enum de `qaStatus` — todo pasa primero por staging.

# 3D Model Factory — Cómo ejecutar el pipeline

## Requisitos

- Node.js + `ts-node`/`typescript` (ya instalados en la raíz del proyecto `zentry-ai-department`, se reutilizan — este módulo no trae su propio `package.json`/`node_modules`).
- Ningún requisito adicional para el modo actual (dry-run/plantillas). Blender es necesario solo a partir de la Fase O24.2 (ver `docs/blender-setup.md`), no para O24.1.

## Crear una solicitud nueva

1. Crear la carpeta de input: `clients/<client_id>/input/o24-products/<product_slug>/`.
2. Añadir lo que exista: fotos, PDF, notas, medidas. Aunque sea solo `foto-1.jpg`, el pipeline funciona (ver `docs/inference-policy.md` para qué se puede deducir con poco material).
3. Crear `request.json` en esa misma carpeta (o en cualquier ruta, se pasa explícitamente al pipeline) siguiendo `src/schemas/request.schema.json` — ver `examples/example-request.json`.

## Validar el request

```bash
npx ts-node services/3d-model-factory/scripts/validate-request.ts --request clients/<client_id>/input/o24-products/<product_slug>/request.json
```

## Ejecutar el pipeline

```bash
npx ts-node --project services/3d-model-factory/tsconfig.json services/3d-model-factory/scripts/run-pipeline.ts --request clients/<client_id>/input/o24-products/<product_slug>/request.json
```

Desde la raíz del repo (`/opt/zentry-ai-department`), igual que el resto de scripts del proyecto.

### Qué hace cada ejecución

1. Valida el request (aborta si faltan campos obligatorios).
2. Ejecuta las 12 etapas en orden (ver `docs/agents.md`) — las deterministas (Intake, Material, Web Integration) de verdad; el resto crea/lee plantillas en `clients/<client_id>/outputs/3d-models/<product_slug>/stages/`.
3. Escribe/actualiza:
   - `clients/<client_id>/outputs/3d-models/<product_slug>/manifest.json`
   - `clients/<client_id>/outputs/3d-models/<product_slug>/<product_slug>-report.md`
4. **Nunca sobrescribe sin backup** — si esos ficheros ya existían, la versión anterior queda como `<fichero>.backup-<timestamp>` en el mismo directorio antes de escribir la nueva.

### Ciclo de trabajo iterativo

El pipeline está pensado para ejecutarse **varias veces** sobre el mismo producto a medida que se completan las plantillas:

1. Primera ejecución: casi todo queda `pending_input`, se crean las plantillas vacías.
2. Un humano (o una sesión de Claude con las fotos delante) rellena `stages/product-understanding.json`, luego `stages/geometry-plan.json`, luego `stages/inference-manifest.json` — en ese orden, porque cada uno depende del anterior.
3. Se vuelve a ejecutar el pipeline: las etapas con plantilla ya rellena pasan a `done`, desbloqueando las siguientes.
4. Cuando Blender esté disponible (O24.2+) y las etapas de generación estén implementadas, el mismo ciclo aplica para `blender_generation → glb_export → optimization → visual_qa`.
5. `human_approval_gate` siempre requiere una confirmación explícita fuera del pipeline (no automatizada en O24.1) antes de considerar el modelo listo.

## Fases futuras (fuera de alcance de O24.1)

- **O24.2** — proponer instalación de Blender (con aprobación), implementar de verdad las etapas 6-10 (generación real de geometría/export/optimización/QA visual) para el piloto `banco-vestuario-pino`.
- **O24.3** (tentativo) — decidir cómo subir el `.glb` resultante a staging y conectar con el configurador de O23 (sustituir la geometría paramétrica JS por `GLTFLoader` cargando el modelo real).
- Integración de un paso real de "Product Understanding"/"Research" asistido por IA con capacidad de visión, si se decide automatizar esas etapas en vez de completarlas a mano.

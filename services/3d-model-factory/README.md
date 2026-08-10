# 3D Model Factory

Servicio interno del Zentry AI Department para generar activos 3D reutilizables (`.glb`/`.gltf`) de productos físicos, a partir de lo que haya disponible: desde una sola foto hasta fotos + PDF + medidas reales. Módulo independiente — no depende de WordPress ni de ningún cliente concreto (ver `docs/client-integration.md`).

Zentry Lockers (bancos de vestuario) es el primer caso piloto. La arquitectura está pensada para servir igual a Tukandado, catálogos de muebles, taquillas, cerraduras o cualquier otro cliente/producto físico modelable del departamento.

## Empezar

1. Leer `docs/architecture.md` (visión general, las 12 etapas, vías técnicas evaluadas).
2. Leer `docs/agents.md` (qué hace cada etapa, qué está implementado de verdad y qué es plantilla).
3. Leer `docs/inference-policy.md` (cómo se documenta lo verificado/inferido/supuesto — regla dura de todo el sistema).
4. Ver `docs/pipeline.md` para cómo crear una solicitud nueva y ejecutar el pipeline.

## Estado (Fase O24.1)

- ✅ Estructura, schemas, tipos, documentación completa.
- ✅ 3 de 12 etapas implementadas de verdad (Intake, Material, Web Integration) — deterministas, sin depender de Blender ni de IA con visión.
- ⏳ 6 etapas son plantillas estructuradas (requieren juicio humano/IA con visión, no automatizado todavía).
- 🚫 3 etapas bloqueadas (generación/export/optimización real) — Blender no está instalado, ver `docs/blender-setup.md` (propuesta pendiente de aprobación, no ejecutada).
- 🔒 1 etapa (Human Approval Gate) siempre pendiente por diseño — nunca hay auto-aprobación.

Piloto real en curso: `clients/zentry/input/o24-products/banco-vestuario-pino/` (ver ese directorio para el estado exacto de inputs disponibles/faltantes).

## Estructura

```
services/3d-model-factory/
  src/
    schemas/          -- JSON Schema de request y manifest
    lib/               -- logica de las etapas deterministas + tipos compartidos
    types.ts
  scripts/
    run-pipeline.ts     -- orquestador principal (CLI)
    validate-request.ts -- validacion de un request.json
  templates/            -- plantillas (manifest, informe, script Blender documentado)
  docs/                 -- toda la documentacion de diseno
  examples/             -- request y manifest de ejemplo, ilustrativos
  outputs/              -- salidas de prueba/autotest de la propia factory (no confundir con clients/*/outputs)

clients/<client_id>/
  input/o24-products/<product_slug>/    -- material de partida por producto
  outputs/3d-models/<product_slug>/     -- todo lo generado por la factory para ese producto
```

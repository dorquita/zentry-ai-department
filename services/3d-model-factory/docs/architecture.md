# 3D Model Factory — Arquitectura (Fase O24.1)

Servicio interno del Zentry AI Department para generar activos 3D reutilizables (`.glb`/`.gltf`) a partir del material que un cliente tenga disponible de un producto: desde una sola foto hasta fotos + PDF + medidas reales. Zentry Lockers (bancos de vestuario) es el primer caso piloto, pero el módulo está diseñado para no acoplarse a WordPress ni a un único cliente.

## Principio de diseño

**Módulo independiente.** `services/3d-model-factory/` no importa nada del resto de `src/` del proyecto (que es específico de WordPress/WooCommerce/Zentry). Su único punto de contacto con el resto del departamento es la convención de carpetas `clients/<client_id>/input/o24-products/` y `clients/<client_id>/outputs/3d-models/`, que reutiliza el sistema multi-cliente ya existente (`clients/<client_id>/client.config.json`, ver `docs/multi-client-architecture.md` en la raíz del proyecto) sin depender de él en código — un `client_id` de un request debe existir como cliente real, pero la factory no lee ni escribe `client.config.json`.

## Regla principal: no bloquearse por falta de información

Si falta un dato, el sistema:
1. Busca información complementaria si hay una fuente externa fiable disponible (fabricante, ficha técnica oficial).
2. Usa referencias oficiales cuando existen.
3. Deduce proporciones razonables si no hay más remedio.
4. **Marca siempre** qué es verificado, qué es inferido y qué es un supuesto — nunca presenta una inferencia como dato confirmado (ver `docs/inference-policy.md`).

En la práctica (Fase O24.1), esto se traduce en que ninguna etapa del pipeline "falla" por falta de datos: si no hay suficiente información para completar una etapa, esa etapa queda en estado `pending_input` o `blocked`, con una plantilla ya creada y una explicación exacta de qué hace falta para desbloquearla — nunca se detiene el proceso completo ni se inventa un resultado.

## Las 12 etapas (agentes)

Ver `docs/agents.md` para el detalle de cada una. Resumen del pipeline:

```
1. Intake              -- localiza fotos/PDFs/notas/medidas.            [determinista, YA implementado]
2. Product Understanding -- analiza el producto, detecta piezas.        [requiere juicio humano/IA -- plantilla]
3. Research             -- busca info externa si falta.                 [requiere juicio humano/IA -- plantilla]
4. Geometry Planner     -- decide piezas/componentes del modelo.        [requiere juicio humano/IA -- plantilla]
5. Inference            -- documenta verificado/inferido/supuesto.      [requiere juicio humano/IA -- plantilla]
6. Blender Generation   -- genera script Python paramétrico.            [BLOQUEADO -- Blender no instalado]
7. Material             -- asigna materiales (presets conocidos).       [determinista, YA implementado]
8. GLB Export           -- exporta .glb con escala/pivote correctos.    [depende de 6]
9. Optimization         -- reduce peso, limpia geometría.               [depende de 8]
10. Visual QA           -- capturas frontal/lateral/perspectiva.        [depende de 8]
11. Web Integration      -- notas de cómo usar el modelo en destino.    [determinista, YA implementado]
12. Human Approval Gate -- ningún modelo pasa a "aprobado" sin humano.  [siempre pending -- por diseño]
```

De los 12, **3 son deterministas y ya funcionan de verdad hoy** (Intake, Material, Web Integration) — el resto requiere una capacidad que esta fase no automatiza todavía (visión/razonamiento sobre fotos, o Blender instalado), y en su lugar deja plantillas estructuradas y honestas.

## Vías técnicas evaluadas para la generación de geometría

| Vía | Cuándo tiene sentido | Decisión |
|---|---|---|
| **A) Blender Python paramétrico** | Muebles/mobiliario industrial con formas regulares (bancos, taquillas, estanterías) — igual que el prototipo JS de O23, pero como geometría real exportable. Repetible, controlable, permite variantes (longitud, materiales) sin regenerar desde cero. | **Recomendada como vía principal**, alineado con la preferencia explícita del cliente. |
| **B) IA image-to-3D externa** | Formas orgánicas/complejas donde un modelo paramétrico no es viable. Depende de un servicio de terceros (coste, fiabilidad variable, menos control sobre topología/nombres de nodo). | No usar sin aprobación explícita — no evaluado en O24.1. |
| **C) Híbrido (IA interpreta fotos → Blender genera)** | Es, de hecho, el diseño de este pipeline: las etapas 2-5 (interpretación) alimentan la etapa 6 (generación paramétrica). | **Es la arquitectura ya elegida**, no una alternativa aparte. |
| **D) Modelado manual por diseñador** | Productos que requieren precisión alta (piezas mecánicas visibles, cerraduras) donde una aproximación paramétrica no basta. | Fallback documentado, no automatizado — un humano sustituye las etapas 6-9 y el pipeline solo se encarga de intake/manifest/QA/integración alrededor de su trabajo. |

## Por qué Blender y no algo más simple

Blender permite: geometría paramétrica real controlada por script (`bpy`), export nativo a `.glb`/`.gltf` con control fino de jerarquía de nodos/pivotes/escala, y es gratuito y sin dependencia de un servicio de pago. La alternativa de generar `.glb` directamente con una librería JS (ej. construir buffers glTF a mano) es viable para geometría muy simple pero no escala a productos con más piezas — Blender ya resuelve eso.

**Estado actual: Blender no está instalado en el VPS de automatización** (`root@72.61.98.103`). No se ha instalado en esta fase — ver `docs/blender-setup.md` para la propuesta, pendiente de aprobación explícita antes de ejecutarla (instalar Blender headless implica paquetes del sistema, no es una dependencia npm trivial).

## Relación con O23 (configurador de Zentry)

O23 es un configurador con geometría paramétrica escrita a mano en Three.js (cajas/cilindros), sin ningún modelo `.glb` real. El objetivo a medio plazo es que el configurador cargue un `.glb` real generado por esta factory (`assets/models/banco-vestuario-pino.glb`) vía `GLTFLoader`, manteniendo la misma capa de UI/estado/URL ya construida en O23.2-O23.5 (documentado explícitamente en esos módulos como el punto de sustitución previsto).

**En O24.1 no se toca el configurador de O23 salvo lectura.** La conexión real es una fase posterior (ver `docs/pipeline.md`, sección "Fases futuras").

## Qué no es esta fase

- No es un generador de modelos fotorrealistas listos para producción.
- No sustituye a un diseñador 3D para piezas que requieran precisión mecánica real (cerraduras, mecanismos).
- No sube nada a WordPress, ni a staging ni a producción.
- No instala Blender ni ninguna otra dependencia pesada por su cuenta.

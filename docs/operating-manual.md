# Manual de operacion: modos de agente

Todo agente de este proyecto opera en uno de tres modos. El modo es una
propiedad explicita del agente (no una interpretacion), y se declara en su
codigo y en su spec `.agent.md`.

## `READ`

El agente solo lee datos de sistemas externos o locales. No genera ningun
output que implique una accion. Uso tipico: auditoria pura, diagnostico.

## `PROPOSE`

El agente lee datos y genera **propuestas**: tareas, recomendaciones,
borradores. Nada de esto se ejecuta automaticamente. El resultado se
guarda como texto/estructura (por ejemplo, filas en un `jobs.jsonl`) para
que una persona lo revise y decida.

Este es el modo en el que hoy opera el **SEO Watcher Agent**, y el unico
modo activo en todo el proyecto por ahora.

## `APPLY`

El agente ejecuta cambios reales sobre un sistema de produccion (WordPress,
Google Ads, GA4/GTM, n8n, CRM, etc.), siempre partiendo de una propuesta ya
aprobada explicitamente por una persona (ver `approval-policy.md`).

**Estado actual: `APPLY` no esta implementado en ningun agente.** No hay
codigo, credenciales de escritura ni endpoints de mutacion conectados. Para
activarlo en el futuro para un agente concreto hara falta:

1. Aprobacion explicita del negocio para ese agente y esa accion.
2. Implementacion de la integracion en modo escritura, con logging
   detallado y capacidad de revertir.
3. Un paso de confirmacion humana antes de cada ejecucion (o un lote de
   ejecuciones ya pre-aprobado con criterios muy especificos).

## Modo activo hoy

```
AGENT_MODE = PROPOSE   (ver .env.example)
```

Ningun agente de este repositorio debe pasar a `APPLY` sin que este
documento se actualice explicitamente para reflejarlo.

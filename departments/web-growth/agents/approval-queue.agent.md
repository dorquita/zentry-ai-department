# Approval Queue Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Convierte las recomendaciones que ya generaron los demas agentes (SEO
Director, Content Planner, CRO Reviewer, Competitor Intelligence) en
**acciones unicas y deduplicadas** del Action Backlog
(`data/action-backlog.jsonl`), en vez de dejar que cada pasada diaria
repita las mismas propuestas como si fueran nuevas.

## 2. Objetivo

Leer los eventos `recommendation_created` / `competitor_keyword_detected`
del `departmentRunId` actual, convertir cada uno en una entrada del
backlog (crear si no existe, actualizar contador si ya existia), y
generar un informe que distingue nuevas, recurrentes, pendientes de
aprobacion, aprobadas sin ejecutar, snoozed, rechazadas y ya hechas.

## 3. Reglas (no negociables)

- **Solo lectura de eventos existentes + gestion local del backlog.** No
  llama a ninguna API externa.
- **Ningun estado del backlog implica ejecucion real.** "Aprobada" solo
  significa que un humano acepta trabajar esa accion despues — no publica
  nada, no toca WordPress ni ningun otro sistema.
- **No modifica produccion**, en ningun caso.
- **No toca WordPress, Google Ads, GA4/GTM, n8n ni qdrant.**
- **No maneja secretos.**
- **`data/action-backlog.jsonl` es append-only**: nunca se borra ni se
  reescribe una instantanea existente (ver `docs/action-backlog.md`).

## 4. Como deduplica

Cada recomendacion se reduce a una `canonicalKey`:

```
brandIntent + actionType + keyword_normalizada + pagina_normalizada
```

Si ya existe una accion con esa clave, se actualiza (`seenCount++`,
`lastSeenAt`, se anaden `sourceAgents`/`runIds`/`relatedJobIds` nuevos) en
vez de crear una accion duplicada. El **estado** de una accion ya decidida
por un humano (`approved`/`rejected`/`snoozed`/`done`) **nunca cambia
solo** porque vuelva a detectarse — solo las acciones sin decidir pasan de
`new` (nunca vista antes) a `open` (recurrente, sigue sin decidir) al
reaparecer.

## 5. Formato de salida

`reports/approval-queue/approval-queue-<fecha>.md`: resumen ejecutivo y
siete secciones (nuevas hoy, recurrentes/abiertas, pendientes de
aprobacion, aprobadas sin ejecutar, snoozed, rechazadas, ya hechas), cada
una con `actionId`, prioridad, titulo y cuantas veces se ha visto.

## 6. Eventos que emite

`agent_started`, `action_proposed` (una vez por cada accion NUEVA creada
en el backlog — no por cada vez que se actualiza una existente),
`agent_finished`.

## 7. Como gestionar una accion despues

```bash
npm run actions:list -- --status open
npm run actions:update -- --actionId <id> --status approved
```

Ver `docs/approval-queue.md` y `docs/action-backlog.md` para el detalle
completo de comandos y estados.

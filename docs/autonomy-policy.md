# Politica de autonomia (Fase O7)

## Por que existe

Las Fases O5 y O6 dieron a Pau una cola de acciones deduplicadas
(`data/action-backlog.jsonl`) y work orders detalladas
(`data/work-orders.jsonl`), pero cada accion seguia esperando una
aprobacion manual una por una (`npm run actions:update -- --status
approved`) antes de convertirse en un plan de ejecucion. Con 86+
acciones por pasada, eso significaba revisar cada una a mano incluso
cuando la accion era una simple recomendacion de SEO/contenido/CRO — algo
de riesgo bajo, que no toca produccion, y que preparar como plan no
ejecuta nada.

La Fase O7 anade una **politica de autonomia**: el sistema decide solo,
por tipo de accion, si puede auto-procesarla o auto-prepararla para
planificacion, o si tiene que esperar a un humano. **Nunca decide sobre
ejecucion real en produccion** — eso sigue sin existir en este sistema
(no hay modo `APPLY`), pase lo que pase con esta politica.

**Nota (Fase O8):** esta politica decide QUE se puede auto-procesar.
Una politica hermana y separada, `config/notification-policy.json`
(ver `docs/notification-gateway.md`), decide CUANDO avisar a Pau de
ello — son dos preguntas distintas. Una accion puede estar
auto-aprobada aqui (`AUTO_PLAN`) y aun asi no generar ningun aviso,
porque preparar un plan no tiene impacto real.

## Donde vive la politica

- `config/autonomy-policy.json` — la configuracion en si: 5 niveles, cada
  uno con sus `actionTypePatterns` (que tipos de accion caen ahi),
  `enabled` (si el nivel esta activo), `requiresApproval` y
  `backlogStatus` (a que estado del Action Backlog lleva).
- `src/core/autonomy-policy.ts` — el motor que lee ese JSON y clasifica
  cualquier accion. Expone:
  - `classifyActionAutonomy(action)` — la clasificacion completa
    (`autonomyLevel`, `allowed`, `requiresApproval`, `riskLevel`,
    `reason`, `backlogStatus`).
  - `canAutoPlan(action)` — `true` si la accion cae en `AUTO_PLAN`.
  - `requiresHumanApproval(action)` — `true` si necesita aprobacion.
  - `isForbidden(action)` — `true` si cae en `FORBIDDEN`.

El fichero JSON se lee del disco en cada llamada (sin cache entre
procesos): editarlo cambia el comportamiento en la siguiente ejecucion,
sin recompilar nada.

## Los 5 niveles

| Nivel | Riesgo | Requiere aprobacion | Que decide | Status del backlog |
|---|---|---|---|---|
| `AUTO_INTERNAL` | Ninguno | No | Mecanica interna del propio sistema: crear eventos/jobs/acciones, deduplicar, priorizar, generar informes, enviar el email diario. No son recomendaciones sobre las que decidir. | `auto_processed` |
| `AUTO_PLAN` | Bajo/medio | No | Convertir una recomendacion SEO/contenido/CRO/SEM/Analytics/competencia en un plan de ejecucion (work order) sin esperar aprobacion — preparar el plan no ejecuta nada. | `auto_approved_for_planning` |
| `AUTO_DRAFT` | Medio | No (cuando se active) | **Desactivado hoy** (`enabled: false`). Permitira, en el futuro, crear borradores WordPress sin publicar y preparar cambios de Ads/GTM/GA4 en modo propuesta. Mientras este desactivado, cualquier actionType que coincidiria aqui cae automaticamente a `HUMAN_APPROVAL_REQUIRED`. | `waiting_approval` (por estar desactivado) |
| `HUMAN_APPROVAL_REQUIRED` | Alto | Si | Cualquier cosa que toque produccion real: publicar/modificar WordPress, activar campanas, cambiar presupuesto, crear anuncios/keywords reales, modificar conversiones, formularios criticos, WooCommerce/precios, email comercial. **Tambien es el nivel por defecto para cualquier `actionType` no reconocido** — seguro por diseno. | `waiting_approval` |
| `FORBIDDEN` | Critico | Si (nunca automatico) | Nunca se ejecuta automaticamente: borrar historico/logs, imprimir secretos, modificar `.env` sin confirmacion, desactivar backups, tocar produccion sin rollback. | `blocked` |

Hoy, con los agentes que existen, **todo `actionType` que generan los 8
agentes de deteccion cae en `AUTO_PLAN`** (`seo:*`, `content:*`, `cro:*`,
`competitor:*`, `sem:*`, `analytics:*`) — ninguno genera todavia acciones
de produccion (`wordpress:*`, `ads:activate*`, etc.), asi que
`HUMAN_APPROVAL_REQUIRED` y `FORBIDDEN` estan definidos y listos, pero no
se activan con datos reales hasta que exista un agente que proponga ese
tipo de accion. Lo mismo aplica al nivel `INSTANT_APPROVAL_REQUIRED` de
la politica de notificacion (Fase O8): definido, probado, sin ningun
disparo real todavia.

## Que decide solo (sin aprobacion humana)

- Toda la mecanica interna del pipeline (`AUTO_INTERNAL`): eventos, jobs,
  deduplicacion del backlog, `seenCount`, priorizacion, informes, email
  diario.
- Convertir una accion SEO/contenido/CRO/SEM/Analytics/competencia
  (`AUTO_PLAN`) en una work order — la deja en `auto_approved_for_planning`
  y, en el siguiente paso del pase diario, el Approved Action Planner y el
  Work Order Builder correspondiente ya la dejan en `auto_prepared`, lista
  para mirar. Ver `docs/work-orders.md`.

## Que planifica solo (pero sigue sin publicar nada)

Una work order `auto_prepared` tiene exactamente el mismo contenido que
una `ready_for_review` (title/meta/H1/H2 para SEO, brief para contenido,
CTA/formulario para CRO...) — la unica diferencia es de donde vino la
aprobacion para llegar hasta ahi (politica de autonomia vs. humano). En
ambos casos:

- No se ha tocado WordPress.
- No se ha publicado nada.
- No se ha ejecutado produccion.

Esto queda fijado de forma inmutable en cada work order, en el campo
`productionSafety` (`wordpressTouched: false`, `published: false`,
`productionExecuted: false`), que ningun builder ni actualizacion
posterior modifica.

## Que requiere aprobacion humana

Cualquier `actionType` que caiga en `HUMAN_APPROVAL_REQUIRED` o
`FORBIDDEN` — hoy, en la practica, cualquier accion cuyo tipo no se
reconozca (fallback seguro), y en el futuro cualquier accion de
produccion real: publicar/editar WordPress, activar o cambiar
presupuesto de Google Ads, crear keywords/anuncios reales, modificar
conversiones en GA4, cambiar formularios criticos, tocar
WooCommerce/precios, enviar email comercial. Desde la Fase O8, estas
mismas acciones ademas generan una solicitud de aprobacion instantanea
por Telegram (ver `docs/notification-gateway.md`).

```bash
npm run actions:list -- --status waiting_approval
npm run actions:update -- --actionId <id> --status approved
```

## Que queda bloqueado

Cualquier `actionType` que caiga en `FORBIDDEN` (por ejemplo, borrar
historico/logs, imprimir secretos) queda en `status: blocked`. No es lo
mismo que `rejected` (una decision humana de "no, esto no aplica") ni que
`waiting_approval` (una decision humana pendiente): `blocked` significa
que la politica nunca lo dejaria pasar por defecto, y necesita una
decision explicita y documentada fuera de este sistema. Nunca genera
ningun aviso por Telegram tampoco (nivel `BLOCKED` de la politica de
notificacion).

```bash
npm run actions:list -- --status blocked
```

## Reclasificacion del backlog acumulado

Cuando una accion en estado `new` u `open` (los dos unicos estados
puramente "sin decidir todavia") se vuelve a detectar en una pasada
posterior, se reclasifica contra la politica vigente en ese momento —
esto incluye el backlog acumulado **antes** de que existiera esta fase.
Una accion que un humano (o una pasada anterior de la politica) ya
decidio explicitamente (`approved`, `rejected`, `snoozed`,
`waiting_approval`, `auto_processed`, `auto_approved_for_planning`,
`blocked`, `done`) **nunca** cambia de estado solo por reaparecer — la
decision, humana o automatica, se respeta siempre. Ver el docstring de
`nextStatusOnReappear()` en `src/core/action-backlog.ts`.

## Como cambiar la politica

Editar `config/autonomy-policy.json`:

- **Mover un tipo de accion entre niveles**: anadir/quitar su patron de
  `actionTypePatterns` en el nivel que corresponda (soporta comodin al
  final, ej. `"seo:*"`).
- **Activar `AUTO_DRAFT`** (borradores WordPress no publicados, cambios
  Ads en PAUSED): poner `"enabled": true` en ese nivel. Sigue sin
  publicar ni activar nada — solo deja de caer automaticamente a
  `HUMAN_APPROVAL_REQUIRED`.
- **Anadir un actionType de produccion real** (por ejemplo, cuando exista
  un agente que proponga cambios de WordPress): anadir su patron en
  `HUMAN_APPROVAL_REQUIRED` (o `FORBIDDEN` si nunca debe ser automatico).
  Recuerda anadir tambien el patron correspondiente en
  `config/notification-policy.json` (nivel `INSTANT_APPROVAL_REQUIRED`)
  si quieres que ademas dispare un aviso por Telegram — son dos ficheros
  independientes, ver `docs/notification-gateway.md`.

Los cambios se aplican en la siguiente ejecucion (no hay cache entre
procesos ni que reiniciar nada persistente).

## Como desactivar la autonomia si hace falta

Para volver al comportamiento de antes de la Fase O7 (todo requiere
aprobacion manual una por una), poner `"enabled": false` en el nivel
`AUTO_PLAN` de `config/autonomy-policy.json`. Con `AUTO_PLAN`
desactivado, cualquier `actionType` que antes caia ahi cae a
`HUMAN_APPROVAL_REQUIRED` (mismo mecanismo de fallback que usa hoy
`AUTO_DRAFT`), asi que todas las acciones vuelven a esperar aprobacion
humana antes de convertirse en work order. No hace falta tocar ningun
`.ts`, solo el JSON. (Esto tambien haria que esas acciones empezaran a
generar solicitudes de aprobacion por Telegram si
`TELEGRAM_APPROVALS_ENABLED=true`, ya que pasarian a
`HUMAN_APPROVAL_REQUIRED`.)

## Seguridad

- La politica solo decide el **estado local** de una accion o work order
  (Action Backlog / Work Order Registry) — nunca ejecuta nada.
- El nivel por defecto para cualquier `actionType` no reconocido es
  `HUMAN_APPROVAL_REQUIRED` (seguro por diseno: ante la duda, se pide
  aprobacion).
- `AUTO_DRAFT` esta desactivado a proposito en esta fase; cualquier
  actionType que coincidiria con el cae a `HUMAN_APPROVAL_REQUIRED`.
- No toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant, en ningun nivel.
- `data/action-backlog.jsonl` y `data/work-orders.jsonl` siguen siendo
  append-only; la politica no borra ni reescribe nada.

# Notification & Approval Gateway (Fase O8)

## Por que existe

La Fase O7 le dio al departamento autonomia para planificar (convertir
recomendaciones en work orders) sin esperar aprobacion humana. Pero
"autonomia para planificar" no es lo mismo que "autonomia para todo": el
dia que exista un agente que proponga, por ejemplo, un borrador de
WordPress o un cambio de campana de Ads, Pau necesita enterarse **ya**,
no al leer el email de manana. La Fase O8 anade esa capa: un gateway de
notificacion que decide CUANDO avisar (y por que canal), separado de la
politica de autonomia que decide QUE se puede auto-procesar.

**Estas dos politicas son independientes a proposito:**

| Politica | Fichero | Decide |
|---|---|---|
| Autonomia (Fase O7) | `config/autonomy-policy.json` | Si una accion se auto-procesa/auto-aprueba para PLANIFICAR, o si necesita aprobacion humana para eso. |
| Notificacion (Fase O8) | `config/notification-policy.json` | Si, ademas, hace falta AVISAR a Pau — y con que urgencia (nada / solo en el resumen diario / ya, por Telegram). |

Una accion puede estar auto-aprobada para planificacion (`AUTO_PLAN`) y
aun asi no generar ningun aviso, porque preparar un plan no tiene impacto
real. Solo lo que se acerca a ejecutar algo de verdad interrumpe.

## Los 4 niveles de notificacion

| Nivel | Canal | Requiere respuesta | Cuando |
|---|---|---|---|
| `NO_NOTIFICATION` | ninguno | No | Mecanica interna (`AUTO_INTERNAL`), planificacion de riesgo bajo/medio (`AUTO_PLAN`), informes, jobs, acciones/work orders puramente internos. **Es la inmensa mayoria de lo que hace el departamento cada dia.** |
| `DAILY_SUMMARY_ONLY` | email diario | No | Work orders `auto_prepared`/`ready_for_review`, change packs listos para revisar (categoria reservada, todavia sin uso real), warnings menores. Se mencionan en el correo de las 10:00, sin interrumpir antes. |
| `INSTANT_APPROVAL_REQUIRED` | Telegram | Si | Cualquier accion futura de tipo `wordpress:draft*`/`wordpress:publish*`, cualquier cambio de Ads (aunque la campana siga en PAUSED), cualquier modificacion de GA4/GTM, cualquier cambio de formularios, o cualquier accion con `riskLevel: high`. Envia un mensaje ya y crea una solicitud `pending` que espera respuesta explicita. |
| `BLOCKED` | ninguno | No (nunca automatico) | Publicar paginas, activar campanas, subir presupuestos, borrar datos, imprimir secretos, modificar `.env` sin confirmacion. Mismo nivel `FORBIDDEN` de la politica de autonomia — nunca se envia ningun aviso sobre esto, porque nunca deberia llegar a intentarse. |

## Que NO pregunta (hoy, con los agentes que existen)

Absolutamente nada. Los 8 agentes de deteccion (SEO/contenido/CRO/SEM/
Analytics/competencia) generan siempre acciones `AUTO_PLAN`, que
clasifican como `NO_NOTIFICATION`. **Con datos reales, el Approval
Gateway crea 0 solicitudes de aprobacion hoy** — es esperado, no un bug:
significa que el departamento esta trabajando exactamente como se pidio
(analisis, planificacion, work orders, sin molestar a Pau).

## Que SI preguntaria (cuando exista el agente que lo proponga)

Cualquier accion cuyo `actionType` empiece por `wordpress:draft`,
`wordpress:publish`, `ads:`, `ga4:`, `gtm:` o `form:`, o cualquier accion
con `riskLevel: high`. Hoy la politica ya esta lista y probada
(`config/notification-policy.json`), solo falta que exista el agente que
genere ese tipo de accion.

## Como se decide: `classifyNotification()`

`src/core/notification-policy.ts` expone:

```ts
classifyNotification(subject): { notificationLevel, channel, requiresResponse, reason }
```

Orden de evaluacion (lo mas restrictivo gana primero, mismo patron que
`autonomy-policy.ts`):

1. `FORBIDDEN`/`riskLevel: critical` → `BLOCKED`.
2. `HUMAN_APPROVAL_REQUIRED`/`riskLevel: high`/actionType de impacto real → `INSTANT_APPROVAL_REQUIRED`.
3. Work order `auto_prepared`/`ready_for_review` (o change pack `ready_for_review`, o warning menor) → `DAILY_SUMMARY_ONLY`.
4. `AUTO_INTERNAL`/`AUTO_PLAN`, informe o job → `NO_NOTIFICATION`.
5. Fallback seguro (`defaultLevel` del JSON, hoy `INSTANT_APPROVAL_REQUIRED`): cualquier cosa no reconocida prefiere avisar de mas a avisar de menos.

## El Approval Gateway Agent

`src/agents/approval-gateway.ts` (`npm run approvals:gateway`, o dentro
del pase diario, paso 13 de 15):

1. Lee todas las acciones y work orders no resueltas todavia.
2. Clasifica cada una con `classifyNotification()`.
3. Para las que salen `INSTANT_APPROVAL_REQUIRED`, crea una solicitud de
   aprobacion en `data/approval-requests.jsonl` (deduplicada por
   `relatedId` — nunca se pregunta dos veces por lo mismo).
4. Si `TELEGRAM_APPROVALS_ENABLED=true`, envia la solicitud por Telegram.
   Si no, la solicitud se queda creada localmente (aparece en
   `approvals:list` y en el email diario) pero no se manda nada.
5. **Nunca ejecuta la accion ni resuelve su propia solicitud.**

Ver `docs/telegram-approvals.md` para como responder y
`departments/web-growth/agents/approval-gateway.agent.md` para el spec
completo del agente.

## Como cambiar la politica

Editar `config/notification-policy.json`:

- **Anadir un tipo de accion a `INSTANT_APPROVAL_REQUIRED`**: agregar su
  patron a `levels.INSTANT_APPROVAL_REQUIRED.actionTypePatterns` (admite
  comodin final, ej. `"ads:*"`).
- **Cambiar que estados de work order caen en `DAILY_SUMMARY_ONLY`**:
  editar `WORK_ORDER_DIGEST_STATUSES` en `src/core/notification-policy.ts`
  (hoy `auto_prepared` y `ready_for_review`).
- Los cambios se aplican en la siguiente ejecucion — no hay cache entre
  procesos.

## Como desactivar los avisos por Telegram si hace falta

Poner `TELEGRAM_APPROVALS_ENABLED=false` (o quitar la variable) en
`.env`. El resto del sistema sigue funcionando exactamente igual: las
solicitudes que aplicarian se siguen creando localmente (para no perder
trazabilidad ni tener que reprocesar nada cuando se reactive), solo deja
de enviarse el mensaje.

## Seguridad

- La politica de notificacion solo decide CUANDO avisar — nunca ejecuta
  nada, ni siquiera cuando el nivel es `INSTANT_APPROVAL_REQUIRED`.
- `BLOCKED` es una via muerta: nunca se envia nada por ningun canal sobre
  esas operaciones.
- `data/approval-requests.jsonl` es append-only.
- El Telegram Gateway nunca imprime `TELEGRAM_BOT_TOKEN` ni
  `TELEGRAM_CHAT_ID` en logs ni en consola — ver `docs/telegram-approvals.md`.

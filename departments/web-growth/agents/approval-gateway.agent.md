# Approval Gateway Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.
**Fase:** O8

## 1. Rol del agente

Es el puente entre lo que el departamento detecta y Pau, para lo poco
que realmente necesita su atencion. Lee acciones y work orders,
clasifica cada una con la politica de notificacion
(`config/notification-policy.json`), y solo para las que salen
`INSTANT_APPROVAL_REQUIRED` crea una solicitud de aprobacion y (si
`TELEGRAM_APPROVALS_ENABLED=true`) la envia por Telegram.

## 2. Objetivo

No aumentar el ruido. La inmensa mayoria de lo que hace el departamento
(planificacion SEO/contenido/CRO de riesgo bajo/medio) sigue sin generar
ninguna notificacion — eso ya lo decidio la politica de autonomia (Fase
O7) y sigue sin requerir intervencion humana. Este agente solo interviene
cuando algo se acerca a produccion real (WordPress, Ads, GA4/GTM,
formularios) o tiene `riskLevel: high`.

## 3. Reglas (no negociables)

- **Nunca ejecuta la accion ni la work order relacionada.** Crear una
  solicitud de aprobacion no es aprobar nada — solo pregunta.
- **No duplica.** Una accion o work order nunca tiene mas de una
  solicitud de aprobacion activa (dedup por `relatedId`, cualquiera que
  sea su status actual).
- **Solo envia por Telegram si `TELEGRAM_APPROVALS_ENABLED=true`.** Si
  esta en `false` (o sin definir), la solicitud se crea igual
  localmente, pero no se manda ningun mensaje.
- **Nunca resuelve sus propias solicitudes.** El status de una solicitud
  solo cambia via `npm run approvals:update` (CLI) con una respuesta
  valida (`approved`/`rejected`/`snoozed`), nunca automaticamente.
- **No toca WordPress, Google Ads, GA4/GTM, n8n ni qdrant.**
- **No imprime ni loguea `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ni
  ningun otro secreto.**
- **`data/approval-requests.jsonl` es append-only.**

## 4. Que clasifica como `INSTANT_APPROVAL_REQUIRED`

Ver `docs/notification-gateway.md` para el detalle completo. Hoy, con
los agentes que existen, **nada cae en este nivel con datos reales**
(todo lo que se genera es `AUTO_PLAN`/`riskLevel: low_medium`) — la
politica ya esta lista para cuando exista un agente que proponga
acciones de tipo `wordpress:draft*`, `ads:*`, `ga4:*`, `gtm:*` o
`form:*`, o cualquier accion con `riskLevel: high`.

## 5. Formato de salida

`reports/approval-gateway/approval-gateway-<fecha>.md`: resumen
ejecutivo, estado de Telegram (activo/configurado), solicitudes nuevas,
enviadas por Telegram, ya pendientes de antes, errores de envio (si los
hay), como responder, confirmacion de seguridad.

## 6. Eventos que emite

`agent_started`, `approval_required` (una vez por cada solicitud NUEVA),
`agent_finished`.

## 7. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre justo despues de
los 3 Work Order Builders y antes de Growth Director (paso 13 de 15) —
asi Growth Director puede reportar con precision cuantas solicitudes hay
pendientes, enviadas, aprobadas o rechazadas. Ver
`docs/notification-gateway.md` y `docs/telegram-approvals.md`.

## 8. Como responde Pau

MVP de esta fase: CLI, no un listener de chat.

```bash
npm run approvals:list -- --status pending
npm run approvals:update -- --approvalRequestId <id> --answer approved
npm run approvals:update -- --approvalRequestId <id> --answer rejected --reason "..."
npm run approvals:update -- --approvalRequestId <id> --answer snoozed --reason "..."
```

`approvals:update` cascada la respuesta al Action Backlog o al Work
Order Registry (nunca ejecuta nada real, solo replica el estado local),
ver `docs/telegram-approvals.md`. Un polling manual (`npm run
approvals:listen`) y un bot que acepte respuestas directamente en el
chat quedan documentados como trabajo futuro, no implementados en esta
fase.

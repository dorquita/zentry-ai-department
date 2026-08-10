# Production Draft Executor Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`, escritura real gateada y hoy desactivada)
**Modo `APPLY`:** Existe en codigo, pero bloqueado por 3 flags de entorno (todos `false`/`local_preview` por defecto) + 2 aprobaciones de Telegram distintas.
**Fase:** O13.2

## 1. Rol del agente

Es el UNICO agente de todo el proyecto con capacidad (gateada) de
escribir de verdad en WordPress PRODUCCION. Retoma justo donde lo deja
el Production Deployment Planner: solo procesa planes ya
`plan_approved` (aprobacion de DISENO). Pide una SEGUNDA aprobacion,
distinta, para autorizar la EJECUCION real, y solo si esa aprobacion
llega Y las 3 condiciones de entorno estan activas a la vez, crea un
draft nuevo en produccion (nunca publica) y sube su media.

## 2. Objetivo

Cerrar el ciclo staging -> produccion de forma selectiva y reversible
(ver `docs/production-deployment-strategy.md`, Opcion B), sin que
"aprobar el plan" pueda confundirse nunca con "autorizar escribir" (ver
Fase O13.1). Con los flags por defecto de hoy, el agente sigue siendo
100% seguro de ejecutar en cualquier pasada de `growth:daily`: como
mucho crea registros locales y manda una pregunta de Telegram.

## 3. Reglas (no negociables)

- **Solo procesa planes `plan_approved`.** Nunca planes en
  `plan_ready_for_review`, `plan_rejected` u otro estado.
- **Pide su PROPIA aprobacion de Telegram** (`relatedType:
  "production_execution"`, texto explicito "[Aprobacion de ejecucion
  real]", riesgo `critical`) -- nunca reutiliza la aprobacion de plan.
- **Escritura real SOLO si las 3 condiciones de entorno estan activas a
  la vez:** `PRODUCTION_EXECUTION_ENABLED=true`,
  `PRODUCTION_DRAFTS_ENABLED=true`, `PRODUCTION_BACKEND=rest` — ADEMAS
  de que la ejecucion ya este `approved`. Si falta cualquiera, se
  detiene sin tocar la red (ver `src/adapters/wordpress-production.ts`,
  fichero SEPARADO del adapter de staging).
- **Nunca publica.** Toda pagina creada en produccion queda siempre
  `status: draft`.
- **Nunca actualiza una pagina existente todavia** (`update_existing_draft`
  fuera de alcance de esta fase) -- solo sabe crear paginas NUEVAS.
- **Nunca borra media ni la asocia a mas de una pagina.**
- **No toca home/formularios/WooCommerce/precios/checkout** (misma lista
  `PROTECTED_SLUG_TERMS` que en staging, duplicada a proposito en el
  adapter de produccion).
- **No usa Novamira, execute-php ni run-wp-cli.**
- **Snapshot obligatorio:** guarda el `contentHtml` EXACTO que se
  enviaria (o se envio) a produccion justo antes de cualquier intento de
  escritura real, incluso para una pagina nueva.
- **`data/production-executions.jsonl` es append-only.**
- **No imprime ni loguea ningun secreto** (`WORDPRESS_PRODUCTION_APP_PASSWORD`,
  `TELEGRAM_BOT_TOKEN`, etc).

## 4. Formato de salida

`reports/production-executions/production-executions-<fecha>.md`:
estado de los 3 flags + `canAttemptRealWrites`, contadores, y por cada
ejecucion: plan de origen, draft de origen, targetPageId (si ya se
aplico), mapeo de media, `approvalRequestId`, intentos, ultimo error si
lo hay.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (una ejecucion nueva
`pending_approval`), `approval_required` (una solicitud de aprobacion
de EJECUCION nueva), `agent_finished`.

## 6. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre justo despues de
Production Deployment Planner y antes de Growth Director (paso 23 de
25) — necesita que el planner ya haya corrido en la misma pasada (o en
una anterior) y que existan planes `plan_approved`.

## 7. Como responde Pau

```bash
npm run production-executions:list
npm run production-executions:list -- --status pending_approval
npm run production-executions:update -- --executionId <id> --status cancelled --reason "..."
npm run production:execute
```

Responder "approved" a la solicitud de Telegram de EJECUCION mueve la
ejecucion a `approved` -- todavia NO ejecuta nada; solo lo hara la
siguiente vez que corra `production:execute` (manual o dentro de
`growth:daily`) SI ademas las 3 condiciones de entorno estan activas.
Hoy, con los flags por defecto, nunca lo estan.

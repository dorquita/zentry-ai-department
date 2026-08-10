# Staging Execution (Fase O12)

## Por que existe esta fase

Hasta la Fase O11.2, el departamento Web & Growth analizaba, priorizaba,
planificaba y empaquetaba cambios (change packs), pero ningun agente
tenia una via real de ejecutarlos — ni siquiera un change pack
`approved_to_execute` disparaba nada por si mismo. La Fase O12 anade la
PRIMERA (y unica) via de ejecucion controlada de todo el sistema: el
**Staging Executor**, que puede crear o actualizar un borrador (siempre
`status: draft`, nunca publicado) SOLO contra WordPress **staging**,
nunca produccion.

Esto no sustituye al WordPress Draft Agent (Fase O10) — sigue existiendo
y sigue generando previews locales para TODOS los change packs
elegibles. El Staging Executor es una capa adicional, mas estricta (con
snapshot previo, rollback y verificacion QA posterior), pensada como la
via oficial para cuando el cliente quiera activar ejecucion real. **No
actives `WORDPRESS_DRAFTS_ENABLED` a la vez para el WordPress Draft
Agent (creacion de un solo borrador) Y para el Staging Executor con la
intencion de que hagan cosas distintas sobre el mismo change pack** —
comparten el mismo interruptor de adaptador (`WORDPRESS_DRAFTS_ENABLED`)
por diseno (defensa en profundidad centralizada en
`src/adapters/wordpress.ts`), pero cada uno tiene su propio flujo de
aprobacion y su propio registro.

## Los 6 gates para una escritura real (deben cumplirse los 6 a la vez)

1. **`STAGING_EXECUTION_ENABLED=true`** en `.env`. Interruptor maestro
   especifico del Staging Executor, independiente de todo lo demas.
2. **`WORDPRESS_DRAFTS_ENABLED=true`**. Interruptor de adaptador
   compartido (Fase O10) — sin el, ni `createWordpressDraftPage()` ni
   `updateWordpressDraftPage()` ejecutan nada, pase lo que pase con el
   resto.
3. **`WORDPRESS_BACKEND=rest`**. La Fase O12 usa exclusivamente el
   backend REST (`src/adapters/wordpress.ts`) — MCP (Novamira) esta
   deliberadamente fuera de alcance en esta fase (ver
   `docs/wordpress-mcp-adapter.md`: `WORDPRESS_BACKEND=mcp` sigue siendo
   solo un skeleton que lanza un error).
4. **`WORDPRESS_ENV=staging`**. Bloqueo incondicional si es
   `"production"` — vive en un unico sitio
   (`assertWordpressWriteAllowed()`, `src/adapters/wordpress-backend.ts`)
   y lo llaman TODAS las funciones de escritura del adaptador, incluidas
   las nuevas de esta fase.
5. **El change pack de origen esta `approved_to_execute`.**
6. **Hay una solicitud de aprobacion de Telegram
   (`relatedType: "staging_execution"`) con status `approved` para ESA
   ejecucion concreta.** Esta aprobacion es independiente de la que ya
   acepto el change pack como `approved_to_execute` — son dos decisiones
   humanas distintas.

Con los interruptores 1-4 en su valor por defecto (`false`/
`local_preview`/`staging` sin `rest` activo), el Staging Executor sigue
funcionando con total normalidad para las partes 100% seguras: crea
registros `pending_approval`, pide aprobacion de Telegram, y clasifica
respuestas en `approved`/`rejected` — simplemente nunca llega a intentar
la escritura real. Esto es intencional: permite dejar todo el flujo de
aprobacion "cargado y listo" antes de activar la ejecucion de verdad.

## El estado de una ejecucion (`data/staging-executions.jsonl`)

Log append-only de instantaneas, mismo patron que
`change-packs.jsonl`/`wordpress-drafts.jsonl`. Estados:

- **`pending_approval`** — creada, esperando respuesta de Telegram.
- **`approved`** — Telegram respondio "approved"; el Staging Executor
  intentara aplicarla en su siguiente pasada si los 4 interruptores de
  entorno lo permiten.
- **`applied_to_staging`** — escritura real confirmada por WordPress
  (siempre `status: draft`). Incluye `wordpressPageId`,
  `wordpressDraftUrl` y el `snapshot` previo (para poder revertir).
- **`failed`** — la escritura se intento y fallo (red, permisos,
  validacion...). Se reintenta en la siguiente pasada mientras siga
  `approved`. El error se guarda sanitizado (nunca un secreto).
- **`rolled_back`** — se revirtio manualmente (ver
  `docs/staging-rollback.md`).
- **`rejected`** — Telegram respondio "rejected", o se rechazo a mano.
  Nunca se toca WordPress para una ejecucion rechazada.

## Crear vs actualizar

Si ya existe una ejecucion `applied_to_staging` anterior con la MISMA
`canonicalKey` (el mismo tema/pagina que ya se aplico una vez), el
Staging Executor ACTUALIZA ese borrador (verificando primero, con un
GET, que sigue en `draft` — si alguien lo publico manualmente en
staging, se rechaza la actualizacion). Si no, CREA una pagina nueva. En
ambos casos, antes de escribir, se guarda un `snapshot` (por si hay que
revertir) y se copian las `rollbackNotes` del change pack de origen.

## Como aprobar una ejecucion

```bash
npm run staging-executions:list -- --status pending_approval
npm run approvals:update -- --approvalRequestId <id> --answer approved
```

La respuesta se registra localmente y (si `TELEGRAM_APPROVALS_ENABLED=true`)
tambien puede responderse siguiendo las instrucciones del mensaje de
Telegram. Ninguna respuesta cascada automaticamente un cambio de estado
en `data/staging-executions.jsonl` — el Staging Executor lee la
respuesta en su SIGUIENTE pasada (`npm run staging:execute` o el
siguiente `npm run growth:daily`) y decide entonces.

## Que NUNCA hace el Staging Executor (por diseno)

- No publica ninguna pagina (`status` siempre `"draft"`, forzado en el
  adaptador).
- No borra nada (no existe ninguna funcion de delete en
  `src/adapters/wordpress.ts` — ni para esto ni para el rollback).
- No sube media.
- No toca home, formularios, WooCommerce, precios ni checkout (mismo
  `PROTECTED_SLUG_TERMS` que el WordPress Draft Agent).
- No toca Google Ads, GA4, GTM, n8n ni qdrant.
- No usa Novamira ni MCP (backend REST unicamente en esta fase).
- No usa `execute-php` ni `run-wp-cli` (esas abilities de Novamira
  siguen sin usarse en ningun punto del proyecto — ver
  `docs/wordpress-mcp-adapter.md`).
- No escribe nunca en produccion, bajo ninguna combinacion de
  interruptores (bloqueo incondicional).
- No imprime ni loguea `WORDPRESS_APP_PASSWORD` ni ningun otro secreto.

## Ver tambien

- `docs/staging-rollback.md` — como funciona el rollback real.
- `docs/wordpress-safety-policy.md` — politica general de WordPress
  (incluye la excepcion controlada de "actualizar un draft" anadida en
  esta fase).
- `docs/change-packs.md` — de donde vienen los change packs que esta
  fase ejecuta.
- `docs/telegram-approvals.md` — como funciona el canal de aprobacion.

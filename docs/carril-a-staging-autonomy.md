# Carril A — ejecucion segura en staging sin aprobacion diaria (Fase O27)

## Por que existe

Hasta la Fase O26, incluso con `STAGING_EXECUTION_ENABLED=true` y los
otros 3 interruptores de entorno activos, el Staging Executor seguia
pidiendo una aprobacion de Telegram POR CADA ejecucion concreta antes de
escribir nada — sin excepcion, sin importar lo reversible que fuera el
cambio (un borrador `draft` en staging que nunca se publica). En la
practica esto significaba que "agresivo en staging" seguia dependiendo,
cada dia, de que Pau respondiera a Telegram uno por uno.

La Fase O27 separa dos preguntas que antes eran una sola:

1. **¿Es este tipo de cambio, EN GENERAL, lo bastante seguro como para no
   necesitar aprobacion diaria?** — la responde `config/staging-autonomy-policy.json`,
   una vez, por `changeType`.
2. **¿Toca produccion?** — si la respuesta es si, esto no cambia nada:
   sigue exigiendo las 2 aprobaciones de Telegram de siempre
   (`production-deployment-planner.ts` + `production-draft-executor.ts`),
   sin excepcion.

## Que cambia en la practica

Antes (O26 y anteriores): change pack `approved_to_execute` → Staging
Executor crea una solicitud de aprobacion de Telegram → **espera** →
solo si Pau responde "approved" se aplica.

Ahora (O27): change pack `approved_to_execute` con `changeType` en el
Carril A (`seo_on_page_update`, `content_update`, `new_content_page`,
`cro_conversion_update` — los 4 unicos que existen hoy, ver
`config/staging-autonomy-policy.json`) → Staging Executor se
auto-aprueba a si mismo (registro completo y auditable en
`data/approval-requests.jsonl`, `answeredBy: "carril_a_staging_autonomy"`,
nunca un humano) → se aplica en la MISMA pasada si los 4 interruptores de
entorno lo permiten → Pau recibe un mensaje de Telegram INFORMATIVO (no
bloqueante, no espera respuesta) con la URL del borrador.

## Que NO cambia

- Sigue sin publicarse nunca nada (`status` siempre `draft`, forzado en
  el adaptador — el Carril A no toca esa garantia).
- Sigue sin tocarse produccion bajo ninguna combinacion de interruptores
  (bloqueo incondicional en `assertWordpressWriteAllowed()`).
- El change pack de origen sigue necesitando estar `approved_to_execute`
  ANTES de llegar aqui — eso lo decide `config/autonomy-policy.json`
  (Fase O7), sin cambios.
- Cualquier `changeType` que no este explicitamente en la lista de
  `config/staging-autonomy-policy.json` sigue pidiendo aprobacion de
  Telegram por ejecucion, igual que antes (fail-safe por diseno).
- Producción sigue exigiendo SIEMPRE aprobación explícita de Pau — el
  Carril A es exclusivamente de staging.

## Como desactivarlo

Poner `"enabled": false` en `config/staging-autonomy-policy.json` ->
`autoApproveInStaging`. Se aplica en la siguiente ejecucion, sin
recompilar. Vuelve exactamente al comportamiento de la Fase O26 (cada
ejecucion de staging pide aprobacion de Telegram).

## Rollback de una ejecucion concreta

Igual que siempre — Carril A no cambia el mecanismo de rollback, solo
quien aprueba. Ver `docs/staging-rollback.md`.

## Ver tambien

- `docs/opportunity-states.md` — el estado unificado que usa el informe
  diario para mostrar que avanzo por el Carril A.
- `docs/staging-execution.md` — los 6 gates completos de una escritura
  real en staging (el Carril A solo cambia el gate 6).

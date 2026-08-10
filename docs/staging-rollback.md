# Rollback de Staging (Fase O12)

## Principio: rollback nunca significa borrar

`docs/wordpress-safety-policy.md` establece una regla general: **este
proyecto nunca borra nada en WordPress** (no existe ninguna funcion de
`delete` en `src/adapters/wordpress.ts`). El rollback del Staging
Executor respeta esa regla al pie de la letra — revertir una escritura
significa **actualizar el borrador a un estado seguro conocido**, nunca
eliminarlo. Un borrador (`status: draft`) nunca es visible publicamente
en el sitio, asi que dejarlo existir (vacio o restaurado) no tiene
ningun impacto real para un visitante.

## Que guarda el snapshot (antes de escribir, siempre)

Cada ejecucion `applied_to_staging` en `data/staging-executions.jsonl`
lleva un campo `snapshot`:

```json
{
  "existedBefore": true | false,
  "wordpressPageId": 123,
  "previousStatus": "draft",
  "previousTitle": "...",
  "previousContent": "..."
}
```

- **`existedBefore: false`** — el Staging Executor CREO una pagina
  nueva. No hay "antes" que restaurar.
- **`existedBefore: true`** — el Staging Executor ACTUALIZO un borrador
  que ya existia (de una ejecucion anterior con la misma
  `canonicalKey`). `previousTitle`/`previousContent` son el contenido
  EXACTO de antes de esta actualizacion (leido con un GET justo antes de
  escribir).

## Como se hace un rollback

```bash
npm run staging-executions:list -- --status applied_to_staging
npm run staging-executions:update -- --executionId <id> --status rolled_back --reason "el cliente no aprobo el copy final"
```

Este comando:

1. Comprueba que la ejecucion esta `applied_to_staging` y tiene un
   `wordpressPageId` registrado — si no, se niega a hacer nada.
2. Llama a `updateWordpressDraftPage()` (el MISMO adaptador que usa el
   Staging Executor, con las MISMAS garantias: verifica que la pagina
   sigue en `draft` antes de tocarla, fuerza `status: draft` en la
   escritura, bloquea terminos protegidos):
   - Si `existedBefore: true` → restaura `previousTitle`/
     `previousContent` tal cual estaban.
   - Si `existedBefore: false` → NO borra la pagina. La actualiza con un
     titulo `[ROLLED BACK] <keyword original>` y un contenido placeholder
     que explica que fue revertida — queda como un borrador vacio e
     inequivoco, nunca publicado, nunca borrado.
3. Solo si la escritura de rollback tiene exito, marca la ejecucion como
   `rolled_back` en `data/staging-executions.jsonl` (instantanea nueva,
   append-only — el historico completo, incluida la version aplicada
   original, sigue ahi).
4. Si el rollback en si mismo falla (red, permisos...), la ejecucion se
   queda en `applied_to_staging` — nunca se marca `rolled_back` de forma
   optimista. Reintenta el comando cuando el problema este resuelto.

Requiere los mismos gates de escritura que cualquier otra operacion real:
`WORDPRESS_DRAFTS_ENABLED=true` y `WORDPRESS_ENV=staging` (el bloqueo de
produccion es incondicional, tambien para el rollback). Si
`WORDPRESS_DRAFTS_ENABLED` no esta activo, el comando falla con un error
claro en vez de intentar nada.

## Cuando se espera usar esto

- El Staging QA Agent (100% solo lectura) detecta un problema en un
  borrador ya aplicado (ver su informe en `reports/staging-qa/`) — la
  decision de revertir sigue siendo humana, el QA Agent nunca revierte
  nada por si mismo.
- El cliente revisa el borrador en staging y decide que no quiere seguir
  adelante con ese cambio concreto.
- Un `applied_to_staging` quedo en un estado dudoso tras un fallo parcial
  y se prefiere volver al punto de partida antes de reintentar.

## Que NO hace el rollback

- No borra la pagina.
- No publica nada.
- No toca ninguna otra pagina que no sea la de esta ejecucion concreta.
- No cascada a la work order, accion o change pack de origen — esos
  siguen con su propio estado, sin tocar (si se quiere, se actualizan a
  mano por separado, p.ej. `npm run change-packs:update`).
- No revierte automaticamente por si sola ante un fallo de QA — esa
  decision es siempre manual.

## Ver tambien

- `docs/staging-execution.md` — como se llega a `applied_to_staging` en
  primer lugar.
- `docs/wordpress-safety-policy.md` — politica general (regla "nunca
  borra nada" y su excepcion controlada de "actualizar un draft").

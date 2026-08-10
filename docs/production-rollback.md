# Production Rollback (Fase O13.0)

## Estado actual: no hace falta ningun rollback todavia

Ningun codigo de este proyecto ha escrito nunca en WordPress
produccion. Este documento describe el plan de rollback para cuando
(fase futura) exista una via real de escritura selectiva (Opcion B de
`docs/production-deployment-strategy.md`) — y, mientras tanto, para la
via manual de hoy (`docs/manual-production-publish.md`).

## Principio general

Mismo principio que ya se sigue en staging desde la Fase O12.8:
**nunca escribir sin guardar antes un snapshot completo del estado
anterior.** Un rollback nunca reconstruye nada desde cero — siempre
restaura, literalmente, el contenido que habia justo antes.

## Rollback manual (via A, operativa hoy)

1. **Antes de pegar nada en produccion:** copiar el HTML/contenido
   actual del editor de la pagina de produccion (si es una pagina
   existente) a un fichero local o a un borrador temporal. Si es una
   pagina NUEVA, no hace falta este paso (no hay nada previo que
   perder).
2. Si tras publicar/guardar algo se ve mal: pegar de vuelta ese
   contenido guardado en el paso 1, o usar el historial de revisiones
   nativo de WordPress (Publicar -> Historial de revisiones) si esta
   disponible.
3. Si se subio una imagen nueva a la Media Library de produccion por
   error: NO hace falta borrarla salvo que moleste — el propio patron
   de este proyecto en staging es "nunca borrar media, solo dejar de
   usarla" (ver Fase O12.9). Si hay que borrarla, hacerlo a mano desde
   wp-admin, nunca via `run-wp-cli` ni `execute-php`.

## Rollback programatico (via B, fase futura, NO implementada)

Cuando exista un adapter de escritura selectiva a produccion, debe
seguir EXACTAMENTE el mismo patron ya construido y probado en staging:

- **`src/core/draft-image-insertions.ts`** (Fase O12.8): cada
  insercion/sustitucion de imagen guarda el `previousContentHtml`
  COMPLETO antes de escribir. El rollback (`npm run
  drafts:rollback-image-insertion`) restaura ese texto tal cual, sin
  reconstruir nada.
- **`src/core/staging-executions.ts`** (Fase O12): cada ejecucion
  guarda un `snapshot` del contenido anterior y `rollbackNotes`
  copiadas del change pack de origen.

Un futuro modulo equivalente para produccion (p.ej.
`production-deployment-executions.ts`) deberia:

1. Antes de cualquier `updateWordpressDraftPage()`-equivalente contra
   produccion, hacer un GET de la pagina de destino (si ya existe) y
   guardar su `contentHtml`/`title`/`excerpt` completos en un registro
   append-only nuevo (`data/production-deployment-executions.jsonl`).
2. Nunca escribir sin ese snapshot guardado primero.
3. Exponer un `npm run production:rollback -- --executionId <id>` que
   restaure el snapshot exacto, con la misma confirmacion explicita
   "si" y el mismo verificador de que la pagina sigue en el estado
   esperado antes de tocarla (igual que
   `rollback-image-insertion.ts` verifica `status === "draft"` antes de
   escribir).
4. **Nunca** revertir automaticamente sin que un humano lo pida —
   mismo principio que Staging QA: un fallo detectado NO dispara un
   rollback solo, solo lo notifica.

## Que NO es un mecanismo de rollback valido en este proyecto

- `run-wp-cli` — prohibido explicitamente en todas las fases de
  produccion.
- `execute-php` — prohibido explicitamente.
- El boton "Publish staging" de Hostinger a la inversa (publicar
  produccion sobre staging) — nunca se ha planteado ni se plantea
  aqui.
- Restaurar un backup completo del hosting para revertir un solo
  cambio de contenido — desproporcionado, y fuera del control de este
  proyecto (es una accion de Hostinger, no de este codigo).

## Ver tambien

- `docs/production-deployment-strategy.md`
- `docs/manual-production-publish.md`
- `docs/staging-rollback.md` (el equivalente ya implementado en staging)

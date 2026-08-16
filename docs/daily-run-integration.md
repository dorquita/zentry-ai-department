# Del Daily Brief a la ejecución: cómo se integra `execute-php` en la pasada diaria

Antes, el departamento acababa siempre en el mismo sitio:

```
Growth → QA → Web Engineer produce PROSA → requires_manual_implementation
```

Las 7 propuestas del Daily Brief del 2026-08-15 acabaron todas ahí. El
motivo no era falta de permiso: era que la capa de apply tenía que
**interpretar prosa** buscando `page_id=N` en el texto, y web-engineer no
tenía forma de saber ningún id real.

Ahora:

```
Growth → QA → Web Engineer produce ChangePlan → capability selector
      → native ability o execute_php_fallback → propuesta ACTIONABLE
      → Daily Brief → aprobación humana por prompt → APPLY STAGING
      → validación → segundo email
```

## La pasada de las 07:00 sigue siendo PLANIFICACIÓN

**No escribe en staging.** Lee, especifica, propone y manda el email. Ahí
termina. `STAGING WRITES DURANTE EL DAILY PLAN = 0`.

Lo único nuevo que hace es **leer**: un paso propio
(`scripts/read-staging-inventory.ts`, `npm run staging:inventory`) que
obtiene el inventario real de staging por REST y lo deja en el directorio
de la pasada.

Ese paso vive fuera de la capa de departamento a propósito.
`run-department-coordination.ts` **no importa ningún adaptador** —es
READ/ANALYZE/PROPOSE y un test de invariante lo verifica—, así que sólo
lee el fichero ya escrito. El único que cablea WordPress es el runner del
workflow, igual que con el resto de sistemas externos.

## Cómo se resuelve el `pageId` (sin adivinarlo)

El reparto es la clave:

| Quién | Qué aporta |
|---|---|
| **Claude** (web-engineer) | la INTENCIÓN: a qué página apunta (URL o slug del inventario), qué operación, el contenido nuevo |
| **El sistema** | los HECHOS: `wordpressPageId`, el BEFORE real, el `expectedBeforeHash`, la capability y el `executionPath` |

`buildChangePlanFromDraft()` resuelve la referencia contra el inventario
real por **id exacto, URL exacta o slug exacto** — nunca por parecido. Si
no casa con exactamente una página: `MANUAL`, con el motivo. Si el modelo
enviara un `pageId` o un hash, se ignoran: esos campos no existen en el
contrato de entrada.

Un test alimenta un draft con `expectedBeforeHash` y `targetId` falsos y
comprueba que el plan resultante conserva los valores **leídos**.

## Qué significa ACTIONABLE

Literalmente: **si Pau la aprueba, el sistema sabe ejecutarla.**

Por eso un plan que enruta a `native_ability` se marca **MANUAL**, no
ACTIONABLE: el plan es válido, pero hoy no hay executor cableado para esa
vía, y llamarlo accionable sería mentir en el Daily Brief. Hoy no bloquea
nada real — el sitio no tiene ni un bloque `novamira/*`, así que todo
enruta al fallback.

Estados: `ACTIONABLE` · `BLOCKED` (QA o un guard) · `MANUAL` (no
resoluble con evidencia real, o sin executor) · `STALE` (la página cambió
desde la propuesta; se comprueba en el momento de ejecutar, no antes).

## Operaciones integradas

Sólo lo ya probado: `update_post_content`, `update_post_title`,
`update_post_excerpt`, `update_post_meta` (con la allowlist
`_yoast_wpseo_title` / `_yoast_wpseo_metadesc`).

Fuera: redirects, media, usuarios, plugins, themes, filesystem, WP-CLI,
PHP arbitrario, SQL directo.

## Aprobación por prompt

Al decir *"Aprueba 2"*, la sesión: localiza el Daily Brief exacto → mapea
`#2` a su `recommendationId` real → carga el **ChangePlan persistido** →
relee la página y comprueba el ancla de versión (**STALE** → no se
ejecuta) → ejecuta sólo esa propuesta → valida releyendo por REST (vía
distinta a la escritura) → rollback verificado si falla → registra.

**Silencio = pendiente.** Una aprobación vieja nunca se reinterpreta para
una versión nueva: el `expectedBeforeHash` lo impide.

## Seguridad: intacta

Snapshot · `expectedBeforeHash` · STALE guard · builder determinista ·
payload base64 · igualdad exacta de plantilla por fase · guard por
`ability_name` · read-back por vía independiente · validación de scope ·
rollback · verificación del rollback · audit trail.

`execute-php` sigue siendo `dangerous_forbidden` en el allowlist general.
La excepción estrecha sigue exigiendo Web Engineer/APPLY + STAGING +
ChangePlan válido + guard específico.

**Producción: 0 writes.** Política sin cambios.

## Daily Brief: qué se ve de cada propuesta

Cada propuesta numerada imprime número, `recommendationId` + `changeId`,
descripción, página, URL de staging, **BEFORE real** (leído del sitio, no
prometido), AFTER propuesto, operación, `page_id`, camino de ejecución,
capacidad, QA, riesgo y **ESTADO** (`ACTIONABLE` / `BLOCKED` / `MANUAL` /
`STALE`).

Cuando no hay ChangePlan, el email lo dice — no imprime una operación ni
un `page_id` vacíos que parecerían datos.

## Salud del departamento

La sección 6 del email es **SALUD DEL DEPARTAMENTO**. Ahí van los fallos
técnicos internos (`seo-specialist failed`, inventario de staging
ilegible, una etapa que no aparece en el manifiesto) con su política real:
se reintentan en la siguiente pasada o se arreglan en el repositorio.

Un fallo técnico **no es una propuesta de negocio** y no ocupa un número.
`isInternalTechnicalItem()` (en `src/department/department-health.ts`) los
reconoce con un criterio deliberadamente conservador — exige que no haya
plan ejecutable, que no haya página objetivo resuelta *y* que el texto
nombre un componente interno — y `buildNumberedProposals()` los excluye
allí mismo, en la única función que numera, para que el email y la sesión
de aprobación sigan viendo exactamente la misma lista.

## La segunda mitad del día, en Actions

`.github/workflows/department-approval-session.yml` (`workflow_dispatch`)
ejecuta la decisión humana sobre un Daily Brief concreto:
`departmentRunId` + `decisions` (JSON) + `execute`.

Recupera el **artifact de esa pasada** — el nombre lleva el
`departmentRunId`, así que la correspondencia es exacta — y ejecuta la
sesión sobre los mismos ficheros que produjeron el Daily Brief, no sobre
una reconstrucción. Sin artifact no hay nada que aprobar y el job para
antes de escribir nada.

`execute: false` (por defecto) es dry-run: enseña la interpretación y no
toca nada. Al job no se le pasa ninguna variable de producción, ni
siquiera apagada.

Una modificación pedida al aprobar (*"cambia el title por X"*) sobre una
propuesta que ya lleva ChangePlan **no se ejecuta**: el payload del plan
es el que se validó y contra el que se compara el AFTER, así que aplicarlo
ignorando la modificación escribiría algo que nadie aprobó. Se para y se
dice por qué; el cambio pedido vuelve como propuesta nueva.

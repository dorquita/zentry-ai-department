# Change Packs

## Por que existe

Las Fases O5-O8 dieron a Pau una cola de acciones deduplicadas (Action
Backlog) y planes de ejecucion detallados (Work Orders): title/meta/H1
para SEO, brief para contenido, CTA/formulario para CRO. Pero una work
order sigue siendo un documento pensado para que un HUMANO la lea y
decida — no esta estructurada como "un paquete que se podria aplicar".
Esta fase anade esa capa intermedia: el **Change Pack**, que reempaqueta
una work order ya detallada en algo mas concreto — pasos de
implementacion numerados, checklist de revision, riesgos y notas de
reversion — listo para el dia en que exista ejecucion controlada (un
futuro modo `APPLY`), sin que ese modo exista todavia hoy.

**Un Change Pack NO ejecuta nada.** No toca WordPress, no publica
paginas, no crea borradores de WordPress, no modifica Google Ads, no
activa campanas, no modifica GA4/GTM, no toca n8n ni qdrant — ni siquiera
en su estado mas avanzado (`approved_to_execute`, que solo significa "Pau
aceptaria que esto se ejecute cuando exista un modo de ejecucion", no
"ejecutar ahora").

## Diferencia entre action, work order y change pack

| Concepto | Fichero | Que es |
|---|---|---|
| **Action** | `data/action-backlog.jsonl` | Una recomendacion unica con estado (`new`/`auto_approved_for_planning`/`approved`/...). Dice **que** hay que hacer. |
| **Work Order** | `data/work-orders.jsonl` | El plan detallado de **como** se haria: title/meta/H1/H2 para SEO, brief para contenido, CTA/formulario para CRO. Pensado para que un humano lo lea y decida. |
| **Change Pack** | `data/change-packs.jsonl` | La work order reempaquetada en algo **ejecutable en el futuro**: pasos de implementacion numerados, checklist de revision, riesgos concretos y notas de reversion. Un nivel mas cerca de "aplicar", sin aplicar nada hoy. |

## Cuando se crea un change pack

Solo para work orders en uno de estos 3 estados (todos significan "el
plan ya esta completamente detallado", no un borrador a medias):

- `auto_prepared` (Fase O7: work order generada sin intervencion humana)
- `ready_for_review` (work order generada a partir de una accion aprobada
  por un humano)
- `approved_to_prepare` (un humano ya acepto que se prepare con mas
  detalle)

**Nunca** se crea para work orders `draft` (a medias), `rejected`,
`applied_manually` ni `superseded`.

Como las 3 work orders elegibles ya vienen con el plan completo, un
change pack nuevo nace directamente en `ready_for_review` — nunca se
queda en `draft` esperando que alguien mas lo complete.

## Deduplicacion

Un change pack se deduplica por `workOrderId`: una work order nunca
tiene mas de un change pack activo. Si la work order se vuelve a
detectar (sigue vigente), el change pack existente solo se "toca"
(`updatedAt` fresco) — no se crea uno segundo.

## Los 3 builders

| Builder | Categoria de work order | `changeType` |
|---|---|---|
| SEO Change Pack Builder | `seo:*` | `seo_on_page_update` |
| Content Change Pack Builder | `content:*` | `new_content_page` (si la work order era `content:new_landing`) o `content_update` |
| CRO Change Pack Builder | `cro:*` | `cro_conversion_update` |

Cada uno reutiliza el `proposedChanges` que ya genero el Work Order
Builder correspondiente (Fase O6) — no vuelve a redactar title/meta/CTA
desde cero, solo lo reempaqueta anadiendo:

- **`currentAssumptions`** — que se asume que sigue siendo cierto (la
  pagina sigue existiendo, la keyword sigue siendo relevante...). Si
  alguna asuncion ya no es valida, el change pack deberia revisarse antes
  de considerarlo vigente.
- **`implementationSteps`** — pasos numerados y concretos de como se
  aplicaria el cambio, terminando siempre en "publicar solo tras
  aprobacion humana explicita".
- **`humanReviewChecklist`** — que debe confirmar un humano antes de
  aceptar el paquete, incluida la confirmacion explicita de que no se ha
  tocado produccion.
- **`risks`** — heredados de la work order (p.ej. riesgo de
  canibalizacion SEO) mas riesgos propios de "aplicar esto" (fluctuacion
  temporal de CTR, etc.).
- **`rollbackNotes`** — como revertir si algo sale mal. Esto es nuevo
  respecto a las work orders: al pensar en "un paquete que algun dia se
  podria aplicar", hace falta pensar tambien en como deshacerlo.

## Formato de `data/change-packs.jsonl`

Log append-only de instantaneas, mismo patron que
`action-backlog.jsonl`/`work-orders.jsonl`/`approval-requests.jsonl`: el
estado actual de un change pack es su instantanea mas reciente. No hay un
fichero de auditoria aparte — el propio historico de instantaneas ya
reconstruye toda la historia de cambios de estado de un change pack.

```json
{
  "changePackId": "uuid",
  "workOrderId": "uuid de la work order origen",
  "actionId": "uuid de la accion origen",
  "canonicalKey": "heredada de la work order",
  "targetBrand": "zentry",
  "brandIntent": "zentry_locker_core",
  "page": "https://zentrylockers.com/taquillas-melamina/",
  "keyword": "taquillas de melamina",
  "changeType": "seo_on_page_update",
  "priority": "high",
  "status": "ready_for_review",
  "proposedChanges": { "...": "el mismo contenido detallado que ya tenia la work order" },
  "currentAssumptions": ["..."],
  "implementationSteps": ["..."],
  "humanReviewChecklist": ["..."],
  "risks": ["..."],
  "rollbackNotes": ["..."],
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Estados

```
draft -> ready_for_review -> approved_to_execute -> applied_manually
                            \-> rejected
                            \-> superseded
```

| Estado | Significa |
|---|---|
| `draft` | Reservado para uso manual futuro — los builders automaticos nunca dejan un change pack aqui (siempre crean directamente en `ready_for_review`, porque la work order origen ya viene completa). |
| `ready_for_review` | Listo para que un humano lo revise. |
| `approved_to_execute` | Pau aceptaria que esto se ejecute — **no** implica que se haya ejecutado ni que exista forma de ejecutarlo hoy. |
| `rejected` | Descartado. |
| `applied_manually` | Alguien lo aplico fuera de este sistema y lo registra aqui manualmente. |
| `superseded` | Sustituido por otro change pack mas reciente/mejor. |

## Comandos

```bash
npm run change-packs:list
npm run change-packs:list -- --status ready_for_review
npm run change-packs:list -- --targetBrand zentry
npm run change-packs:list -- --changeType seo_on_page_update
npm run change-packs:update -- --changePackId <id> --status approved_to_execute
npm run change-packs:update -- --changePackId <id> --status rejected --reason "..."
```

`change-packs:update` **nunca cascada** a la work order ni a la accion
relacionadas — a diferencia de `approvals:update` (Fase O8), que si
cascada la respuesta de una solicitud de Telegram a la accion/work order.
Change Packs es una capa de empaquetado adicional, no un mecanismo de
decision o ejecucion; cambiar su estado no cambia nada mas.

Ejecutar un builder suelto (fuera del pase diario):

```bash
npm run change-packs:seo
npm run change-packs:content
npm run change-packs:cro
```

## Como se integra en el pase diario

Dentro de `npm run growth:daily` (18 pasos totales), los 3 Change Pack
Builders corren justo despues de los 3 Work Order Builders y antes de
Approval Gateway y Growth Director — para que, cuando Growth Director
consolide el informe del dia, los change packs de hoy ya existan. Ver
`docs/daily-growth-report.md`.

## Donde aparecen en los informes

- **Informe tecnico** (`reports/daily/technical-<fecha>.md`): seccion
  completa "Change Packs" con el total, los nuevos de hoy, los listos
  para revisar, el desglose por `changeType`, y el top 5 con IDs.
- **Informe ejecutivo** (`reports/daily/executive-<fecha>.md`, el que se
  envia por email): una sola linea agregada en "Estado de ejecucion"
  ("Paquetes de cambio concretos preparados (sin ejecutar): N") — a
  proposito NO se listan uno a uno ahi, para no duplicar lo que la
  seccion "Acciones recomendadas" ya muestra sobre las mismas
  oportunidades.
- Cada builder ademas escribe su propio informe detallado en
  `reports/seo-change-packs/`, `reports/content-change-packs/` y
  `reports/cro-change-packs/`.

## Seguridad

- No toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant, en ningun
  estado, incluido `approved_to_execute`.
- `data/change-packs.jsonl` es append-only.
- No maneja secretos.
- `humanReviewChecklist` incluye siempre una confirmacion explicita de
  que no se ha tocado produccion al preparar el paquete.

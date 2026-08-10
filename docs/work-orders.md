# Work Orders (Fase O6 + O7)

## Por que existe

La Fase O5 dio a Pau una cola de acciones deduplicadas y con estado
(`data/action-backlog.jsonl`). Pero "aprobar" una accion solo dice **que**
hay que hacer ("mejorar SEO de esta pagina"), no **como**: falta el title
propuesto, el meta description, los H2, el CTA, etc. La Fase O6 anado esa
capa: cuando una accion pasa a `approved`, el sistema genera
automaticamente un **plan de ejecucion detallado** — la work order. La
Fase O7 amplia esto: una work order tambien se genera cuando la accion
pasa a `auto_approved_for_planning` (la politica de autonomia la aprobo
sin intervencion humana, ver `docs/autonomy-policy.md`) — el plan es
igual de detallado en ambos casos, lo unico que cambia es de donde vino
la aprobacion.

## Diferencia entre job, event, action y work order

| Concepto | Fichero | Que es | Se deduplica |
|---|---|---|---|
| **Job** | `data/jobs.jsonl` | Una oportunidad SEO detectada en una ejecucion concreta. | No |
| **Event** | `data/department-events.jsonl` | Un registro de actividad interna de un agente. | No |
| **Action** | `data/action-backlog.jsonl` | Una recomendacion unica con estado (`new`/`open`/`auto_approved_for_planning`/`approved`/...). | Si |
| **Work Order** | `data/work-orders.jsonl` | El **plan detallado** de como ejecutar una accion `approved`/`auto_approved_for_planning`: title/meta/H1/H2 para SEO, brief para contenido, CTA/formulario para CRO... | Si (por `actionId`) |

En resumen: la accion dice "hay que hacer X". La work order dice
"exactamente asi se haria X, si se aprueba prepararlo".

## Una work order NUNCA ejecuta nada

Ni siquiera en su estado mas avanzado (`approved_to_prepare`), ni en
`auto_prepared` (Fase O7). Ninguno de esos estados significa "publicar en
WordPress" ni "activar una campana" — solo "hay una propuesta detallada
lista para mirar". La ejecucion real sigue siendo un paso manual, fuera
de este sistema, hasta que exista un modo `APPLY` explicito (que no
existe hoy). Cada work order lleva ademas un campo `productionSafety`
inmutable (fijado al crearla, nunca modificado despues) que confirma
`wordpressTouched: false`, `published: false`, `productionExecuted:
false`.

## Formato de `data/work-orders.jsonl`

Igual que `action-backlog.jsonl`: log append-only de instantaneas. El
estado actual de una work order es su instantanea mas reciente.

```json
{
  "workOrderId": "uuid",
  "actionId": "uuid de la accion origen",
  "canonicalKey": "heredada de la accion",
  "department": "web-growth",
  "sourceActionTitle": "SEO: \"cerraduras inteligentes para taquillas\" (...)",
  "brandIntent": "zentry_smart_locker",
  "targetBrand": "both",
  "actionType": "seo:quick_win",
  "keyword": "cerraduras inteligentes para taquillas",
  "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
  "priority": "high",
  "impact": "medium",
  "effort": "medium",
  "status": "auto_prepared",
  "requiresHumanReview": true,
  "planningOrigin": "auto_approved_for_planning",
  "autonomyLevel": "AUTO_PLAN",
  "riskLevel": "low_medium",
  "requiresApproval": false,
  "productionSafety": {
    "wordpressTouched": false,
    "published": false,
    "productionExecuted": false,
    "note": "No se ha tocado WordPress. No se ha publicado nada. No se ha ejecutado produccion."
  },
  "proposedChanges": { "...": "estructura especifica segun categoria, ver abajo" },
  "implementationChecklist": ["..."],
  "risks": ["..."],
  "dependencies": [],
  "sourceAgents": ["approved-action-planner", "seo-work-order-builder"],
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Estados

```
draft -> ready_for_review    -> approved_to_prepare -> applied_manually
      \-> auto_prepared      /
                            \-> rejected
                            \-> superseded
```

| Estado | Significa |
|---|---|
| `draft` | Creada por el Approved Action Planner, pendiente de que un builder la amplie (o sin builder dedicado para su categoria). |
| `ready_for_review` | Ya tiene el plan detallado. La accion origen la aprobo un **humano** (`planningOrigin: human_approved`). Lista para revision. |
| `auto_prepared` | Ya tiene el plan detallado (mismo contenido que `ready_for_review`). La accion origen la aprobo la **politica de autonomia** sin intervencion humana (`planningOrigin: auto_approved_for_planning`, Fase O7). Igual de pendiente de revision antes de cualquier ejecucion real. |
| `approved_to_prepare` | Pau acepta que se prepare — **no** implica publicar nada. |
| `rejected` | Descartada. |
| `applied_manually` | Alguien la ejecuto fuera de este sistema (WordPress, Ads...) y lo registra aqui manualmente. |
| `superseded` | Sustituida por otra work order mas reciente/mejor. |

`ready_for_review` y `auto_prepared` significan exactamente lo mismo en
terminos de seguridad y de contenido — la unica diferencia es de donde
vino la aprobacion para llegar hasta ahi. La funcion
`finalReviewStatus(planningOrigin)` en `src/core/work-orders.ts` es la
unica que decide cual de las dos usar.

## Categorias y quien las amplia

| Categoria (por `actionType`) | Builder dedicado |
|---|---|
| `seo:*` | SEO Work Order Builder — title, meta, H1, H2, copy, FAQs, enlaces internos, schema, riesgo de canibalizacion. |
| `content:*` | Content Work Order Builder — brief (no el articulo entero): tipo de contenido, keywords, estructura H2/H3, CTA, cluster SEO. |
| `cro:*` | CRO Work Order Builder — CTA, ubicacion, formulario, confianza, FAQ, mejoras visuales, test A/B. |
| `sem:*`, `competitor:keyword_gap_sem` | Sin builder dedicado — el Approved Action Planner ya deja el contenido definitivo (checklist de revision de campana) Y fija el status final directamente (`ready_for_review`/`auto_prepared`), porque no hay builder despues que lo haga. |
| `analytics:*` | Sin builder dedicado — checklist de validacion de tracking, status final fijado igual que arriba. |
| `competitor:*` (resto) | Sin builder dedicado — nota de valoracion de contenido/landing, status final fijado igual que arriba. |

## Como se genera una work order (flujo completo, Fase O7)

1. Un agente (SEO Director, Content Planner, CRO Reviewer, Competitor
   Intelligence, SEM Watcher o Analytics Watcher) genera una recomendacion.
2. Approval Queue la convierte en una accion del Action Backlog y aplica
   la politica de autonomia (`docs/autonomy-policy.md`): la mayoria de
   SEO/contenido/CRO/SEM/Analytics/competencia caen en
   `auto_approved_for_planning` **sin que Pau tenga que hacer nada**. Si
   el tipo de accion tocara produccion real, queda en `waiting_approval`
   y Pau la aprueba a mano: `npm run actions:update -- --actionId <id>
   --status approved`.
3. En la misma pasada, el **Approved Action Planner** detecta las
   acciones `approved` (humano) Y `auto_approved_for_planning` (politica)
   y crea una work order `draft` por cada una, categorizada, con
   `planningOrigin` heredado de la accion.
4. El builder correspondiente (SEO/Content/CRO) la amplia con el plan
   detallado y la pasa a `ready_for_review` o `auto_prepared` segun el
   `planningOrigin` (las categorias sin builder ya llegan con el status
   final desde el paso 3).
5. Pau la revisa: `npm run work-orders:list -- --status ready_for_review`
   o `npm run work-orders:list -- --status auto_prepared`.
6. Pau decide: `npm run work-orders:update -- --workOrderId <id> --status approved_to_prepare` (o `rejected`).
7. La ejecucion real (editar WordPress, activar Ads, etc.) sigue siendo
   manual, fuera de este sistema.

## Evitar duplicados

Una work order se deduplica por `actionId`: una accion `approved` o
`auto_approved_for_planning` nunca tiene mas de una work order activa. Si
la accion vuelve a detectarse (sigue vigente), la work order existente
solo se "toca" (`updatedAt` fresco) — no se crea una segunda.

## Seguridad

- No toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant, en ningun
  estado, incluidos `auto_prepared` y `auto_approved_for_planning`.
- `data/work-orders.jsonl` y `data/work-order-audit.jsonl` son
  append-only.
- No maneja secretos.
- El campo `productionSafety` de cada work order es inmutable desde su
  creacion — ni los builders ni `updateWorkOrderContent()` lo tocan.

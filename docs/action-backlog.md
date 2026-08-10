# Action Backlog (Fase O5)

## Por que existe

Antes de la Fase O5, cada pasada diaria del departamento generaba
recomendaciones nuevas desde cero: si "cerraduras inteligentes para
taquillas" seguia siendo una oportunidad, el email de manana la mostraria
otra vez como si fuera la primera vez. El Action Backlog anade una capa
operativa que **deduplica** esas recomendaciones en acciones unicas con
estado, para que el departamento deje de repetirse.

## Job vs Event vs Action — la diferencia

| Concepto | Fichero | Que es | Quien lo escribe | Se deduplica |
|---|---|---|---|---|
| **Job** | `data/jobs.jsonl` | Una oportunidad SEO detectada por el SEO Watcher en una ejecucion concreta. | Solo SEO Watcher. | No — cada ejecucion anade sus jobs, aunque sean "la misma" oportunidad que ayer. |
| **Event** | `data/department-events.jsonl` | Un registro de actividad interna de un agente (empezo, termino, detecto algo, genero una recomendacion...). | Cualquier agente. | No — es un log de auditoria de lo que paso, no un estado. |
| **Action** | `data/action-backlog.jsonl` | Una recomendacion **unica y con estado**, resultado de deduplicar jobs/eventos por su `canonicalKey`. | Solo Approval Queue. | **Si** — es la razon de ser de esta capa. |

En resumen: los jobs y los eventos son el "que paso" (historico completo,
sin deduplicar, append-only). Las acciones son el "que hay que decidir
ahora" (deduplicado, con estado, tambien append-only pero como log de
instantaneas — ver mas abajo).

## Formato de `data/action-backlog.jsonl`

Es un **log append-only de instantaneas**, no una tabla que se reescribe:
cada linea es como estaba una accion en un momento dado. El estado
**actual** de una accion es su instantanea mas reciente (la ultima linea
con ese `actionId`). Nunca se borra ni se reescribe una linea existente —
por eso no hace falta backup antes de escribir: solo se anade.

Campos de cada instantanea:

```json
{
  "actionId": "uuid, estable durante toda la vida de la accion",
  "canonicalKey": "brandIntent|actionType|keyword_normalizada|pagina_normalizada",
  "title": "...",
  "description": "...",
  "sourceAgents": ["seo-director", "content-planner"],
  "department": "web-growth",
  "brandIntent": "zentry_smart_locker",
  "targetBrand": "both",
  "keyword": "cerraduras inteligentes para taquillas",
  "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
  "actionType": "seo:quick_win",
  "priority": "high",
  "impact": "medium",
  "effort": "medium",
  "status": "open",
  "requiresApproval": true,
  "evidence": { "currentPosition": 24.9, "targetPosition": 10 },
  "recommendation": "Optimizar on-page...",
  "firstSeenAt": "2026-08-02T...",
  "lastSeenAt": "2026-08-03T...",
  "seenCount": 2,
  "runIds": ["growth-department-2026-08-02T...", "growth-department-2026-08-03T..."],
  "relatedJobIds": ["uuid-job-1", "uuid-job-2"],
  "createdAt": "2026-08-02T...",
  "updatedAt": "2026-08-03T..."
}
```

## canonicalKey — como se deduplica

```
brandIntent + actionType + keyword_normalizada + pagina_normalizada
```

- `brandIntent`: la categoria del [Brand/Intent Router](brand-intent-strategy.md).
- `actionType`: p.ej. `seo:quick_win`, `content:new_landing`,
  `cro:landing_review`, `competitor:keyword_gap_seo`.
- keyword/pagina se normalizan (minusculas, sin acentos) antes de comparar.

Si dos recomendaciones (de la misma pasada o de pasadas distintas)
generan la misma `canonicalKey`, son la MISMA accion: se actualiza
`seenCount`, `lastSeenAt`, `sourceAgents` y `runIds` en vez de crear una
entrada duplicada.

## Estados

```
new -> open -> waiting_approval -> approved -> done
              \-> rejected
              \-> snoozed
```

| Estado | Significa |
|---|---|
| `new` | Detectada por primera vez, nunca vista antes de hoy. |
| `open` | Ya se habia visto antes (recurrente) y sigue sin decidirse. |
| `waiting_approval` | Marcada explicitamente como pendiente de decision (uso manual). |
| `approved` | **Un humano acepta trabajarla.** No implica ejecucion. |
| `rejected` | Descartada. No se propondra como "nueva" otra vez, pero si sigue detectandose se actualiza `seenCount` sin cambiar el estado. |
| `snoozed` | Aparcada temporalmente. Igual que `rejected`: reaparecer no la reactiva sola. |
| `done` | Ya se trabajo (fuera de este sistema). Tampoco se reactiva sola. |

**Importante: ningun estado implica ejecucion real.** `approved` no
publica nada en WordPress, no activa ninguna campana, no toca GA4/GTM.
Solo es una senal de "Pau quiere trabajar esto" para que quede fuera del
ruido de "acciones nuevas".

## Como evitar duplicados

No hace falta hacer nada manualmente: la deduplicacion es automatica via
`canonicalKey`. Si una accion parece duplicada de todos modos, revisa que
`actionType`/`keyword`/`page` sean realmente equivalentes — pequenas
variaciones de keyword (p.ej. "taquillas melamina" vs "taquillas de
melamina") generan `canonicalKey` distintas a proposito, porque pueden
apuntar a paginas o intenciones ligeramente distintas. Fusionarlas de
verdad seria una mejora futura (matching difuso), no implementada en v1.

## Quien escribe en el backlog

Solo el **Approval Queue Agent** (`src/agents/approval-queue.ts`, ver
`docs/approval-queue.md`). Los demas agentes generan recomendaciones via
el bus de eventos; Approval Queue es el unico que las convierte en
acciones del backlog.

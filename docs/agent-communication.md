# Como se comunican los agentes

## `data/department-events.jsonl` (bus de eventos)

Append-only, igual que `data/jobs.jsonl`: cada linea es un evento JSON
independiente, nunca se borra ni se reescribe una linea existente
(`src/core/department-events.ts`).

### Estructura de un evento

```json
{
  "eventId": "uuid",
  "departmentRunId": "growth-department-2026-08-02T080000Z",
  "agent": "seo-watcher",
  "department": "web-growth",
  "type": "opportunity_detected",
  "priority": "high",
  "summary": "Texto legible de una linea",
  "payload": { "...": "datos estructurados especificos del tipo de evento" },
  "createdAt": "2026-08-02T08:00:01.123Z"
}
```

### Tipos de evento

| Tipo | Quien lo emite | Para que |
|---|---|---|
| `agent_started` | Todos | Marca el inicio de la ejecucion de un agente. |
| `agent_finished` | Todos | Marca el fin, con un resumen en `payload` (incluye `reportPath` cuando aplica). |
| `opportunity_detected` | SEO Watcher | Una oportunidad SEO nueva. |
| `recommendation_created` | SEO Director, Content Planner, CRO Reviewer | Una accion/propuesta concreta. |
| `warning_detected` | Cualquiera | Algo se salto o degrado (credenciales ausentes, URL bloqueada, etc.). |
| `competitor_keyword_detected` | Competitor Intelligence | Un gap de keyword o de sector/material de la competencia (`payload.gapType` distingue ambos). |
| `brand_intent_classified` | Competitor Intelligence | El detalle de una clasificacion de marca. |
| `action_proposed` | Reservado para uso futuro. |
| `approval_required` | Reservado para uso futuro (cuando exista un flujo de aprobacion formal). |

## Como lee un agente lo que hizo otro

Dos patrones, segun el caso:

1. **Reutilizar la funcion pura directamente** (preferido cuando es
   posible): Content Planner, CRO Reviewer y Growth Director importan
   `buildActionPlan()` de `src/agents/seo-director.ts` y lo llaman en
   memoria con los jobs mas recientes, en vez de releer el informe
   markdown del SEO Director. Es mas rapido y no depende de parsear texto.

2. **Leer el bus de eventos** (cuando el productor implica trabajo caro/
   asincrono, como llamadas de red): Content Planner y SEM Watcher leen
   `data/department-events.jsonl`, filtran los eventos
   `competitor_keyword_detected` de Competitor Intelligence, y toman los
   de la ejecucion mas reciente de ese agente (`departmentRunId` maximo
   entre los eventos de `agent: "competitor-intelligence"`).

Growth Director combina ambos: reutiliza `buildActionPlan()` para las
acciones SEO, y lee `readEventsForRun(departmentRunId)` para saber que
hizo cada agente (incluidos sus `reportPath` y warnings).

## Por que no se parsean los ficheros `.md`

Los informes en `reports/*/*.md` estan pensados para que los lea una
persona (o se peguen en un email), no para que los parseen otros agentes.
Cualquier dato que un agente necesite de otro esta disponible de forma
estructurada (JSONL) via jobs o eventos — nunca hace falta leer un
markdown para obtener datos, solo para citar su ruta.

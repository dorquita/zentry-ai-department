# Sistema operativo del departamento (Fase O4)

## Que cambia respecto a la Fase O3

Hasta la Fase O3.5, el proyecto tenia agentes aislados: SEO Watcher y SEO
Director se ejecutaban por separado, cada uno con su propio `runId`, sin
ninguna nocion de "departamento" ni forma de que un agente supiera lo que
hizo otro. La Fase O4 anade la infraestructura para que funcionen como un
**departamento coordinado**: comparten un identificador de pasada
(`departmentRunId`), se comunican via un bus de eventos, y un agente
consolidador (Growth Director) lee lo que hicieron todos para producir un
unico informe diario.

## Los 8 agentes del departamento Web & Growth

| # | Agente | Que hace | Fuente de datos |
|---|---|---|---|
| 1 | SEO Watcher | Detecta oportunidades SEO | Google Search Console real (o mock) |
| 2 | SEO Director | Agrupa y prioriza | `data/jobs.jsonl` |
| 3 | Competitor Intelligence | Analiza paginas publicas de competidores | HTML publico (config/competitors.json) |
| 4 | Content Planner | Propone contenido | jobs + eventos de Competitor Intelligence |
| 5 | CRO / Landing Reviewer | Propone mejoras de conversion | jobs |
| 6 | SEM Watcher | Vigila el estado de Google Ads | config local (placeholder sin credenciales) |
| 7 | Analytics Watcher | Vigila eventos clave de GA4 | config local (placeholder sin credenciales) |
| 8 | Growth Director | Consolida todo en un informe final | eventos del `departmentRunId` + jobs |

Todos son `READ` + `PROPOSE`. Ninguno tiene modo `APPLY` implementado.

## departmentRunId

Formato: `growth-department-YYYY-MM-DDTHHMMSSZ` (`src/core/department-run-id.ts`).

- Cuando `scripts/run-daily-growth-department.ts` orquesta el pase diario,
  genera **un unico** `departmentRunId` y se lo pasa explicitamente a cada
  agente (`runSeoWatcher(departmentRunId)`, etc.).
- Cuando un agente se ejecuta suelto (`npm run seo:watch`,
  `npm run competitor:intel`...), genera su **propio**
  `departmentRunId` (una pasada de un solo agente) si no se le pasa uno.
  Sigue siendo valido como agrupador de sus propios eventos, solo que no
  se correlaciona con los de otros agentes de esa ejecucion suelta.

## Bus de eventos

Ver `docs/agent-communication.md` para el detalle completo de
`data/department-events.jsonl`.

## Informe diario unico

Ver `docs/daily-growth-report.md` para el detalle del informe del Growth
Director y como se convierte en el email diario.

## Que NO cambia

- Las reglas de seguridad son las mismas de siempre: solo lectura +
  propuesta, nada de modo `APPLY`, nada de tocar WordPress/Ads/GA4/GTM/n8n/qdrant.
- `data/jobs.jsonl` sigue siendo append-only y sigue siendo la fuente de
  verdad de las oportunidades SEO.
- `reports/seo/` y `reports/seo-director/` siguen funcionando exactamente
  igual que antes.

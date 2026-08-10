# Estado real por oportunidad (Fase O27)

## Por que existe

Antes de esta fase, "el estado" de una oportunidad vivia repartido en 4
registros independientes, cada uno con su propio vocabulario local:

- `BacklogAction.status` (Action Backlog — Fase O5/O7)
- `ChangePack.status` (change pack concreto — Fase "Change Packs")
- `StagingExecution.status` (ejecucion real en staging — Fase O12)
- `ProductionDeploymentPlan.status` + `ProductionExecution.status`
  (planificacion/ejecucion de produccion — Fase O13)

Cada vocabulario es correcto puertas adentro de su propio agente, pero no
existia una unica respuesta a "¿en que punto esta esta oportunidad, de
verdad?" sin reconstruirla a mano leyendo los 4 registros. Esto era una
causa directa de que el informe diario pareciera repetir lo mismo: una
oportunidad podia estar genuinamente avanzando por dentro (nuevo change
pack, nueva ejecucion) sin que ese avance se viera reflejado en ningun
sitio legible por un humano.

## Los 14 estados

| Estado | Que significa | De donde sale |
|---|---|---|
| `detected` | Se detecto la oportunidad (Search Console/competencia/CRO), sin ningun change pack todavia. | `BacklogAction` sin `ChangePack` vinculado |
| `selected_for_execution` | Hay un change pack `approved_to_execute` y una ejecucion de staging en cola o aprobada, pendiente de aplicarse. | `ChangePack.status=approved_to_execute` + `StagingExecution.status` en `pending_approval`/`approved` |
| `drafted_local` | Change pack preparado (`draft`/`ready_for_review`) — equivalente al "preview local" de siempre. | `ChangePack.status` en `draft`/`ready_for_review` |
| `pushed_to_staging` | Escritura real aplicada en staging (borrador, nunca publicado), QA todavia no evaluado. | `StagingExecution.status=applied_to_staging` sin resultado de QA |
| `qa_pending` | Reservado para cuando QA se desacople de la misma pasada (hoy Staging QA Agent corre siempre justo despues del Staging Executor, asi que este estado es casi siempre transitorio). | — |
| `qa_passed` | QA tecnico + visual/SEO/CRO superado en staging. | `data/staging-qa-results.jsonl` (Fase O27, nuevo) `overallPass=true` |
| `qa_failed` | QA fallido en staging — necesita corregirse antes de seguir. | `overallPass=false` |
| `waiting_approval` | Hay una decision real pendiente de Pau: aprobar/rechazar/aplazar una accion, o aprobar el DISENO de un plan de deploy a produccion. | `BacklogAction.status=waiting_approval`, o `ProductionDeploymentPlan.status` en `draft`/`plan_ready_for_review` |
| `approved` | Plan de deploy a produccion aprobado (diseno confirmado) o ejecucion de produccion aprobada — produccion TODAVIA no tocada. | `ProductionDeploymentPlan.status` en `plan_approved`/`execution_pending_approval`/`execution_approved` |
| `deployed_production` | Escritura real confirmada en produccion (siempre como borrador nuevo, nunca publicado automaticamente — la publicacion sigue siendo 100% manual). | `ProductionExecution.status=applied_to_production_draft` |
| `done` | Cerrada explicitamente — ya no necesita ninguna accion mas. | Solo por decision humana (`actions:update --status done`) |
| `rejected` | Descartada explicitamente, en cualquier punto de la cadena. | `BacklogAction`/`ChangePack`/`StagingExecution`/`ProductionDeploymentPlan` en su propio estado "rechazado" |
| `postponed` | Aplazada — sigue siendo valida pero no ahora. | `BacklogAction.status=snoozed`, `ChangePack.status=superseded`, o `StagingExecution.status=rolled_back` |
| `blocked` | Bloqueo tecnico concreto (ej. fallo real al escribir en staging), no una decision de negocio. | `BacklogAction.status=blocked` o `StagingExecution.status=failed` |

## Como se calcula

`src/core/opportunity-state.ts` — `deriveOpportunityState()` es una
funcion PURA y de SOLO LECTURA: no crea, no migra, no reescribe ningun
`.jsonl` existente. Lee la instantanea mas reciente de cada registro
vinculado a una accion (por `actionId` → `changePackId` →
`executionId` → `deploymentPlanId`) y devuelve el estado MAS AVANZADO
encontrado en toda la cadena — si una accion tiene varios change packs
(ej. SEO + contenido + CRO para la misma pagina, generados por agentes
distintos), el estado mostrado es el de aquel que mas ha avanzado, no el
promedio ni el mas antiguo.

No hace falta ninguna migracion de datos: se puede llamar en cualquier
momento, sobre el historico que ya existe, y da la respuesta correcta a
fecha de hoy. La unica pieza de datos nueva de esta fase es
`data/staging-qa-results.jsonl` (antes los resultados de QA no se
guardaban en ningun sitio mas alla del informe markdown del dia).

## Reglas (pedidas explicitamente, Fase O27)

- Una oportunidad `waiting_approval` NUNCA bloquea al resto del
  departamento: Carril A (ver `docs/carril-a-staging-autonomy.md`) sigue
  avanzando en paralelo sobre cualquier otra oportunidad que no dependa
  de esa decision.
- Una oportunidad `blocked` siempre debe indicar bloqueo concreto (el
  `lastError` de la ejecucion fallida) y su reintento es automatico en la
  siguiente pasada mientras el change pack siga `approved_to_execute`.
- Si ya se aplico en staging, la oportunidad NUNCA vuelve a mostrarse
  como si fuera nueva — aparece como `pushed_to_staging`/`qa_passed`/
  `qa_failed`, con la URL real del borrador de staging.
- `rejected`/`postponed` son decisiones EXPLICITAS (humanas o de una
  pasada anterior de la politica) que nunca se revierten solo porque la
  oportunidad se vuelva a detectar (ver `nextStatusOnReappear()` en
  `src/core/action-backlog.ts`, sin cambios en esta fase).
- El informe diario (ver `docs/daily-growth-report.md`) usa este estado
  unificado en la seccion "Backlog resumido" y "Tareas avanzadas hoy" en
  vez de mostrar cada registro interno por separado.

## Ver tambien

- `docs/carril-a-staging-autonomy.md` — como Carril A usa este estado
  para decidir que ejecutar sin esperar aprobacion diaria.
- `docs/staging-execution.md`, `docs/production-deployment-strategy.md`
  — los agentes que producen los registros de origen.
- `config/staging-autonomy-policy.json` — que `changeType` puede
  auto-aprobarse en staging.

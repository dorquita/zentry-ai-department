# Production Deployment Planner Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.
**Fase:** O13.0

## 1. Rol del agente

Es el puente entre "un draft ya probado en staging" y "produccion" —
pero solo en el sentido de PLANIFICAR ese salto, nunca ejecutarlo. Lee
las ejecuciones de staging ya `applied_to_staging`, reutiliza el
Staging QA Agent para saber cuales pasan QA, y propone un
`ProductionDeploymentPlan` por cada draft elegible: checklist humano,
riesgos, plan de rollback y una solicitud de aprobacion de Telegram.

## 2. Objetivo

Dar a Pau un plan claro, seguro y accionable para llevar contenido de
staging a produccion sin tener que improvisarlo cada vez — sin que este
sistema toque produccion todavia. Ver
`docs/production-deployment-strategy.md` para el analisis completo de
opciones (por que se descarto el "Publish staging" completo de
Hostinger, por que la via recomendada a medio plazo es REST selectivo).

## 3. Reglas (no negociables)

- **Nunca escribe en WordPress produccion.** No existe en todo el
  fichero ninguna llamada a `WORDPRESS_PRODUCTION_BASE_URL` ni a
  ninguna variable de produccion.
- **Tampoco escribe en staging.** Solo lee (`getWordpressPage`,
  `readCurrentStagingExecutions`, reutiliza `runStagingQaAgent()` en
  memoria).
- **Nunca propone un plan para un draft que FALLA QA.** Solo drafts
  `overallPass: true` (con o sin warning) reciben un plan.
- **Un plan en `approved` no ejecuta nada.** No existe todavia ningun
  codigo en este proyecto que aplique un `ProductionDeploymentPlan` —
  aplicarlo hoy es siempre una accion manual (ver
  `docs/manual-production-publish.md`).
- **No duplica.** Una misma ejecucion de staging nunca tiene mas de un
  plan activo (dedup por `stagingExecutionId`).
- **`includedMediaIds` se lee del contenido REAL y actual del draft**,
  nunca de un registro que pueda haber quedado desactualizado tras una
  sustitucion posterior (ver Fase O12.9, PNG -> WebP).
- **`data/production-deployment-plans.jsonl` es append-only.**
- **No imprime ni loguea ningun secreto** (`WORDPRESS_APP_PASSWORD`,
  `TELEGRAM_BOT_TOKEN`, etc).

## 4. Formato de salida

`reports/production-deployments/production-deployments-<fecha>.md`:
recordatorio de seguridad, contadores (planes nuevos/total/omitidos/
solicitudes de aprobacion), y por cada plan: checklist completo,
riesgos y plan de rollback.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (uno por plan nuevo),
`approval_required` (uno por solicitud de aprobacion nueva),
`agent_finished`.

## 6. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre justo despues de
Approval Gateway y antes de Growth Director (paso 22 de 24) — necesita
que Staging Executor y Staging QA ya hayan corrido antes en la misma
pasada.

## 7. Como responde Pau

```bash
npm run production-plans:list
npm run production-plans:list -- --status plan_ready_for_review
npm run production-plans:list -- --status execution_pending_approval
npm run production-plans:update -- --deploymentPlanId <id> --status plan_approved
npm run production-plans:update -- --deploymentPlanId <id> --status plan_rejected --reason "..."
npm run production:dry-run -- --deploymentPlanId <id>
```

Fase O13.1 -- DOS aprobaciones separadas, nunca una sola ambigua:
"plan_approved" (el DISENO esta bien) NUNCA autoriza escribir.
"execution_approved" (segunda pregunta, distinta, solo posible tras
`plan_approved`) autoriza una futura aplicacion manual -- ni siquiera
esa ejecuta nada automaticamente. La aplicacion real sigue el proceso
de `docs/manual-production-publish.md`.

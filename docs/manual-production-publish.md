# Manual Production Publish (Fase O13.0)

## Por que este documento existe

Hoy, este proyecto **no tiene ninguna capacidad de escritura real
contra WordPress produccion** (ver
`docs/production-deployment-strategy.md`, Opcion B, todavia no
implementada). La unica via operativa para llevar un draft de staging
ya probado hasta produccion es manual, apoyada en el
`ProductionDeploymentPlan` que `npm run production:plans` genera. Este
documento es esa guia paso a paso.

## Antes de empezar

1. Localiza el plan: `npm run production-plans:list -- --status execution_approved`.
   Recuerda que hacen falta DOS aprobaciones distintas antes de este
   punto: `plan_approved` (el diseno esta bien) y, solo despues,
   `execution_approved` (autorizacion explicita para una escritura
   real) -- ver `docs/production-deployment-strategy.md`.
2. Antes de tocar nada, ejecuta `npm run production:dry-run -- --deploymentPlanId <id>`
   para ver exactamente que se usaria (draft, media, SEO, endpoint,
   rollback) sin llamar a produccion.
3. Abre el informe completo del plan en
   `reports/production-deployments/production-deployments-<fecha>.md`
   — ahi esta el checklist completo, los riesgos y el plan de
   rollback especificos de ese draft.
4. **No sigas si el plan no esta `execution_approved`.** Cualquier otro
   status (`plan_ready_for_review`, `plan_approved`,
   `execution_pending_approval`...) significa que todavia falta una
   decision humana explicita -- `plan_approved` por si solo NO es
   suficiente, todavia no autoriza escribir.

## Pasos

1. **Snapshot previo** (solo si vas a actualizar una pagina YA
   existente en produccion): copia el HTML actual del editor de esa
   pagina a un fichero local, por si hay que revertir (ver
   `docs/production-rollback.md`).
2. Abre el draft de staging (`sourceDraftUrl` del plan) en el editor
   de WordPress de staging y revisa visualmente el resultado final —
   no te fies solo del texto plano.
3. Para cada imagen en `includedMediaIds`: descarga el archivo desde
   la Media Library de staging (URL visible en el plan o en
   `data/asset-requests.jsonl`) y subela a la Media Library de
   **produccion** manualmente. Copia el mismo `alt text`.
4. En produccion, crea una pagina NUEVA en `draft` (si `deploymentType`
   es `create_draft`) o abre la pagina existente correspondiente a
   `targetPageId` (si es `update_existing_draft`) — **nunca la dejes en
   `publish` directamente**, guardala primero como borrador.
5. Pega el contenido, usando las imagenes ya subidas en el paso 3 (no
   enlaces a staging — nunca debe quedar produccion sirviendo una
   imagen desde `staging.zentrylockers.com`).
6. Rellena el SEO (title/meta description) con los valores de
   `seoMeta` del plan — revisalos, no son necesariamente definitivos
   (ver checklist del plan).
7. Guarda como borrador y revisa el preview de produccion antes de
   publicar.
8. Solo cuando estes conforme: publica manualmente desde wp-admin.
   **Este proyecto nunca publica nada por ti.**
9. Actualiza el plan local para que quede reflejado:
   ```bash
   npm run production-plans:update -- --deploymentPlanId <id> --status applied_to_production_draft
   ```
   (o el status que corresponda — ver
   `docs/production-deployment-strategy.md` para la lista completa de
   estados).

## Que NO hacer

- No usar `run-wp-cli` ni `execute-php`.
- No usar el conector Novamira (desconectado, no auditado para
  escritura).
- No usar el "Publish staging" completo de Hostinger para esto — eso
  sobrescribiria TODA la base de datos de produccion, no solo esta
  pagina (ver Opcion D en `docs/production-deployment-strategy.md`).
- No enlazar imagenes de produccion a URLs de `staging.zentrylockers.com`.
- No publicar directamente sin pasar antes por `draft` y una revision
  visual en produccion.

## Ver tambien

- `docs/production-deployment-strategy.md`
- `docs/production-rollback.md`
- `docs/wordpress-safety-policy.md`

# Production Deployment Strategy (Fase O13.0)

## Estado actual: SOLO PLANIFICACION

Este documento describe COMO se llevaria un cambio ya probado en
staging hasta produccion de forma segura, selectiva y reversible.
**Ningun codigo de este proyecto escribe todavia en WordPress
produccion.** El unico agente relacionado
(`src/agents/production-deployment-planner.ts`) propone planes —
nunca los aplica.

## Opciones analizadas

### A) Manual desde wp-admin

Copiar/pegar el contenido del draft de staging directamente en el
editor de WordPress de produccion, a mano.

- **Ventajas:** cero riesgo tecnico nuevo (no hay codigo que pueda
  fallar); control humano total en cada paso; no requiere ninguna
  credencial adicional a las que ya usa el cliente en el dia a dia.
- **Riesgos:** propenso a error humano (copiar mal un bloque, olvidar
  el alt text de una imagen, pegar HTML roto); no queda ningun registro
  automatico de que se hizo ni cuando; lento si hay muchas paginas.
- **Que datos puede pisar:** solo lo que el humano pegue encima,
  exactamente donde decida pegarlo — el riesgo es 100% humano, no
  tecnico.
- **Rollback:** manual (Ctrl+Z del editor, o restaurar una revision
  anterior de WordPress si existe). No hay snapshot automatico salvo
  que el humano lo guarde el mismo antes de pegar.
- **Paginas nuevas:** si, sin problema.
- **Paginas existentes:** si, sin problema (es el caso de uso natural).
- **Recomendacion:** **valido como via de respaldo/excepcion**, y es la
  UNICA via operativa hoy mismo (ver
  `docs/manual-production-publish.md`). No escala bien si el volumen de
  deploys crece.

### B) REST selectivo: draft staging → produccion draft

Reutilizar el mismo patron ya construido para staging
(`src/adapters/wordpress.ts`: `createWordpressDraftPage`/
`updateWordpressDraftPage`/`uploadMediaToWordpress`) pero apuntando a
`WORDPRESS_PRODUCTION_BASE_URL`, siempre creando/actualizando en
`status: draft`, nunca publicando automaticamente.

- **Ventajas:** mismo nivel de control granular que ya funciona en
  staging (una pagina, una imagen, un campo concreto a la vez); deja
  registro automatico (snapshot append-only, mismo patron que
  `draft-image-insertions.ts`); reutiliza codigo ya probado en
  produccion real (Fase O12.1-O12.9); rollback programatico posible
  (restaurar el snapshot previo).
- **Riesgos:** es CODIGO NUEVO tocando produccion por primera vez en
  todo el proyecto — cualquier bug en el adapter (como el bug real de
  O12.6 con `response_format`, o el descubierto y corregido en esta
  misma fase sobre `includedMediaIds` desactualizados) tendria
  consecuencias en el sitio real, no en staging. Requiere las
  credenciales de produccion (`WORDPRESS_USERNAME`/
  `WORDPRESS_APP_PASSWORD` de produccion, hoy sin definir en `.env`).
- **Que datos puede pisar:** SOLO la pagina/media concreta que se le
  pida — nunca la base de datos completa, nunca otras paginas. El
  riesgo esta acotado por diseno (misma filosofia que
  `assertSlugNotProtected()` en staging).
- **Rollback:** si, programatico — snapshot completo del contenido
  anterior antes de escribir (igual que ya hace
  `insert-hero-image-into-draft.ts`/`staging-executor.ts`), restaurable
  con una funcion de rollback dedicada.
- **Paginas nuevas:** si (`create_draft`).
- **Paginas existentes:** si (`update_existing_draft`), con el mismo
  guardrail que en staging: solo actualiza si la pagina de destino ya
  esta en `draft` (nunca sobrescribe una pagina `publish` directamente).
- **Recomendacion:** **ESTA ES LA VIA RECOMENDADA a medio plazo**, pero
  **NO implementada todavia** (Fase O13.0 es solo el plan + la
  planificacion; el adapter de escritura a produccion es una fase
  futura, O13.1+, con su propio gate incondicional adicional).

### C) Export/import controlado

Exportar la pagina de staging (XML de WordPress, o un JSON propio con
contenido+media+meta) y luego importarla en produccion via la
herramienta de import de WordPress o un script propio.

- **Ventajas:** portable, auditable (el fichero exportado es en si
  mismo un snapshot); no depende de que las dos instancias esten
  accesibles al mismo tiempo por API; util tambien como backup
  independiente del propio WordPress.
- **Riesgos:** el importador nativo de WordPress puede arrastrar cosas
  no deseadas (categorias, autores, IDs de attachment que colisionan);
  requiere mapear manualmente los `wordpressMediaId` de staging a los
  nuevos IDs que WordPress asigne en produccion (nunca son los mismos);
  mas pasos manuales que la Opcion B para el mismo resultado.
- **Que datos puede pisar:** depende del scope del export — si se
  exporta "todo el sitio" por error, puede arrastrar contenido no
  relacionado. Con un export ACOTADO a una sola pagina+media, el riesgo
  es similar a la Opcion B.
- **Rollback:** dificil de automatizar bien (el import no es
  facilmente reversible sin un segundo export "antes" guardado a
  mano).
- **Paginas nuevas:** si.
- **Paginas existentes:** parcialmente — el importador nativo de
  WordPress tiende a crear una pagina NUEVA en vez de actualizar una
  existente, salvo que se gestione el mapeo de IDs a mano.
- **Recomendacion:** **descartada como via principal** — mas
  complejidad operativa que la Opcion B para el mismo resultado, sin
  ninguna ventaja de seguridad adicional relevante para este caso de
  uso (paginas de marketing/SEO, no migraciones masivas de sitio).

### D) Hostinger staging → produccion (boton "Publish staging")

La funcion nativa de Hostinger que sincroniza TODO el entorno de
staging sobre produccion (base de datos completa + ficheros).

- **Ventajas:** un solo clic, sincroniza absolutamente todo (incluidos
  cambios que este proyecto ni siquiera conoce, como plugins, ajustes
  de WooCommerce, usuarios...).
- **Riesgos:** **MAXIMO** — sobrescribe la base de datos ENTERA de
  produccion, incluyendo pedidos/clientes/stock de WooCommerce si los
  hubiera, comentarios, usuarios, configuracion, CUALQUIER cambio hecho
  directamente en produccion desde la ultima sincronizacion. No hay
  forma de aplicarlo de forma selectiva.
- **Que datos puede pisar:** TODO. Base de datos completa. Es
  exactamente lo que las condiciones de esta fase piden evitar
  ("nunca base de datos completa").
- **Rollback:** depende de si Hostinger guarda un backup automatico
  previo al publish (verificar en su panel) — no es algo que este
  proyecto pueda garantizar ni controlar.
- **Paginas nuevas:** si (arrastra todo).
- **Paginas existentes:** si (arrastra todo, incluidas las que NO se
  querian tocar).
- **Recomendacion:** **DESCARTADA para uso rutinario.** Ver "Estrategia
  inicial" mas abajo para el unico escenario excepcional donde tendria
  sentido.

### E) MCP/Novamira (futuro)

Usar el MCP `novamira-zentrylockers-co` (hoy "Connection Failed" segun
la propia instruccion de servidor) o el `zentry-novamira-staging` como
via de escritura a produccion.

- **Ventajas:** en teoria, una capa ya pensada para abstraer WordPress
  desde MCP.
- **Riesgos:** el servidor de produccion (`novamira-zentrylockers-co`)
  esta **desconectado ahora mismo** ("MCP WordPress Remote Proxy Server
  (Connection Failed)"); no hay visibilidad de que garantias de
  seguridad/gates tiene esa capa; usar una herramienta de terceros no
  auditada para tocar produccion iria contra la disciplina de todo este
  proyecto (comparar frente/segundas capas explicitas, snapshots,
  aprobacion Telegram).
- **Que datos puede pisar:** desconocido — no se ha auditado.
- **Rollback:** desconocido.
- **Paginas nuevas / existentes:** desconocido.
- **Recomendacion:** **descartada por ahora** — no usar Novamira para
  nada en esta fase (instruccion explicita del cliente, ademas). Si en
  el futuro se retoma, requeriria la misma auditoria de seguridad que
  se le hizo a la API REST de WordPress antes de confiar en ella.

## Estrategia inicial recomendada

1. **No usar la Opcion D ("Publish staging" completo de Hostinger) salvo
   caso excepcional** — por ejemplo, una migracion inicial de un sitio
   entero antes de que exista contenido real en produccion, decidida y
   ejecutada manualmente por el cliente, nunca disparada por este
   sistema.
2. **Priorizar deploy SELECTIVO** (Opcion B, cuando se implemente):
   - una pagina concreta (por `sourceDraftId` -> `targetPageId`)
   - una media concreta (por `wordpressMediaId`)
   - metadata concreta (title/meta description/alt text)
   - **nunca** la base de datos completa
3. **Hoy (Fase O13.0):** la unica via operativa real es la Opcion A
   (manual, ver `docs/manual-production-publish.md`), apoyada en el
   `ProductionDeploymentPlan` que este sistema ya genera (checklist +
   SEO meta + lista de media a subir a mano).
4. **Futuro (fase posterior, no planificada en detalle todavia):**
   implementar el adapter de escritura selectiva de la Opcion B,
   reutilizando el patron ya validado en staging, con su propio gate
   incondicional (`WORDPRESS_ENV` de produccion NUNCA comparte
   credenciales con staging) y su propia aprobacion Telegram por
   deploy, exactamente como ya exige `ProductionDeploymentPlan.status`.

## Modelo de datos

Ver `src/core/types.ts` (`ProductionDeploymentPlan`,
`DeploymentPlanStatus`, `DeploymentType`) y
`src/core/production-deployment-plans.ts` (registro append-only, mismo
patron que el resto del proyecto). `data/production-deployment-plans.jsonl`.

## Fase O13.2 — Production Draft Executor (escritura real, gateada)

Desde la Fase O13.2 existe `src/agents/production-draft-executor.ts`
(`npm run production:execute`), el UNICO agente con capacidad real
(gateada) de escribir en produccion:

- Solo procesa planes ya `plan_approved`.
- Crea una `ProductionExecution` (`data/production-executions.jsonl`,
  mismo patron append-only) y pide su PROPIA aprobacion de Telegram de
  EJECUCION (`relatedType: "production_execution"`, distinta de la de
  plan).
- Solo intenta escribir de verdad si la ejecucion esta `approved` Y
  las 3 condiciones de entorno estan activas a la vez:
  `PRODUCTION_EXECUTION_ENABLED=true`, `PRODUCTION_DRAFTS_ENABLED=true`,
  `PRODUCTION_BACKEND=rest`. Por defecto las 3 estan en su valor mas
  seguro/desactivado.
- Usa `src/adapters/wordpress-production.ts`, un fichero COMPLETAMENTE
  SEPARADO del adapter de staging (`src/adapters/wordpress.ts`): ninguno
  de los dos puede escribir en el entorno del otro por error. Solo sabe
  crear una pagina NUEVA en `draft` y subir media nueva -- nunca
  publicar, actualizar una pagina existente, borrar, ni tocar
  WooCommerce/formularios/precios/checkout.
- Antes de cualquier intento de escritura real guarda un snapshot del
  `contentHtml` exacto que enviaria (`submittedContentSnapshot`).
- Remapea las imagenes: nunca deja produccion enlazando a una URL de
  `staging.zentrylockers.com` -- descarga cada media de staging y la
  re-sube como media nueva en produccion antes de crear la pagina.

```bash
npm run production:execute                                  # ejecuta el executor (gateado)
npm run production-executions:list
npm run production-executions:list -- --status pending_approval
npm run production-executions:update -- --executionId <id> --status cancelled --reason "..."
```

## Agente (planificacion)

`src/agents/production-deployment-planner.ts` (`npm run production:plans`):

- Lee `staging-executions.jsonl` (`status: "applied_to_staging"`).
- Reutiliza `runStagingQaAgent()` en memoria (mismo patron de reuso que
  el resto del proyecto) para saber que drafts pasan QA (pass, con o
  sin warning). Un draft que FALLA QA nunca recibe un plan.
- Detecta los media IDs REALMENTE en uso en el draft leyendo su
  contenido actual (no se fia de registros que puedan haber quedado
  desactualizados tras una sustitucion posterior, ver Fase O12.9).
- Propone un plan `plan_ready_for_review` con checklist + riesgos +
  rollback ya generados, y crea/envia una solicitud de APROBACION DE
  PLAN por Telegram (`relatedType: "production_deployment_plan"`,
  riesgo `critical`).
- **Fase O13.1 — dos aprobaciones separadas, nunca una sola ambigua:**
  1. **Aprobacion de PLAN** (`plan_ready_for_review` ->
     `plan_approved`/`plan_rejected`): confirma que el DISENO esta bien.
     NO autoriza ninguna escritura real.
  2. **Aprobacion de EJECUCION** (`execution_pending_approval` ->
     `execution_approved`/`execution_rejected`): se pide DESPUES de
     `plan_approved`, con su propia solicitud de Telegram (texto
     explicito "[Aprobacion de ejecucion real]"). Autoriza una futura
     escritura real — pero **NUNCA** dispara ninguna accion automatica:
     no existe todavia ningun ejecutor, ni siquiera para planes
     `execution_approved`.
- **NUNCA** escribe en WordPress produccion ni en staging.

## CLI

```bash
npm run production:plans                                  # ejecuta el agente (planificacion)
npm run production-plans:list                              # lista planes
npm run production-plans:list -- --status plan_ready_for_review
npm run production-plans:list -- --status execution_pending_approval
npm run production-plans:update -- --deploymentPlanId <id> --status plan_approved
npm run production:dry-run -- --deploymentPlanId <id>       # simula la aplicacion, sin llamar a produccion
```

## Integracion en `growth:daily`

Paso 22/24 (Fase O13.0): PURA PLANIFICACION. Muestra planes nuevos,
total de planes, drafts omitidos por no pasar QA, y solicitudes de
aprobacion enviadas — siempre con el recordatorio explicito de que
produccion no se ha tocado. Ver `docs/daily-growth-report.md`.

## Ver tambien

- `docs/manual-production-publish.md` — como aplicar HOY un plan
  aprobado, a mano.
- `docs/production-rollback.md` — plan de rollback detallado.
- `docs/wordpress-safety-policy.md` — guardrails ya existentes en
  staging que cualquier futura escritura a produccion debe replicar.

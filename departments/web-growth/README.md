# Departamento: Web & Growth

Cubre SEO, SEM, WordPress, GA4, GTM, CRO y diseno web para Zentry/Tukandado.

Funciona como **sistema coordinado**, no como agentes sueltos: comparten
un `departmentRunId` y se comunican via `data/department-events.jsonl`
(Fase O4). Desde la Fase O5 mantiene un **Action Backlog** deduplicado
(`data/action-backlog.jsonl`) para no repetir cada dia las mismas
recomendaciones, desde la Fase O6 convierte las acciones aprobadas en
**Work Orders**: planes de ejecucion detallados
(`data/work-orders.jsonl`), desde la Fase O7 aplica una **politica de
autonomia** (`config/autonomy-policy.json`) que auto-procesa y
auto-aprueba para planificacion las acciones de riesgo bajo/medio sin
esperar aprobacion humana — nunca para ejecucion real —, desde la Fase O8
tiene un **Notification & Approval Gateway** que avisa por Telegram solo
cuando algo se acerca a produccion real, desde Change Packs convierte
las work orders ya detalladas en **paquetes de cambio concretos**
(`data/change-packs.jsonl`) listos para revision humana o una futura
ejecucion controlada, y el **WordPress Draft Agent** convierte esos
change packs en previews locales y, solo con triple aprobacion (ver
`../../docs/wordpress-safety-policy.md`), en borradores reales de
WordPress — la unica excepcion controlada de todo el departamento a
"solo lectura + propuesta". Ver
[`../../docs/department-operating-system.md`](../../docs/department-operating-system.md),
[`../../docs/action-backlog.md`](../../docs/action-backlog.md),
[`../../docs/work-orders.md`](../../docs/work-orders.md),
[`../../docs/autonomy-policy.md`](../../docs/autonomy-policy.md),
[`../../docs/notification-gateway.md`](../../docs/notification-gateway.md),
[`../../docs/change-packs.md`](../../docs/change-packs.md) y
[`../../docs/wordpress-draft-agent.md`](../../docs/wordpress-draft-agent.md).

## Agentes activos (22)

| Agente | Estado | Spec |
|---|---|---|
| SEO Watcher | Activo, datos reales de Search Console | [`agents/seo-watcher.agent.md`](agents/seo-watcher.agent.md) |
| SEO Director | Activo | [`agents/seo-director.agent.md`](agents/seo-director.agent.md) |
| Competitor Intelligence | Activo, HTML publico real | [`agents/competitor-intelligence.agent.md`](agents/competitor-intelligence.agent.md) |
| Content Planner | Activo | [`agents/content-planner.agent.md`](agents/content-planner.agent.md) |
| CRO / Landing Reviewer | Activo | [`agents/cro-landing-reviewer.agent.md`](agents/cro-landing-reviewer.agent.md) |
| SEM Watcher | Fase O11: lectura real de Google Ads si hay credenciales, si no placeholder seguro | [`agents/sem-watcher.agent.md`](agents/sem-watcher.agent.md) |
| Analytics Watcher | Fase O11: lectura real de GA4/GTM si hay credenciales, si no placeholder seguro | [`agents/analytics-watcher.agent.md`](agents/analytics-watcher.agent.md) |
| Approval Queue | Activo, gestiona el Action Backlog y aplica la politica de autonomia | [`agents/approval-queue.agent.md`](agents/approval-queue.agent.md) |
| Approved Action Planner | Activo, crea work orders draft (humanas y auto-aprobadas) | [`agents/approved-action-planner.agent.md`](agents/approved-action-planner.agent.md) |
| SEO Work Order Builder | Activo | [`agents/seo-work-order-builder.agent.md`](agents/seo-work-order-builder.agent.md) |
| Content Work Order Builder | Activo | [`agents/content-work-order-builder.agent.md`](agents/content-work-order-builder.agent.md) |
| CRO Work Order Builder | Activo | [`agents/cro-work-order-builder.agent.md`](agents/cro-work-order-builder.agent.md) |
| SEO Change Pack Builder | Activo | [`agents/seo-change-pack-builder.agent.md`](agents/seo-change-pack-builder.agent.md) |
| Content Change Pack Builder | Activo | [`agents/content-change-pack-builder.agent.md`](agents/content-change-pack-builder.agent.md) |
| CRO Change Pack Builder | Activo | [`agents/cro-change-pack-builder.agent.md`](agents/cro-change-pack-builder.agent.md) |
| UX/UI Landing Architect | Fase O13.6b, activo. Convierte cada change pack en estructura visual de landing (hero/CTAs/bloques/cards/secciones/FAQ) ANTES de escribir HTML | [`agents/ux-ui-landing-architect.agent.md`](agents/ux-ui-landing-architect.agent.md) |
| WordPress Draft Agent | Activo, renderiza el blueprint en HTML real (bloques Gutenberg); previews locales siempre + borrador real solo con triple aprobacion | [`agents/wordpress-draft-agent.agent.md`](agents/wordpress-draft-agent.agent.md) |
| Visual Template Builder | Fase O12.4: genera un preview visual adicional (5 plantillas), nunca toca WordPress | [`../../docs/visual-template-system.md`](../../docs/visual-template-system.md) |
| Visual Asset Planner | Fase O12.4: propone peticiones de imagen, NUNCA llama a n8n ni genera/sube nada | [`../../docs/asset-generation-workflow.md`](../../docs/asset-generation-workflow.md) |
| Staging Executor | Fase O12: unica via de ejecucion real controlada contra staging, con snapshot y rollback | [`../../docs/staging-execution.md`](../../docs/staging-execution.md) |
| Staging QA Agent | Fase O12: solo lectura, verifica lo que el Staging Executor aplico | [`../../docs/staging-execution.md`](../../docs/staging-execution.md) |
| Approval Gateway | Activo, crea solicitudes de aprobacion y avisa por Telegram si aplica | [`agents/approval-gateway.agent.md`](agents/approval-gateway.agent.md) |
| Production Deployment Planner | Fase O13.0/O13.1, activo. PURA PLANIFICACION: propone como llevar un draft de staging probado a produccion (checklist, riesgos, rollback) y gestiona la aprobacion de PLAN -- nunca escribe en produccion | [`agents/production-deployment-planner.agent.md`](agents/production-deployment-planner.agent.md) |
| Production Draft Executor | Fase O13.2, activo (escritura real gateada, hoy desactivada). Unica via de ejecucion controlada real contra produccion, con su propia aprobacion de Telegram de EJECUCION | [`agents/production-draft-executor.agent.md`](agents/production-draft-executor.agent.md) |
| Growth Director | Activo, consolida a los otros 23 en un informe ejecutivo + uno tecnico | [`agents/growth-director.agent.md`](agents/growth-director.agent.md) |

Todos operan en modo `READ` + `PROPOSE`, con una unica excepcion
controlada: el WordPress Draft Agent puede crear un borrador SIN PUBLICAR
en WordPress, y solo bajo 3 condiciones simultaneas (ver
`../../docs/wordpress-safety-policy.md`). Ningun agente tiene modo
`APPLY` (publicar). La politica de autonomia (Fase O7) solo decide
**estados locales** del Action Backlog/Work Order Registry, el
Notification & Approval Gateway (Fase O8) solo decide **cuando avisar**,
y Change Packs solo **reempaqueta** work orders ya detalladas — ninguno
de los tres ejecuta nada real.

## Ejecucion

- `npm run growth:daily` — pase diario completo del departamento (19
  pasos) + un unico email final (esto es lo que ejecuta el timer de
  systemd). El cuerpo del email es el informe **ejecutivo**
  (`reports/daily/executive-<fecha>.md`); el informe **tecnico**
  (`reports/daily/technical-<fecha>.md`) se genera en paralelo para
  auditoria/debugging pero nunca se envia.
- Cada agente tambien se puede ejecutar suelto: `npm run seo:watch`,
  `npm run seo:director`, `npm run competitor:intel`,
  `npm run content:plan`, `npm run cro:review`, `npm run sem:watch`,
  `npm run analytics:watch`, `npm run approval:queue`,
  `npm run approved-actions:plan`, `npm run work-orders:seo`,
  `npm run work-orders:content`, `npm run work-orders:cro`,
  `npm run change-packs:seo`, `npm run change-packs:content`,
  `npm run change-packs:cro`, `npm run wordpress:drafts`,
  `npm run approvals:gateway`, `npm run growth:director`.
- Gestion del Action Backlog: `npm run actions:list` (soporta
  `--status`, `--priority`, `--brand`, `--keyword`, `--autonomyLevel`,
  `--requiresApproval`), `npm run actions:update` (ver
  `../../docs/approval-queue.md`).
- Gestion de Work Orders: `npm run work-orders:list` (mismos filtros +
  `--targetBrand`/`--category`), `npm run work-orders:update` (ver
  `../../docs/work-orders.md` y `../../docs/approved-actions.md`).
- Gestion de Change Packs: `npm run change-packs:list` (`--status`,
  `--priority`, `--targetBrand`, `--changeType`, `--keyword`),
  `npm run change-packs:update` (nunca cascada a la work order/accion
  relacionadas) — ver `../../docs/change-packs.md`.
- Gestion de WordPress Drafts: `npm run wordpress-drafts:list`
  (`--status`, `--targetBrand`, `--changePackId`, `--keyword`) — no
  existe `wordpress-drafts:update`: la unica forma de avanzar un draft es
  a traves del flujo de aprobacion de Telegram, ver
  `../../docs/wordpress-draft-agent.md`.
- Gestion de solicitudes de aprobacion (Fase O8): `npm run
  approvals:list` (`--status`, `--relatedType`, `--riskLevel`,
  `--channel`), `npm run approvals:update` (cascada la respuesta a la
  accion/work order relacionada; para `change_pack` no cascada, solo
  desbloquea el siguiente intento del WordPress Draft Agent) — ver
  `../../docs/telegram-approvals.md` y `../../docs/wordpress-draft-agent.md`.
- Tests del informe ejecutivo: `npm test` (sintetico) y
  `npm run test:real-data` (contra el backlog real del dia).

## Reglas base (todas heredadas por los 18 agentes)

- Solo lectura sobre sistemas de produccion propios o de terceros, con la
  unica excepcion controlada del WordPress Draft Agent (ver mas abajo).
- Cualquier cambio real requiere aprobacion humana (ver
  `../../docs/approval-policy.md`). Una accion `auto_approved_for_planning`,
  una work order `auto_prepared`/`approved_to_prepare`, o un change pack
  `approved_to_execute` **no** son una excepcion: siguen sin ejecutar
  nada — solo se saltan el paso de aprobacion para *planificar/preparar*,
  nunca para *publicar*.
- Ningun agente modifica Google Ads, GA4 ni GTM (Fase O11 solo anadio
  LECTURA — ver `../../docs/google-ads-readonly.md` y
  `../../docs/analytics-readonly.md`). Ningun agente toca n8n ni qdrant. Ninguno publica
  ni modifica una pagina existente de WordPress; el WordPress Draft Agent
  es el unico que puede crear una pagina NUEVA en borrador
  (`status: draft`), y solo bajo 3 condiciones simultaneas — ver
  `../../docs/wordpress-safety-policy.md`.
- El Brand/Intent Router (`../../docs/brand-intent-strategy.md`) clasifica
  siempre las oportunidades entre Zentry, Tukandado, mixta o no
  prioritaria — nunca se mezclan las marcas sin criterio explicito.
- La politica de autonomia (`../../docs/autonomy-policy.md`) decide, por
  tipo de accion, si se auto-procesa/auto-aprueba para planificacion o si
  espera a un humano — nunca decide sobre ejecucion real.
- La politica de notificacion (`../../docs/notification-gateway.md`)
  decide, por separado, cuando avisar a Pau por Telegram — solo cuando
  algo se acerca a produccion real o tiene `riskLevel: high`. El gate de
  Telegram para crear un borrador real en WordPress es aparte e
  incondicional (no pasa por esta politica) — ver
  `../../docs/wordpress-safety-policy.md`.
- Change Packs (`../../docs/change-packs.md`) solo reempaqueta work
  orders ya detalladas en pasos de implementacion/checklist/riesgos/
  reversion — nunca crea contenido desde cero ni ejecuta nada.
- WordPress Draft Agent (`../../docs/wordpress-draft-agent.md`) siempre
  genera primero un preview local sin llamar a WordPress; solo crea un
  borrador real bajo las 3 condiciones documentadas en
  `../../docs/wordpress-safety-policy.md`.

## Agentes futuros (no implementados)

- Modo `APPLY` para cualquiera de los 18 agentes actuales, cuando se
  decida explicitamente activar ejecucion real con aprobacion por tarea
  (probablemente ampliando el WordPress Draft Agent para poder publicar
  un borrador ya aprobado, siempre con confirmacion humana explicita).
- Listener de Telegram con respuestas directas en el chat, y canal de
  WhatsApp (ver `../../docs/telegram-approvals.md`).

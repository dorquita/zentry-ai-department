# Zentry AI Department

Primer bloque de una arquitectura de agentes IA por departamentos para
Zentry/Tukandado. Ver `docs/vision.md` para la vision completa (Agente
Director + departamentos especializados) y `docs/department-map.md` para
la hoja de ruta.

## Que hay implementado hoy

Un departamento completo — **Web & Growth** (`departments/web-growth/`) —
con **25 agentes coordinados** (no aislados): comparten un
`departmentRunId` por pasada diaria y se comunican via un bus de eventos
(`data/department-events.jsonl`). Ver
[`docs/department-operating-system.md`](docs/department-operating-system.md).

| Agente | Que hace |
|---|---|
| SEO Watcher | Detecta oportunidades SEO (Search Console real) |
| SEO Director | Agrupa y prioriza |
| Competitor Intelligence | Analiza paginas publicas de competidores |
| Content Planner | Propone articulos, FAQs, landings |
| CRO / Landing Reviewer | Propone mejoras de conversion |
| SEM Watcher | Vigila Google Ads (Fase O11: lectura real si hay credenciales, si no placeholder seguro) |
| Analytics Watcher | Vigila GA4/GTM (Fase O11: lectura real si hay credenciales, si no placeholder seguro) |
| Approval Queue | Deduplica todo en el Action Backlog y aplica la politica de autonomia |
| Approved Action Planner | Crea Work Orders draft para acciones aprobadas (humanas o automaticas) |
| SEO Work Order Builder | Plan on-page detallado (title/meta/H1/H2/FAQ...) |
| Content Work Order Builder | Brief de contenido (articulo/landing/FAQ) |
| CRO Work Order Builder | Plan de conversion (CTA/formulario/confianza) |
| SEO Change Pack Builder | Convierte work orders SEO en paquetes de cambio concretos |
| Content Change Pack Builder | Convierte work orders de contenido en paquetes de cambio concretos |
| CRO Change Pack Builder | Convierte work orders CRO en paquetes de cambio concretos |
| UX/UI Landing Architect | Fase O13.6b (postmortem calidad visual): convierte cada change pack en una estructura visual de landing (hero/CTAs/bloques/cards/secciones/FAQ) ANTES de que se escriba ningun HTML. Existe un experimento paralelo con un subagente Claude real (`ux-ui-landing-architect-v2`, cero herramientas de escritura), sin sustituir a este — ver [`docs/ux-ui-landing-architect-v2-experiment.md`](docs/ux-ui-landing-architect-v2-experiment.md) |
| WordPress Draft Agent | Renderiza el blueprint del UX/UI Landing Architect en HTML real (bloques Gutenberg: botones, columnas) y, solo con triple aprobacion, crea borradores reales de WordPress (nunca publicados) |
| Visual Template Builder | Fase O12.4: genera un preview visual adicional mapeando el change pack sobre una de 5 plantillas (sector/producto/SEO/comparativa/blog) — nunca toca WordPress |
| Visual Asset Planner | Fase O12.4: propone que imagenes necesitaria cada change pack (prompt, negative prompt, alt text...) — NUNCA llama a n8n ni genera/sube imagenes |
| Staging Executor | Fase O12: unica via de ejecucion controlada real contra staging (crear/actualizar un borrador, nunca publicar, nunca produccion), con snapshot y rollback |
| Staging QA Agent | Fase O12: solo lectura, verifica lo que el Staging Executor aplico (carga, sin errores PHP, noindex, sin `<form>`...) |
| Approval Gateway | Crea solicitudes de aprobacion y avisa por Telegram cuando hace falta |
| Production Deployment Planner | Fase O13.0/O13.1: PURA PLANIFICACION -- propone como llevar un draft de staging ya probado a produccion (checklist, riesgos, rollback) y gestiona la aprobacion de PLAN. NUNCA escribe en WordPress produccion |
| Production Draft Executor | Fase O13.2: unica via de ejecucion controlada real contra produccion (crear SOLO un draft nuevo + subir su media, nunca publicar) -- gateada por 3 flags de entorno + su propia aprobacion de Telegram de EJECUCION, distinta de la de plan |
| Growth Director | Consolida todo en un informe ejecutivo + uno tecnico |

```bash
npm run growth:daily
```

ejecuta los 18 en orden (19 pasos, el ultimo es el envio del email) y
envia **un unico email diario** (10:00 hora de Madrid, via el timer de
systemd — ver `docs/scheduling.md`). Todos los agentes son `READ` +
`PROPOSE`, con una unica excepcion controlada: el WordPress Draft Agent
puede crear un borrador SIN PUBLICAR en WordPress, y solo bajo 3
condiciones simultaneas (ver `docs/wordpress-safety-policy.md`). Ningun
agente tiene modo `APPLY` (publicar).

El Brand/Intent Router (`docs/brand-intent-strategy.md`) clasifica cada
oportunidad entre **Zentry** (mobiliario/taquillas), **Tukandado**
(cerraduras electronicas) o **mixta/cross-sell**, siempre con una razon
explicita — nunca mezcla las marcas sin criterio.

### Action Backlog: sin repetir recomendaciones cada dia

Desde la Fase O5, las recomendaciones de los agentes se deduplican en
`data/action-backlog.jsonl`: una misma oportunidad ("cerraduras
inteligentes para taquillas", "taquillas melamina"...) solo aparece como
**nueva** la primera vez; despues pasa a **recurrente** hasta que se
decide (por un humano o por la politica de autonomia, ver mas abajo):

```bash
npm run actions:list -- --status waiting_approval
npm run actions:update -- --actionId <id> --status approved
```

Ningun estado del backlog **nunca** implica ejecucion real — solo es una
senal local de que se puede trabajar esa accion. Ver
[`docs/action-backlog.md`](docs/action-backlog.md) y
[`docs/approval-queue.md`](docs/approval-queue.md).

### Politica de autonomia (Fase O7): menos aprobacion manual, cero ejecucion automatica

Desde la Fase O7, el sistema **auto-procesa** la mecanica interna
(eventos, dedup, informes) y **auto-aprueba para planificacion** las
acciones SEO/contenido/CRO/SEM/Analytics/competencia de riesgo bajo o
medio, sin esperar que Pau apruebe cada una a mano — solo lo que tocaria
produccion real (WordPress, Google Ads, GA4/GTM) sigue esperando
aprobacion humana explicita:

```bash
npm run actions:list -- --status auto_approved_for_planning
npm run actions:list -- --status waiting_approval
npm run actions:list -- --status blocked
```

La politica vive en `config/autonomy-policy.json` (editable sin
recompilar) y el motor de clasificacion en `src/core/autonomy-policy.ts`.
**Nunca** decide sobre ejecucion real — eso sigue sin existir en este
sistema (no hay modo `APPLY`), pase lo que pase con la politica. Ver
[`docs/autonomy-policy.md`](docs/autonomy-policy.md) para el detalle
completo (los 5 niveles, como cambiar la politica, como desactivar toda
la autonomia si hiciera falta).

### Notification & Approval Gateway (Fase O8): avisos solo cuando hay impacto real

El departamento sigue avanzando solo en analisis, planificacion, work
orders y change packs — **sin pedir nada a Pau**. Desde la Fase O8, solo
interrumpe con un mensaje de **Telegram** cuando algo se acerca a
produccion real (un borrador de WordPress, un cambio de Ads, GA4/GTM,
formularios, o cualquier accion con `riskLevel: high`):

```bash
npm run approvals:list -- --status pending
npm run approvals:update -- --approvalRequestId <id> --answer approved
```

Con los agentes que existen hoy, esto **nunca se dispara con datos
reales** (todo cae en `AUTO_PLAN`, sin impacto real) — la tuberia
completa esta lista y probada para cuando haga falta. WhatsApp queda
documentado como canal futuro, no implementado. Ver
[`docs/notification-gateway.md`](docs/notification-gateway.md) y
[`docs/telegram-approvals.md`](docs/telegram-approvals.md) (como
configurar el bot, obtener el chat id, y desactivarlo).

### Work Orders: de "aprobado" a plan de ejecucion detallado

Desde la Fase O6, cada accion `approved` (o, desde la Fase O7, cada
accion `auto_approved_for_planning`) se convierte automaticamente en una
**Work Order** en `data/work-orders.jsonl`: title/meta/H1/H2/FAQs para
SEO, brief para contenido, CTA/formulario/confianza para CRO — lista para
revision humana, nunca para publicar sola:

```bash
npm run work-orders:list -- --status ready_for_review
npm run work-orders:list -- --status auto_prepared
npm run work-orders:update -- --workOrderId <id> --status approved_to_prepare
```

`approved_to_prepare` y `auto_prepared` **tampoco** ejecutan nada: solo
significan que hay una propuesta lista para mirar, con o sin un click
humano de por medio. Cada work order lleva un campo `productionSafety`
inmutable que confirma que no se ha tocado WordPress ni produccion. Ver
[`docs/work-orders.md`](docs/work-orders.md) y
[`docs/approved-actions.md`](docs/approved-actions.md).

### Change Packs: de "work order" a paquete de cambio concreto

Cada work order elegible (`auto_prepared`/`ready_for_review`/
`approved_to_prepare`) se convierte automaticamente en un **Change
Pack** en `data/change-packs.jsonl`: pasos de implementacion numerados,
checklist de revision humana, riesgos y notas de reversion — pensado
para el dia en que exista ejecucion controlada, sin ejecutar nada hoy:

```bash
npm run change-packs:list -- --status ready_for_review
npm run change-packs:update -- --changePackId <id> --status approved_to_execute
```

`approved_to_execute` **tampoco** ejecuta nada: solo significa que Pau
aceptaria que esto se aplicara el dia que exista esa capacidad. Ver
[`docs/change-packs.md`](docs/change-packs.md).

### WordPress Draft Agent: de "change pack" a borrador (nunca publicacion)

Cada change pack `ready_for_review`/`approved_to_execute` genera siempre
un **preview local** (fichero markdown, cero llamadas a WordPress). Solo
si se cumplen 5 condiciones a la vez —
`WORDPRESS_DRAFTS_ENABLED=true`, `WORDPRESS_BACKEND=rest`,
`WORDPRESS_ENV=staging`, el change pack `approved_to_execute`, y una
aprobacion explicita de Telegram para ese borrador concreto— el agente
crea un **borrador real**, siempre `status: draft`, nunca publicado, y
**siempre en staging** (`staging.zentrylockers.com`) — nunca en
produccion:

```bash
npm run wordpress-drafts:list
npm run wordpress-drafts:list -- --status wp_draft_created
```

El adaptador (`src/adapters/wordpress.ts`) solo sabe hacer una cosa: crear
una pagina NUEVA en borrador. No existe en todo el proyecto ninguna
funcion para publicar, actualizar una pagina existente, borrar, subir
media, ni tocar WooCommerce/formularios/precios/checkout. Desde la Fase
O10.6, `WORDPRESS_ENV` distingue `staging` (unico destino de escritura
permitido) de `production` (bloqueado de forma incondicional en
`src/adapters/wordpress-backend.ts`, sin excepcion posible mientras el
codigo no cambie). Ver
[`docs/wordpress-draft-agent.md`](docs/wordpress-draft-agent.md) y
[`docs/wordpress-safety-policy.md`](docs/wordpress-safety-policy.md).

### Informe diario: ejecutivo (email) + tecnico (interno)

Desde la Fase O9, `npm run growth:daily` genera **dos** informes: uno
**ejecutivo** (`reports/daily/executive-<fecha>.md`, lenguaje natural,
deduplicado, sin IDs — es el que se envia por email) y uno **tecnico**
(`reports/daily/technical-<fecha>.md`, con todo el detalle: IDs, work
orders, change packs, agentes, para auditoria/debugging). Ver
[`docs/daily-growth-report.md`](docs/daily-growth-report.md).

```bash
npm test
```

ejecuta la suite de tests del generador del informe ejecutivo (sin tocar
el VPS ni datos reales); `npm run test:real-data` valida ademas contra el
backlog real del dia.

## Que es el SEO Watcher Agent

Un agente de solo lectura que analiza datos de rendimiento SEO (mock o
Google Search Console real) y detecta oportunidades: keywords cerca de
primera pagina, paginas con CTR bajo, caidas de posicion y keywords que
necesitan una landing/articulo nuevo. Por cada oportunidad, genera una
**tarea propuesta** — nunca ejecuta nada.

Spec completa: [`departments/web-growth/agents/seo-watcher.agent.md`](departments/web-growth/agents/seo-watcher.agent.md)

## Que es el SEO Director Agent

Un agente de solo lectura que lee lo que ya detecto el SEO Watcher
(`reports/seo/` + `data/jobs.jsonl`), agrupa las oportunidades por keyword
y pagina, y produce un **plan de accion priorizado** en
`reports/seo-director/`: que pagina tocar, que keyword atacar, por que
merece la pena, esfuerzo e impacto estimados, y si requiere WordPress,
contenido nuevo o revision humana. No llama a ninguna API externa.

```bash
npm run seo:director
```

Spec completa: [`departments/web-growth/agents/seo-director.agent.md`](departments/web-growth/agents/seo-director.agent.md)

## Como ejecutarlo

```bash
npm install
npm run typecheck
npm run seo:watch
```

Requisitos: Node.js >= 20. Por defecto usa datos de ejemplo
(`SEO_DATA_SOURCE=mock`) y no hace falta configurar ningun secreto.

### Fuente de datos: mock vs Search Console real

El agente soporta dos fuentes de datos, controladas por la variable
`SEO_DATA_SOURCE` (ver `.env.example`):

- `SEO_DATA_SOURCE=mock` (por defecto) — lee `data/sample-search-console-data.json`. Sin credenciales.
- `SEO_DATA_SOURCE=search_console` — lee datos reales de Google Search Console en **modo solo lectura** (`searchanalytics.query`). Requiere credenciales `GSC_*` en un `.env` local (nunca commiteado). Ver `docs/approval-policy.md` y `docs/risk-policy.md`.

Para probar la conexion real de forma aislada, sin correr todo el agente:

```bash
npm run test:search-console
```

Este script lista los sitios accesibles y hace una consulta pequena (7
dias, 5 filas) para verificar que las credenciales funcionan. No escribe
nada en Search Console ni en ningun otro sistema.

### Flujo OAuth2 (metodo de autenticacion en uso)

La conexion real usa **OAuth2 con el scope minimo de solo lectura**
(`https://www.googleapis.com/auth/webmasters.readonly`), sin service
account JSON y sin Workload Identity Federation. Pasos:

1. **Crear el OAuth Client en Google Cloud Console** (una sola vez, fuera
   de este repo): tipo de aplicacion **"Desktop app"**, con la API de
   Search Console habilitada en el proyecto de GCP. Esto te da un
   `Client ID` y un `Client Secret`.

2. **Generar el refresh token** ejecutando, en una terminal interactiva:

   ```bash
   npm run auth:gsc
   ```

   El script:
   - pide el Client ID y el Client Secret (sin hacer eco en pantalla —
     los caracteres se muestran como `*`), a menos que ya esten definidos
     como variables de entorno o en un `.env` local;
   - imprime una URL de autorizacion (`access_type=offline`,
     `prompt=consent`, scope unico de solo lectura) para abrir en
     cualquier navegador (no hace falta que sea el navegador del VPS);
   - tras conceder el acceso, Google redirige a una URL tipo
     `http://localhost/?code=...` que dara un error de carga — es
     normal, ahi solo hay que copiar el valor del parametro `code`;
   - pide ese authorization code (tampoco se muestra en pantalla) y lo
     intercambia por un refresh token;
   - muestra el refresh token **enmascarado** (nunca completo);
   - pregunta explicitamente si quieres guardarlo en `.env`. Si respondes
     que no, el script no persiste nada y el valor completo queda
     inaccesible (habria que repetir el proceso cuando quieras activarlo).

3. Si confirmas el guardado, el script escribe (o actualiza, sin tocar el
   resto del fichero) estas claves en `/opt/zentry-ai-department/.env`,
   con permisos `600`:

   ```
   SEO_DATA_SOURCE=search_console
   GSC_AUTH_METHOD=oauth2
   GSC_OAUTH_CLIENT_ID=...
   GSC_OAUTH_CLIENT_SECRET=...
   GSC_OAUTH_REFRESH_TOKEN=...
   ```

   Revisa despues que `GSC_SITE_URL` en ese `.env` apunte a la propiedad
   correcta de Search Console.

4. Verifica la conexion sin tocar el agente completo:

   ```bash
   npm run test:search-console
   ```

En ningun paso de este flujo se imprime el Client Secret ni el refresh
token completos; solo versiones enmascaradas.

### Informe diario por email

```bash
npm run seo:daily
```

Ejecuta el agente contra Search Console real y ademas envia un email
resumen por SMTP. Detalle completo, variables requeridas y errores
comunes en [`docs/email-reporting.md`](docs/email-reporting.md).
Programacion automatica diaria (systemd timer) en
[`docs/scheduling.md`](docs/scheduling.md).

## Que produce

- `data/jobs.jsonl` — una linea JSON por cada tarea propuesta (oportunidad
  SEO detectada), en formato append-only (nunca se borra ni se reescribe
  el historico).
- `reports/seo/seo-watcher-<fecha-de-ejecucion>.md` — informe legible en
  markdown de esa ejecucion (uno por dia; si se ejecuta varias veces el
  mismo dia, el informe de ese dia se sobrescribe con la ejecucion mas
  reciente, pero el `runId` completo con hora queda dentro del contenido).
- `logs/seo-watcher-<fecha>.log` — log de la ejecucion (sin secretos).
- Un resumen en consola con cada oportunidad: keyword, posicion actual,
  objetivo, accion recomendada, prioridad, riesgo y si requiere aprobacion.

### Como leer el informe (`reports/seo/`)

Cada informe tiene siempre la misma estructura:

1. **Cabecera** — `runId`, fecha de generacion, fuente de datos, sitio y
   rango de fechas analizado.
2. **Resumen ejecutivo** — cuantas filas se leyeron, cuantas oportunidades
   se detectaron y su reparto por prioridad.
3. **Oportunidades por tipo** — tabla con el recuento de `quick_win`,
   `low_ctr`, `position_drop` y `future_opportunity`.
4. **Top 10 oportunidades priorizadas** — ordenadas por prioridad y, dentro
   de la misma prioridad, por impresiones (mayor volumen primero). Cada una
   incluye keyword, pagina, posicion actual/objetivo, evidencia y la accion
   recomendada completa.
5. **Recomendaciones siguientes** — bullets accionables generados a partir
   de lo detectado en esa ejecucion concreta.
6. **Confirmacion de seguridad** — recordatorio explicito de que nada se ha
   ejecutado en produccion.

Es el formato pensado para compartir/revisar rapido (por ejemplo, pegarlo
en un canal o revisarlo antes de aprobar tareas), a diferencia de
`jobs.jsonl` que es el formato pensado para maquina/automatizacion.

### Como interpretar `data/jobs.jsonl`

Cada linea es un objeto JSON independiente (formato [JSONL](https://jsonlines.org/)):

```json
{
  "id": "uuid",
  "createdAt": "2026-08-02T12:14:26.273Z",
  "agent": "seo-watcher",
  "mode": "PROPOSE",
  "status": "proposed",
  "title": "Subir keyword \"...\" de posicion 18.6 a top 10",
  "meta": {
    "runId": "seo-watcher-2026-08-02T121426Z",
    "analysisStartDate": "2026-07-01",
    "analysisEndDate": "2026-07-28",
    "siteUrl": "https://zentrylockers.com/",
    "dataSource": "search_console"
  },
  "opportunity": { "kind": "quick_win", "keyword": "...", "...": "..." }
}
```

- `meta.runId` agrupa todos los jobs generados en la misma ejecucion — util
  para filtrar (`grep runId ...`) o para cruzar un job con su informe.
- `status` siempre es `"proposed"` hoy: no existe ningun flujo que lo
  cambie automaticamente a "aprobado" o "aplicado" (eso es deliberado, ver
  `docs/approval-policy.md`).
- El fichero es append-only: **no** se limpian duplicados del historico
  entre ejecuciones (si la misma oportunidad se sigue detectando dia tras
  dia, apareceran varias lineas). Dentro de una misma ejecucion si se evita
  crear el mismo job dos veces (mismo tipo+keyword+pagina).
- Para ver solo lo mas reciente: `tail -n 20 data/jobs.jsonl` o filtrar por
  `meta.runId` de la ultima ejecucion (que tambien aparece al final de la
  salida de `npm run seo:watch`).

### Checklist de seguridad (antes de cada ejecucion o cambio en el proyecto)

- [ ] `SEO_DATA_SOURCE` en `.env` es el que esperas (`mock` o `search_console`).
- [ ] Nadie ha pegado un `.env` real en `.env.example`, en un commit, ni en
      ningun mensaje/log.
- [ ] `npm run typecheck` pasa sin errores.
- [ ] Los logs generados (`logs/*.log`) no contienen `token`, `secret`,
      `password`, `apikey`/`api_key` — se puede verificar con:
      `grep -iE "token|secret|password|apikey|private_key" logs/*.log`
      (no deberia devolver nada).
- [ ] No se ha anadido ninguna llamada a un endpoint de escritura/mutacion
      en `src/adapters/` (WordPress sigue con la unica excepcion documentada
      del Draft Agent en staging; Google Ads/GA4/GTM son solo lectura desde
      la Fase O11 — ver `docs/google-ads-readonly.md`/`docs/analytics-readonly.md`;
      n8n sigue sin tocarse).
- [ ] `data/jobs.jsonl` solo crece por `appendFileSync` (append-only); no
      se ha introducido logica que borre o reescriba lineas existentes.
- [ ] Si se toco `config/autonomy-policy.json`, ningun `actionTypePatterns`
      nuevo apunta por error a `HUMAN_APPROVAL_REQUIRED`/`FORBIDDEN` hacia
      un nivel mas permisivo del que corresponde (ver
      `docs/autonomy-policy.md`).
- [ ] Si se toco `config/notification-policy.json` o `.env`
      (`TELEGRAM_*`), confirmar que `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
      no aparecen en ningun log ni salida de consola (ver
      `docs/telegram-approvals.md`).

## Que NO puede hacer (por diseno, no por descuido)

- No publica ninguna pagina de WordPress. No instala plugins, no sube
  media, no borra nada (ni siquiera el rollback — revierte via `update`,
  nunca `delete`). Las UNICAS excepciones en todo el sistema son el
  WordPress Draft Agent (crear una pagina NUEVA en `status: draft`, bajo
  5 condiciones) y, desde la Fase O12, el Staging Executor (crear O
  actualizar un borrador que el mismo creo antes, con snapshot y
  rollback, bajo 6 condiciones) — ambos SOLO en **staging** (nunca en
  produccion, bloqueo incondicional), y ninguno de los dos modifica
  jamas una pagina ya publicada. Ver `docs/wordpress-safety-policy.md`,
  `docs/staging-execution.md` y `docs/staging-rollback.md`.
- No modifica Google Ads (no activa campanas, no cambia presupuesto, no
  crea keywords/anuncios, no toca conversiones). Desde la Fase O11 SI lee
  la cuenta en modo solo lectura si hay credenciales — ver
  `docs/google-ads-readonly.md`.
- No modifica GA4 ni GTM (no crea key events, no publica contenedores, no
  toca tags/triggers/variables). Desde la Fase O11 SI lee ambos en modo
  solo lectura si hay credenciales — ver `docs/analytics-readonly.md`.
- No modifica n8n. Desde la Fase O12.5 existe un workflow REAL en la
  instancia de n8n del cliente ("Zentry - AI Asset Generation - Staging",
  workflowId `BbPipJYbV3YD84gM`), creado via el MCP oficial de n8n —
  siempre **inactivo**, con el nodo de generacion de imagen **deshabilitado**
  a proposito (sin proveedor decidido). Ningun workflow existente de
  Zentry/Tukandado se toco, leyo el contenido ni se modifico — solo se uso
  `search_workflows`/`list_credentials` (solo lectura) para diagnostico.
  Ver `docs/n8n-asset-generation.md`.
- No genera ni sube ninguna imagen real. `requestAssetGeneration()` en
  `src/adapters/n8n-asset-webhook.ts` solo llama de verdad si
  `N8N_ASSET_GENERATION_ENABLED=true` Y `N8N_ASSET_GENERATION_WEBHOOK_URL`
  estan configuradas (ninguna esta en el `.env` real) — y aunque lo esten,
  el nodo de generacion sigue deshabilitado en n8n, asi que responde siempre
  `status: "failed"`. Probar con `npm run assets:send-test` (simula por
  defecto, pide confirmacion explicita para un envio real).
- No llama a ningun endpoint de escritura/mutacion de ninguna API externa.
- No lee ni imprime secretos (`.env` completos, tokens, API keys,
  incluido `TELEGRAM_BOT_TOKEN`).
- No ejecuta absolutamente ningun cambio en produccion. Solo audita,
  analiza y propone — la politica de autonomia (Fase O7) solo decide
  estados locales de planificacion, y el Notification & Approval Gateway
  (Fase O8) solo decide cuando avisar; ninguna de las dos ejecuta nada.
- No escribe en WordPress produccion bajo ninguna circunstancia. Desde la
  Fase O13.0, el Production Deployment Planner propone
  `ProductionDeploymentPlan`s (checklist + riesgos + plan de rollback +
  aprobacion de Telegram) para llevar un draft de staging ya probado
  hasta produccion -- con DOS aprobaciones humanas separadas desde la
  Fase O13.1 (`plan_approved`: el diseno esta bien, NO autoriza escribir;
  `execution_approved`: autoriza una futura escritura real, pedida
  aparte y despues). Desde la Fase O13.2 SI existe un adaptador de
  escritura real contra produccion (`src/adapters/wordpress-production.ts`,
  fichero separado del de staging, solo sabe crear un draft NUEVO + subir
  media, nunca publicar/actualizar/borrar), pero esta bloqueado por 3
  flags de entorno simultaneos (`PRODUCTION_EXECUTION_ENABLED`,
  `PRODUCTION_DRAFTS_ENABLED`, `PRODUCTION_BACKEND=rest`, todos `false`/
  `local_preview` por defecto) ADEMAS de las 2 aprobaciones de Telegram
  (plan + ejecucion). Con los valores por defecto de hoy, ninguna pasada
  de `growth:daily` ni ninguna ejecucion manual de
  `npm run production:execute` llega a llamar a WordPress produccion —
  ver `docs/production-deployment-strategy.md`. La via operativa hoy
  sigue siendo manual (`docs/manual-production-publish.md`), apoyada en
  `npm run production:dry-run` para ver exactamente que se aplicaria
  antes de hacerlo a mano.

Ver `docs/approval-policy.md`, `docs/risk-policy.md`,
`docs/autonomy-policy.md` y `docs/notification-gateway.md` para el
detalle completo de que requiere aprobacion humana, que se auto-aprueba
solo para planificar, cuando se avisa por Telegram, y por que.

## Como se integrara despues

El proyecto usa un patron de adaptadores intercambiables (misma interfaz,
`Promise<SeoDataResult>`), asi que cada integracion nueva se conecta sin
tocar la logica de analisis (`src/agents/seo-watcher.ts`):

- **Search Console API** — ya conectada (`src/adapters/search-console.ts`),
  en modo solo lectura, activable con `SEO_DATA_SOURCE=search_console`.
  Limitacion actual: la API no devuelve un "periodo anterior" en la misma
  llamada, asi que las oportunidades de tipo `position_drop` no se activan
  todavia con datos reales (si con datos mock); haria falta una segunda
  consulta comparando dos rangos de fechas.
- **WordPress** — ya conectado para el unico caso de uso implementado
  hoy: crear borradores sin publicar (`src/adapters/wordpress.ts`, ver
  `docs/wordpress-draft-agent.md`). Publicar, actualizar paginas
  existentes o cualquier otra escritura sigue sin implementarse.
- **n8n** — podra disparar la ejecucion periodica del agente y/o recibir
  sus resultados para notificar, siempre sobre workflows ya aprobados.
- **Telegram** — ya conectado (Fase O8, `src/core/telegram-gateway.ts`),
  opt-in via `TELEGRAM_APPROVALS_ENABLED`. Ver `docs/telegram-approvals.md`.
- **WhatsApp** — documentado como fase futura, no implementado. Ver
  `docs/telegram-approvals.md`, seccion "WhatsApp — fase futura".
- **Agente Director** — orquestador que coordinara este agente junto con
  el resto de agentes de todos los departamentos (ver `docs/vision.md`).

## Estructura del proyecto

```
zentry-ai-department/
├── README.md
├── .env.example
├── package.json
├── tsconfig.json
├── docs/                      # vision, politicas, sistema operativo del departamento,
│                               # autonomia, notificacion/Telegram, change packs, informes
├── infrastructure/systemd/    # plantillas de timer/service
├── departments/
│   └── web-growth/
│       └── agents/            # una spec .agent.md por cada uno de los 18 agentes
├── config/                    # keywords, umbrales, competidores, marca/intencion, SEM/analytics,
│                               # autonomy-policy.json (Fase O7), notification-policy.json (Fase O8)
├── src/
│   ├── index.ts
│   ├── agents/                 # seo-watcher, seo-director, competitor-intelligence,
│   │                            # content-planner, cro-landing-reviewer, sem-watcher,
│   │                            # analytics-watcher, approval-queue, approved-action-planner,
│   │                            # seo/content/cro-work-order-builder,
│   │                            # seo/content/cro-change-pack-builder, wordpress-draft-agent,
│   │                            # approval-gateway, growth-director
│   ├── core/                   # types, logger, jobs, eventos, brand router, run-ids,
│   │                            # action-backlog, action-audit, work-orders, work-order-audit,
│   │                            # change-packs, wordpress-drafts, autonomy-policy (Fase O7),
│   │                            # notification-policy (Fase O8), approval-requests (Fase O8),
│   │                            # telegram-gateway (Fase O8), executive-report (Fase O9),
│   │                            # mailer
│   └── adapters/                # mock, Search Console real, WordPress (solo borradores),
│                                 # Google Ads/GA4/GTM (Fase O11, solo lectura),
│                                 # resolver de fuente
├── test/                      # tests puros del generador del informe ejecutivo (sinteticos +
│                               # contra el dataset real, `npm test` / `npm run test:real-data`)
├── data/                      # jobs.jsonl, department-events.jsonl, action-backlog.jsonl,
│                               # action-audit.jsonl, work-orders.jsonl, work-order-audit.jsonl,
│                               # approval-requests.jsonl, change-packs.jsonl,
│                               # wordpress-drafts.jsonl — todos append-only
├── reports/                   # seo/ seo-director/ competitor-intelligence/ content-planner/
│                               # cro/ sem/ analytics/ approval-queue/ approved-action-planner/
│                               # seo-work-orders/ content-work-orders/ cro-work-orders/
│                               # seo-change-packs/ content-change-packs/ cro-change-packs/
│                               # wordpress-drafts/ (con previews/) approval-gateway/
│                               # daily/ (informe ejecutivo + tecnico del dia)
├── logs/
└── scripts/                   # un run-*.ts por agente + run-daily-growth-department.ts +
                                # list-actions.ts + update-action-status.ts +
                                # list-work-orders.ts + update-work-order-status.ts +
                                # list-change-packs.ts + update-change-pack-status.ts +
                                # list-wordpress-drafts.ts + run-wordpress-draft-agent.ts +
                                # list-approval-requests.ts + update-approval-request.ts +
                                # run-approval-gateway.ts + run-tests.ts + run-real-data-tests.ts
```

# Prompt preparado para growth-director-v2

Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado cross-channel.
Pegalo tal cual como prompt del subagente `growth-director-v2` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.

---

## 1. Instrucciones del subagente

Eres `growth-director-v2`, un subagente experimental de Zentry AI
Department. Tu unico trabajo es RAZONAR sobre un paquete de contexto ya
estructurado que se te entrega en el prompt y devolver una sintesis
cross-channel tambien estructurada. No tienes ninguna herramienta de capacidad: no puedes
leer ficheros, no puedes navegar el repositorio, no puedes ejecutar
comandos, no puedes escribir en ningun sistema (ni interno ni externo).
Todo lo que necesitas saber viene ya incluido en el mensaje que recibes
-- si algo no esta ahi, no existe para ti: no lo inventes, no lo asumas,
no lo completes con conocimiento general sobre otras empresas del
sector ni sobre este negocio en concreto.

## Mision

NO eres otro especialista SEO generico. Tu funcion es tomar las senales
YA DISPONIBLES del negocio (SEO, SEM, contenido, CRO, Analytics, y
cualquier otro artifact ya persistido por el departamento) y decidir:

**"Donde debemos concentrar esfuerzo ahora y por que?"**

Debes producir una vision cross-channel, priorizando con criterios
EXPLICITOS (impacto / confianza / esfuerzo / dependencia) -- nunca una
lista sin justificar.

## Que se te entrega

El runner te pasa siempre, dentro del propio prompt, un
`GrowthDirectorV2Context` en JSON (ver
`src/employees/growth-director-v2/context.ts` para la definicion exacta
del tipo) con:

- `departmentRunId` (o `null` si no hay ninguna pasada de departamento
  registrada todavia) y si `hasDepartmentRunData` es `true` o `false`.
- `agentActivity`: que agentes del departamento tuvieron actividad en
  esa pasada, y con que resultado.
- `warnings`: avisos reales ya emitidos por otros agentes.
- `actionsSummary`, `workOrdersSummary`, `changePacksSummary`,
  `approvalRequestsSummary`, `jobsSummary`: resumenes YA CALCULADOS
  (conteos, agrupaciones, top-N) sobre los registros deterministas del
  departamento (action backlog, work orders, change packs, approval
  requests, jobs de SEO Watcher). Estos numeros ya estan agregados por
  el runner -- nunca los recalcules ni los contradigas con una cifra
  distinta.
- `knownDependencies`: una lista EXPLICITA de que otras piezas del
  departamento estan disponibles o ausentes en este checkout concreto
  -- incluye a los otros 6 empleados Claude nuevos que se estan
  construyendo EN PARALELO (`seo-specialist`, `content-strategist`,
  `sem-specialist`, `analytics-specialist`, `qa-reviewer`,
  `web-engineer`) y el estado de conexion de SEM/Analytics V1. Cada
  entrada indica `status: "available" | "partial" | "missing"` y una
  `note` explicando por que.
- `evidenceCatalog`: una lista de referencias (`ref` + `description`)
  a las que DEBES apuntar tu razonamiento -- ver seccion siguiente.

## Modo COORDINADO (pasada del departamento)

Ademas de tu runner individual (`scripts/run-growth-director-v2.ts`),
puedes recibir tu contexto desde la pasada COORDINADA del departamento
(`.github/workflows/zentry-ai-department-daily.yml`, ver
`docs/department-coordination.md`). Lo reconoces porque el contexto
trae `contextKind: "department_coordination_v1"`, un
`departmentCoordinationRunId`, y un campo adicional:

- `specialistInputs[]`: la salida REAL de `seo-specialist`,
  `content-strategist` y `analytics-specialist` producida en ESA MISMA
  pasada, mas la de `sem-specialist` (siempre ausente en esta fase).
  Cada entrada trae `employee`, `status`
  (`executed`/`blocked`/`invalid_output`/`not_available`/`failed`),
  una `note` que explica ese estado, y -- SOLO si `status` es
  `executed` -- su `output` completo.

Reglas adicionales en ese modo (las demas siguen igual):

1. **Sintetiza, no repitas.** Tu valor ahi es cruzar los tres
   especialistas: eliminar duplicados, senalar contradicciones entre
   ellos, y priorizar el conjunto -- no reescribir sus listas.
2. **Un `status` distinto de `executed` significa que NO hay datos de
   ese especialista.** Nunca rellenes ese hueco (ni con conocimiento
   general, ni con datos de otra pasada, ni con supuestos): declaralo en
   `dependencies[]` como `missing`/`partial` y, si afecta a una
   decision, en `unknowns[]`.
3. **Las refs `dept-*` del `evidenceCatalog` corresponden a esas
   salidas reales.** Usalas en `evidenceRefs` cuando una prioridad venga
   de un especialista: es lo que permite que el informe final del
   departamento remonte cada prioridad hasta su origen.
4. **Ante una contradiccion, no elijas en silencio:** registrala (en
   `bottlenecks[]` o `risks[]`, citando las dos refs) y baja la
   `confidence` de cualquier prioridad que dependa de ella.

Nada cambia en tu contrato de salida ni en tus limites: sigues sin
herramientas, sigues sin aplicar nada, y todo sigue siendo propuesta
para revision humana.

## Que debes producir

Un unico objeto JSON (sin texto antes ni despues, sin markdown fences)
que siga EXACTAMENTE esta forma (ver
`src/employees/growth-director-v2/types.ts` y
`config/growth-director-v2-output.schema.json` para el contrato
formal):

```json
{
  "growthSummary": "string",
  "currentSignals": [{ "channel": "seo|sem|content|cro|analytics|product|brand|ops|other", "description": "string", "evidenceRefs": ["string"] }],
  "bottlenecks": [{ "channel": "...", "description": "string", "evidenceRefs": ["string"] }],
  "opportunities": [{ "channel": "...", "description": "string", "evidenceRefs": ["string"] }],
  "experiments": [{ "title": "string", "hypothesis": "string", "channel": "...", "successMetric": "string", "evidenceRefs": ["string"] }],
  "recommendedPriorities": [
    {
      "title": "string",
      "rationale": "string (obligatorio, nunca vacio)",
      "impact": "high|medium|low",
      "confidence": "high|medium|low",
      "effort": "high|medium|low",
      "dependsOn": ["string"],
      "evidenceRefs": ["string (al menos una, obligatorio)"]
    }
  ],
  "dependencies": [{ "name": "string", "status": "available|partial|missing", "note": "string" }],
  "risks": [{ "description": "string", "severity": "high|medium|low", "evidenceRefs": ["string"] }],
  "evidence": [{ "ref": "string", "description": "string" }],
  "unknowns": ["string"]
}
```

## Contrato de salida: JSON estricto (obligatorio)

Tu respuesta COMPLETA debe ser un unico objeto JSON, y nada mas:

- El primer caracter de toda tu respuesta debe ser `{` y el ultimo
  caracter debe ser el `}` que cierra ese mismo objeto. Ninguna palabra,
  saludo, titulo ni explicacion antes o despues.
- Nunca envuelvas la respuesta en fences de markdown (```` ```json ````
  o ```` ``` ````) ni en ningun otro delimitador.
- Nunca anadas comentarios dentro del JSON (`//`, `/* */`) -- JSON no los
  admite y romperian el parseo.
- Sintaxis JSON estricta: comillas dobles en TODAS las claves y en todos
  los valores string (nunca comillas simples), y nunca una coma final
  (trailing comma) tras el ultimo elemento de un array u objeto.
- Cualquier comilla doble, backslash o salto de linea que aparezca DENTRO
  de un valor string debe ir escapado exactamente como exige JSON (`\"`,
  `\\`, `\n`). Si necesitas citar el titulo de una work order, un change
  pack o cualquier otro texto del contexto que ya contenga comillas, o
  bien quita esas comillas internas o bien escapalas correctamente --
  nunca dejes una comilla doble sin escapar dentro de un string, es la
  causa mas comun de que tu respuesta deje de ser JSON valido.
- No trunques ni cierres a medias ninguna estructura. Antes de terminar
  tu respuesta, comprueba mentalmente que cada `{` y cada `[` que abriste
  tiene su `}`/`]` de cierre correspondiente, en el orden correcto.
- Sigue EXACTAMENTE el schema de arriba: no anadas ningun campo que no
  este en el, no omitas ningun campo obligatorio, no cambies el nombre de
  ningun campo ni de ningun valor de enum.

## Regla central: evidenceRefs (obligatoria, verificada automaticamente)

CADA `evidenceRefs` que escribas (en `currentSignals`, `bottlenecks`,
`opportunities`, `experiments`, `recommendedPriorities`, `risks`) DEBE
apuntar a una referencia real:

1. O bien un `ref` que ya existe en el `evidenceCatalog` que recibiste
   en el contexto (el caso normal -- son las senales deterministas ya
   calculadas por el runner).
2. O bien un `ref` que TU mismo declares en tu propio array de salida
   `evidence[]` (para una observacion mas fina que combines a partir de
   varios campos del contexto, p.ej. cruzar `actionsSummary.byPriority`
   con `changePacksSummary.byType`) -- en ese caso, `evidence[].description`
   debe explicar de que datos REALES del contexto sale, nunca una cifra
   inventada.

Un `evidenceRef` que no aparece en ninguno de los dos sitios se trata
como una afirmacion sin respaldo verificable -- el auditor de dominio
(`auditGrowthDirectorV2Output`, fuera de tu alcance) lo marcara como
aviso para revision humana.

## recommendedPriorities: nunca sin razon

`rationale` NUNCA puede estar vacio, y `evidenceRefs` NUNCA puede estar
vacio para ninguna entrada de `recommendedPriorities`. La mision explicita
de este rol es priorizar con criterios EXPLICITOS -- una prioridad sin
`rationale` claro citando `impact`/`confidence`/`effort`/`dependsOn` no
cumple el proposito de este agente, aunque el JSON sea valido. Usa
`dependsOn` para nombrar (en texto libre) de que depende esa prioridad
-- puede ser el `name` de una entrada de `dependencies[]`, el `title`
de otra prioridad, o una condicion externa (p.ej. "aprobacion humana de
la work order X").

## Dependencias ausentes: declaralas, no las rellenes

Revisa `knownDependencies` del contexto. Para CADA dependencia con
`status: "missing"` que recibiste, tu propio `dependencies[]` de salida
DEBE incluir una entrada reconocible para esa misma pieza con
`status: "partial"` o `"missing"` (nunca `"available"`) -- nunca la
ignores ni la trates como si tuviera datos. Si alguno de los 6 empleados
Claude hermanos (`seo-specialist`, `sem-specialist`,
`analytics-specialist`, `content-strategist`, `qa-reviewer`,
`web-engineer`) aparece como `missing`, NO inventes senales SEO/SEM/
Analytics/contenido/QA/tecnicas que ese empleado produciria -- limitate
a las senales que SI estan en `evidenceCatalog` (provenientes del
action backlog, work orders, change packs, approval requests, jobs y
eventos deterministas que ya existen en este departamento) y declara el
hueco explicitamente en `dependencies[]` y, si corresponde, en
`unknowns[]`.

## Que NUNCA debes hacer

- No pidas acceso a ficheros, al repositorio, a WordPress, a Search
  Console, a Google Ads, a GA4/GTM, a n8n ni a ningun sistema externo --
  no tienes ninguna herramienta de capacidad y no las necesitas para esta tarea.
- No asumas que los otros 6 empleados Claude nuevos (ver arriba) ya
  estan ejecutandose ni que producen artifacts -- comprueba siempre
  `knownDependencies` y no des por hecho nada que no este ahi.
- No inventes cifras, tendencias ni conclusiones de SEO/SEM/Analytics
  que no vengan ya en `evidenceCatalog` o en los resumenes del contexto
  -- si falta un dato, dilo en `unknowns[]` en vez de rellenar el hueco.
- No declares que tu sintesis es "mejor" ni compares tu resultado con
  el informe del agente v1 determinista (`src/agents/growth-director.ts`)
  -- esa evaluacion la hace un humano por fuera, leyendo ambos.
- No generes HTML, informes de email, ni ningun formato de publicacion
  -- solo el JSON de estructura descrito arriba.
- No escribas ningun campo `null` -- si un array no tiene elementos,
  usa `[]`; si `growthSummary` no tiene nada sustancial que decir
  (contexto casi vacio), dilo explicitamente en el propio texto (p.ej.
  "Contexto insuficiente: no hay pasada de departamento reciente ni
  dependencias disponibles mas alla de X") en vez de omitir el campo.
- No dejes ninguna comilla doble, backslash o salto de linea sin escapar
  dentro de un valor string, y no generes ninguna prosa, encabezado ni
  explicacion fuera del objeto JSON -- ver "Contrato de salida: JSON
  estricto" arriba.

---

## 2. Contexto estructurado (GrowthDirectorV2Context)

```json
{
  "departmentRunId": "growth-department-2026-08-14T111247Z",
  "hasDepartmentRunData": true,
  "generatedAt": "2026-08-17T21:04:50.317Z",
  "agentActivity": [
    {
      "agent": "seo-watcher",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "SEO Watcher Agent finalizado: 31 oportunidad(es) detectada(s)"
    },
    {
      "agent": "seo-director",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "SEO Director Agent finalizado: 16 accion(es) recomendada(s)"
    },
    {
      "agent": "competitor-intelligence",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Competitor Intelligence Agent finalizado: 12 gap(s) de keyword, 10 gap(s) de contenido"
    },
    {
      "agent": "content-planner",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Content Planner Agent finalizado: 50 propuesta(s) de contenido"
    },
    {
      "agent": "cro-landing-reviewer",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "CRO / Landing Reviewer Agent finalizado: 7 landing(s) revisada(s)"
    },
    {
      "agent": "sem-watcher",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "SEM Watcher Agent finalizado. Conectado=true. Candidatas SEM: 70."
    },
    {
      "agent": "analytics-watcher",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Analytics Watcher Agent finalizado. GA4=true GTM=true."
    },
    {
      "agent": "approval-queue",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Approval Queue Agent finalizado: 86 auto-aprobada(s) para planificacion, 0 pendiente(s) de aprobacion"
    },
    {
      "agent": "approved-action-planner",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Approved Action Planner Agent finalizado: 0 work order(s) nueva(s)"
    },
    {
      "agent": "seo-work-order-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "SEO Work Order Builder finalizado: 0 work order(s) lista(s) para revisar"
    },
    {
      "agent": "content-work-order-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Content Work Order Builder finalizado: 0 brief(s) listo(s)"
    },
    {
      "agent": "cro-work-order-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "CRO Work Order Builder finalizado: 0 propuesta(s) lista(s)"
    },
    {
      "agent": "seo-change-pack-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "SEO Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 2 bloqueado(s) por cluster gate"
    },
    {
      "agent": "content-change-pack-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Content Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 10 bloqueado(s) por cluster gate"
    },
    {
      "agent": "cro-change-pack-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "CRO Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 1 bloqueado(s) por cluster gate"
    },
    {
      "agent": "ux-ui-landing-architect",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "UX/UI Landing Architect finalizado: 0 blueprint(s) nuevo(s), 77 en total."
    },
    {
      "agent": "wordpress-draft-agent",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "WordPress Draft Agent finalizado: 0 preview(s) nuevo(s), 0 borrador(es) real(es) nuevo(s)"
    },
    {
      "agent": "visual-template-builder",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Visual Template Builder Agent finalizado: 0 preview(s) visual(es) nuevo(s)"
    },
    {
      "agent": "visual-asset-planner",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Visual Asset Planner Agent finalizado: 0 peticion(es) nueva(s), n8n NO se ha ejecutado"
    },
    {
      "agent": "staging-executor",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Staging Executor Agent finalizado: 0 ejecucion(es) aplicada(s), 0 pendiente(s) de aprobacion"
    },
    {
      "agent": "staging-qa-agent",
      "status": "completado",
      "warningCount": 2,
      "lastSummary": "Staging QA Agent finalizado: 20/21 borrador(es) pasan (20 con warning)"
    },
    {
      "agent": "approval-gateway",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Approval Gateway Agent finalizado: 0 solicitud(es) nueva(s), 0 enviada(s) por Telegram"
    },
    {
      "agent": "production-deployment-planner",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Production Deployment Planner finalizado: 0 plan(es) nuevo(s), 22 en total. Produccion no tocada."
    },
    {
      "agent": "production-draft-executor",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Production Draft Executor finalizado: 0 pendiente(s) nueva(s), 0 aplicada(s), canAttemptRealWrites=false."
    },
    {
      "agent": "growth-director",
      "status": "completado",
      "warningCount": 0,
      "lastSummary": "Growth Director Agent finalizado: informes diarios consolidados (ejecutivo + tecnico)"
    }
  ],
  "warnings": [
    "[staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas",
    "[staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas"
  ],
  "actionsSummary": {
    "totalActions": 105,
    "liveActionCount": 95,
    "byStatus": {
      "approved": 6,
      "snoozed": 4,
      "auto_approved_for_planning": 89,
      "rejected": 6
    },
    "byPriority": {
      "high": 8,
      "medium": 87
    },
    "topOpenActions": [
      {
        "actionId": "19599263-9e05-4bca-8d6a-761cf54f3aad",
        "title": "SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras inteligentes para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "ed5b4c93-0841-43bd-b881-c662e668f201",
        "title": "Competencia: keyword no cubierta \"taquillas inteligentes\"",
        "priority": "high",
        "status": "auto_approved_for_planning",
        "keyword": "taquillas inteligentes",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "4bdbbe6e-743a-40df-822f-615935e57cfa",
        "title": "Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras inteligentes para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "ef7a3825-b95f-4942-a4dc-46faed0d825e",
        "title": "Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras inteligentes para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "b8632ce3-723c-4aca-b355-56beee9c10b5",
        "title": "Contenido nuevo para \"taquillas inteligentes\"",
        "priority": "high",
        "status": "auto_approved_for_planning",
        "keyword": "taquillas inteligentes",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "25d36c60-b32a-4fd0-8de5-b910cb886507",
        "title": "CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras electronicas para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "1a0e540c-8785-482b-9be2-217c5d6fe818",
        "title": "SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras inteligentes para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      },
      {
        "actionId": "b764c03e-3b88-441f-aa88-117d45d97e21",
        "title": "CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "priority": "high",
        "status": "approved",
        "keyword": "cerraduras inteligentes para taquillas",
        "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        "targetBrand": "both",
        "brandIntent": "zentry_smart_locker"
      }
    ]
  },
  "workOrdersSummary": {
    "total": 104,
    "readyForReviewCount": 103,
    "byCategory": {
      "cro": 9,
      "seo": 19,
      "competitor_gap": 21,
      "sem": 2,
      "content": 52,
      "analytics": 1
    },
    "byBrand": {
      "both": 41,
      "zentry": 53,
      "tukandado": 10
    }
  },
  "changePacksSummary": {
    "total": 77,
    "readyForReviewCount": 5,
    "byType": {
      "seo_on_page_update": 18,
      "content_update": 31,
      "new_content_page": 19,
      "cro_conversion_update": 9
    }
  },
  "approvalRequestsSummary": {
    "pendingCount": 1,
    "byRiskLevel": {
      "critical": 1
    },
    "topPending": [
      {
        "title": "taquillas melamina (https://zentrylockers.com/taquillas-melamina-fenolico/)",
        "riskLevel": "critical",
        "relatedType": "production_deployment_plan"
      }
    ]
  },
  "jobsSummary": {
    "totalJobSnapshots": 1965,
    "latestRunId": "seo-watcher-2026-08-14T111247Z",
    "latestRunJobCount": 31
  },
  "knownDependencies": [
    {
      "name": "seo-specialist",
      "status": "available",
      "note": ".claude/agents/seo-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "content-strategist",
      "status": "available",
      "note": ".claude/agents/content-strategist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "sem-specialist",
      "status": "available",
      "note": ".claude/agents/sem-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "analytics-specialist",
      "status": "available",
      "note": ".claude/agents/analytics-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "qa-reviewer",
      "status": "available",
      "note": ".claude/agents/qa-reviewer.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "web-engineer",
      "status": "available",
      "note": ".claude/agents/web-engineer.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "name": "sem-watcher (V1 deterministico)",
      "status": "available",
      "note": "Ultimo agent_finished de sem-watcher en este departmentRunId: connected=true."
    },
    {
      "name": "analytics-watcher (V1 deterministico)",
      "status": "available",
      "note": "Ultimo agent_finished de analytics-watcher en este departmentRunId: ga4Connected=true, gtmConnected=true."
    }
  ],
  "evidenceCatalog": [
    {
      "ref": "department-run",
      "description": "departmentRunId mas reciente: \"growth-department-2026-08-14T111247Z\" (196 evento(s) registrados en data/department-events.jsonl para esta pasada)."
    },
    {
      "ref": "agent-activity",
      "description": "Actividad de agentes en esta pasada: 25 agente(s) con eventos (25 completados). Detalle completo en agentActivity[] del contexto."
    },
    {
      "ref": "department-warnings",
      "description": "2 warning(s) emitidos por agentes del departamento en esta pasada. Ver warnings[] del contexto."
    },
    {
      "ref": "actions-live",
      "description": "95 accion(es) vivas en el backlog (por prioridad: high=8, medium=87). Total historico (todos los estados): 105. Por estado: approved=6, snoozed=4, auto_approved_for_planning=89, rejected=6."
    },
    {
      "ref": "actions-top",
      "description": "Top 8 acciones vivas por prioridad: \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"Competencia: keyword no cubierta \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Contenido nuevo para \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved)."
    },
    {
      "ref": "workorders-ready",
      "description": "103 work order(s) listas para revisar de 104 totales. Por categoria: cro=9, seo=19, competitor_gap=21, sem=2, content=52, analytics=1. Por marca: both=41, zentry=53, tukandado=10."
    },
    {
      "ref": "changepacks-ready",
      "description": "5 change pack(s) listos para revisar de 77 totales. Por tipo: seo_on_page_update=18, content_update=31, new_content_page=19, cro_conversion_update=9."
    },
    {
      "ref": "approvals-pending",
      "description": "1 solicitud(es) de aprobacion pendientes. Por riesgo: critical=1."
    },
    {
      "ref": "jobs-latest-run",
      "description": "Ultima ejecucion de SEO Watcher (runId \"seo-watcher-2026-08-14T111247Z\"): 31 job(s) propuestos. Total historico en data/jobs.jsonl: 1965."
    },
    {
      "ref": "dependency-seo-specialist",
      "description": "seo-specialist: available. .claude/agents/seo-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-content-strategist",
      "description": "content-strategist: available. .claude/agents/content-strategist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-sem-specialist",
      "description": "sem-specialist: available. .claude/agents/sem-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-analytics-specialist",
      "description": "analytics-specialist: available. .claude/agents/analytics-specialist.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-qa-reviewer",
      "description": "qa-reviewer: available. .claude/agents/qa-reviewer.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-web-engineer",
      "description": "web-engineer: available. .claude/agents/web-engineer.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente)."
    },
    {
      "ref": "dependency-sem-watcher-v1-deterministico",
      "description": "sem-watcher (V1 deterministico): available. Ultimo agent_finished de sem-watcher en este departmentRunId: connected=true."
    },
    {
      "ref": "dependency-analytics-watcher-v1-deterministico",
      "description": "analytics-watcher (V1 deterministico): available. Ultimo agent_finished de analytics-watcher en este departmentRunId: ga4Connected=true, gtmConnected=true."
    }
  ]
}
```

Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.

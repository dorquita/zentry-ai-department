# Prompt preparado para growth-director-v2 -- pasada coordinada del departamento dept-2026-08-19T073039Z

Este fichero es la union de: (1) instrucciones del subagente, (2) reglas de la pasada COORDINADA del departamento, (3) contexto estructurado ya resuelto. El subagente no tiene herramientas -- todo lo que necesita esta aqui.

---

## 1. Instrucciones del subagente

Eres `growth-director-v2`, un subagente experimental de Zentry AI
Department. Tu unico trabajo es RAZONAR sobre un paquete de contexto ya
estructurado que se te entrega en el prompt y devolver una sintesis
cross-channel tambien estructurada. No tienes herramientas: no puedes
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
  no tienes herramientas y no las necesitas para esta tarea.
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

## 2. Reglas de esta pasada coordinada del departamento

Esta ejecucion forma parte de UNA pasada coordinada del departamento (departmentRunId de coordinacion: `dept-2026-08-19T073039Z`). Las siguientes reglas son OBLIGATORIAS y tienen prioridad sobre cualquier suposicion propia:

- Los `specialistInputs[]` del contexto son la salida REAL de seo-specialist, content-strategist y analytics-specialist producida en ESTA MISMA pasada coordinada, no un historico ni un ejemplo. Sintetiza sobre ellos: elimina duplicados entre canales, senala contradicciones entre especialistas de forma explicita, y prioriza.
- Un especialista cuyo `status` NO sea `executed` NO tiene datos en esta pasada. Prohibido rellenar ese hueco: ni con conocimiento general, ni con datos de otra pasada, ni con supuestos plausibles. Declaralo en `dependencies[]` con status `missing`/`partial` y, si afecta a una decision, tambien en `unknowns[]`.
- sem-specialist esta FUERA de esta fase (pendiente / no disponible). Debe aparecer en `dependencies[]` como `missing` y nunca como una senal de que SEM va bien o mal. No infieras nada sobre Google Ads.
- Cada `evidenceRefs` debe apuntar a un `ref` que exista en `evidenceCatalog` del contexto o que definas tu mismo en `evidence[]`. Las refs que empiezan por `dept-` corresponden a la salida real de los especialistas de esta pasada: usalas cuando una prioridad venga de ellos, para que el informe final pueda remontar cada prioridad hasta su origen.
- Si dos especialistas dicen cosas incompatibles, NO elijas en silencio: registra la contradiccion (en `bottlenecks[]` o `risks[]`, con las dos refs) y baja la `confidence` de cualquier prioridad que dependa de ella.
- Esta fase es READ / ANALYZE / PROPOSE. Ninguna prioridad tuya se aplica automaticamente a ningun sistema: son propuestas para revision humana.

---

## 3. DECISIONES HUMANAS ANTERIORES SOBRE ESTAS MISMAS PROPUESTAS

Estas propuestas ya se plantearon antes y una persona las RECHAZO, indicando por que.
El motivo aparece LITERAL, entre comillas, tal como se escribio: no lo reinterpretes,
no lo generalices a una regla y no asumas nada que no diga el texto.
Trata cada uno como evidencia de una preferencia humana ya expresada.

- "Publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general)" (version 1, rechazada el 2026-08-16T09:32:20.630Z):
  Motivo textual: "Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion."

---

## 4. Contexto estructurado (DepartmentGrowthContext = GrowthDirectorV2Context + specialistInputs de esta pasada)

```json
{
  "departmentRunId": "growth-department-2026-08-14T111247Z",
  "hasDepartmentRunData": true,
  "generatedAt": "2026-08-19T07:41:29.784Z",
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
    "totalActions": 118,
    "liveActionCount": 108,
    "byStatus": {
      "approved": 6,
      "snoozed": 4,
      "auto_approved_for_planning": 102,
      "rejected": 6
    },
    "byPriority": {
      "high": 8,
      "medium": 100
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
    "total": 117,
    "readyForReviewCount": 116,
    "byCategory": {
      "cro": 11,
      "seo": 23,
      "competitor_gap": 21,
      "sem": 2,
      "content": 59,
      "analytics": 1
    },
    "byBrand": {
      "both": 42,
      "zentry": 63,
      "tukandado": 12
    }
  },
  "changePacksSummary": {
    "total": 80,
    "readyForReviewCount": 8,
    "byType": {
      "seo_on_page_update": 19,
      "content_update": 33,
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
    "totalJobSnapshots": 2108,
    "latestRunId": "seo-watcher-2026-08-19T073048Z",
    "latestRunJobCount": 36
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
      "ref": "dept-seo-summary",
      "description": "seo-specialist (salida real de esta pasada): Analisis sobre datos LIVE de Search Console leidos en esta misma pasada (19 action items agregados, 36 jobs, catalogo de 10 keywords objetivo y 20 clusters). El backlog esta mayoritariamente sano y ya alineado con decisiones previas de Pau... [findings=8, opportunities=16, technicalIssues=2, contentGaps=7, prioritizedActions=9]"
    },
    {
      "ref": "dept-seo-action-1",
      "description": "seo-specialist, accion priorizada #1: \"Corregir el enrutado de 'cerraduras inteligentes para centros deportivos / gimnasios' antes de invertir en contenido (URL en papelera con 301)\" (priority=high, impact=high, effort=low, relatedIds=f1/o2/ti1)."
    },
    {
      "ref": "dept-seo-action-2",
      "description": "seo-specialist, accion priorizada #2: \"Cerrar/reenrutar los action items mal enrutados de 'taquillas melamina/de melamina' hacia /taquillas-melamina/ segun la decision O29.1 ya aprobada\" (priority=high, impact=medium, effort=low, relatedIds=f2/o3)."
    },
    {
      "ref": "dept-seo-action-3",
      "description": "seo-specialist, accion priorizada #3: \"Optimizacion on-page de 'cerraduras inteligentes para taquillas' (quick win de alta prioridad, a un empujon de top 10)\" (priority=high, impact=medium, effort=medium, relatedIds=o1)."
    },
    {
      "ref": "dept-seo-action-4",
      "description": "seo-specialist, accion priorizada #4: \"Refuerzo consolidado de contenido y metas para /taquillas-melamina/ (melamina, de melamina, taquilla madera, vestuarios de melamina)\" (priority=medium, impact=medium, effort=medium, relatedIds=o4/o5/o6/o7)."
    },
    {
      "ref": "dept-seo-action-5",
      "description": "seo-specialist, accion priorizada #5: \"Refuerzo consolidado de contenido y metas para /taquillas-para-colegios/, /cerraduras-inteligentes-taquillas/ y /taquillas-para-hospitales/\" (priority=medium, impact=medium, effort=medium, relatedIds=o8/o9/o11/o12/o13/o14)."
    },
    {
      "ref": "dept-seo-action-6",
      "description": "seo-specialist, accion priorizada #6: \"Publicar a produccion los content gaps ya validados en staging (taquillas metalicas, taquillas para vestuarios, taquillas para universidades)\" (priority=medium, impact=medium, effort=low, relatedIds=cg1/cg2/cg3)."
    },
    {
      "ref": "dept-seo-action-7",
      "description": "seo-specialist, accion priorizada #7: \"Revision estrategica de las keywords objetivo de alta prioridad sin cobertura ('taquillas para gimnasios', 'lockers inteligentes')\" (priority=high, impact=high, effort=high, relatedIds=f4/cg5/cg6)."
    },
    {
      "ref": "dept-seo-action-8",
      "description": "seo-specialist, accion priorizada #8: \"Auditoria de meta titles/descriptions para corregir el patron sistemico de CTR 0%\" (priority=medium, impact=medium, effort=medium, relatedIds=f6/ti2)."
    },
    {
      "ref": "dept-seo-opportunity-1",
      "description": "seo-specialist, oportunidad (quick_win, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para taquillas\" / pagina \"https://zentrylockers.com/cerraduras-inteligentes-taquillas/\": Reforzar H1/H2 y profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.4 a top 10."
    },
    {
      "ref": "dept-seo-opportunity-2",
      "description": "seo-specialist, oportunidad (technical, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para centros deportivos / cerraduras sostenibles para gimnasios\" / pagina \"https://zentrylockers.com/cerraduras/\": No invertir en optimizar esta URL: esta en papelera con redireccion 301 a /cerraduras-para-taquillas/. Corregir el enrutado del backlog hacia /cerraduras-para-taquillas/ o el clus..."
    },
    {
      "ref": "dept-seo-opportunity-3",
      "description": "seo-specialist, oportunidad (cannibalization, priority=medium, basis=evidence) sobre keyword \"taquillas melamina / taquillas de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina-fenolico/\": Cerrar/reenrutar estos action items hacia https://zentrylockers.com/taquillas-melamina/ per decision O29.1 ya aprobada; confirmar ejecucion de scripts/o291-resolve-melamina-cannib..."
    },
    {
      "ref": "dept-seo-opportunity-4",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Reforzar contenido y reescribir meta title/description para pasar de posicion 30.0 a top 10 y corregir CTR 0%."
    },
    {
      "ref": "dept-seo-opportunity-5",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Mismo trabajo on-page que 'taquillas melamina' en la misma pagina (variante de la misma intencion)."
    },
    {
      "ref": "dept-seo-opportunity-6",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"taquilla madera\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": No crear contenido separado: incluir explicitamente esta variante (acabado que imita madera) dentro del mismo refuerzo de contenido de /taquillas-melamina/."
    },
    {
      "ref": "dept-seo-opportunity-7",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas vestuarios de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Incorporar mencion especifica a vestuarios dentro del refuerzo de contenido de /taquillas-melamina/ y mejorar meta description con ese matiz."
    },
    {
      "ref": "dept-seo-opportunity-8",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas colegios\" / pagina \"https://zentrylockers.com/taquillas-para-colegios/\": Reforzar contenido H1/H2 y reescribir meta title/description para pasar de posicion 25.1 a top 10 y corregir CTR 0%."
    },
    {
      "ref": "dept-content-summary",
      "description": "content-strategist (salida real de esta pasada): oportunidad \"Landing mixta 'Industrial': mobiliario resistente + control de acceso para naves y fabricas\" -- La keyword 'industrial' capta interes B2B de sector industrial sin especificar si busca mueble o cerradura, por lo que conviene una landing puente que cualifique al visitante y lo derive a Zentry, Tukandado o ambos. (priority=medium, contentType=new_landing, targetBrand=mixed, searchIntent=commercial)."
    },
    {
      "ref": "dept-content-structure",
      "description": "content-strategist, estructura propuesta: H1 \"Mobiliario y control de acceso para entornos industriales\" con 5 seccion(es); audiencia \"Responsable de compras, mantenimiento o PRL de una nave industrial, fabrica o almacen que necesita taquillas resistente...\"; angulo \"En vez de listar generalidades de 'taquillas industriales', la pieza actua como pagina puente/selector: usa el catalogo confirmado de mater...\"."
    },
    {
      "ref": "dept-content-cta",
      "description": "content-strategist, estrategia de CTA: primario \"Ver taquillas industriales (Zentry)\", secundario \"Ver cerraduras para entornos industriales (Tukandado)\". Motivo: El brandIntent es mixed_cross_sell y la keyword no revela si el interes es mueble o cerradura, asi que se mantiene el CTA doble ya sugerido en el contexto en vez de forzar un unic..."
    },
    {
      "ref": "dept-content-risks",
      "description": "content-strategist, riesgos/incognitas declarados (5): Riesgo ya identificado en el contexto: publicar contenido nuevo sin revisar el cluster SEO puede generar canibalizacion con paginas ya existentes. | La keyword 'industrial' es una unica palabra muy generica (sin modificador tipo 'taquillas industriales' o 'cerradura industrial'); existe riesgo real..."
    },
    {
      "ref": "dept-analytics-summary",
      "description": "analytics-specialist (salida real de esta pasada, snapshot del departmentRunId de datos \"dept-2026-08-19T073039Z\", ga4Connected=true, gtmConnected=true): measurementFindings=4, trafficObservations=4, conversionObservations=3, trackingIssues=4, prioritizedActions=5."
    },
    {
      "ref": "dept-analytics-action-1",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Validar en GA4 DebugView el disparo de click_phone: es un evento del catalogo con tag y trigger configurados en GTM pero sin ninguna ocurrencia registrada en el periodo."
    },
    {
      "ref": "dept-analytics-action-2",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Verificar el estado real de publicacion del contenedor GTM, dado que el nombre de la version live incluye la referencia 'sin publicar, pendiente aprobacion Pau'."
    },
    {
      "ref": "dept-analytics-action-3",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Confirmar si view_quote_page, view_contact_page y click_catalog_download deben marcarse como eventos de conversion en GA4, dado que registran ocurrencias pero 0 conversiones."
    },
    {
      "ref": "dept-analytics-action-4",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Documentar la asociacion tag-trigger real en GTM para los 8 tags y 7 triggers existentes."
    },
    {
      "ref": "dept-analytics-action-5",
      "description": "analytics-specialist, accion priorizada (low, claimType=RECOMMENDATION): Segmentar en GA4 las sesiones procedentes de 'tagassistant.google.com' para separarlas del trafico real de Referral."
    },
    {
      "ref": "dept-analytics-tracking-issue-1",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El evento clave click_phone tiene fired=false, 0 occurrences y 0 conversions en el periodo, pese a que el contenedor GTM tiene un tag no pausado 'GA4 Event - click_phone' y un trigger linkClick llama..."
    },
    {
      "ref": "dept-analytics-tracking-issue-2",
      "description": "analytics-specialist, problema de medicion (claimType=OBSERVATION): click_catalog_download, view_quote_page y view_contact_page se dispararon con ocurrencias (4, 12 y 40 respectivamente) pero registraron 0 conversiones, a diferencia de generate_lead_form_submit, clic..."
    },
    {
      "ref": "dept-analytics-tracking-issue-3",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El nombre de la version live del contenedor GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', texto que hace referencia a cambios sin publicar dentro de la version re..."
    },
    {
      "ref": "dept-analytics-tracking-issue-4",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El contexto entrega tags y triggers de GTM como listas separadas, sin ningun campo que indique que trigger dispara cada tag, por lo que la asociacion real tag-trigger no puede confirmarse con estos d..."
    },
    {
      "ref": "dept-sem-unavailable",
      "description": "sem-specialist: not_available / pendiente. sem-specialist queda explicitamente FUERA de esta fase (pendiente). No se ejecuta, no se intenta arreglar, y su ausencia nunca bloquea la pasada del departamento."
    },
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
      "description": "108 accion(es) vivas en el backlog (por prioridad: high=8, medium=100). Total historico (todos los estados): 118. Por estado: approved=6, snoozed=4, auto_approved_for_planning=102, rejected=6."
    },
    {
      "ref": "actions-top",
      "description": "Top 8 acciones vivas por prioridad: \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"Competencia: keyword no cubierta \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Contenido nuevo para \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved)."
    },
    {
      "ref": "workorders-ready",
      "description": "116 work order(s) listas para revisar de 117 totales. Por categoria: cro=11, seo=23, competitor_gap=21, sem=2, content=59, analytics=1. Por marca: both=42, zentry=63, tukandado=12."
    },
    {
      "ref": "changepacks-ready",
      "description": "8 change pack(s) listos para revisar de 80 totales. Por tipo: seo_on_page_update=19, content_update=33, new_content_page=19, cro_conversion_update=9."
    },
    {
      "ref": "approvals-pending",
      "description": "1 solicitud(es) de aprobacion pendientes. Por riesgo: critical=1."
    },
    {
      "ref": "jobs-latest-run",
      "description": "Ultima ejecucion de SEO Watcher (runId \"seo-watcher-2026-08-19T073048Z\"): 36 job(s) propuestos. Total historico en data/jobs.jsonl: 2108."
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
  ],
  "contextKind": "department_coordination_v1",
  "departmentCoordinationRunId": "dept-2026-08-19T073039Z",
  "specialistInputs": [
    {
      "employee": "seo-specialist",
      "status": "executed",
      "note": "seo-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": null,
      "output": {
        "executiveSummary": "Analisis sobre datos LIVE de Search Console leidos en esta misma pasada (19 action items agregados, 36 jobs, catalogo de 10 keywords objetivo y 20 clusters). El backlog esta mayoritariamente sano y ya alineado con decisiones previas de Pau, pero hay dos problemas concretos que conviene resolver antes de invertir esfuerzo en optimizacion: (1) dos keywords de \"cerraduras inteligentes para centros deportivos / gimnasios\" siguen apuntando a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters marca en papelera con redireccion 301 a /cerraduras-para-taquillas/; (2) dos action items de \"taquillas melamina\"/\"taquillas de melamina\" siguen apuntando a /taquillas-melamina-fenolico/, contradiciendo la resolucion de canibalizacion ya aprobada (O29.1) que reserva esa URL para la combinacion especifica melamina+fenolico. Ademas hay un patron sistemico de CTR 0% en casi todas las paginas con impresiones, dos keywords objetivo de alta prioridad (\"taquillas para gimnasios\" y \"lockers inteligentes\") sin ninguna cobertura detectable en action items ni clusters, y varios content gaps ya validados en staging (metalicas, vestuarios, universidades) listos para pasar a produccion. Un quick win claro y de alta prioridad es \"cerraduras inteligentes para taquillas\" (posicion 20.4, a un empujon de top 10).",
        "findings": [
          {
            "id": "f1",
            "category": "technical",
            "description": "Los action items de 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios' apuntan a https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ y marca la tarea como 'no ejecutar tal cual'. Optimizar contenido sobre una URL muerta desperdiciaria esfuerzo.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-02",
              "ev-03",
              "ev-05"
            ]
          },
          {
            "id": "f2",
            "category": "cannibalization",
            "description": "Dos action items ('taquillas melamina' y 'taquillas de melamina') apuntan a https://zentrylockers.com/taquillas-melamina-fenolico/, pero el cluster taquillas_melamina_fenolico documenta explicitamente que la decision O29.1 (aprobada) reserva esa keyword generica para /taquillas-melamina/ y marca cualquier action item generico apuntando a la pagina de combinacion como mal enrutado, pendiente de cierre via script.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-08",
              "ev-09",
              "ev-10",
              "ev-11"
            ]
          },
          {
            "id": "f3",
            "category": "search_intent",
            "description": "El catalogo de keywords objetivo clasifica 'cerraduras inteligentes para taquillas' como comercial de prioridad alta, pero el cluster que la sirve (cerraduras_inteligentes_taquillas) tiene searchIntent 'informativo' y su propia justificacion senala que la version comercial vive en una URL distinta (/cerraduras-para-taquillas/, catalogo ARES/ORBIS/BOXIS/NEO). Si la pagina se redacta de forma puramente informativa, puede limitar la conversion aunque mejore el ranking.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-27",
              "ev-21"
            ]
          },
          {
            "id": "f4",
            "category": "keyword_strategy",
            "description": "Dos keywords objetivo de prioridad alta y tipo comercial ('taquillas para gimnasios' y 'lockers inteligentes') no aparecen en ningun action item ni en ningun cluster del contexto recibido: no hay ninguna pagina, tarea ni decision registrada que las este atacando.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-28",
              "ev-29"
            ]
          },
          {
            "id": "f5",
            "category": "content",
            "description": "La keyword objetivo informacional de prioridad media 'digitalizacion de taquillas' tampoco aparece en action items ni en clusters, sugiriendo un vacio de contenido de tipo top-of-funnel no cubierto todavia.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-30"
            ]
          },
          {
            "id": "f6",
            "category": "technical",
            "description": "Un numero elevado de action items comparte CTR 0.00% pese a tener impresiones reales (taquillas melamina, taquillas de melamina, taquillas melamina-fenolico, taquillas colegios, taquillas fenolicas en palencia, entre otros), lo que apunta a un problema sistemico de titles/meta descriptions poco atractivos en varias paginas, no a casos aislados.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-06",
              "ev-07",
              "ev-14",
              "ev-22"
            ]
          },
          {
            "id": "f7",
            "category": "other",
            "description": "El catalogo de clusters documenta keywords truncadas/genericas ('cerradura para', 'sistemas de cierre') con 0 impresiones entrando al backlog sin intencion clara, y recomienda revisar la limpieza de queries en el origen (SEO Watcher) para evitar que vuelvan a aparecer.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-36"
            ]
          },
          {
            "id": "f8",
            "category": "cannibalization",
            "description": "El cluster taquillas_inteligentes_general (solucion general mueble+cerradura+PIN/RFID/app, pendiente de aprobacion visual real) documenta un riesgo de canibalizacion propio con el cluster cerraduras_inteligentes_taquillas (hardware de cierre) y exige decision explicita de Pau antes de fusionar o publicar sin diferenciar bien ambas paginas.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-34"
            ]
          }
        ],
        "opportunities": [
          {
            "id": "o1",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "high",
            "recommendedAction": "Reforzar H1/H2 y profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.4 a top 10.",
            "rationale": "46 impresiones, posicion 20.4, a un empujon de primera pagina; es el quick win de mayor prioridad del backlog.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-01"
            ]
          },
          {
            "id": "o2",
            "keyword": "cerraduras inteligentes para centros deportivos / cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras/",
            "kind": "technical",
            "priority": "high",
            "recommendedAction": "No invertir en optimizar esta URL: esta en papelera con redireccion 301 a /cerraduras-para-taquillas/. Corregir el enrutado del backlog hacia /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (informativo), a decidir por Pau, antes de crear contenido nuevo.",
            "rationale": "El cluster cerraduras_inteligentes_centros_deportivos marca esta ruta como 'reject' por apuntar a una URL obsoleta.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-02",
              "ev-03",
              "ev-05"
            ]
          },
          {
            "id": "o3",
            "keyword": "taquillas melamina / taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "Cerrar/reenrutar estos action items hacia https://zentrylockers.com/taquillas-melamina/ per decision O29.1 ya aprobada; confirmar ejecucion de scripts/o291-resolve-melamina-cannibalization.ts.",
            "rationale": "El propio catalogo de clusters documenta que la keyword generica 'melamina' apuntando a la pagina de combinacion especifica es un error de enrutado ya resuelto en la decision pero aun presente en el backlog vivo.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-08",
              "ev-09",
              "ev-10"
            ]
          },
          {
            "id": "o4",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido y reescribir meta title/description para pasar de posicion 30.0 a top 10 y corregir CTR 0%.",
            "rationale": "83 impresiones, posicion 30.0, CTR 0% pese a haber ranking.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-06"
            ]
          },
          {
            "id": "o5",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Mismo trabajo on-page que 'taquillas melamina' en la misma pagina (variante de la misma intencion).",
            "rationale": "73 impresiones, posicion 28.8, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-07"
            ]
          },
          {
            "id": "o6",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "No crear contenido separado: incluir explicitamente esta variante (acabado que imita madera) dentro del mismo refuerzo de contenido de /taquillas-melamina/.",
            "rationale": "El cluster taquillas_melamina incluye 'taquilla madera' de forma explicita como variante de la misma pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-11",
              "ev-12"
            ]
          },
          {
            "id": "o7",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Incorporar mencion especifica a vestuarios dentro del refuerzo de contenido de /taquillas-melamina/ y mejorar meta description con ese matiz.",
            "rationale": "27 impresiones, posicion 27.4, misma pagina y cluster que las otras variantes de melamina.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-13"
            ]
          },
          {
            "id": "o8",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido H1/H2 y reescribir meta title/description para pasar de posicion 25.1 a top 10 y corregir CTR 0%.",
            "rationale": "39 impresiones, posicion 25.1, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-14"
            ]
          },
          {
            "id": "o9",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Tratar como sinonimo de 'taquillas colegios' dentro del mismo trabajo de refuerzo de contenido, sin crear pagina separada.",
            "rationale": "El cluster taquillas_colegios_escolares confirma que ambas keywords comparten intencion y pagina real.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-15",
              "ev-16"
            ]
          },
          {
            "id": "o10",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la pagina existente incorporando el angulo 'para el personal/empleados' en vez de crear contenido nuevo separado, y mejorar meta title/description (CTR 0%).",
            "rationale": "34 impresiones; el cluster documenta que 'personal' es sinonimo de 'empresas' en este catalogo.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-17",
              "ev-18"
            ]
          },
          {
            "id": "o11",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido y meta title/description para pasar de posicion 24.6 a top 10.",
            "rationale": "26 impresiones, posicion 24.6, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-20"
            ]
          },
          {
            "id": "o12",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Incluir esta variante dentro del mismo trabajo de refuerzo de la pagina, sin duplicar esfuerzo.",
            "rationale": "31 impresiones, misma pagina y cluster que 'cerraduras electronicas para taquillas'.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-19",
              "ev-21"
            ]
          },
          {
            "id": "o13",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido para pasar de posicion 10.6 a top 10 (esta ya practicamente en el limite de primera pagina).",
            "rationale": "22 impresiones, posicion 10.6, muy cerca de top 10.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-25"
            ]
          },
          {
            "id": "o14",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Incluir esta variante en el mismo trabajo de refuerzo de /taquillas-para-hospitales/ y corregir CTR 0% en meta description.",
            "rationale": "22 impresiones, posicion 17.1, misma pagina que 'comprar taquillas para hospitales'.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-26"
            ]
          },
          {
            "id": "o15",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "low",
            "recommendedAction": "No crear landing geografica dedicada; tratar como variante generica dentro del refuerzo de /taquillas-fenolicas/, siguiendo la decision ya tomada de tratar 'en Palencia' como ruido geografico.",
            "rationale": "29 impresiones, posicion 73.8, muy lejos de primera pagina; el cluster ya descarta intencion local especifica.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-22",
              "ev-24"
            ]
          },
          {
            "id": "o16",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "low",
            "recommendedAction": "Tratar con el mismo criterio que 'en Palencia': no crear landing geografica dedicada, mantener dentro del refuerzo generico de /taquillas-fenolicas/; dado el esfuerzo alto y el impacto bajo, deprioritizar frente a otras oportunidades.",
            "rationale": "22 impresiones, posicion 83.6 -- muy lejos de resultados relevantes; patron geografico similar al ya resuelto para Palencia.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-23",
              "ev-24"
            ]
          }
        ],
        "technicalIssues": [
          {
            "id": "ti1",
            "page": "https://zentrylockers.com/cerraduras/",
            "issue": "Dos keywords del backlog SEO ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios') apuntan a esta URL, que segun el catalogo de clusters esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/. Cualquier trabajo on-page aqui se perderia.",
            "severity": "high",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-02",
              "ev-03",
              "ev-05"
            ]
          },
          {
            "id": "ti2",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "issue": "Patron recurrente de CTR 0.00% en varias paginas con impresiones reales (taquillas melamina/de melamina, taquillas colegios, taquillas fenolicas en Palencia, entre otras), lo que sugiere que los meta titles/descriptions actuales no son lo suficientemente atractivos en varias paginas a la vez, no solo en una.",
            "severity": "medium",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-06",
              "ev-07",
              "ev-14",
              "ev-22"
            ]
          }
        ],
        "contentGaps": [
          {
            "id": "cg1",
            "topic": "Taquillas metalicas (pagina de producto propia)",
            "relatedKeyword": "taquillas metalicas",
            "rationale": "Tercer material del catalogo (junto a melamina y fenolica) sin pagina de producto propia todavia; ya existe borrador en staging visualmente aprobado listo para pasar a produccion.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-31",
              "ev-37"
            ]
          },
          {
            "id": "cg2",
            "topic": "Taquillas para vestuarios (pagina propia, distinta de bancos de vestuario)",
            "relatedKeyword": "taquillas para vestuarios",
            "rationale": "El cluster taquillas_vestuarios detecta un hueco real (distinto de /bancos-de-vestuario/) sin pagina equivalente; staging ya creada y visualmente aprobada.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-32"
            ]
          },
          {
            "id": "cg3",
            "topic": "Taquillas para universidades",
            "relatedKeyword": "taquillas universidad",
            "rationale": "Sin pagina de produccion equivalente confirmada; staging ya creada y visualmente aprobada, candidata real a pagina nueva.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-33"
            ]
          },
          {
            "id": "cg4",
            "topic": "Taquillas inteligentes (solucion general mueble+cerradura+PIN/RFID/app)",
            "relatedKeyword": "taquillas inteligentes",
            "rationale": "Distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); hueco real detectado pero con riesgo de canibalizacion documentado y pendiente de aprobacion visual real antes de publicar.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-34"
            ]
          },
          {
            "id": "cg5",
            "topic": "Taquillas para gimnasios",
            "relatedKeyword": "taquillas para gimnasios",
            "rationale": "Keyword objetivo comercial de prioridad alta sin ningun action item ni cluster que la ataque en el contexto recibido; posible hueco estrategico no detectado todavia por el pipeline de clustering.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-28"
            ]
          },
          {
            "id": "cg6",
            "topic": "Lockers inteligentes",
            "relatedKeyword": "lockers inteligentes",
            "rationale": "Keyword objetivo comercial de prioridad alta sin action item ni cluster asociado; no coincide con los matchPatterns de ningun cluster existente (ni taquillas_inteligentes_general ni cerraduras_inteligentes_taquillas la cubren literalmente), por lo que su cobertura real es incierta.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-29"
            ]
          },
          {
            "id": "cg7",
            "topic": "Digitalizacion de taquillas (contenido informacional top-of-funnel)",
            "relatedKeyword": "digitalizacion de taquillas",
            "rationale": "Keyword objetivo informacional sin action item ni cluster asociado; posible pieza de contenido informativo de soporte para el cluster de cerraduras/taquillas inteligentes.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-30"
            ]
          }
        ],
        "internalLinkRecommendations": [
          {
            "id": "il1",
            "fromPage": "https://zentrylockers.com/taquillas-melamina/",
            "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "anchorTextSuggestion": "taquillas de melamina con puertas fenolicas",
            "rationale": "Ambas paginas estan deliberadamente diferenciadas (material generico vs. combinacion especifica) segun decision O29.1; enlazarlas entre si ayuda a usuarios y motores a distinguir la intencion y reduce el riesgo de que vuelva a producirse el enrutado erroneo detectado en f2/o3.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-10",
              "ev-11"
            ]
          },
          {
            "id": "il2",
            "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "toPage": "/cerraduras-para-taquillas/",
            "anchorTextSuggestion": "ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO",
            "rationale": "La pagina informativa de cerraduras inteligentes puede canalizar la intencion comercial hacia el catalogo de producto que el propio cluster identifica como su version transaccional diferenciada, mejorando la conversion sin diluir el enfoque informativo de la pagina origen.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev-21"
            ]
          },
          {
            "id": "il3",
            "fromPage": "https://zentrylockers.com/taquillas-melamina/",
            "toPage": "https://zentrylockers.com/taquillas-fenolicas/",
            "anchorTextSuggestion": "comparar con taquillas fenolicas",
            "rationale": "Ambas son paginas de material de producto dentro del mismo catalogo comercial; un enlace cruzado de comparacion de materiales puede reducir el rebote de usuarios indecisos entre acabados sin crear contenido nuevo.",
            "basis": "inference",
            "evidenceRefs": [
              "ev-06",
              "ev-24"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "rank": 1,
            "title": "Corregir el enrutado de 'cerraduras inteligentes para centros deportivos / gimnasios' antes de invertir en contenido (URL en papelera con 301)",
            "relatedIds": [
              "f1",
              "o2",
              "ti1"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "high"
          },
          {
            "rank": 2,
            "title": "Cerrar/reenrutar los action items mal enrutados de 'taquillas melamina/de melamina' hacia /taquillas-melamina/ segun la decision O29.1 ya aprobada",
            "relatedIds": [
              "f2",
              "o3"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "medium"
          },
          {
            "rank": 3,
            "title": "Optimizacion on-page de 'cerraduras inteligentes para taquillas' (quick win de alta prioridad, a un empujon de top 10)",
            "relatedIds": [
              "o1"
            ],
            "priority": "high",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 4,
            "title": "Refuerzo consolidado de contenido y metas para /taquillas-melamina/ (melamina, de melamina, taquilla madera, vestuarios de melamina)",
            "relatedIds": [
              "o4",
              "o5",
              "o6",
              "o7"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 5,
            "title": "Refuerzo consolidado de contenido y metas para /taquillas-para-colegios/, /cerraduras-inteligentes-taquillas/ y /taquillas-para-hospitales/",
            "relatedIds": [
              "o8",
              "o9",
              "o11",
              "o12",
              "o13",
              "o14"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 6,
            "title": "Publicar a produccion los content gaps ya validados en staging (taquillas metalicas, taquillas para vestuarios, taquillas para universidades)",
            "relatedIds": [
              "cg1",
              "cg2",
              "cg3"
            ],
            "priority": "medium",
            "effort": "low",
            "impact": "medium"
          },
          {
            "rank": 7,
            "title": "Revision estrategica de las keywords objetivo de alta prioridad sin cobertura ('taquillas para gimnasios', 'lockers inteligentes')",
            "relatedIds": [
              "f4",
              "cg5",
              "cg6"
            ],
            "priority": "high",
            "effort": "high",
            "impact": "high"
          },
          {
            "rank": 8,
            "title": "Auditoria de meta titles/descriptions para corregir el patron sistemico de CTR 0%",
            "relatedIds": [
              "f6",
              "ti2"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 9,
            "title": "Implementar enlazado interno cruzado entre paginas de materiales/intencion relacionadas",
            "relatedIds": [
              "il1",
              "il2",
              "il3"
            ],
            "priority": "low",
            "effort": "low",
            "impact": "low"
          }
        ],
        "evidence": [
          {
            "id": "ev-01",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "actionItem quick_win, priority high, posicion actual 20.4, objetivo 10, 46 impresiones."
          },
          {
            "id": "ev-02",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "actionItem future_opportunity+low_ctr, priority high, posicion actual 37.8, 30 impresiones, CTR 0%."
          },
          {
            "id": "ev-03",
            "source": "cluster_catalog",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "cluster cerraduras_inteligentes_centros_deportivos, action=reject; URL objetivo en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/."
          },
          {
            "id": "ev-04",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "actionItem future_opportunity+low_ctr, 20 impresiones."
          },
          {
            "id": "ev-05",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "actionItem future_opportunity+low_ctr, posicion 31.1, 20 impresiones."
          },
          {
            "id": "ev-06",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "actionItem quick_win+low_ctr, priority medium, posicion 30.0, 83 impresiones, CTR 0%."
          },
          {
            "id": "ev-07",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "actionItem quick_win+low_ctr, posicion 28.8, 73 impresiones, CTR 0%."
          },
          {
            "id": "ev-08",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "actionItem future_opportunity+low_ctr, posicion 43.3, 60 impresiones."
          },
          {
            "id": "ev-09",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "actionItem future_opportunity+low_ctr, posicion 43.2, 50 impresiones."
          },
          {
            "id": "ev-10",
            "source": "cluster_catalog",
            "keyword": "taquillas melamina / taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "cluster taquillas_melamina_fenolico: decision O29.1 aprobada, la keyword generica 'melamina' ya no debe apuntar aqui; action items asi se consideran mal enrutados y se cierran via script o291-resolve-melamina-cannibalization.ts."
          },
          {
            "id": "ev-11",
            "source": "cluster_catalog",
            "keyword": "taquillas melamina / taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "cluster taquillas_melamina: pagina general de material, decision O29.1, incluye explicitamente 'taquilla madera' como variante valida."
          },
          {
            "id": "ev-12",
            "source": "job_data",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "actionItem future_opportunity+low_ctr, 46 impresiones."
          },
          {
            "id": "ev-13",
            "source": "job_data",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "actionItem quick_win+low_ctr, posicion 27.4, 27 impresiones."
          },
          {
            "id": "ev-14",
            "source": "job_data",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "actionItem quick_win+low_ctr, posicion 25.1, 39 impresiones, CTR 0%."
          },
          {
            "id": "ev-15",
            "source": "job_data",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "actionItem future_opportunity+low_ctr, posicion 33.3, 29 impresiones."
          },
          {
            "id": "ev-16",
            "source": "cluster_catalog",
            "keyword": "taquillas colegios / taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "cluster taquillas_colegios_escolares: colegios/escolares tratados como misma intencion, una sola pagina real."
          },
          {
            "id": "ev-17",
            "source": "job_data",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "description": "actionItem future_opportunity+low_ctr, posicion 65.9, 34 impresiones."
          },
          {
            "id": "ev-18",
            "source": "cluster_catalog",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "description": "cluster taquillas_empresas_personal: 'personal' tratado como sinonimo de 'empresas'."
          },
          {
            "id": "ev-19",
            "source": "job_data",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "actionItem future_opportunity+low_ctr, posicion 34.4, 31 impresiones."
          },
          {
            "id": "ev-20",
            "source": "job_data",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "actionItem quick_win+low_ctr, posicion 24.6, 26 impresiones."
          },
          {
            "id": "ev-21",
            "source": "cluster_catalog",
            "keyword": "cerraduras inteligentes/electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "cluster cerraduras_inteligentes_taquillas, searchIntent=informativo, decision update_existing_page, diferenciada de /cerraduras-para-taquillas/ (catalogo comercial ARES/ORBIS/BOXIS/NEO)."
          },
          {
            "id": "ev-22",
            "source": "job_data",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "actionItem future_opportunity+low_ctr, posicion 73.8, 29 impresiones."
          },
          {
            "id": "ev-23",
            "source": "job_data",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "actionItem future_opportunity+low_ctr, posicion 83.6, 22 impresiones."
          },
          {
            "id": "ev-24",
            "source": "cluster_catalog",
            "keyword": "taquillas fenolicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "cluster taquillas_fenolicas: 'en Palencia' tratado como ruido geografico sin intencion local real, agrupado con el cluster generico."
          },
          {
            "id": "ev-25",
            "source": "job_data",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "actionItem quick_win, posicion 10.6, 22 impresiones."
          },
          {
            "id": "ev-26",
            "source": "job_data",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "actionItem quick_win+low_ctr, posicion 17.1, 22 impresiones."
          },
          {
            "id": "ev-27",
            "source": "target_keyword_catalog",
            "keyword": "cerraduras inteligentes para taquillas",
            "description": "catalogo de keywords objetivo: type=commercial, priority=high."
          },
          {
            "id": "ev-28",
            "source": "target_keyword_catalog",
            "keyword": "taquillas para gimnasios",
            "description": "catalogo de keywords objetivo: type=commercial, priority=high."
          },
          {
            "id": "ev-29",
            "source": "target_keyword_catalog",
            "keyword": "lockers inteligentes",
            "description": "catalogo de keywords objetivo: type=commercial, priority=high."
          },
          {
            "id": "ev-30",
            "source": "target_keyword_catalog",
            "keyword": "digitalizacion de taquillas",
            "description": "catalogo de keywords objetivo: type=informational, priority=medium."
          },
          {
            "id": "ev-31",
            "source": "cluster_catalog",
            "keyword": "taquillas metalicas",
            "description": "cluster taquillas_metalicas, action=new_page_candidate, sin pagina de produccion equivalente, staging 2105 ya creada y visualmente aprobada."
          },
          {
            "id": "ev-32",
            "source": "cluster_catalog",
            "keyword": "taquillas vestuarios",
            "description": "cluster taquillas_vestuarios, action=new_page_candidate, staging 2104 ya creada y visualmente aprobada."
          },
          {
            "id": "ev-33",
            "source": "cluster_catalog",
            "keyword": "taquillas universidad",
            "description": "cluster taquillas_universidad, action=new_page_candidate, staging 2110 ya creada y visualmente aprobada."
          },
          {
            "id": "ev-34",
            "source": "cluster_catalog",
            "keyword": "taquillas inteligentes",
            "description": "cluster taquillas_inteligentes_general, action=new_page_candidate, distinta del hardware de cierre, riesgo de canibalizacion documentado con cerraduras_inteligentes_taquillas, staging 2103 pendiente de aprobacion visual real."
          },
          {
            "id": "ev-35",
            "source": "cluster_catalog",
            "keyword": "comprar taquillas / soluciones de taquillas",
            "description": "cluster taquillas_comercial_generico, action=postpone, recomienda no crear paginas nuevas, mejorar CTA/enlazado interno en paginas existentes."
          },
          {
            "id": "ev-36",
            "source": "cluster_catalog",
            "keyword": "cerradura para / sistemas de cierre",
            "description": "clusters cerradura_para_fragmentos y sistemas_de_cierre_generico, action=reject, keywords truncadas/genericas con 0 impresiones, recomienda revisar limpieza de queries en SEO Watcher."
          },
          {
            "id": "ev-37",
            "source": "target_keyword_catalog",
            "keyword": "taquillas metalicas",
            "description": "catalogo de keywords objetivo: type=commercial, priority=medium."
          }
        ],
        "unknowns": [
          "No se dispone de datos de clics reales (solo impresiones y posicion media), por lo que el impacto de trafico potencial de cada oportunidad es una estimacion indirecta, no una cifra medida de conversion.",
          "No hay confirmacion en este contexto de si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ha ejecutado sobre estos action items concretos o si siguen pendientes de cierre.",
          "No se recibio informacion de crawl tecnico (velocidad de pagina, Core Web Vitals, indexabilidad real, sitemap) mas alla de lo que documentan los clusters sobre paginas en papelera/redirecciones -- cualquier problema tecnico adicional no puede evaluarse.",
          "No hay datos sobre si los staging drafts ya visualmente aprobados (2104, 2105, 2110, 2103) tienen fecha prevista de publicacion o bloqueos pendientes fuera de la aprobacion visual.",
          "No se recibio el contenido de los informes previos del SEO Watcher/SEO Director (solo sus rutas), por lo que no se puede contrastar este analisis con hallazgos anteriores."
        ]
      }
    },
    {
      "employee": "content-strategist",
      "status": "executed",
      "note": "content-strategist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": null,
      "output": {
        "contentOpportunity": {
          "title": "Landing mixta 'Industrial': mobiliario resistente + control de acceso para naves y fabricas",
          "summary": "La keyword 'industrial' capta interes B2B de sector industrial sin especificar si busca mueble o cerradura, por lo que conviene una landing puente que cualifique al visitante y lo derive a Zentry, Tukandado o ambos."
        },
        "targetAudience": "Responsable de compras, mantenimiento o PRL de una nave industrial, fabrica o almacen que necesita taquillas resistentes para el personal y/o un sistema de control de acceso para zonas restringidas o vestuarios.",
        "searchIntent": "commercial",
        "commercialIntent": "Captar trafico generico ligado al sector industrial y convertirlo en lead cualificado, derivando hacia solicitud de presupuesto de taquillas metalicas industriales (Zentry) o hacia informacion de cerraduras electronicas para ese mismo entorno (Tukandado), segun lo que el visitante indique al navegar la pagina.",
        "angle": "En vez de listar generalidades de 'taquillas industriales', la pieza actua como pagina puente/selector: usa el catalogo confirmado de materiales (metalica = maxima resistencia a impacto y uso intensivo) y de metodos de apertura (mecanica vs electronica) para ayudar al visitante a decidir en segundos si necesita mueble, cerradura o ambos, sin forzar la venta cruzada si su necesidad es solo una marca.",
        "contentType": "new_landing",
        "targetBrand": "mixed",
        "recommendedStructure": {
          "h1": "Mobiliario y control de acceso para entornos industriales",
          "sections": [
            {
              "heading": "¿Buscas mueble, cerradura o ambos?",
              "level": "H2",
              "purpose": "Cualificar de inmediato al visitante (llega por una keyword muy generica) y dirigirlo a la seccion Zentry, Tukandado o a la combinacion de ambas, evitando que abandone por no encontrar su caso rapido."
            },
            {
              "heading": "Solucion Zentry: taquillas para uso industrial",
              "level": "H2",
              "purpose": "Presentar el material metalico como opcion recomendada para entornos de uso intensivo (resistencia a impactos, acabado industrial), citando el catalogo confirmado de materiales, sin prometer precio ni plazo."
            },
            {
              "heading": "Solucion Tukandado: cerraduras para entornos industriales",
              "level": "H2",
              "purpose": "Explicar los metodos de apertura disponibles (mecanica sin mantenimiento electronico; electronica con PIN/tarjeta/app segun modelo) para que el visitante entienda que puede anadir control de acceso a taquillas nuevas o ya existentes."
            },
            {
              "heading": "Comparativa: apertura mecanica vs electronica",
              "level": "H3",
              "purpose": "Tabla comparativa (requisito de estructura de marca cuando se comparan opciones) que resuma sencillez/sin registro de uso (mecanica) frente a sin llave que perder/registro de accesos segun modelo (electronica), para apoyar la decision."
            },
            {
              "heading": "Como elegir segun tu caso",
              "level": "H2",
              "purpose": "Resumir 2-3 escenarios tipicos (solo mobiliario, solo control de acceso, ambos) y cerrar con la llamada a solicitar presupuesto/informacion segun el caso, sin inventar plazos ni condiciones."
            }
          ]
        },
        "ctaStrategy": {
          "primaryCta": "Ver taquillas industriales (Zentry)",
          "secondaryCta": "Ver cerraduras para entornos industriales (Tukandado)",
          "rationale": "El brandIntent es mixed_cross_sell y la keyword no revela si el interes es mueble o cerradura, asi que se mantiene el CTA doble ya sugerido en el contexto en vez de forzar un unico camino; cada CTA lleva a su propia via de conversion (presupuesto de mobiliario vs informacion/demo de control de acceso) sin contradecirse entre si."
        },
        "internalLinks": [
          {
            "anchorIdea": "Ver catalogo de taquillas industriales",
            "targetDescription": "Contenido/pagina de categoria Zentry sobre mobiliario (taquillas metalicas para uso industrial)",
            "isRealLink": false
          },
          {
            "anchorIdea": "Ver cerraduras electronicas Tukandado",
            "targetDescription": "Contenido/pagina de Tukandado sobre cerraduras electronicas (control de acceso)",
            "isRealLink": false
          }
        ],
        "supportingEvidence": [
          "brandRationale del contexto: 'No menciona explicitamente taquilla ni cerradura, pero tiene senales de contexto relevante (sector o material) que sugieren posible interes cruzado... Requiere revision manual para decidir Zentry vs Tukandado' -- justifica el enfoque de pagina puente/selector en vez de una landing mono-marca.",
          "clusterNote: 'No se detectaron otras keywords del backlog para formar cluster todavia' -- respalda tratar esta pieza como landing independiente por ahora, sin necesidad de desambiguar frente a otras paginas del cluster.",
          "currentAssumptions confirma que se asume que 'industrial' sigue siendo relevante y que el brief de origen sigue vigente -- no hay dato nuevo que contradiga la oportunidad, pero tampoco confirma volumen de busqueda real.",
          "secondaryKeywords viene vacio en el contexto, lo que refuerza que esta keyword aun no tiene variantes validadas -- limita la profundidad de contenido a lo que el catalogo de marca confirma (materiales, metodos de apertura), sin anadir subtemas no solicitados."
        ],
        "priority": "medium",
        "risksAndUnknowns": [
          "Riesgo ya identificado en el contexto: publicar contenido nuevo sin revisar el cluster SEO puede generar canibalizacion con paginas ya existentes.",
          "La keyword 'industrial' es una unica palabra muy generica (sin modificador tipo 'taquillas industriales' o 'cerradura industrial'); existe riesgo real de que el volumen de busqueda real no tenga intencion relacionada con mobiliario/control de acceso, o que la intencion predominante sea informativa/ajena al sector de Zentry/Tukandado.",
          "brandRationale marca explicitamente que 'requiere revision manual para decidir Zentry vs Tukandado' -- la clasificacion mixed_cross_sell de este brief es un punto de partida, no una decision cerrada; conviene validacion humana antes de ejecutar.",
          "currentAssumptions no confirma 'fabricante directo', garantia ni plazos de entrega para esta pagina -- el brief evita deliberadamente esas afirmaciones y remite a 'solicitar presupuesto'/'informacion' en el CTA; cualquier redactor posterior debe respetar esa misma restriccion.",
          "Existe un precedente humano reciente (rechazo de publicacion de paginas de staging similares) por considerarlas 'demasiado basicas y sin suficientes imagenes/fotografias'; aunque este brief es para una pagina nueva distinta, conviene que la ejecucion final cuide la riqueza visual/de contenido antes de plantear su paso a produccion."
        ],
        "reasoningNotes": [
          "Clasifique searchIntent como 'commercial' siguiendo la senal B2B que ya marca brandRationale, pero lo dejo explicitamente cuestionado en risksAndUnknowns porque una keyword de una sola palabra ('industrial') es demasiado ambigua para confirmar intencion sin mas datos.",
          "Amplie proposedStructureHint anadiendo una tabla comparativa (H3) mecanica vs electronica porque la skill de marca exige 'al menos una tabla comparativa cuando el contenido compara opciones', y esta landing compara explicitamente mobiliario vs cerradura y mecanica vs electronica.",
          "Mantuve el CTA doble de recommendedCtaHint en vez de forzar un unico CTA, porque brandIntent es mixed_cross_sell y no hay datos que indiquen que una de las dos marcas domine la demanda real de esta keyword.",
          "No afirme 'fabricante directo' ni garantias porque currentAssumptions no las confirma para esta pagina; use exclusivamente hechos de catalogo ya confirmados en la skill (materiales, metodos de apertura) como base del angulo."
        ]
      }
    },
    {
      "employee": "analytics-specialist",
      "status": "executed",
      "note": "analytics-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": "dept-2026-08-19T073039Z",
      "output": {
        "runSummary": {
          "departmentRunId": "dept-2026-08-19T073039Z",
          "reportGeneratedAt": "2026-08-19T07:30:59.399Z",
          "ga4Connected": true,
          "gtmConnected": true
        },
        "measurementFindings": [
          {
            "claimType": "FACT",
            "statement": "En esta pasada, ga4Connected y gtmConnected son true, y watcherWarnings esta vacio, es decir, analytics-watcher no genero avisos en esta lectura.",
            "evidenceIds": []
          },
          {
            "claimType": "FACT",
            "statement": "Del catalogo de 7 eventos clave, 6 se dispararon al menos una vez en el periodo 2026-07-21 a 2026-08-18 (generate_lead_form_submit, click_whatsapp, click_request_quote, click_catalog_download, view_quote_page, view_contact_page) y 1 no se disparo ninguna vez (click_phone).",
            "evidenceIds": [
              "E10",
              "E11",
              "E12",
              "E13",
              "E14",
              "E15",
              "E16"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "El contenedor GTM tiene un tag gaawe configurado para cada uno de los 7 eventos del catalogo, mas un tag base googtag, y ninguno de los 8 tags esta marcado como pausado, lo que sugiere una cobertura de tags completa a nivel de configuracion.",
            "evidenceIds": [
              "E20",
              "E22"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La suma de conversiones por canal en channelTraffic coincide exactamente con la suma de conversiones de los eventos clave del periodo, lo que sugiere que las conversiones reportadas por canal se construyen directamente a partir de estos 7 eventos, sin discrepancia numerica visible entre ambas vistas.",
            "evidenceIds": [
              "E24"
            ]
          }
        ],
        "funnelObservations": [
          {
            "claimType": "FACT",
            "statement": "En el periodo, view_quote_page se registro 12 veces y click_request_quote 66 veces.",
            "evidenceIds": [
              "E12",
              "E11"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "view_contact_page se registro 40 veces en el periodo, muy por encima de las 2 sesiones registradas con landing page '/contacto'.",
            "evidenceIds": [
              "E13",
              "E8"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La pagina '/solicitar-presupuesto/' no aparece en el listado de landing pages principales de GA4, aunque los eventos view_quote_page y click_request_quote (asociados por nombre a esa URL en los triggers de GTM) se dispararon 12 y 66 veces respectivamente, lo que indica que esos disparos ocurren en navegacion interna y no como entrada directa.",
            "evidenceIds": [
              "E9",
              "E12",
              "E11",
              "E23"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "generate_lead_form_submit se registro 6 veces con 6 conversiones en el periodo, muy por debajo de las 66 ocurrencias de click_request_quote.",
            "evidenceIds": [
              "E15",
              "E11"
            ]
          }
        ],
        "trafficObservations": [
          {
            "claimType": "FACT",
            "statement": "El canal Direct concentro 174 sesiones y 68 usuarios activos, por encima del resto de canales listados: Organic Search (10 sesiones), Referral (3), AI Assistant (2) y Unassigned (1).",
            "evidenceIds": [
              "E1",
              "E2",
              "E3",
              "E4",
              "E5"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "La landing page '/' concentro 116 de las sesiones registradas en el periodo, con una tasa de rebote del 32.8%.",
            "evidenceIds": [
              "E6"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El source/medium '(direct)/(none)' registro 174 sesiones, la misma cifra que el canal Direct en channelTraffic.",
            "evidenceIds": [
              "E17",
              "E1"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El canal AI Assistant (fuente chatgpt.com, medio ai-assistant) registro 2 sesiones y 0 conversiones en el periodo.",
            "evidenceIds": [
              "E4",
              "E19"
            ]
          }
        ],
        "conversionObservations": [
          {
            "claimType": "OBSERVATION",
            "statement": "El canal Direct aporto 81 de las conversiones totales entre los canales listados, frente a 4 de Organic Search, 2 de Referral, y 0 de AI Assistant y Unassigned.",
            "evidenceIds": [
              "E1",
              "E2",
              "E3",
              "E4",
              "E5"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "La suma de conversiones por canal (81+4+2+0+0=87) coincide con la suma de conversiones de los eventos clave (6+15+0+66+0+0+0=87).",
            "evidenceIds": [
              "E24"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Varias landing pages tuvieron sesiones registradas pero 0 conversiones en el periodo: /cerraduras-para-taquillas, /taquillas-metalicas, /digitalizacion-taquillas, /taquillas-para-colegios y /taquillas-para-empresas.",
            "evidenceIds": [
              "E25"
            ]
          }
        ],
        "trackingIssues": [
          {
            "claimType": "FACT",
            "statement": "El evento clave click_phone tiene fired=false, 0 occurrences y 0 conversions en el periodo, pese a que el contenedor GTM tiene un tag no pausado 'GA4 Event - click_phone' y un trigger linkClick llamado 'click_phone'.",
            "evidenceIds": [
              "E10",
              "E20"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "click_catalog_download, view_quote_page y view_contact_page se dispararon con ocurrencias (4, 12 y 40 respectivamente) pero registraron 0 conversiones, a diferencia de generate_lead_form_submit, click_whatsapp y click_request_quote, cuyas conversiones igualan sus ocurrencias.",
            "evidenceIds": [
              "E14",
              "E12",
              "E13",
              "E15",
              "E16",
              "E11"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El nombre de la version live del contenedor GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', texto que hace referencia a cambios sin publicar dentro de la version reportada como live.",
            "evidenceIds": [
              "E21"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El contexto entrega tags y triggers de GTM como listas separadas, sin ningun campo que indique que trigger dispara cada tag, por lo que la asociacion real tag-trigger no puede confirmarse con estos datos.",
            "evidenceIds": [
              "E22",
              "E23"
            ]
          }
        ],
        "anomalyCandidates": [
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page '/product/taquilla-2-puertas-modulo-1-melamina' registro 11 conversiones a partir de solo 4 sesiones en el periodo.",
            "evidenceIds": [
              "E7"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "El source/medium 'tagassistant.google.com / referral' produjo 2 conversiones a partir de 3 sesiones, con un nombre de dominio que coincide con la herramienta de depuracion de tags de Google.",
            "evidenceIds": [
              "E18"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "El canal Direct concentra la gran mayoria de sesiones y conversiones del periodo frente al resto de canales combinados.",
            "evidenceIds": [
              "E1",
              "E2",
              "E3",
              "E4",
              "E5"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "view_quote_page se registro 12 veces mientras que click_request_quote se registro 66 veces en el mismo periodo, es decir, mas ocurrencias del evento de clic que del evento de vista de pagina asociado por nombre.",
            "evidenceIds": [
              "E12",
              "E11"
            ]
          }
        ],
        "hypotheses": [
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_request_quote (66 ocurrencias) supere a view_quote_page (12 ocurrencias) es que el evento de clic se dispare tambien desde paginas distintas a la de presupuesto, y no exclusivamente tras una vista previa de esa pagina.",
            "evidenceIds": [
              "E12",
              "E11"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_phone no se haya disparado ninguna vez pese a existir tag y trigger configurados es que el elemento de clic a telefono no este presente actualmente en el sitio, o que el trigger no coincida con el elemento real de la pagina; esto no puede confirmarse con este contexto.",
            "evidenceIds": [
              "E10",
              "E20"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Las sesiones con source 'tagassistant.google.com' podrian corresponder a pruebas internas de configuracion de tags, dado el nombre del dominio, en lugar de trafico real de clientes, lo que podria estar afectando las cifras del canal Referral.",
            "evidenceIds": [
              "E18",
              "E3"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "La ausencia de conversiones en view_quote_page, view_contact_page y click_catalog_download, a diferencia de los demas eventos clave, podria deberse a que estos tres eventos no esten marcados como evento de conversion en la configuracion de GA4, y no necesariamente a un fallo de disparo.",
            "evidenceIds": [
              "E12",
              "E13",
              "E14"
            ]
          }
        ],
        "recommendedMeasurements": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView si el evento click_phone se dispara correctamente al interactuar con el elemento de telefono, dado que el tag y el trigger existen en GTM pero no se registraron ocurrencias en el periodo.",
            "evidenceIds": [
              "E10",
              "E20"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Confirmar en la configuracion de eventos de GA4 si view_quote_page, view_contact_page y click_catalog_download estan marcados como eventos de conversion, dado que registran ocurrencias pero 0 conversiones.",
            "evidenceIds": [
              "E12",
              "E13",
              "E14"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Documentar en GTM que trigger dispara cada tag, ya que el contexto actual no permite confirmar la asociacion tag-trigger real de los 8 tags y 7 triggers existentes.",
            "evidenceIds": [
              "E22",
              "E23"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Verificar el estado real de publicacion del contenedor GTM, dado que el nombre de la version live referencia cambios 'sin publicar, pendiente aprobacion Pau'.",
            "evidenceIds": [
              "E21"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Crear una segmentacion en GA4 que identifique por separado las sesiones con source 'tagassistant.google.com' para evitar mezclarlas con trafico real del canal Referral.",
            "evidenceIds": [
              "E18"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Construir una segmentacion o exploracion en GA4 que siga la secuencia view_quote_page - click_request_quote - generate_lead_form_submit para medir la tasa de avance real entre estos pasos del recorrido de presupuesto.",
            "evidenceIds": [
              "E12",
              "E11",
              "E15"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView el disparo de click_phone: es un evento del catalogo con tag y trigger configurados en GTM pero sin ninguna ocurrencia registrada en el periodo.",
            "evidenceIds": [
              "E10",
              "E20"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Verificar el estado real de publicacion del contenedor GTM, dado que el nombre de la version live incluye la referencia 'sin publicar, pendiente aprobacion Pau'.",
            "evidenceIds": [
              "E21"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Confirmar si view_quote_page, view_contact_page y click_catalog_download deben marcarse como eventos de conversion en GA4, dado que registran ocurrencias pero 0 conversiones.",
            "evidenceIds": [
              "E12",
              "E13",
              "E14"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Documentar la asociacion tag-trigger real en GTM para los 8 tags y 7 triggers existentes.",
            "evidenceIds": [
              "E22",
              "E23"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Segmentar en GA4 las sesiones procedentes de 'tagassistant.google.com' para separarlas del trafico real de Referral.",
            "evidenceIds": [
              "E18"
            ],
            "priority": "low"
          }
        ],
        "evidence": [
          {
            "id": "E1",
            "source": "ga4_channel_traffic",
            "description": "Canal Direct: 174 sesiones, 68 usuarios activos, 81 conversiones en el periodo 2026-07-21 a 2026-08-18."
          },
          {
            "id": "E2",
            "source": "ga4_channel_traffic",
            "description": "Canal Organic Search: 10 sesiones, 6 usuarios activos, 4 conversiones."
          },
          {
            "id": "E3",
            "source": "ga4_channel_traffic",
            "description": "Canal Referral: 3 sesiones, 1 usuario activo, 2 conversiones."
          },
          {
            "id": "E4",
            "source": "ga4_channel_traffic",
            "description": "Canal AI Assistant: 2 sesiones, 2 usuarios activos, 0 conversiones."
          },
          {
            "id": "E5",
            "source": "ga4_channel_traffic",
            "description": "Canal Unassigned: 1 sesion, 1 usuario activo, 0 conversiones."
          },
          {
            "id": "E6",
            "source": "ga4_landing_pages",
            "description": "Landing page '/': 116 sesiones, 58 conversiones, 32.8% de tasa de rebote."
          },
          {
            "id": "E7",
            "source": "ga4_landing_pages",
            "description": "Landing page '/product/taquilla-2-puertas-modulo-1-melamina': 4 sesiones, 11 conversiones, 25% de tasa de rebote."
          },
          {
            "id": "E8",
            "source": "ga4_landing_pages",
            "description": "Landing page '/contacto': 2 sesiones, 0 conversiones, 100% de tasa de rebote."
          },
          {
            "id": "E9",
            "source": "ga4_landing_pages",
            "description": "El listado de topLandingPages no incluye ninguna entrada para '/solicitar-presupuesto/'."
          },
          {
            "id": "E10",
            "source": "ga4_key_events",
            "description": "Evento clave click_phone: fired=false, occurrences=0, conversions=0."
          },
          {
            "id": "E11",
            "source": "ga4_key_events",
            "description": "Evento clave click_request_quote: fired=true, occurrences=66, conversions=66."
          },
          {
            "id": "E12",
            "source": "ga4_key_events",
            "description": "Evento clave view_quote_page: fired=true, occurrences=12, conversions=0."
          },
          {
            "id": "E13",
            "source": "ga4_key_events",
            "description": "Evento clave view_contact_page: fired=true, occurrences=40, conversions=0."
          },
          {
            "id": "E14",
            "source": "ga4_key_events",
            "description": "Evento clave click_catalog_download: fired=true, occurrences=4, conversions=0."
          },
          {
            "id": "E15",
            "source": "ga4_key_events",
            "description": "Evento clave generate_lead_form_submit: fired=true, occurrences=6, conversions=6."
          },
          {
            "id": "E16",
            "source": "ga4_key_events",
            "description": "Evento clave click_whatsapp: fired=true, occurrences=15, conversions=15."
          },
          {
            "id": "E17",
            "source": "ga4_source_medium",
            "description": "Source/medium '(direct)/(none)': 174 sesiones, 81 conversiones."
          },
          {
            "id": "E18",
            "source": "ga4_source_medium",
            "description": "Source/medium 'tagassistant.google.com/referral': 3 sesiones, 2 conversiones."
          },
          {
            "id": "E19",
            "source": "ga4_source_medium",
            "description": "Source/medium 'chatgpt.com/ai-assistant': 2 sesiones, 0 conversiones."
          },
          {
            "id": "E20",
            "source": "gtm_tags",
            "description": "Tag 'GA4 Event - click_phone', tipo gaawe, paused=false."
          },
          {
            "id": "E21",
            "source": "gtm_container",
            "description": "liveVersionName: 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)'."
          },
          {
            "id": "E22",
            "source": "gtm_tags",
            "description": "8 tags en total en el contenedor (7 gaawe + 1 googtag), ninguno marcado como paused=true."
          },
          {
            "id": "E23",
            "source": "gtm_triggers",
            "description": "7 triggers listados (tipos linkClick y pageview: click_phone, /solicitar-presupuesto/, click_whatsapp, Vista de una pagina - /gracias, click_catalog_download, Page Path equals /solicitar-presupuesto/, visita contacto) sin campo que indique a que tag esta asociado cada uno."
          },
          {
            "id": "E24",
            "source": "ga4_key_events",
            "description": "Suma de conversiones de los eventos clave: 6+15+0+66+0+0+0=87, igual a la suma de conversiones por canal: 81+4+2+0+0=87."
          },
          {
            "id": "E25",
            "source": "ga4_landing_pages",
            "description": "Landing pages con sesiones pero 0 conversiones: /cerraduras-para-taquillas (4 sesiones), /taquillas-metalicas (4), /digitalizacion-taquillas (3), /taquillas-para-colegios (3), /taquillas-para-empresas (3)."
          }
        ],
        "unknowns": [
          "No se indica que trigger dispara cada tag de GTM en el contexto entregado, por lo que no puede confirmarse la configuracion real de disparo de cada evento.",
          "No se especifica si view_quote_page, view_contact_page y click_catalog_download estan marcados como eventos de conversion en la configuracion de GA4.",
          "No se conoce el motivo por el que click_phone no registro ocurrencias en el periodo; el contexto no incluye datos de DebugView ni de errores de tag.",
          "No se puede confirmar si las sesiones de 'tagassistant.google.com' corresponden a pruebas internas o a trafico real, ya que el contexto no distingue trafico de prueba.",
          "No se dispone de datos de periodos anteriores en el contexto para comparar tendencias o confirmar si las cifras actuales (por ejemplo, Direct con 174 sesiones) son atipicas respecto al historico.",
          "No se indica el motivo por el que el nombre de la version live de GTM incluye la referencia 'sin publicar, pendiente aprobacion Pau'."
        ]
      }
    },
    {
      "employee": "sem-specialist",
      "status": "not_available",
      "note": "sem-specialist queda EXPLICITAMENTE FUERA de esta fase (pendiente / temporalmente no disponible). No hay ninguna senal de SEM/Google Ads en esta pasada: no asumas gasto, CPC, impresiones, campanas activas ni ningun otro dato de Ads, y no trates su ausencia como si SEM estuviera sano o vacio. Su ausencia NUNCA bloquea esta pasada.",
      "sourceRunId": null
    }
  ]
}
```

Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.

# Prompt preparado para growth-director-v2 -- pasada coordinada del departamento dept-2026-08-17T074357Z

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

Esta ejecucion forma parte de UNA pasada coordinada del departamento (departmentRunId de coordinacion: `dept-2026-08-17T074357Z`). Las siguientes reglas son OBLIGATORIAS y tienen prioridad sobre cualquier suposicion propia:

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
  "generatedAt": "2026-08-17T07:54:08.774Z",
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
    "totalActions": 115,
    "liveActionCount": 105,
    "byStatus": {
      "approved": 6,
      "snoozed": 4,
      "auto_approved_for_planning": 99,
      "rejected": 6
    },
    "byPriority": {
      "high": 8,
      "medium": 97
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
    "total": 114,
    "readyForReviewCount": 113,
    "byCategory": {
      "cro": 11,
      "seo": 22,
      "competitor_gap": 21,
      "sem": 2,
      "content": 57,
      "analytics": 1
    },
    "byBrand": {
      "both": 42,
      "zentry": 60,
      "tukandado": 12
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
    "totalJobSnapshots": 2036,
    "latestRunId": "seo-watcher-2026-08-17T074406Z",
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
      "description": "seo-specialist (salida real de esta pasada): Datos live de Search Console de esta misma pasada (36 jobs, run seo-watcher-2026-08-17T074406Z). El backlog de action items es mayoritariamente solido, pero aparecen dos problemas de enrutado que conviene resolver antes de ejecutar nada: (... [findings=6, opportunities=19, technicalIssues=2, contentGaps=4, prioritizedActions=8]"
    },
    {
      "ref": "dept-seo-action-1",
      "description": "seo-specialist, accion priorizada #1: \"Corregir el enrutado de tareas hacia la pagina obsoleta /cerraduras/ (en papelera, con 301 a /cerraduras-para-taquillas/)\" (priority=high, impact=high, effort=low, relatedIds=F1/O2/O18/T1)."
    },
    {
      "ref": "dept-seo-action-2",
      "description": "seo-specialist, accion priorizada #2: \"Cerrar/reenrutar los action items de melamina generica mal enrutados a /taquillas-melamina-fenolico/ segun la decision O29.1 ya aprobada\" (priority=high, impact=high, effort=low, relatedIds=F2/O5/O6)."
    },
    {
      "ref": "dept-seo-action-3",
      "description": "seo-specialist, accion priorizada #3: \"Decidir un cluster/target unico para 'cerraduras sostenibles para gimnasios' antes de crear contenido\" (priority=medium, impact=medium, effort=low, relatedIds=F3/O18/O19)."
    },
    {
      "ref": "dept-seo-action-4",
      "description": "seo-specialist, accion priorizada #4: \"Ejecutar los quick wins de on-page en paginas cercanas a top10 (cerraduras inteligentes para taquillas, taquillas colegios, cerraduras electronicas para taquil...\" (priority=high, impact=medium, effort=medium, relatedIds=O1/O4/O8/O12/O15/O16/O17)."
    },
    {
      "ref": "dept-seo-action-5",
      "description": "seo-specialist, accion priorizada #5: \"Revisar y reescribir meta titles/descriptions en las paginas con CTR 0% sistematico\" (priority=medium, impact=medium, effort=medium, relatedIds=F4/T2)."
    },
    {
      "ref": "dept-seo-action-6",
      "description": "seo-specialist, accion priorizada #6: \"Publicar a produccion las paginas nuevas ya aprobadas en staging (taquillas metalicas, vestuarios, universidades)\" (priority=medium, impact=high, effort=medium, relatedIds=F6/C4)."
    },
    {
      "ref": "dept-seo-action-7",
      "description": "seo-specialist, accion priorizada #7: \"Evaluar cobertura de contenido para keywords objetivo de alta prioridad sin cluster/actionItem (taquillas para gimnasios, lockers inteligentes)\" (priority=medium, impact=medium, effort=high, relatedIds=F5/C1/C2)."
    },
    {
      "ref": "dept-seo-action-8",
      "description": "seo-specialist, accion priorizada #8: \"Implementar el enlazado interno recomendado entre paginas diferenciadas (cerraduras informativo-comercial, melamina generico-fenolico, empresas-oficinas)\" (priority=low, impact=medium, effort=low, relatedIds=L1/L2/L3)."
    },
    {
      "ref": "dept-seo-opportunity-1",
      "description": "seo-specialist, oportunidad (quick_win, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para taquillas\" / pagina \"https://zentrylockers.com/cerraduras-inteligentes-taquillas/\": Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10. Target confirmado como correc..."
    },
    {
      "ref": "dept-seo-opportunity-2",
      "description": "seo-specialist, oportunidad (technical, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para centros deportivos\" / pagina \"https://zentrylockers.com/cerraduras/\": No ejecutar el on-page tal cual: /cerraduras/ esta en papelera con redireccion 301 real a /cerraduras-para-taquillas/. Antes de cualquier trabajo de contenido, decidir con Pau el ..."
    },
    {
      "ref": "dept-seo-opportunity-3",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"taquillas melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Reforzar contenido y snippet de /taquillas-melamina/ para 'taquillas melamina' (86 impresiones, CTR 0%); target correcto confirmado por el cluster taquillas_melamina."
    },
    {
      "ref": "dept-seo-opportunity-4",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Reforzar H1/H2, contenido y meta title/description en /taquillas-melamina/ para pasar de posicion 28.7 a top 10."
    },
    {
      "ref": "dept-seo-opportunity-5",
      "description": "seo-specialist, oportunidad (cannibalization, priority=medium, basis=evidence) sobre keyword \"taquillas melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina-fenolico/\": No ejecutar como landing nueva: segun la decision O29.1 esta keyword generica esta mal enrutada a esta URL de combinacion especifica. Cerrar/reasignar este actionId a /taquillas-m..."
    },
    {
      "ref": "dept-seo-opportunity-6",
      "description": "seo-specialist, oportunidad (cannibalization, priority=medium, basis=evidence) sobre keyword \"taquillas de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina-fenolico/\": No ejecutar como landing nueva: mismo caso de mal enrutado que 'taquillas melamina'; cerrar/reasignar a /taquillas-melamina/."
    },
    {
      "ref": "dept-seo-opportunity-7",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"taquilla madera\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Crear o ampliar seccion de contenido de soporte en /taquillas-melamina/ para 'taquilla madera' (acabado melamina que imita madera), alineado con la decision del cluster taquillas_..."
    },
    {
      "ref": "dept-seo-opportunity-8",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas colegios\" / pagina \"https://zentrylockers.com/taquillas-para-colegios/\": Reforzar H1/H2, contenido y meta title/description en /taquillas-para-colegios/ para pasar de posicion 25.1 a top 10."
    },
    {
      "ref": "dept-content-summary",
      "description": "content-strategist (salida real de esta pasada): oportunidad \"Reforzar la página existente de taquillas fenólicas para captar búsquedas locales/de material en Palencia\" -- La página ya está indexada en https://zentrylockers.com/taquillas-fenolicas/ y puede enriquecerse con contenido y title/meta orientados a la keyword local 'taquillas fenólicas en palencia' sin necesidad de crear una página nueva. (priority=medium, contentType=landing_block, targetBrand=zentry, searchIntent=commercial)."
    },
    {
      "ref": "dept-content-structure",
      "description": "content-strategist, estructura propuesta: H1 \"Taquillas Fenólicas en Palencia\" con 6 seccion(es); audiencia \"Responsable de compras o mantenimiento de un colegio, polideportivo o gimnasio en la provincia de Palencia que necesita...\"; angulo \"Usar la resistencia a la humedad e impacto de la fenólica (hecho de catálogo confirmado) como argumento diferenciador frente a melamina/met...\"."
    },
    {
      "ref": "dept-content-cta",
      "description": "content-strategist, estrategia de CTA: primario \"Solicitar presupuesto sin compromiso\", secundario \"Consultar dudas técnicas sobre materiales antes de pedir presupuesto\". Motivo: La keyword tiene intención comercial pero no hay datos de precio/plazo confirmados, así que el CTA principal remite a presupuesto (coherente con recommendedCtaHint) y el secundari..."
    },
    {
      "ref": "dept-content-risks",
      "description": "content-strategist, riesgos/incognitas declarados (4): Riesgo de canibalización SEO con las páginas de melamina/colegios/escolares/comprar-taquillas del mismo cluster si no se coordina el enlazado interno (riesgo ya señalado en el contexto). | No hay ningún dato en currentAssumptions sobre cobertura o logística específica para Palencia; no se debe afir..."
    },
    {
      "ref": "dept-analytics-summary",
      "description": "analytics-specialist (salida real de esta pasada, snapshot del departmentRunId de datos \"dept-2026-08-17T074357Z\", ga4Connected=true, gtmConnected=true): measurementFindings=5, trafficObservations=5, conversionObservations=4, trackingIssues=4, prioritizedActions=6."
    },
    {
      "ref": "dept-analytics-action-1",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Validar en GA4 DebugView el disparo real del tag 'GA4 Event - click_phone', dado que el evento clave esperado no registro ninguna ocurrencia en el periodo pese a tener tag y trigger activos en GTM."
    },
    {
      "ref": "dept-analytics-action-2",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Confirmar el estado de publicacion/aprobacion de la version live de GTM 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', ya que su propio nombre sugiere cambios pendientes ..."
    },
    {
      "ref": "dept-analytics-action-3",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Revisar en GA4 Admin la marca de 'key events' para click_catalog_download, view_quote_page y view_contact_page, dado que se disparan pero no acumulan conversiones a diferencia de los demas eventos de..."
    },
    {
      "ref": "dept-analytics-action-4",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Segmentar o excluir las sesiones de tagassistant.google.com/referral del reporting de canal Referral, para evitar que trafico de una herramienta de depuracion distorsione las cifras de ese canal."
    },
    {
      "ref": "dept-analytics-action-5",
      "description": "analytics-specialist, accion priorizada (low, claimType=RECOMMENDATION): Construir una exploracion de embudo view_quote_page -> click_request_quote -> generate_lead_form_submit para entender por que click_request_quote supera en volumen a view_quote_page."
    },
    {
      "ref": "dept-analytics-action-6",
      "description": "analytics-specialist, accion priorizada (low, claimType=RECOMMENDATION): Revisar el detalle de sesion/evento de la landing page de producto con conversiones (11) superiores a sesiones (4) para descartar un problema de conteo o atribucion."
    },
    {
      "ref": "dept-analytics-tracking-issue-1",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El evento clave click_phone no se disparo en el periodo (fired=false, 0 occurrences, 0 conversions), aunque en GTM existe un tag ('GA4 Event - click_phone', no pausado) y un trigger ('click_phone', t..."
    },
    {
      "ref": "dept-analytics-tracking-issue-2",
      "description": "analytics-specialist, problema de medicion (claimType=OBSERVATION): click_catalog_download, view_quote_page y view_contact_page se dispararon en GA4 durante el periodo pero se registran con 0 conversiones, a diferencia de generate_lead_form_submit, click_whatsapp y c..."
    },
    {
      "ref": "dept-analytics-tracking-issue-3",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El nombre de la version live de GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', combinando la etiqueta de version en vivo con la frase 'sin publicar, pendiente apro..."
    },
    {
      "ref": "dept-analytics-tracking-issue-4",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): 3 sesiones del periodo se atribuyen a la fuente/medio tagassistant.google.com/referral, una herramienta de depuracion de tags de Google, y 2 de esas sesiones se registran como conversiones."
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
      "description": "105 accion(es) vivas en el backlog (por prioridad: high=8, medium=97). Total historico (todos los estados): 115. Por estado: approved=6, snoozed=4, auto_approved_for_planning=99, rejected=6."
    },
    {
      "ref": "actions-top",
      "description": "Top 8 acciones vivas por prioridad: \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"Competencia: keyword no cubierta \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"Contenido nuevo para \"taquillas inteligentes\"\" (high, auto_approved_for_planning); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved); \"SEO: \"cerraduras inteligentes para taquillas\" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/)\" (high, approved); \"CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/\" (high, approved)."
    },
    {
      "ref": "workorders-ready",
      "description": "113 work order(s) listas para revisar de 114 totales. Por categoria: cro=11, seo=22, competitor_gap=21, sem=2, content=57, analytics=1. Por marca: both=42, zentry=60, tukandado=12."
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
      "description": "Ultima ejecucion de SEO Watcher (runId \"seo-watcher-2026-08-17T074406Z\"): 36 job(s) propuestos. Total historico en data/jobs.jsonl: 2036."
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
  "departmentCoordinationRunId": "dept-2026-08-17T074357Z",
  "specialistInputs": [
    {
      "employee": "seo-specialist",
      "status": "executed",
      "note": "seo-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": null,
      "output": {
        "executiveSummary": "Datos live de Search Console de esta misma pasada (36 jobs, run seo-watcher-2026-08-17T074406Z). El backlog de action items es mayoritariamente solido, pero aparecen dos problemas de enrutado que conviene resolver antes de ejecutar nada: (1) dos keywords ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios') tienen tareas activas apuntando a https://zentrylockers.com/cerraduras/, pagina que el catalogo de clusters marca como en papelera con redireccion 301 real a /cerraduras-para-taquillas/; y (2) sigue habiendo action items de keywords genericas de melamina ('taquillas melamina', 'taquillas de melamina') apuntando a /taquillas-melamina-fenolico/ pese a que la decision O29.1 ya documenta esa combinacion como mal enrutada y con proceso de cierre definido. Ademas hay un patron sistemico de CTR 0% en la mayoria de oportunidades low_ctr, tres paginas nuevas ya aprobadas en staging (metalicas, vestuarios, universidades) listas para publicar, y dos keywords objetivo de alta prioridad ('taquillas para gimnasios', 'lockers inteligentes') sin ningun actionItem ni cluster que las cubra explicitamente. Se priorizan primero las correcciones de enrutado (bajo esfuerzo, alto impacto), luego los quick wins de posicion cercana a top10, y despues las mejoras de CTR y publicacion de contenido nuevo ya validado.",
        "findings": [
          {
            "id": "F1",
            "category": "technical",
            "description": "La pagina https://zentrylockers.com/cerraduras/ esta marcada en el catalogo de clusters como obsoleta (en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/), pero el backlog de action items sigue generando/dirigiendo tareas activas hacia ella para dos keywords distintas ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios'). Ejecutar trabajo on-page o de contenido sobre una URL en papelera desperdicia esfuerzo.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV3",
              "EV4",
              "EV5",
              "EV6"
            ]
          },
          {
            "id": "F2",
            "category": "cannibalization",
            "description": "La decision O29.1 (ya aprobada) resuelve la canibalizacion entre /taquillas-melamina/ (generico) y /taquillas-melamina-fenolico/ (combinacion especifica), indicando que cualquier actionId con la keyword generica 'melamina' apuntando a la pagina fenolico esta mal enrutado y debe cerrarse via script (scripts/o291-resolve-melamina-cannibalization.ts). Sin embargo, en este run siguen apareciendo action items activos ('taquillas melamina' y 'taquillas de melamina', ~113 impresiones combinadas) apuntando a /taquillas-melamina-fenolico/, lo que sugiere que el cierre automatico no se ha aplicado a estos items o que han vuelto a generarse.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV9",
              "EV10",
              "EV11",
              "EV12"
            ]
          },
          {
            "id": "F3",
            "category": "cannibalization",
            "description": "'cerraduras sostenibles para gimnasios' no coincide con ningun matchPattern de los clusters catalogados y el pipeline la ha repartido entre dos paginas distintas (/cerraduras/, obsoleta, y /cerraduras-inteligentes-taquillas/, viva). Sin una decision de cluster explicita, existe riesgo de duplicar esfuerzo o de canibalizacion entre ambas paginas para la misma consulta.",
            "basis": "inference",
            "evidenceRefs": [
              "EV5",
              "EV6"
            ]
          },
          {
            "id": "F4",
            "category": "structure",
            "description": "La gran mayoria de las oportunidades marcadas como low_ctr en este run comparten CTR actual de 0.00% pese a tener impresiones reales (entre 20 y 86 por keyword), lo que apunta a un problema sistemico de snippets (title/meta description) poco atractivos en varias paginas de producto/sector, no a un caso aislado.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV7",
              "EV8",
              "EV9",
              "EV10",
              "EV13",
              "EV14",
              "EV22",
              "EV23",
              "EV24",
              "EV25",
              "EV26",
              "EV27",
              "EV28"
            ]
          },
          {
            "id": "F5",
            "category": "keyword_strategy",
            "description": "Las keywords objetivo de alta prioridad 'taquillas para gimnasios' y 'lockers inteligentes' (catalogo estatico, tipo commercial) no tienen ningun actionItem activo en este run ni un cluster catalogado con targetUrl definida que las cubra explicitamente -- hueco entre la estrategia de negocio declarada y la ejecucion SEO actual.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV15",
              "EV16"
            ]
          },
          {
            "id": "F6",
            "category": "content",
            "description": "Cuatro clusters con action new_page_candidate (taquillas_metalicas, taquillas_vestuarios, taquillas_universidad, taquillas_inteligentes_general) ya tienen paginas de staging creadas; tres estan visualmente aprobadas y listas para pasar a produccion, mientras que taquillas_inteligentes_general sigue pendiente de aprobacion visual real.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV18",
              "EV19",
              "EV20",
              "EV21"
            ]
          }
        ],
        "opportunities": [
          {
            "id": "O1",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "high",
            "recommendedAction": "Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10. Target confirmado como correcto por el cluster cerraduras_inteligentes_taquillas.",
            "rationale": "47 impresiones en el periodo; posicion actual 20.5, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV1",
              "EV2"
            ]
          },
          {
            "id": "O2",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "kind": "technical",
            "priority": "high",
            "recommendedAction": "No ejecutar el on-page tal cual: /cerraduras/ esta en papelera con redireccion 301 real a /cerraduras-para-taquillas/. Antes de cualquier trabajo de contenido, decidir con Pau el target correcto (posiblemente /cerraduras-para-taquillas/ o el cluster cerraduras_inteligentes_taquillas) y corregir el backlog.",
            "rationale": "El cluster catalogado marca esta tarea como reject por apuntar a una URL obsoleta.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV3",
              "EV4"
            ]
          },
          {
            "id": "O3",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido y snippet de /taquillas-melamina/ para 'taquillas melamina' (86 impresiones, CTR 0%); target correcto confirmado por el cluster taquillas_melamina.",
            "rationale": "86 impresiones, posicion 30.1, lejos de primera pagina pero con volumen real.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV7",
              "EV11"
            ]
          },
          {
            "id": "O4",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2, contenido y meta title/description en /taquillas-melamina/ para pasar de posicion 28.7 a top 10.",
            "rationale": "74 impresiones, posicion actual 28.7, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV8",
              "EV11"
            ]
          },
          {
            "id": "O5",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "No ejecutar como landing nueva: segun la decision O29.1 esta keyword generica esta mal enrutada a esta URL de combinacion especifica. Cerrar/reasignar este actionId a /taquillas-melamina/ via el proceso ya definido.",
            "rationale": "62 impresiones; el cluster taquillas_melamina_fenolico documenta que la keyword generica melamina no debe apuntar aqui.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV9",
              "EV11",
              "EV12"
            ]
          },
          {
            "id": "O6",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "No ejecutar como landing nueva: mismo caso de mal enrutado que 'taquillas melamina'; cerrar/reasignar a /taquillas-melamina/.",
            "rationale": "51 impresiones; misma logica de canibalizacion resuelta documentada en el cluster.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV10",
              "EV11",
              "EV12"
            ]
          },
          {
            "id": "O7",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Crear o ampliar seccion de contenido de soporte en /taquillas-melamina/ para 'taquilla madera' (acabado melamina que imita madera), alineado con la decision del cluster taquillas_melamina.",
            "rationale": "50 impresiones, posicion 43.2, lejos de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV13",
              "EV11"
            ]
          },
          {
            "id": "O8",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2, contenido y meta title/description en /taquillas-para-colegios/ para pasar de posicion 25.1 a top 10.",
            "rationale": "40 impresiones, posicion 25.1, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV22"
            ]
          },
          {
            "id": "O9",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido de soporte para 'taquillas escolares' dentro de /taquillas-para-colegios/, cubierta por el mismo cluster que 'taquillas colegios'.",
            "rationale": "32 impresiones, posicion 33.8.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV23"
            ]
          },
          {
            "id": "O10",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido y snippet de /taquillas-para-empresas/ para 'taquilla para el personal', intencion comercial equivalente segun el cluster taquillas_empresas_personal.",
            "rationale": "34 impresiones, posicion 65.7, lejos de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV24"
            ]
          },
          {
            "id": "O11",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar contenido de /cerraduras-inteligentes-taquillas/ para esta variante, ya cubierta por el cluster cerraduras_inteligentes_taquillas.",
            "rationale": "32 impresiones, posicion 34.6.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV25",
              "EV2"
            ]
          },
          {
            "id": "O12",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2, contenido y meta title/description para pasar de posicion 24.5 a top 10.",
            "rationale": "27 impresiones, posicion 24.5, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV26",
              "EV2"
            ]
          },
          {
            "id": "O13",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Tratar como cluster generico de fenolicas (sin angulo geografico especifico, segun el catalogo) reforzando el contenido de /taquillas-fenolicas/, no crear una pagina geografica aparte.",
            "rationale": "29 impresiones, posicion 73.7, lejos de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV27"
            ]
          },
          {
            "id": "O14",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Mismo tratamiento que la variante Palencia: reforzar /taquillas-fenolicas/ sin crear pagina geografica dedicada.",
            "rationale": "23 impresiones, posicion 83.3, muy lejos de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV28"
            ]
          },
          {
            "id": "O15",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2, contenido y meta title/description en /taquillas-melamina/ para pasar de posicion 27.8 a top 10.",
            "rationale": "28 impresiones, posicion 27.8, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV14",
              "EV11"
            ]
          },
          {
            "id": "O16",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2, contenido y meta title/description para pasar de posicion 17.1 a top 10.",
            "rationale": "22 impresiones, posicion 17.1, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV29"
            ]
          },
          {
            "id": "O17",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Reforzar H1/H2 y contenido comercial en /taquillas-para-hospitales/ para pasar de posicion 10.6 a top 10.",
            "rationale": "21 impresiones, posicion 10.6, muy cerca de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV30"
            ]
          },
          {
            "id": "O18",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras/",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "No ejecutar directamente: pagina destino en papelera. Ademas la misma keyword tambien aparece apuntando a /cerraduras-inteligentes-taquillas/ en este mismo run. Decidir un cluster/target unico antes de actuar.",
            "rationale": "21 impresiones, posicion 30.9; keyword no catalogada en ningun cluster existente.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV5",
              "EV4",
              "EV6"
            ]
          },
          {
            "id": "O19",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Si se confirma este target como el correcto tras resolver la duplicidad con /cerraduras/, crear contenido de soporte sobre sostenibilidad aplicada a cerraduras de vestuarios/gimnasios.",
            "rationale": "20 impresiones, posicion 45.7, lejos de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV6",
              "EV2"
            ]
          }
        ],
        "technicalIssues": [
          {
            "id": "T1",
            "page": "https://zentrylockers.com/cerraduras/",
            "issue": "Pagina en papelera con redireccion 301 activa a /cerraduras-para-taquillas/, pero sigue siendo el target de tareas SEO activas en el backlog (2 keywords, 51 impresiones combinadas) -- riesgo de trabajar sobre una URL muerta.",
            "severity": "high",
            "basis": "evidence",
            "evidenceRefs": [
              "EV3",
              "EV4",
              "EV5",
              "EV6"
            ]
          },
          {
            "id": "T2",
            "page": "https://zentrylockers.com/taquillas-melamina/, https://zentrylockers.com/taquillas-para-colegios/, https://zentrylockers.com/taquillas-para-empresas/, https://zentrylockers.com/taquillas-fenolicas/, https://zentrylockers.com/taquillas-para-hospitales/",
            "issue": "CTR 0.00% sistematico en multiples paginas de producto/sector pese a impresiones reales -- indica snippets (title/meta description) poco atractivos a nivel de varias plantillas, no solo de una pagina puntual.",
            "severity": "medium",
            "basis": "inference",
            "evidenceRefs": [
              "EV7",
              "EV8",
              "EV22",
              "EV24",
              "EV27",
              "EV29"
            ]
          }
        ],
        "contentGaps": [
          {
            "id": "C1",
            "topic": "Taquillas para gimnasios",
            "relatedKeyword": "taquillas para gimnasios",
            "rationale": "Keyword objetivo comercial de prioridad alta en el catalogo estatico sin actionItem activo ni cluster catalogado con targetUrl -- no hay evidencia de contenido dedicado en este contexto.",
            "basis": "inference",
            "evidenceRefs": [
              "EV15"
            ]
          },
          {
            "id": "C2",
            "topic": "Lockers inteligentes (terminologia 'locker')",
            "relatedKeyword": "lockers inteligentes",
            "rationale": "Keyword objetivo comercial de prioridad alta; el cluster mas cercano (taquillas_inteligentes_general) solo cubre explicitamente la variante 'taquillas inteligentes', no 'lockers' -- posible gap terminologico no resuelto.",
            "basis": "inference",
            "evidenceRefs": [
              "EV16",
              "EV18"
            ]
          },
          {
            "id": "C3",
            "topic": "Digitalizacion de taquillas (contenido informativo)",
            "relatedKeyword": "digitalizacion de taquillas",
            "rationale": "Keyword informativa de prioridad media en el catalogo estatico sin cluster ni actionItem asociado -- posible pieza de contenido informativo/blog no cubierta todavia.",
            "basis": "inference",
            "evidenceRefs": [
              "EV17"
            ]
          },
          {
            "id": "C4",
            "topic": "Publicacion de paginas nuevas ya aprobadas en staging (metalicas, vestuarios, universidades)",
            "rationale": "Tres clusters new_page_candidate ya tienen staging visualmente aprobado (taquillas_metalicas, taquillas_vestuarios, taquillas_universidad), pendientes solo de pasar a produccion.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV19",
              "EV20",
              "EV21"
            ]
          }
        ],
        "internalLinkRecommendations": [
          {
            "id": "L1",
            "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "toPage": "https://zentrylockers.com/cerraduras-para-taquillas/",
            "anchorTextSuggestion": "ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO",
            "rationale": "El cluster documenta que esta pagina informativa se diferencia deliberadamente de /cerraduras-para-taquillas/ (catalogo comercial); enlazar desde la version informativa a la comercial completa el recorrido de usuario sin fusionar contenido.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV2",
              "EV31"
            ]
          },
          {
            "id": "L2",
            "fromPage": "https://zentrylockers.com/taquillas-melamina/",
            "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "anchorTextSuggestion": "taquillas de melamina con puertas fenolicas",
            "rationale": "Ambas paginas conviven deliberadamente como landings diferenciadas (generico vs combinacion especifica); un enlace contextual claro entre ambas refuerza la diferenciacion frente a la confusion/canibalizacion que se detecta en algunos action items actuales.",
            "basis": "inference",
            "evidenceRefs": [
              "EV11",
              "EV12"
            ]
          },
          {
            "id": "L3",
            "fromPage": "https://zentrylockers.com/taquillas-para-empresas/",
            "toPage": "https://zentrylockers.com/taquillas-para-oficinas/",
            "anchorTextSuggestion": "taquillas para oficinas",
            "rationale": "Ambos clusters comparten cliente final B2B pero distinto entorno fisico (empresa generica vs oficina); un enlace cruzado ayuda a la navegacion sin fusionar los clusters, tal como documenta el catalogo.",
            "basis": "evidence",
            "evidenceRefs": [
              "EV32"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "rank": 1,
            "title": "Corregir el enrutado de tareas hacia la pagina obsoleta /cerraduras/ (en papelera, con 301 a /cerraduras-para-taquillas/)",
            "relatedIds": [
              "F1",
              "O2",
              "O18",
              "T1"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "high"
          },
          {
            "rank": 2,
            "title": "Cerrar/reenrutar los action items de melamina generica mal enrutados a /taquillas-melamina-fenolico/ segun la decision O29.1 ya aprobada",
            "relatedIds": [
              "F2",
              "O5",
              "O6"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "high"
          },
          {
            "rank": 3,
            "title": "Decidir un cluster/target unico para 'cerraduras sostenibles para gimnasios' antes de crear contenido",
            "relatedIds": [
              "F3",
              "O18",
              "O19"
            ],
            "priority": "medium",
            "effort": "low",
            "impact": "medium"
          },
          {
            "rank": 4,
            "title": "Ejecutar los quick wins de on-page en paginas cercanas a top10 (cerraduras inteligentes para taquillas, taquillas colegios, cerraduras electronicas para taquillas, taquillas vestuarios de melamina, taquillas de melamina, taquillas para hospital, comprar taquillas para hospitales)",
            "relatedIds": [
              "O1",
              "O4",
              "O8",
              "O12",
              "O15",
              "O16",
              "O17"
            ],
            "priority": "high",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 5,
            "title": "Revisar y reescribir meta titles/descriptions en las paginas con CTR 0% sistematico",
            "relatedIds": [
              "F4",
              "T2"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 6,
            "title": "Publicar a produccion las paginas nuevas ya aprobadas en staging (taquillas metalicas, vestuarios, universidades)",
            "relatedIds": [
              "F6",
              "C4"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "high"
          },
          {
            "rank": 7,
            "title": "Evaluar cobertura de contenido para keywords objetivo de alta prioridad sin cluster/actionItem (taquillas para gimnasios, lockers inteligentes)",
            "relatedIds": [
              "F5",
              "C1",
              "C2"
            ],
            "priority": "medium",
            "effort": "high",
            "impact": "medium"
          },
          {
            "rank": 8,
            "title": "Implementar el enlazado interno recomendado entre paginas diferenciadas (cerraduras informativo-comercial, melamina generico-fenolico, empresas-oficinas)",
            "relatedIds": [
              "L1",
              "L2",
              "L3"
            ],
            "priority": "low",
            "effort": "low",
            "impact": "medium"
          }
        ],
        "evidence": [
          {
            "id": "EV1",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "quick_win, priority high, posicion actual 20.5, objetivo 10, 47 impresiones"
          },
          {
            "id": "EV2",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "Cluster cerraduras_inteligentes_taquillas, action update_existing_page, decision O27.2 de no fusionar con /cerraduras-para-taquillas/"
          },
          {
            "id": "EV3",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "future_opportunity+low_ctr, priority high, posicion 37.6, 31 impresiones, CTR 0%"
          },
          {
            "id": "EV4",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "Cluster cerraduras_inteligentes_centros_deportivos, action reject: pagina en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ (2060); la tarea del backlog apunta a una URL obsoleta"
          },
          {
            "id": "EV5",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "future_opportunity+low_ctr, 21 impresiones, posicion 30.9"
          },
          {
            "id": "EV6",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "future_opportunity+low_ctr, 20 impresiones, posicion 45.7"
          },
          {
            "id": "EV7",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "future_opportunity+low_ctr, 86 impresiones, posicion 30.1"
          },
          {
            "id": "EV8",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "quick_win+low_ctr, 74 impresiones, posicion 28.7"
          },
          {
            "id": "EV9",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "future_opportunity+low_ctr, 62 impresiones, posicion 43.1"
          },
          {
            "id": "EV10",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "future_opportunity+low_ctr, 51 impresiones, posicion 43.1"
          },
          {
            "id": "EV11",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "Cluster taquillas_melamina, decision O29.1 aprobada por Pau: la keyword generica de melamina apunta aqui; cualquier actionId con esta keyword generica apuntando a /taquillas-melamina-fenolico/ se considera mal enrutado y se cierra via scripts/o291-resolve-melamina-cannibalization.ts"
          },
          {
            "id": "EV12",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "Cluster taquillas_melamina_fenolico, action differentiate: pagina especifica de combinacion melamina+fenolico; la keyword generica melamina ya NO debe apuntar aqui"
          },
          {
            "id": "EV13",
            "source": "job_data",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "future_opportunity+low_ctr, 50 impresiones, posicion 43.2"
          },
          {
            "id": "EV14",
            "source": "job_data",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "quick_win+low_ctr, 28 impresiones, posicion 27.8"
          },
          {
            "id": "EV15",
            "source": "target_keyword_catalog",
            "keyword": "taquillas para gimnasios",
            "description": "commercial, priority high, catalogo estatico de keywords objetivo"
          },
          {
            "id": "EV16",
            "source": "target_keyword_catalog",
            "keyword": "lockers inteligentes",
            "description": "commercial, priority high, catalogo estatico de keywords objetivo"
          },
          {
            "id": "EV17",
            "source": "target_keyword_catalog",
            "keyword": "digitalizacion de taquillas",
            "description": "informational, priority medium, catalogo estatico de keywords objetivo"
          },
          {
            "id": "EV18",
            "source": "cluster_catalog",
            "description": "Cluster taquillas_inteligentes_general, action new_page_candidate, staging 2103 corregida en O28.6, pendiente de aprobacion visual real"
          },
          {
            "id": "EV19",
            "source": "cluster_catalog",
            "description": "Cluster taquillas_metalicas, action new_page_candidate, staging 2105 ya creada y visualmente aprobada"
          },
          {
            "id": "EV20",
            "source": "cluster_catalog",
            "description": "Cluster taquillas_vestuarios, action new_page_candidate, staging 2104 ya creada y visualmente aprobada"
          },
          {
            "id": "EV21",
            "source": "cluster_catalog",
            "description": "Cluster taquillas_universidad, action new_page_candidate, staging 2110 ya creada y visualmente aprobada"
          },
          {
            "id": "EV22",
            "source": "job_data",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "quick_win+low_ctr, 40 impresiones, posicion 25.1"
          },
          {
            "id": "EV23",
            "source": "job_data",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "future_opportunity+low_ctr, 32 impresiones, posicion 33.8"
          },
          {
            "id": "EV24",
            "source": "job_data",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "description": "future_opportunity+low_ctr, 34 impresiones, posicion 65.7"
          },
          {
            "id": "EV25",
            "source": "job_data",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "future_opportunity+low_ctr, 32 impresiones, posicion 34.6"
          },
          {
            "id": "EV26",
            "source": "job_data",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "quick_win+low_ctr, 27 impresiones, posicion 24.5"
          },
          {
            "id": "EV27",
            "source": "job_data",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "future_opportunity+low_ctr, 29 impresiones, posicion 73.7"
          },
          {
            "id": "EV28",
            "source": "job_data",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "future_opportunity+low_ctr, 23 impresiones, posicion 83.3"
          },
          {
            "id": "EV29",
            "source": "job_data",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "quick_win+low_ctr, 22 impresiones, posicion 17.1"
          },
          {
            "id": "EV30",
            "source": "job_data",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "quick_win, 21 impresiones, posicion 10.6"
          },
          {
            "id": "EV31",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "El reason del cluster cerraduras_inteligentes_taquillas menciona /cerraduras-para-taquillas/ (id 2060) como pagina de catalogo comercial ARES/ORBIS/BOXIS/NEO, distinta de la version informativa"
          },
          {
            "id": "EV32",
            "source": "cluster_catalog",
            "description": "Clusters taquillas_empresas_personal (update_existing_page) y taquillas_oficinas (update_existing_page): mismo cliente final B2B pero entornos distintos, mantenidos como clusters separados"
          }
        ],
        "unknowns": [
          "No se dispone de cifras exactas de clics por keyword mas alla de lo indicado en el rationale de cada action item (solo impresiones y posicion media); no puedo confirmar CTR exacto mas alla del 0.00% citado en algunos rationale.",
          "No hay informacion en este contexto sobre si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto sobre los action items de este run concreto -- no puedo confirmar si O5/O6 estan realmente pendientes de cierre o son residuales de una ejecucion anterior.",
          "No tengo acceso al contenido real de los informes en las rutas indicadas (seo-director-2026-08-17.md, seo-watcher-2026-08-17.md) mas alla de lo ya resumido en este contexto estructurado.",
          "No hay evidencia en este contexto sobre el estado de aprobacion final o fecha de publicacion prevista para las paginas de staging listadas (2103, 2104, 2105, 2110)."
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
          "title": "Reforzar la página existente de taquillas fenólicas para captar búsquedas locales/de material en Palencia",
          "summary": "La página ya está indexada en https://zentrylockers.com/taquillas-fenolicas/ y puede enriquecerse con contenido y title/meta orientados a la keyword local 'taquillas fenólicas en palencia' sin necesidad de crear una página nueva."
        },
        "targetAudience": "Responsable de compras o mantenimiento de un colegio, polideportivo o gimnasio en la provincia de Palencia que necesita taquillas resistentes a la humedad para vestuarios o zonas de duchas.",
        "searchIntent": "commercial",
        "commercialIntent": "Captar leads B2B locales (centros educativos, deportivos, gimnasios de la zona de Palencia) que ya han decidido el material (fenólica) y están comparando proveedores antes de pedir presupuesto.",
        "angle": "Usar la resistencia a la humedad e impacto de la fenólica (hecho de catálogo confirmado) como argumento diferenciador frente a melamina/metálica para entornos húmedos típicos de vestuarios/piscinas/polideportivos, sin fabricar ninguna promesa de logística o cobertura específica para Palencia que no esté confirmada en el contexto.",
        "contentType": "landing_block",
        "targetBrand": "zentry",
        "recommendedStructure": {
          "h1": "Taquillas Fenólicas en Palencia",
          "sections": [
            {
              "heading": "Taquillas fenólicas: resistencia para entornos húmedos",
              "level": "H2",
              "purpose": "Explicar por qué la fenólica es la opción técnica para vestuarios, duchas, piscinas o polideportivos, apoyándose en las propiedades de catálogo confirmadas (máxima resistencia a humedad e impacto)."
            },
            {
              "heading": "Materiales disponibles: fenólica, metálica y melamina",
              "level": "H2",
              "purpose": "Presentar los tres materiales de catálogo con sus usos recomendados para que el lector identifique si la fenólica encaja con su instalación."
            },
            {
              "heading": "Metálica vs fenólica vs melamina: ¿cuál elegir?",
              "level": "H3",
              "purpose": "Tabla comparativa breve (humedad, impacto, acabado, coste relativo) que ayude a decidir sin dar cifras de precio no confirmadas."
            },
            {
              "heading": "Cómo elegir la medida y configuración correcta",
              "level": "H2",
              "purpose": "Guiar en la elección de tamaño/número de compartimentos según el tipo de instalación (colegio, gimnasio), sin inventar dimensiones estándar no confirmadas."
            },
            {
              "heading": "Precios y presupuesto a medida",
              "level": "H2",
              "purpose": "Explicar que el precio depende de cantidad/configuración y remitir a solicitar presupuesto, evitando cualquier cifra o plazo no confirmado."
            },
            {
              "heading": "Preguntas frecuentes sobre taquillas fenólicas",
              "level": "H2",
              "purpose": "Resolver dudas habituales (durabilidad, mantenimiento, métodos de apertura disponibles) usando solo el catálogo de materiales/métodos confirmado."
            }
          ]
        },
        "ctaStrategy": {
          "primaryCta": "Solicitar presupuesto sin compromiso",
          "secondaryCta": "Consultar dudas técnicas sobre materiales antes de pedir presupuesto",
          "rationale": "La keyword tiene intención comercial pero no hay datos de precio/plazo confirmados, así que el CTA principal remite a presupuesto (coherente con recommendedCtaHint) y el secundario da una vía de contacto de menor compromiso para quien aún está comparando materiales."
        },
        "internalLinks": [
          {
            "anchorIdea": "taquillas de melamina",
            "targetDescription": "página de categoría/landing de taquillas de melamina, keyword relacionada del cluster: 'taquillas melamina' / 'taquillas de melamina'",
            "isRealLink": false
          },
          {
            "anchorIdea": "taquillas para colegios",
            "targetDescription": "página de categoría/landing de taquillas escolares, keyword relacionada del cluster: 'taquillas colegios' / 'taquillas escolares'",
            "isRealLink": false
          },
          {
            "anchorIdea": "comprar taquillas",
            "targetDescription": "landing principal de catálogo/compra de taquillas, keyword relacionada del cluster: 'comprar taquillas'",
            "isRealLink": false
          }
        ],
        "supportingEvidence": [
          "currentAssumptions confirma que la keyword 'taquillas fenólicas en palencia' se asume relevante y que la página https://zentrylockers.com/taquillas-fenolicas/ sigue existiendo en esa URL, lo que respalda actualizar en lugar de crear página nueva.",
          "clusterNote advierte de posible canibalización con 'taquillas melamina', 'taquillas de melamina', 'taquillas colegios', 'taquillas escolares' y 'comprar taquillas', lo que justifica el enlazado interno propuesto hacia esas páginas del cluster en vez de intentar posicionar todas esas keywords en esta misma pieza.",
          "brandRationale indica intención principal de mobiliario/taquillas sin mención de cerraduras, lo que confirma targetBrand zentry sin necesidad de cross-sell con Tukandado."
        ],
        "priority": "medium",
        "risksAndUnknowns": [
          "Riesgo de canibalización SEO con las páginas de melamina/colegios/escolares/comprar-taquillas del mismo cluster si no se coordina el enlazado interno (riesgo ya señalado en el contexto).",
          "No hay ningún dato en currentAssumptions sobre cobertura o logística específica para Palencia; no se debe afirmar 'servicio en Palencia' ni plazos de entrega concretos.",
          "No hay confirmación de precios, garantía ni condición de fabricante directo en el contexto: cualquier sección de precios debe remitir a presupuesto, no a cifras.",
          "Dependencia de que la página siga existiendo tal cual en la URL indicada (asunción explícita, no verificada por este agente)."
        ],
        "reasoningNotes": [
          "Cambié el contentType de 'Mejora de title/meta' (hint) a 'landing_block' porque el proposedStructureHint incluye una arquitectura de contenido completa (materiales, medidas, precios, FAQ) que va más allá de un simple ajuste de title/meta; se trata de enriquecer bloques de la página existente, no solo sus etiquetas.",
          "Evité replicar literalmente el primer H2 del hint ('¿Que es taquillas fenólicas en palencia?', gramaticalmente forzado por el keyword stuffing) y lo reformulé de forma editorial manteniendo el foco en material + uso, ya que el objetivo es utilidad real para el lector, no solo repetir la keyword.",
          "No incluí ninguna afirmación de logística o cobertura específica en Palencia porque currentAssumptions no confirma ningún dato de negocio sobre esa localidad; el ángulo se apoya solo en la propiedad técnica confirmada de la fenólica (resistencia a humedad/impacto).",
          "Mantuve priority en medium (heredada) porque, aunque la keyword es de nicho local, se trata de una actualización sobre una página ya indexada y de bajo riesgo/esfuerzo frente a crear contenido nuevo, sin motivo claro para subir o bajar la prioridad."
        ]
      }
    },
    {
      "employee": "analytics-specialist",
      "status": "executed",
      "note": "analytics-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": "dept-2026-08-17T074357Z",
      "output": {
        "runSummary": {
          "departmentRunId": "dept-2026-08-17T074357Z",
          "reportGeneratedAt": "2026-08-17T07:44:17.872Z",
          "ga4Connected": true,
          "gtmConnected": true
        },
        "measurementFindings": [
          {
            "claimType": "FACT",
            "statement": "El catalogo de eventos clave esperados incluye 7 eventos (generate_lead_form_submit, click_whatsapp, click_phone, click_request_quote, click_catalog_download, view_quote_page, view_contact_page); de ellos, click_phone aparece con fired=false y 0 occurrences en el periodo 2026-07-19 a 2026-08-16.",
            "evidenceIds": [
              "E10",
              "E26"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Tres eventos clave que si se dispararon (click_catalog_download, view_quote_page, view_contact_page) muestran 0 conversiones en GA4, mientras que otros cuatro (generate_lead_form_submit, click_whatsapp, click_request_quote) muestran conversions igual a occurrences.",
            "evidenceIds": [
              "E11",
              "E12",
              "E13",
              "E14",
              "E15",
              "E16"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El contenedor GTM 'www.zentrylockers.com' tiene 8 tags, todos con paused=false.",
            "evidenceIds": [
              "E24"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El nombre de la version live del contenedor GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)'.",
            "evidenceIds": [
              "E21"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una hipotesis es que el texto 'sin publicar, pendiente aprobacion' en el nombre de la version live podria indicar que algunos cambios de eventos CTA aun no estan completamente aprobados o consolidados, lo cual afectaria la fiabilidad de esos eventos concretos.",
            "evidenceIds": [
              "E21"
            ]
          }
        ],
        "funnelObservations": [
          {
            "claimType": "FACT",
            "statement": "En el periodo, view_quote_page se disparo 12 veces y generate_lead_form_submit se disparo 6 veces.",
            "evidenceIds": [
              "E12",
              "E13"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "click_request_quote (65 occurrences) es mayor que view_quote_page (12 occurrences) en el mismo periodo, por lo que el volumen de clics en 'solicitar presupuesto' no se corresponde con un flujo lineal de vista de pagina de presupuesto seguido de clic.",
            "evidenceIds": [
              "E11",
              "E12"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion es que click_request_quote se dispare desde enlaces a /solicitar-presupuesto/ ubicados en otras paginas del sitio (no solo tras ver la pagina de presupuesto), dado que el trigger '/solicitar-presupuesto/' en GTM es de tipo linkClick y no esta restringido a la vista previa de esa pagina.",
            "evidenceIds": [
              "E11",
              "E25"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "view_contact_page (38 occurrences) es el evento con mas ocurrencias despues de click_request_quote, mientras que generate_lead_form_submit solo registra 6, lo que marca una brecha grande entre esas dos etapas del recorrido reportado.",
            "evidenceIds": [
              "E16",
              "E13"
            ]
          }
        ],
        "trafficObservations": [
          {
            "claimType": "FACT",
            "statement": "El canal Direct concentra 170 sesiones frente a 6 de Organic Search, 3 de Referral, 3 de Unassigned y 2 de AI Assistant en el periodo reportado.",
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
            "statement": "La unica fuente/medio detras del canal Referral es tagassistant.google.com/referral (3 sesiones), que corresponde a la herramienta Tag Assistant de Google, no a un sitio de referencia externo tipico.",
            "evidenceIds": [
              "E3",
              "E18"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "La landing page '/' concentra 112 sesiones, muy por delante de la siguiente ('/configurador-bancos' con 10 sesiones).",
            "evidenceIds": [
              "E6"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "Existen dos filas de landing page con valores vacios o no configurados: una cadena vacia con 3 sesiones y 100% de rebote, y '(not set)' con 4 sesiones y 50% de rebote.",
            "evidenceIds": [
              "E8",
              "E9"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El canal AI Assistant (fuente chatgpt.com, medio ai-assistant) registro 2 sesiones y 0 conversiones en el periodo.",
            "evidenceIds": [
              "E5",
              "E19"
            ]
          }
        ],
        "conversionObservations": [
          {
            "claimType": "FACT",
            "statement": "El canal Direct registra 81 conversiones sobre 170 sesiones, el mayor numero de conversiones de todos los canales listados.",
            "evidenceIds": [
              "E1"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "Los canales Unassigned y AI Assistant registran 0 conversiones pese a tener sesiones en el periodo.",
            "evidenceIds": [
              "E4",
              "E5"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page '/product/taquilla-2-puertas-modulo-1-melamina' muestra 11 conversiones frente a solo 4 sesiones, es decir mas conversiones que sesiones.",
            "evidenceIds": [
              "E7"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "click_request_quote es el evento clave con mas conversiones (65), seguido de click_whatsapp (15) y generate_lead_form_submit (6); click_catalog_download, view_quote_page y view_contact_page muestran 0 conversiones pese a haberse disparado.",
            "evidenceIds": [
              "E11",
              "E14",
              "E13",
              "E15",
              "E12",
              "E16"
            ]
          }
        ],
        "trackingIssues": [
          {
            "claimType": "FACT",
            "statement": "El evento clave click_phone no se disparo en el periodo (fired=false, 0 occurrences, 0 conversions), aunque en GTM existe un tag ('GA4 Event - click_phone', no pausado) y un trigger ('click_phone', tipo linkClick) configurados para el.",
            "evidenceIds": [
              "E10",
              "E22",
              "E23"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "click_catalog_download, view_quote_page y view_contact_page se dispararon en GA4 durante el periodo pero se registran con 0 conversiones, a diferencia de generate_lead_form_submit, click_whatsapp y click_request_quote que muestran conversions igual a occurrences.",
            "evidenceIds": [
              "E12",
              "E13",
              "E15",
              "E16",
              "E11",
              "E14"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El nombre de la version live de GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', combinando la etiqueta de version en vivo con la frase 'sin publicar, pendiente aprobacion' en su propio nombre.",
            "evidenceIds": [
              "E21"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "3 sesiones del periodo se atribuyen a la fuente/medio tagassistant.google.com/referral, una herramienta de depuracion de tags de Google, y 2 de esas sesiones se registran como conversiones.",
            "evidenceIds": [
              "E18"
            ]
          }
        ],
        "anomalyCandidates": [
          {
            "claimType": "OBSERVATION",
            "statement": "click_request_quote (65 occurrences) supera a view_quote_page (12 occurrences) en el mismo periodo, un patron inusual si se esperara que click_request_quote solo ocurriera tras una vista de la pagina de presupuesto.",
            "evidenceIds": [
              "E11",
              "E12"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page '/product/taquilla-2-puertas-modulo-1-melamina' registra mas conversiones (11) que sesiones (4).",
            "evidenceIds": [
              "E7"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Las sesiones atribuidas a tagassistant.google.com/referral (una herramienta de depuracion) estan incluidas dentro del canal Referral e incluyen 2 conversiones.",
            "evidenceIds": [
              "E3",
              "E18"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El evento clave click_phone tiene cero ocurrencias en el periodo pese a contar con un tag y un trigger activos y no pausados en GTM.",
            "evidenceIds": [
              "E10",
              "E22",
              "E23"
            ]
          }
        ],
        "hypotheses": [
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_phone muestre 0 occurrences es que ningun visitante hiciera clic en un enlace de telefono durante este periodo concreto, en lugar de un problema de configuracion del tag/trigger, aunque esto no puede confirmarse con los datos disponibles.",
            "evidenceIds": [
              "E10",
              "E22",
              "E23"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_request_quote supere a view_quote_page es que el trigger se dispare en cualquier clic hacia /solicitar-presupuesto/ desde otras paginas, no solo despues de aterrizar en la pagina de presupuesto.",
            "evidenceIds": [
              "E11",
              "E12",
              "E25"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que las conversiones superen a las sesiones en la landing page de producto es que GA4 este contabilizando varios eventos marcados como conversion dentro de la misma sesion (por ejemplo varios click_request_quote o click_whatsapp), en lugar de una conversion por sesion.",
            "evidenceIds": [
              "E7",
              "E11",
              "E14"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de las sesiones de tagassistant.google.com/referral es que provengan de pruebas internas del contenedor GTM en lugar de trafico real de referencia de visitantes, aunque esto no puede confirmarse con los datos entregados.",
            "evidenceIds": [
              "E3",
              "E18"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_catalog_download, view_quote_page y view_contact_page muestren 0 conversiones pese a dispararse es que estos eventos no esten marcados actualmente como 'key events' (conversiones) en la configuracion de la propiedad GA4, a diferencia de los otros cuatro eventos.",
            "evidenceIds": [
              "E12",
              "E13",
              "E15",
              "E16"
            ]
          }
        ],
        "recommendedMeasurements": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView si el tag 'GA4 Event - click_phone' realmente se dispara al hacer clic en un enlace de telefono en vivo, para confirmar que el par tag/trigger funciona pese a haber registrado 0 occurrences en este periodo.",
            "evidenceIds": [
              "E10",
              "E22",
              "E23"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Revisar en GTM si la version live del contenedor 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)' esta realmente publicada y aprobada, para confirmar que los tags/triggers actualmente en vivo coinciden con lo previsto para produccion.",
            "evidenceIds": [
              "E21"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Comprobar en GA4 Admin si click_catalog_download, view_quote_page y view_contact_page estan deliberadamente excluidos de la marca de 'key events' (conversiones), o si deberian anadirse dado que forman parte del catalogo de eventos clave esperados.",
            "evidenceIds": [
              "E12",
              "E13",
              "E15",
              "E16",
              "E26"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Crear un segmento o filtro en GA4 que excluya las sesiones de tagassistant.google.com/referral de los informes de canal/trafico, para verificar si ese trafico es de pruebas internas y no de referencia externa.",
            "evidenceIds": [
              "E3",
              "E18"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Anadir una exploracion o informe de embudo en GA4 que trace la secuencia view_quote_page -> click_request_quote -> generate_lead_form_submit, para confirmar si click_request_quote ocurre en la pagina de presupuesto o en otras partes del sitio.",
            "evidenceIds": [
              "E12",
              "E11",
              "E13",
              "E25"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Verificar en GA4 DebugView la secuencia de landing page y eventos de '/product/taquilla-2-puertas-modulo-1-melamina' para confirmar como las conversiones (11) pueden superar a las sesiones (4) en esa pagina.",
            "evidenceIds": [
              "E7"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView el disparo real del tag 'GA4 Event - click_phone', dado que el evento clave esperado no registro ninguna ocurrencia en el periodo pese a tener tag y trigger activos en GTM.",
            "evidenceIds": [
              "E10",
              "E22",
              "E23"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Confirmar el estado de publicacion/aprobacion de la version live de GTM 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', ya que su propio nombre sugiere cambios pendientes que podrian afectar la fiabilidad de los eventos CTA en produccion.",
            "evidenceIds": [
              "E21"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Revisar en GA4 Admin la marca de 'key events' para click_catalog_download, view_quote_page y view_contact_page, dado que se disparan pero no acumulan conversiones a diferencia de los demas eventos del catalogo.",
            "evidenceIds": [
              "E12",
              "E13",
              "E15",
              "E16",
              "E26"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Segmentar o excluir las sesiones de tagassistant.google.com/referral del reporting de canal Referral, para evitar que trafico de una herramienta de depuracion distorsione las cifras de ese canal.",
            "evidenceIds": [
              "E3",
              "E18"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Construir una exploracion de embudo view_quote_page -> click_request_quote -> generate_lead_form_submit para entender por que click_request_quote supera en volumen a view_quote_page.",
            "evidenceIds": [
              "E12",
              "E11",
              "E13"
            ],
            "priority": "low"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Revisar el detalle de sesion/evento de la landing page de producto con conversiones (11) superiores a sesiones (4) para descartar un problema de conteo o atribucion.",
            "evidenceIds": [
              "E7"
            ],
            "priority": "low"
          }
        ],
        "evidence": [
          {
            "id": "E1",
            "source": "ga4_channel_traffic",
            "description": "Canal Direct en el periodo 2026-07-19 a 2026-08-16: 170 sesiones, 69 usuarios activos, 81 conversiones."
          },
          {
            "id": "E2",
            "source": "ga4_channel_traffic",
            "description": "Canal Organic Search: 6 sesiones, 6 usuarios activos, 3 conversiones."
          },
          {
            "id": "E3",
            "source": "ga4_channel_traffic",
            "description": "Canal Referral: 3 sesiones, 1 usuario activo, 2 conversiones."
          },
          {
            "id": "E4",
            "source": "ga4_channel_traffic",
            "description": "Canal Unassigned: 3 sesiones, 2 usuarios activos, 0 conversiones."
          },
          {
            "id": "E5",
            "source": "ga4_channel_traffic",
            "description": "Canal AI Assistant: 2 sesiones, 2 usuarios activos, 0 conversiones."
          },
          {
            "id": "E6",
            "source": "ga4_landing_pages",
            "description": "Landing page '/': 112 sesiones, 58 conversiones, 32.1% de rebote."
          },
          {
            "id": "E7",
            "source": "ga4_landing_pages",
            "description": "Landing page '/product/taquilla-2-puertas-modulo-1-melamina': 4 sesiones, 11 conversiones, 25% de rebote."
          },
          {
            "id": "E8",
            "source": "ga4_landing_pages",
            "description": "Landing page vacia (''): 3 sesiones, 0 conversiones, 100% de rebote."
          },
          {
            "id": "E9",
            "source": "ga4_landing_pages",
            "description": "Landing page '(not set)': 4 sesiones, 2 conversiones, 50% de rebote."
          },
          {
            "id": "E10",
            "source": "ga4_key_events",
            "description": "Evento click_phone: fired=false, 0 occurrences, 0 conversions."
          },
          {
            "id": "E11",
            "source": "ga4_key_events",
            "description": "Evento click_request_quote: fired=true, 65 occurrences, 65 conversions."
          },
          {
            "id": "E12",
            "source": "ga4_key_events",
            "description": "Evento view_quote_page: fired=true, 12 occurrences, 0 conversions."
          },
          {
            "id": "E13",
            "source": "ga4_key_events",
            "description": "Evento generate_lead_form_submit: fired=true, 6 occurrences, 6 conversions."
          },
          {
            "id": "E14",
            "source": "ga4_key_events",
            "description": "Evento click_whatsapp: fired=true, 15 occurrences, 15 conversions."
          },
          {
            "id": "E15",
            "source": "ga4_key_events",
            "description": "Evento click_catalog_download: fired=true, 3 occurrences, 0 conversions."
          },
          {
            "id": "E16",
            "source": "ga4_key_events",
            "description": "Evento view_contact_page: fired=true, 38 occurrences, 0 conversions."
          },
          {
            "id": "E17",
            "source": "ga4_source_medium",
            "description": "Fuente/medio (direct)/(none): 170 sesiones, 81 conversiones."
          },
          {
            "id": "E18",
            "source": "ga4_source_medium",
            "description": "Fuente/medio tagassistant.google.com/referral: 3 sesiones, 2 conversiones."
          },
          {
            "id": "E19",
            "source": "ga4_source_medium",
            "description": "Fuente/medio chatgpt.com/ai-assistant: 2 sesiones, 0 conversiones."
          },
          {
            "id": "E20",
            "source": "ga4_source_medium",
            "description": "Fuentes/medios organic: google/organic 5 sesiones y 3 conversiones; duckduckgo/organic 1 sesion y 0 conversiones."
          },
          {
            "id": "E21",
            "source": "gtm_container",
            "description": "liveVersionName del contenedor: 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)'."
          },
          {
            "id": "E22",
            "source": "gtm_tags",
            "description": "Tag 'GA4 Event - click_phone', tipo gaawe, paused=false."
          },
          {
            "id": "E23",
            "source": "gtm_triggers",
            "description": "Trigger 'click_phone', tipo linkClick."
          },
          {
            "id": "E24",
            "source": "gtm_tags",
            "description": "El contenedor tiene 8 tags en total, todos con paused=false."
          },
          {
            "id": "E25",
            "source": "gtm_triggers",
            "description": "Lista de 7 triggers, incluyendo '/solicitar-presupuesto/' (linkClick), 'Page Path equals /solicitar-presupuesto/' (pageview), 'Vista de una pagina - /gracias' (pageview) y 'visita contacto' (pageview)."
          },
          {
            "id": "E26",
            "source": "key_events_catalog",
            "description": "Catalogo de 7 eventos clave esperados: generate_lead_form_submit, click_whatsapp, click_phone, click_request_quote, click_catalog_download, view_quote_page, view_contact_page."
          }
        ],
        "unknowns": [
          "No se dispone de datos de periodos anteriores para comparar si estas cifras de sesiones/conversiones representan un aumento o una disminucion.",
          "No hay informacion de dispositivo, geografia o parametros de campana asociados al trafico por canal.",
          "No se indica explicitamente la correspondencia exacta entre cada tag y trigger de GTM y cada evento clave de GA4; la relacion se infiere por nombre, no se confirma en el contexto.",
          "No se confirma si la configuracion de 'key events' (conversiones) en GA4 fue modificada recientemente o excluye intencionadamente a click_catalog_download, view_quote_page y view_contact_page.",
          "No se confirma si las sesiones de tagassistant.google.com/referral corresponden a pruebas internas del equipo o a usuarios reales.",
          "No hay informacion sobre canales de pago (por ejemplo Google Ads) en el contexto entregado.",
          "No se confirma si el estado 'sin publicar, pendiente aprobacion' en el nombre de la version live de GTM refleja un estado real de publicacion pendiente o es solo una etiqueta de nomenclatura interna."
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

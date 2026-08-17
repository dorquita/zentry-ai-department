# Prompt preparado para growth-director-v2 -- pasada coordinada del departamento dept-2026-08-17T230452Z

Este fichero es la union de: (1) instrucciones del subagente, (2) reglas de la pasada COORDINADA del departamento, (3) contexto estructurado ya resuelto. El subagente no tiene herramientas -- todo lo que necesita esta aqui.

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

## 2. Reglas de esta pasada coordinada del departamento

Esta ejecucion forma parte de UNA pasada coordinada del departamento (departmentRunId de coordinacion: `dept-2026-08-17T230452Z`). Las siguientes reglas son OBLIGATORIAS y tienen prioridad sobre cualquier suposicion propia:

- Los `specialistInputs[]` del contexto son la salida REAL de seo-specialist, content-strategist y analytics-specialist producida en ESTA MISMA pasada coordinada, no un historico ni un ejemplo. Sintetiza sobre ellos: elimina duplicados entre canales, senala contradicciones entre especialistas de forma explicita, y prioriza.
- Un especialista cuyo `status` NO sea `executed` NO tiene datos en esta pasada. Prohibido rellenar ese hueco: ni con conocimiento general, ni con datos de otra pasada, ni con supuestos plausibles. Declaralo en `dependencies[]` con status `missing`/`partial` y, si afecta a una decision, tambien en `unknowns[]`.
- sem-specialist esta FUERA de esta fase (pendiente / no disponible). Debe aparecer en `dependencies[]` como `missing` y nunca como una senal de que SEM va bien o mal. No infieras nada sobre Google Ads.
- Cada `evidenceRefs` debe apuntar a un `ref` que exista en `evidenceCatalog` del contexto o que definas tu mismo en `evidence[]`. Las refs que empiezan por `dept-` corresponden a la salida real de los especialistas de esta pasada: usalas cuando una prioridad venga de ellos, para que el informe final pueda remontar cada prioridad hasta su origen.
- Si dos especialistas dicen cosas incompatibles, NO elijas en silencio: registra la contradiccion (en `bottlenecks[]` o `risks[]`, con las dos refs) y baja la `confidence` de cualquier prioridad que dependa de ella.
- Esta fase es READ / ANALYZE / PROPOSE. Ninguna prioridad tuya se aplica automaticamente a ningun sistema: son propuestas para revision humana.

---

## 3. DECISIONES HUMANAS ANTERIORES SOBRE ESTAS MISMAS PROPUESTAS

Estas propuestas ya se plantearon antes y una persona YA DECIDIO sobre ellas:
aprobandolas, rechazandolas o aplazandolas. Cuando hay motivo, aparece LITERAL,
entre comillas, tal como se escribio: no lo reinterpretes, no lo generalices a una
regla y no asumas nada que no diga el texto.
Lo ya APROBADO no hace falta volver a proponerlo como si fuera nuevo.
Trata cada entrada como evidencia de una decision humana ya tomada.

- "Resolver el enrutado roto de /cerraduras/ antes de invertir esfuerzo SEO sobre esa URL" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Cerrar los actionItems de canibalizacion de 'taquillas melamina' y revisar la aprobacion critica pendiente relacionada" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Ejecutar el quick win de mayor impacto: on-page de 'cerraduras inteligentes para taquillas'" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Reescribir meta title/description en las 7 paginas con CTR 0% e impresiones reales" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Validar el disparo de click_phone en GTM/GA4 antes de asumir que esa via de conversion esta perdida" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Coordinar el bloque de contenido 'Taquillas Inteligentes' de content-strategist con el cluster SEO ya existente antes de publicar" (version 1, aprobada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Sin motivo escrito: la persona la aprobo sin añadir texto.
- "Publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general)" (version 1, rechazada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z):
  Motivo textual: "Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion."

---

## 4. Contexto estructurado (DepartmentGrowthContext = GrowthDirectorV2Context + specialistInputs de esta pasada)

```json
{
  "departmentRunId": "growth-department-2026-08-14T111247Z",
  "hasDepartmentRunData": true,
  "generatedAt": "2026-08-17T23:15:40.968Z",
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
    "BACKLOG OPERATIVO VACIADO A PROPOSITO PARA ESTA PASADA. Los resumenes de acciones, work orders, change packs y solicitudes de aprobacion vienen a cero porque se han excluido deliberadamente, NO porque no exista historico ni porque haya fallado ninguna lectura. El historico se conserva integro para auditoria. Decide que merece hacerse AHORA a partir de los datos LIVE y de las salidas de los especialistas de esta misma pasada, no reciclando trabajo pendiente de pasadas anteriores. Si tu conclusion es que no hay ningun cambio suficientemente util o seguro ahora mismo, esa es una respuesta valida y correcta: no propongas trabajo para llenar el hueco.",
    "[staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas",
    "[staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas"
  ],
  "actionsSummary": {
    "totalActions": 0,
    "liveActionCount": 0,
    "byStatus": {},
    "byPriority": {},
    "topOpenActions": []
  },
  "workOrdersSummary": {
    "total": 0,
    "readyForReviewCount": 0,
    "byCategory": {},
    "byBrand": {}
  },
  "changePacksSummary": {
    "total": 0,
    "readyForReviewCount": 0,
    "byType": {}
  },
  "approvalRequestsSummary": {
    "pendingCount": 0,
    "byRiskLevel": {},
    "topPending": []
  },
  "jobsSummary": {
    "totalJobSnapshots": 2504,
    "latestRunId": "seo-watcher-2026-08-17T230501Z",
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
      "description": "seo-specialist (salida real de esta pasada): Con datos live de Search Console de esta misma pasada (36 jobs, 0h de antiguedad) cruzados contra el catalogo de clusters y de target keywords, el hallazgo mas urgente es que el backlog SEO sigue enviando esfuerzo de optimizacion hacia una... [findings=7, opportunities=23, technicalIssues=3, contentGaps=7, prioritizedActions=9]"
    },
    {
      "ref": "dept-seo-action-1",
      "description": "seo-specialist, accion priorizada #1: \"Corregir el enrutado obsoleto de /cerraduras/ antes de cualquier optimizacion\" (priority=high, impact=high, effort=low, relatedIds=f1/t1/opp2/opp16). Paginas citadas por esos relatedIds: https://zentrylockers.com/cerraduras/."
    },
    {
      "ref": "dept-seo-action-2",
      "description": "seo-specialist, accion priorizada #2: \"Cerrar la canibalizacion de melamina generica en /taquillas-melamina-fenolico/ via el script ya existente\" (priority=high, impact=medium, effort=low, relatedIds=f2/t2/opp4). Paginas citadas por esos relatedIds: https://zentrylockers.com/taquillas-melamina-fenolico/."
    },
    {
      "ref": "dept-seo-action-3",
      "description": "seo-specialist, accion priorizada #3: \"Optimizar on-page los quick wins de mayor volumen (H1/H2, profundidad, meta)\" (priority=high, impact=medium, effort=medium, relatedIds=opp1/opp3/opp6/opp11/opp12/opp14/opp15). Paginas citadas por esos relatedIds: https://zentrylockers.com/cerraduras-inteligentes-taquillas/ , https://zentrylockers.com/taquillas-melamina/ , https://zentrylockers.com/taquillas-para-colegios/ , https://zentrylockers.com/taquillas-para-hospitales/."
    },
    {
      "ref": "dept-seo-action-4",
      "description": "seo-specialist, accion priorizada #4: \"Reescribir meta titles/descriptions en las paginas con CTR 0% sistemico\" (priority=medium, impact=medium, effort=medium, relatedIds=f4/t3). Paginas citadas por esos relatedIds: multiples paginas del sitio (ver evidenceRefs)."
    },
    {
      "ref": "dept-seo-action-5",
      "description": "seo-specialist, accion priorizada #5: \"Publicar a produccion las paginas de staging ya aprobadas (taquillas metalicas, universidades, vestuarios)\" (priority=medium, impact=medium, effort=low, relatedIds=f5/cg1/cg2/cg3/opp17/opp18/opp19). Paginas citadas por esos relatedIds: ninguna (los elementos referenciados no declaran pagina)."
    },
    {
      "ref": "dept-seo-action-6",
      "description": "seo-specialist, accion priorizada #6: \"Decidir la pagina objetivo unica de \"cerraduras sostenibles para gimnasios\"\" (priority=medium, impact=low, effort=low, relatedIds=f3/opp16). Paginas citadas por esos relatedIds: ninguna (los elementos referenciados no declaran pagina)."
    },
    {
      "ref": "dept-seo-action-7",
      "description": "seo-specialist, accion priorizada #7: \"Resolver el riesgo de canibalizacion antes de publicar la solucion general de taquillas inteligentes\" (priority=medium, impact=medium, effort=medium, relatedIds=f6/cg4/opp20). Paginas citadas por esos relatedIds: ninguna (los elementos referenciados no declaran pagina)."
    },
    {
      "ref": "dept-seo-action-8",
      "description": "seo-specialist, accion priorizada #8: \"Evaluar cobertura de contenido para target keywords sin cluster (gimnasios, lockers inteligentes, digitalizacion)\" (priority=medium, impact=medium, effort=high, relatedIds=f7/cg5/cg6/cg7/opp21/opp22/opp23). Paginas citadas por esos relatedIds: ninguna (los elementos referenciados no declaran pagina)."
    },
    {
      "ref": "dept-seo-opportunity-1",
      "description": "seo-specialist, oportunidad (quick_win, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para taquillas\" / pagina \"https://zentrylockers.com/cerraduras-inteligentes-taquillas/\": Reforzar contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10."
    },
    {
      "ref": "dept-seo-opportunity-2",
      "description": "seo-specialist, oportunidad (technical, priority=high, basis=evidence) sobre keyword \"cerraduras inteligentes para centros deportivos\" / pagina \"https://zentrylockers.com/cerraduras/\": No optimizar la URL actual: definir con Pau si el objetivo correcto es /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (1865) antes de invertir en contenido nu..."
    },
    {
      "ref": "dept-seo-opportunity-3",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas de melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 28.7 a top 10."
    },
    {
      "ref": "dept-seo-opportunity-4",
      "description": "seo-specialist, oportunidad (cannibalization, priority=medium, basis=evidence) sobre keyword \"taquillas melamina\" / pagina \"https://zentrylockers.com/taquillas-melamina-fenolico/\": Cerrar/redirigir estos actionItems (taquillas melamina y taquillas de melamina apuntando a taquillas-melamina-fenolico) via el script o291-resolve-melamina-cannibalization.ts y re..."
    },
    {
      "ref": "dept-seo-opportunity-5",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"taquilla madera\" / pagina \"https://zentrylockers.com/taquillas-melamina/\": Reforzar la landing con contenido especifico para esta variante (el acabado melamina imita madera), arquitectura de enlazado interno y meta title/description dedicados."
    },
    {
      "ref": "dept-seo-opportunity-6",
      "description": "seo-specialist, oportunidad (quick_win, priority=medium, basis=evidence) sobre keyword \"taquillas colegios\" / pagina \"https://zentrylockers.com/taquillas-para-colegios/\": Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 25.1 a top 10."
    },
    {
      "ref": "dept-seo-opportunity-7",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"taquilla para el personal\" / pagina \"https://zentrylockers.com/taquillas-para-empresas/\": Crear/reforzar contenido dedicado a esta intencion (personal=empleados) dentro de la pagina de empresas, con enlazado interno de soporte."
    },
    {
      "ref": "dept-seo-opportunity-8",
      "description": "seo-specialist, oportunidad (future_opportunity, priority=medium, basis=evidence) sobre keyword \"cerraduras electrónicas taquillas\" / pagina \"https://zentrylockers.com/cerraduras-inteligentes-taquillas/\": Reforzar la landing existente para esta variante (electronica=inteligente en el lenguaje de busqueda de estos usuarios), mejorando meta title/description."
    },
    {
      "ref": "dept-seo-technical-issue-1",
      "description": "seo-specialist, problema tecnico (severity=high, basis=evidence) en la pagina https://zentrylockers.com/cerraduras/: Pagina objetivo obsoleta (en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/) sigue siendo el destino de actionItems activos del backlog SEO (cerraduras..."
    },
    {
      "ref": "dept-seo-technical-issue-2",
      "description": "seo-specialist, problema tecnico (severity=medium, basis=evidence) en la pagina https://zentrylockers.com/taquillas-melamina-fenolico/: Recibe impresiones de las keywords genericas \"taquillas melamina\" y \"taquillas de melamina\", que segun la decision O29.1 documentada deberian apuntar a /taquillas-melamina/ -- mis..."
    },
    {
      "ref": "dept-seo-technical-issue-3",
      "description": "seo-specialist, problema tecnico (severity=medium, basis=evidence) en la pagina multiples paginas del sitio (ver evidenceRefs): CTR 0.00% reportado de forma consistente en la mayoria de keywords marcadas low_ctr, en al menos 8 paginas distintas -- indica un problema generalizado de meta title/meta descript..."
    },
    {
      "ref": "dept-content-summary",
      "description": "content-strategist (salida real de esta pasada): oportunidad \"Actualizar title/meta y refrescar el contenido de la pagina existente taquillas-melamina\" -- La pagina ya posicionada para 'taquillas melamina' necesita un title/meta mas especifico y contenido que la diferencie claramente de las paginas vecinas del cluster (colegios, escolares, fenolica en Palencia, comprar taquillas) para mejora... (priority=medium, contentType=title_meta_improvement, targetBrand=zentry, searchIntent=commercial)."
    },
    {
      "ref": "dept-content-structure",
      "description": "content-strategist, estructura propuesta: H1 \"Taquillas de Melamina\" con 7 seccion(es); audiencia \"Responsable de compras o mantenimiento de un colegio, oficina o instalacion que necesita equipar/renovar taquillas en u...\"; angulo \"Posicionar esta pagina como la referencia clara sobre el material melamina (acabado, uso recomendado, cuando NO es la mejor opcion frente a...\"."
    },
    {
      "ref": "dept-content-cta",
      "description": "content-strategist, estrategia de CTA: primario \"Solicitar presupuesto sin compromiso\", secundario \"Ver taquillas para colegios y vestuarios\". Motivo: El intent es comercial/comparativo (el usuario evalua el material antes de comprar), por lo que un CTA de presupuesto encaja mejor que uno de contenido puramente informativo; se m..."
    },
    {
      "ref": "dept-content-risks",
      "description": "content-strategist, riesgos/incognitas declarados (5): Riesgo de canibalizacion SEO con paginas del mismo cluster (colegios, escolares, fenolica en Palencia, comprar taquillas) si no se coordina el enlazado interno y la diferenciacion tematica. | El changePack aprobado sobre cierre de canibalizacion de 'taquillas melamina' deberia verificarse como ya e..."
    },
    {
      "ref": "dept-analytics-summary",
      "description": "analytics-specialist (salida real de esta pasada, snapshot del departmentRunId de datos \"dept-2026-08-17T230452Z\", ga4Connected=true, gtmConnected=true): measurementFindings=4, trafficObservations=5, conversionObservations=4, trackingIssues=4, prioritizedActions=5."
    },
    {
      "ref": "dept-analytics-action-1",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Validar en GA4 DebugView el disparo del evento click_phone, ya que el tag y trigger existen en GTM pero no hay ninguna ocurrencia registrada en GA4 en el periodo."
    },
    {
      "ref": "dept-analytics-action-2",
      "description": "analytics-specialist, accion priorizada (high, claimType=RECOMMENDATION): Revisar y decidir sobre la publicacion de la version del contenedor GTM marcada como sin publicar, pendiente aprobacion Pau, para asegurar que la configuracion vigente es la analizada."
    },
    {
      "ref": "dept-analytics-action-3",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Investigar la discrepancia entre click_request_quote (65) y view_quote_page (12) para entender el recorrido real hacia la pagina de presupuesto."
    },
    {
      "ref": "dept-analytics-action-4",
      "description": "analytics-specialist, accion priorizada (medium, claimType=RECOMMENDATION): Aclarar y homogeneizar por que view_quote_page y view_contact_page no cuentan como conversion en GA4 a diferencia de otros eventos del catalogo."
    },
    {
      "ref": "dept-analytics-action-5",
      "description": "analytics-specialist, accion priorizada (low, claimType=RECOMMENDATION): Segmentar y auditar el trafico Direct/(direct)/(none) para revisar posible falta de etiquetado UTM en otros canales."
    },
    {
      "ref": "dept-analytics-tracking-issue-1",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El evento clave click_phone no se disparo ninguna vez en el periodo (fired=false, 0 ocurrencias), pese a que en GTM existe el tag GA4 Event - click_phone (no pausado) y el trigger click_phone de tipo..."
    },
    {
      "ref": "dept-analytics-tracking-issue-2",
      "description": "analytics-specialist, problema de medicion (claimType=OBSERVATION): La version live del contenedor GTM incluye en su nombre la anotacion sin publicar, pendiente aprobacion Pau, lo que genera ambiguedad sobre si la configuracion de tags y triggers analizada correspond..."
    },
    {
      "ref": "dept-analytics-tracking-issue-3",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): El evento click_catalog_download se disparo 3 veces pero registro 0 conversiones, a diferencia de otros eventos del catalogo (click_whatsapp, click_request_quote, generate_lead_form_submit) donde ocu..."
    },
    {
      "ref": "dept-analytics-tracking-issue-4",
      "description": "analytics-specialist, problema de medicion (claimType=FACT): view_quote_page (12 ocurrencias) y view_contact_page (38 ocurrencias) no registran ninguna conversion en GA4, a diferencia de otros eventos del catalogo observado."
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
  "departmentCoordinationRunId": "dept-2026-08-17T230452Z",
  "specialistInputs": [
    {
      "employee": "seo-specialist",
      "status": "executed",
      "note": "seo-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": null,
      "output": {
        "executiveSummary": "Con datos live de Search Console de esta misma pasada (36 jobs, 0h de antiguedad) cruzados contra el catalogo de clusters y de target keywords, el hallazgo mas urgente es que el backlog SEO sigue enviando esfuerzo de optimizacion hacia una URL en papelera (https://zentrylockers.com/cerraduras/, con 301 real a /cerraduras-para-taquillas/) para dos keywords con volumen (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios): cualquier trabajo on-page ahi se perderia. En paralelo, dos actionItems de \"taquillas melamina\"/\"taquillas de melamina\" siguen apuntando a /taquillas-melamina-fenolico/ pese a que la decision O29.1 (documentada en el propio catalogo de clusters) ya resolvio esa canibalizacion a favor de /taquillas-melamina/, y existe un script dedicado para cerrarlos que no parece haberse aplicado a estos casos concretos. Hay un patron sistemico de CTR 0.00% en la mayoria de keywords low_ctr repartidas en al menos 8 paginas, lo que apunta a un problema generalizado de meta title/description mas que a casos aislados. Por el lado positivo, tres huecos de contenido (taquillas metalicas, taquillas universidad, taquillas vestuarios) ya tienen su pagina en staging visualmente aprobada y solo pendiente de publicar, mientras que tres target keywords comerciales/informacionales de prioridad alta o media (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) no tienen ningun cluster ni pagina que las cubra en el contexto recibido.",
        "findings": [
          {
            "id": "f1",
            "category": "technical",
            "description": "Dos actionItems del backlog (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) apuntan a https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ -- cualquier optimizacion on-page sobre esa URL se perderia.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev2",
              "ev18",
              "ev20"
            ]
          },
          {
            "id": "f2",
            "category": "cannibalization",
            "description": "Los actionItems de \"taquillas melamina\" y \"taquillas de melamina\" que apuntan a /taquillas-melamina-fenolico/ contradicen la decision O29.1 (Pau) documentada en el cluster taquillas_melamina_fenolico: la keyword generica de melamina debe apuntar a /taquillas-melamina/. Ya existe un script de resolucion (o291-resolve-melamina-cannibalization.ts) que aparentemente no se ha aplicado a estos dos actionItems concretos.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev5",
              "ev6",
              "ev21",
              "ev22"
            ]
          },
          {
            "id": "f3",
            "category": "keyword_strategy",
            "description": "La keyword \"cerraduras sostenibles para gimnasios\" aparece como dos actionItems separados apuntando a dos paginas distintas (/cerraduras/, obsoleta, y /cerraduras-inteligentes-taquillas/), sin que ningun cluster del catalogo la contemple explicitamente -- routing ambiguo sin decision documentada.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev18",
              "ev19"
            ]
          },
          {
            "id": "f4",
            "category": "content",
            "description": "Patron sistemico de CTR 0.00% en la mayoria de actionItems marcados low_ctr, repartido en al menos 8 paginas distintas y multiples keywords -- sugiere un problema generalizado de meta title/description poco atractivos mas que casos aislados.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev2",
              "ev3",
              "ev5",
              "ev6",
              "ev7",
              "ev9",
              "ev10",
              "ev11",
              "ev12",
              "ev15",
              "ev18",
              "ev19"
            ]
          },
          {
            "id": "f5",
            "category": "content",
            "description": "Tres clusters con action new_page_candidate (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios) ya tienen su pagina en staging creada y visualmente aprobada, listas para pasar a produccion -- son huecos de contenido con el trabajo de desarrollo ya hecho, pendientes solo de publicacion.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev23",
              "ev24",
              "ev25"
            ]
          },
          {
            "id": "f6",
            "category": "cannibalization",
            "description": "El cluster taquillas_inteligentes_general (solucion general de taquillas inteligentes) tiene staging (2103) corregida pero aun pendiente de aprobacion visual real, y el propio catalogo advierte riesgo de canibalizacion con el cluster cerraduras_inteligentes_taquillas si se publica sin una decision explicita de diferenciacion.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev26"
            ]
          },
          {
            "id": "f7",
            "category": "keyword_strategy",
            "description": "Tres keywords del catalogo de target keywords (\"taquillas para gimnasios\" prioridad alta, \"lockers inteligentes\" prioridad alta, \"digitalizacion de taquillas\" prioridad media) no tienen ningun cluster ni actionItem que las cubra de forma directa en el contexto recibido.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev27",
              "ev28",
              "ev29"
            ]
          }
        ],
        "opportunities": [
          {
            "id": "opp1",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "high",
            "recommendedAction": "Reforzar contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10.",
            "rationale": "47 impresiones en el periodo analizado; posicion actual 20.5, a un empujon de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev1"
            ]
          },
          {
            "id": "opp2",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "kind": "technical",
            "priority": "high",
            "recommendedAction": "No optimizar la URL actual: definir con Pau si el objetivo correcto es /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (1865) antes de invertir en contenido nuevo para esta keyword, ya que /cerraduras/ esta en papelera con 301.",
            "rationale": "El cluster catalog marca esta ruta como reject por apuntar a una URL obsoleta en papelera desde O22.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev2",
              "ev20"
            ]
          },
          {
            "id": "opp3",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 28.7 a top 10.",
            "rationale": "74 impresiones en el periodo analizado; posicion actual 28.7, a un empujon de primera pagina; CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev4"
            ]
          },
          {
            "id": "opp4",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "Cerrar/redirigir estos actionItems (taquillas melamina y taquillas de melamina apuntando a taquillas-melamina-fenolico) via el script o291-resolve-melamina-cannibalization.ts y reencauzar el esfuerzo hacia /taquillas-melamina/, la pagina correcta segun la decision O29.1.",
            "rationale": "El cluster catalog documenta explicitamente que esta ruta esta mal enrutada y ya cuenta con un mecanismo de resolucion.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev5",
              "ev6",
              "ev21",
              "ev22"
            ]
          },
          {
            "id": "opp5",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la landing con contenido especifico para esta variante (el acabado melamina imita madera), arquitectura de enlazado interno y meta title/description dedicados.",
            "rationale": "50 impresiones en el periodo analizado; posicion 43.2, lejos de primera pagina pero con volumen real.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev7"
            ]
          },
          {
            "id": "opp6",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 25.1 a top 10.",
            "rationale": "40 impresiones en el periodo analizado; posicion actual 25.1, a un empujon de primera pagina; CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev8"
            ]
          },
          {
            "id": "opp7",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Crear/reforzar contenido dedicado a esta intencion (personal=empleados) dentro de la pagina de empresas, con enlazado interno de soporte.",
            "rationale": "34 impresiones en el periodo analizado; posicion 65.7, lejos de primera pagina pero con volumen real.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev9"
            ]
          },
          {
            "id": "opp8",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la landing existente para esta variante (electronica=inteligente en el lenguaje de busqueda de estos usuarios), mejorando meta title/description.",
            "rationale": "32 impresiones en el periodo analizado; posicion 34.6, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev10"
            ]
          },
          {
            "id": "opp9",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la landing existente de colegios para la variante \"escolares\" (misma intencion segun el cluster), con meta title/description dedicados.",
            "rationale": "32 impresiones en el periodo analizado; posicion 33.8, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev11"
            ]
          },
          {
            "id": "opp10",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la landing generica de fenolicas (el catalogo trata \"Palencia\" como ruido geografico sin intencion local propia) con meta title/description mejorados.",
            "rationale": "29 impresiones en el periodo analizado; posicion 73.7, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev12"
            ]
          },
          {
            "id": "opp11",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 27.8 a top 10.",
            "rationale": "28 impresiones en el periodo analizado; posicion actual 27.8, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev13"
            ]
          },
          {
            "id": "opp12",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 24.5 a top 10.",
            "rationale": "27 impresiones en el periodo analizado; posicion actual 24.5, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev14"
            ]
          },
          {
            "id": "opp13",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "kind": "future_opportunity",
            "priority": "medium",
            "recommendedAction": "Reforzar la landing generica de fenolicas para esta consulta long-tail transaccional, con meta title/description mejorados.",
            "rationale": "23 impresiones en el periodo analizado; posicion 83.3, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev15"
            ]
          },
          {
            "id": "opp14",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 17.1 a top 10.",
            "rationale": "22 impresiones en el periodo analizado; posicion actual 17.1, CTR 0%.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev16"
            ]
          },
          {
            "id": "opp15",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "kind": "quick_win",
            "priority": "medium",
            "recommendedAction": "Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 10.6 a top 10 -- muy cerca del objetivo.",
            "rationale": "21 impresiones en el periodo analizado; posicion actual 10.6, a un empujon minimo de primera pagina.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev17"
            ]
          },
          {
            "id": "opp16",
            "keyword": "cerraduras sostenibles para gimnasios",
            "kind": "cannibalization",
            "priority": "medium",
            "recommendedAction": "Definir con Pau una unica pagina objetivo para esta keyword (candidatos: /cerraduras-inteligentes-taquillas/ o una nueva landing de sostenibilidad) antes de optimizar cualquiera de las dos paginas actuales, ya que ninguna esta documentada en el catalogo de clusters y una de ellas (/cerraduras/) esta obsoleta.",
            "rationale": "La misma keyword aparece con dos actionItems apuntando a paginas distintas sin cluster que resuelva la ambiguedad.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev18",
              "ev19",
              "ev20"
            ]
          },
          {
            "id": "opp17",
            "keyword": "taquillas metalicas",
            "kind": "content_gap",
            "priority": "medium",
            "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada visualmente (2105) para cubrir este material de catalogo sin pagina propia.",
            "rationale": "Tercer material del catalogo (junto a melamina/fenolica) sin pagina de producto propia todavia; ademas coincide con una target keyword comercial de prioridad media.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev23",
              "ev31"
            ]
          },
          {
            "id": "opp18",
            "keyword": "taquillas universidad",
            "kind": "content_gap",
            "priority": "medium",
            "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada (2110) para el sector universidades, sin equivalente en produccion actualmente.",
            "rationale": "Sin pagina de produccion equivalente confirmada; staging ya creada y aprobada visualmente.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev24"
            ]
          },
          {
            "id": "opp19",
            "keyword": "taquillas vestuarios",
            "kind": "content_gap",
            "priority": "medium",
            "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada (2104), diferenciada de /bancos-de-vestuario/.",
            "rationale": "Hueco de contenido real sobre taquillas de vestuario en si (distinto del mobiliario complementario); staging ya aprobada.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev25"
            ]
          },
          {
            "id": "opp20",
            "keyword": "taquillas inteligentes",
            "kind": "content_gap",
            "priority": "medium",
            "recommendedAction": "Resolver primero el riesgo de canibalizacion documentado frente al cluster cerraduras_inteligentes_taquillas antes de publicar la staging 2103; requiere decision explicita de Pau sobre diferenciacion de intencion (solucion completa vs. hardware de cierre).",
            "rationale": "Cluster distinto pero conceptualmente cercano al de cerraduras inteligentes; el propio catalogo advierte del riesgo si se publica sin decision.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev26"
            ]
          },
          {
            "id": "opp21",
            "keyword": "taquillas para gimnasios",
            "kind": "content_gap",
            "priority": "high",
            "recommendedAction": "Evaluar la creacion de una pagina o cluster dedicado a este sector, ya que es una target keyword comercial de prioridad alta sin cobertura documentada en clusters ni en el backlog de acciones actual.",
            "rationale": "Presente en el catalogo de target keywords con prioridad alta, pero ausente de clusters y actionItems.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev27"
            ]
          },
          {
            "id": "opp22",
            "keyword": "lockers inteligentes",
            "kind": "content_gap",
            "priority": "high",
            "recommendedAction": "Valorar si esta keyword debe cubrirse mediante el mismo cluster de taquillas inteligentes (staging 2103) como sinonimo terminologico, o si requiere tratamiento propio -- decision pendiente de Pau.",
            "rationale": "Target keyword comercial de prioridad alta sin cluster que la mencione literalmente, aunque conceptualmente cercana a taquillas_inteligentes_general.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev28",
              "ev26"
            ]
          },
          {
            "id": "opp23",
            "keyword": "digitalizacion de taquillas",
            "kind": "content_gap",
            "priority": "medium",
            "recommendedAction": "Valorar contenido informativo (articulo/guia) sobre digitalizacion de taquillas que sirva de contenido de soporte y enlace hacia las paginas comerciales de cerraduras inteligentes y taquillas inteligentes.",
            "rationale": "Target keyword informacional de prioridad media sin cluster ni actionItem asociado en el contexto recibido.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev29"
            ]
          }
        ],
        "technicalIssues": [
          {
            "id": "t1",
            "page": "https://zentrylockers.com/cerraduras/",
            "issue": "Pagina objetivo obsoleta (en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/) sigue siendo el destino de actionItems activos del backlog SEO (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) -- cualquier optimizacion on-page ejecutada aqui se perderia.",
            "severity": "high",
            "basis": "evidence",
            "evidenceRefs": [
              "ev2",
              "ev18",
              "ev20"
            ]
          },
          {
            "id": "t2",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "issue": "Recibe impresiones de las keywords genericas \"taquillas melamina\" y \"taquillas de melamina\", que segun la decision O29.1 documentada deberian apuntar a /taquillas-melamina/ -- mismatch entre el enrutado real y la arquitectura de contenido decidida.",
            "severity": "medium",
            "basis": "evidence",
            "evidenceRefs": [
              "ev5",
              "ev6",
              "ev21"
            ]
          },
          {
            "id": "t3",
            "page": "multiples paginas del sitio (ver evidenceRefs)",
            "issue": "CTR 0.00% reportado de forma consistente en la mayoria de keywords marcadas low_ctr, en al menos 8 paginas distintas -- indica un problema generalizado de meta title/meta description poco atractivos en los snippets de resultados, no casos aislados.",
            "severity": "medium",
            "basis": "evidence",
            "evidenceRefs": [
              "ev2",
              "ev3",
              "ev5",
              "ev6",
              "ev7",
              "ev9",
              "ev10",
              "ev11",
              "ev12",
              "ev15",
              "ev18",
              "ev19"
            ]
          }
        ],
        "contentGaps": [
          {
            "id": "cg1",
            "topic": "Taquillas metalicas (nuevo material de catalogo sin pagina propia)",
            "relatedKeyword": "taquillas metalicas",
            "rationale": "Tercer material del catalogo (junto a melamina/fenolica) sin pagina de producto propia todavia; staging (2105) ya creada y visualmente aprobada, coincide con target keyword comercial de prioridad media.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev23",
              "ev31"
            ]
          },
          {
            "id": "cg2",
            "topic": "Taquillas para universidades",
            "relatedKeyword": "taquillas universidad",
            "rationale": "Sin pagina de produccion equivalente confirmada; staging (2110) ya creada y visualmente aprobada, candidata real a pagina nueva.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev24"
            ]
          },
          {
            "id": "cg3",
            "topic": "Taquillas para vestuarios (generico, no melamina)",
            "relatedKeyword": "taquillas vestuarios",
            "rationale": "Distinto de bancos de vestuario (mobiliario complementario); sin pagina equivalente en produccion. Staging (2104) ya creada y visualmente aprobada.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev25"
            ]
          },
          {
            "id": "cg4",
            "topic": "Taquillas inteligentes - solucion general (mueble+cerradura+PIN/RFID/app)",
            "relatedKeyword": "taquillas inteligentes",
            "rationale": "Distinto del cluster de cerraduras inteligentes (hardware de cierre); staging (2103) corregida pero pendiente de aprobacion visual real y de resolver riesgo de canibalizacion documentado.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev26"
            ]
          },
          {
            "id": "cg5",
            "topic": "Taquillas para gimnasios",
            "relatedKeyword": "taquillas para gimnasios",
            "rationale": "Target keyword comercial de prioridad alta sin cluster ni actionItem que la cubra directamente en el contexto recibido.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev27"
            ]
          },
          {
            "id": "cg6",
            "topic": "Lockers inteligentes (variante terminologica)",
            "relatedKeyword": "lockers inteligentes",
            "rationale": "Target keyword comercial de prioridad alta sin cluster que la mencione literalmente en sus matchPatterns.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev28"
            ]
          },
          {
            "id": "cg7",
            "topic": "Digitalizacion de taquillas (contenido informativo)",
            "relatedKeyword": "digitalizacion de taquillas",
            "rationale": "Target keyword informacional de prioridad media sin cluster ni actionItem asociado; podria funcionar como contenido de soporte hacia paginas comerciales.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev29"
            ]
          }
        ],
        "internalLinkRecommendations": [
          {
            "id": "il1",
            "fromPage": "https://zentrylockers.com/taquillas-melamina/",
            "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "anchorTextSuggestion": "taquillas con puertas fenolicas para mayor resistencia",
            "rationale": "Ambas paginas conviven en el mismo catalogo de material (melamina) pero atacan intenciones distintas segun la decision O29.1 -- enlazar desde la pagina generica a la variante de combinacion ayuda a diferenciar la intencion para el usuario y a reforzar la senal de que son paginas distintas, no duplicadas.",
            "basis": "inference",
            "evidenceRefs": [
              "ev21",
              "ev22"
            ]
          },
          {
            "id": "il2",
            "fromPage": "https://zentrylockers.com/taquillas-para-empresas/",
            "toPage": "https://zentrylockers.com/taquillas-para-oficinas/",
            "anchorTextSuggestion": "taquillas para oficinas",
            "rationale": "El catalogo de clusters documenta que ambas paginas comparten cliente final (empresas B2B) aunque se diferencian por entorno fisico -- enlazar entre ellas cubre mejor el recorrido de un mismo buyer persona sin fusionar los clusters.",
            "basis": "inference",
            "evidenceRefs": [
              "ev32",
              "ev33"
            ]
          },
          {
            "id": "il3",
            "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "toPage": "https://zentrylockers.com/cerraduras-para-taquillas/",
            "anchorTextSuggestion": "catalogo de cerraduras inteligentes ARES, ORBIS, BOXIS y NEO",
            "rationale": "El cluster catalog diferencia explicitamente la version informativa (esta pagina) del catalogo comercial de producto (/cerraduras-para-taquillas/) -- enlazar desde el contenido informativo hacia el catalogo comercial es el flujo natural de conversion informativo-transaccional.",
            "basis": "evidence",
            "evidenceRefs": [
              "ev30",
              "ev34"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "rank": 1,
            "title": "Corregir el enrutado obsoleto de /cerraduras/ antes de cualquier optimizacion",
            "relatedIds": [
              "f1",
              "t1",
              "opp2",
              "opp16"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "high"
          },
          {
            "rank": 2,
            "title": "Cerrar la canibalizacion de melamina generica en /taquillas-melamina-fenolico/ via el script ya existente",
            "relatedIds": [
              "f2",
              "t2",
              "opp4"
            ],
            "priority": "high",
            "effort": "low",
            "impact": "medium"
          },
          {
            "rank": 3,
            "title": "Optimizar on-page los quick wins de mayor volumen (H1/H2, profundidad, meta)",
            "relatedIds": [
              "opp1",
              "opp3",
              "opp6",
              "opp11",
              "opp12",
              "opp14",
              "opp15"
            ],
            "priority": "high",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 4,
            "title": "Reescribir meta titles/descriptions en las paginas con CTR 0% sistemico",
            "relatedIds": [
              "f4",
              "t3"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 5,
            "title": "Publicar a produccion las paginas de staging ya aprobadas (taquillas metalicas, universidades, vestuarios)",
            "relatedIds": [
              "f5",
              "cg1",
              "cg2",
              "cg3",
              "opp17",
              "opp18",
              "opp19"
            ],
            "priority": "medium",
            "effort": "low",
            "impact": "medium"
          },
          {
            "rank": 6,
            "title": "Decidir la pagina objetivo unica de \"cerraduras sostenibles para gimnasios\"",
            "relatedIds": [
              "f3",
              "opp16"
            ],
            "priority": "medium",
            "effort": "low",
            "impact": "low"
          },
          {
            "rank": 7,
            "title": "Resolver el riesgo de canibalizacion antes de publicar la solucion general de taquillas inteligentes",
            "relatedIds": [
              "f6",
              "cg4",
              "opp20"
            ],
            "priority": "medium",
            "effort": "medium",
            "impact": "medium"
          },
          {
            "rank": 8,
            "title": "Evaluar cobertura de contenido para target keywords sin cluster (gimnasios, lockers inteligentes, digitalizacion)",
            "relatedIds": [
              "f7",
              "cg5",
              "cg6",
              "cg7",
              "opp21",
              "opp22",
              "opp23"
            ],
            "priority": "medium",
            "effort": "high",
            "impact": "medium"
          },
          {
            "rank": 9,
            "title": "Implementar enlazado interno estrategico entre paginas relacionadas",
            "relatedIds": [
              "il1",
              "il2",
              "il3"
            ],
            "priority": "low",
            "effort": "low",
            "impact": "medium"
          }
        ],
        "evidence": [
          {
            "id": "ev1",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "quick_win, prioridad alta, posicion actual 20.47, 47 impresiones."
          },
          {
            "id": "ev2",
            "source": "job_data",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "future_opportunity+low_ctr, posicion 37.61, 31 impresiones, CTR 0%."
          },
          {
            "id": "ev3",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "future_opportunity+low_ctr, posicion 30.10, 86 impresiones."
          },
          {
            "id": "ev4",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "quick_win+low_ctr, posicion 28.70, 74 impresiones."
          },
          {
            "id": "ev5",
            "source": "job_data",
            "keyword": "taquillas melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "future_opportunity+low_ctr, posicion 43.10, 62 impresiones."
          },
          {
            "id": "ev6",
            "source": "job_data",
            "keyword": "taquillas de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
            "description": "future_opportunity+low_ctr, posicion 43.12, 51 impresiones."
          },
          {
            "id": "ev7",
            "source": "job_data",
            "keyword": "taquilla madera",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "future_opportunity+low_ctr, posicion 43.2, 50 impresiones."
          },
          {
            "id": "ev8",
            "source": "job_data",
            "keyword": "taquillas colegios",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "quick_win+low_ctr, posicion 25.13, 40 impresiones."
          },
          {
            "id": "ev9",
            "source": "job_data",
            "keyword": "taquilla para el personal",
            "page": "https://zentrylockers.com/taquillas-para-empresas/",
            "description": "future_opportunity+low_ctr, posicion 65.74, 34 impresiones."
          },
          {
            "id": "ev10",
            "source": "job_data",
            "keyword": "cerraduras electrónicas taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "future_opportunity+low_ctr, posicion 34.63, 32 impresiones."
          },
          {
            "id": "ev11",
            "source": "job_data",
            "keyword": "taquillas escolares",
            "page": "https://zentrylockers.com/taquillas-para-colegios/",
            "description": "future_opportunity+low_ctr, posicion 33.84, 32 impresiones."
          },
          {
            "id": "ev12",
            "source": "job_data",
            "keyword": "taquillas fenólicas en palencia",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "future_opportunity+low_ctr, posicion 73.72, 29 impresiones."
          },
          {
            "id": "ev13",
            "source": "job_data",
            "keyword": "taquillas vestuarios de melamina",
            "page": "https://zentrylockers.com/taquillas-melamina/",
            "description": "quick_win+low_ctr, posicion 27.79, 28 impresiones."
          },
          {
            "id": "ev14",
            "source": "job_data",
            "keyword": "cerraduras electronicas para taquillas",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "quick_win+low_ctr, posicion 24.52, 27 impresiones."
          },
          {
            "id": "ev15",
            "source": "job_data",
            "keyword": "fabricante de taquillas fenólicas en badajoz",
            "page": "https://zentrylockers.com/taquillas-fenolicas/",
            "description": "future_opportunity+low_ctr, posicion 83.30, 23 impresiones."
          },
          {
            "id": "ev16",
            "source": "job_data",
            "keyword": "taquillas para hospital",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "quick_win+low_ctr, posicion 17.14, 22 impresiones."
          },
          {
            "id": "ev17",
            "source": "job_data",
            "keyword": "comprar taquillas para hospitales",
            "page": "https://zentrylockers.com/taquillas-para-hospitales/",
            "description": "quick_win, posicion 10.62, 21 impresiones."
          },
          {
            "id": "ev18",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras/",
            "description": "future_opportunity+low_ctr, posicion 30.90, 21 impresiones."
          },
          {
            "id": "ev19",
            "source": "job_data",
            "keyword": "cerraduras sostenibles para gimnasios",
            "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
            "description": "future_opportunity+low_ctr, posicion 45.70, 20 impresiones."
          },
          {
            "id": "ev20",
            "source": "cluster_catalog",
            "keyword": "cerraduras inteligentes para centros deportivos",
            "description": "Cluster cerraduras_inteligentes_centros_deportivos, action reject: la pagina objetivo /cerraduras/ (id 1751) esta en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/ (2060); el backlog apunta a una URL obsoleta."
          },
          {
            "id": "ev21",
            "source": "cluster_catalog",
            "keyword": "taquillas melamina",
            "description": "Cluster taquillas_melamina_fenolico, decision O29.1 (Pau, aprobada): la keyword generica de melamina ya NO debe apuntar a /taquillas-melamina-fenolico/; cualquier actionId con esa keyword generica apuntando aqui se considera mal enrutado y se cierra via scripts/o291-resolve-melamina-cannibalization.ts."
          },
          {
            "id": "ev22",
            "source": "cluster_catalog",
            "keyword": "taquillas de melamina",
            "description": "Cluster taquillas_melamina, decision O29.1 (Pau, aprobada): pagina general /taquillas-melamina/ ataca la keyword principal taquillas melamina/taquillas de melamina/taquilla madera; NO se fusiona con /taquillas-melamina-fenolico/."
          },
          {
            "id": "ev23",
            "source": "cluster_catalog",
            "keyword": "taquillas metalicas",
            "description": "Cluster taquillas_metalicas, action new_page_candidate, sin pagina de produccion propia; staging 2105 ya creada y visualmente aprobada."
          },
          {
            "id": "ev24",
            "source": "cluster_catalog",
            "keyword": "taquillas universidad",
            "description": "Cluster taquillas_universidad, action new_page_candidate, sin pagina de produccion equivalente confirmada; staging 2110 ya creada y visualmente aprobada."
          },
          {
            "id": "ev25",
            "source": "cluster_catalog",
            "keyword": "taquillas vestuarios",
            "description": "Cluster taquillas_vestuarios, action new_page_candidate, distinto de /bancos-de-vestuario/; staging 2104 ya creada y visualmente aprobada."
          },
          {
            "id": "ev26",
            "source": "cluster_catalog",
            "keyword": "taquillas inteligentes",
            "description": "Cluster taquillas_inteligentes_general, action new_page_candidate, solucion general distinta de cerraduras_inteligentes_taquillas; riesgo de canibalizacion documentado; staging 2103 corregida en O28.6 pero pendiente de aprobacion visual real."
          },
          {
            "id": "ev27",
            "source": "target_keyword_catalog",
            "keyword": "taquillas para gimnasios",
            "description": "Keyword comercial de prioridad alta en el catalogo de target keywords, sin cluster ni actionItem que la cubra directamente."
          },
          {
            "id": "ev28",
            "source": "target_keyword_catalog",
            "keyword": "lockers inteligentes",
            "description": "Keyword comercial de prioridad alta en el catalogo de target keywords, sin cluster que la mencione literalmente en sus matchPatterns."
          },
          {
            "id": "ev29",
            "source": "target_keyword_catalog",
            "keyword": "digitalizacion de taquillas",
            "description": "Keyword informacional de prioridad media en el catalogo de target keywords, sin cluster ni actionItem asociado."
          },
          {
            "id": "ev30",
            "source": "cluster_catalog",
            "keyword": "cerraduras inteligentes para taquillas",
            "description": "Cluster cerraduras_inteligentes_taquillas, action update_existing_page: 4 variantes sobre la misma pagina real /cerraduras-inteligentes-taquillas/, diferenciada de /cerraduras-para-taquillas/ (catalogo comercial ARES/ORBIS/BOXIS/NEO)."
          },
          {
            "id": "ev31",
            "source": "target_keyword_catalog",
            "keyword": "taquillas metalicas",
            "description": "Keyword comercial de prioridad media en el catalogo de target keywords, coincide con el cluster taquillas_metalicas (new_page_candidate)."
          },
          {
            "id": "ev32",
            "source": "cluster_catalog",
            "keyword": "taquillas para oficinas",
            "description": "Cluster taquillas_oficinas, action update_existing_page: entorno fisico distinto de taquillas_empresas_personal, pero comparten cliente final segun el reason del cluster."
          },
          {
            "id": "ev33",
            "source": "cluster_catalog",
            "keyword": "taquillas para empresas",
            "description": "Cluster taquillas_empresas_personal, action update_existing_page: \"taquilla para el personal\" es la misma intencion comercial que \"taquillas para empresas\"."
          },
          {
            "id": "ev34",
            "source": "cluster_catalog",
            "page": "https://zentrylockers.com/cerraduras-para-taquillas/",
            "description": "URL del catalogo comercial ARES/ORBIS/BOXIS/NEO mencionada literalmente en los reason de los clusters cerraduras_inteligentes_taquillas y cerraduras_inteligentes_centros_deportivos como pagina diferenciada/objetivo comercial correcto."
          }
        ],
        "unknowns": [
          "No hay datos de clics/impresiones desglosados mas alla de las cifras agregadas por keyword+pagina; no se puede confirmar la magnitud exacta de mejora esperada de cada accion.",
          "No se conoce el estado de aprobacion final de Pau sobre la reasignacion de /cerraduras/ ni sobre la publicacion de taquillas_inteligentes_general (2103).",
          "No hay informacion en este contexto sobre volumen de busqueda, estacionalidad o intencion detallada para las keywords sin cluster (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) mas alla de su presencia en el catalogo de target keywords.",
          "No se dispone de datos tecnicos generales del sitio (Core Web Vitals, indexabilidad, sitemap, errores de rastreo) mas alla de lo inferible del backlog de keywords y del catalogo de clusters.",
          "No se puede verificar el contenido actual completo de cada pagina (H1/H2, longitud de texto real) sin acceso directo al sitio o al repositorio."
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
          "title": "Actualizar title/meta y refrescar el contenido de la pagina existente taquillas-melamina",
          "summary": "La pagina ya posicionada para 'taquillas melamina' necesita un title/meta mas especifico y contenido que la diferencie claramente de las paginas vecinas del cluster (colegios, escolares, fenolica en Palencia, comprar taquillas) para mejorar CTR y evitar canibalizacion."
        },
        "targetAudience": "Responsable de compras o mantenimiento de un colegio, oficina o instalacion que necesita equipar/renovar taquillas en un entorno seco y esta comparando materiales antes de pedir presupuesto.",
        "searchIntent": "commercial",
        "commercialIntent": "Captar trafico en fase de comparacion de materiales (melamina vs otras opciones) y convertirlo en solicitudes de presupuesto para taquillas de melamina, especialmente de perfiles de colegios/oficinas que buscan la opcion mas economica en entornos secos.",
        "angle": "Posicionar esta pagina como la referencia clara sobre el material melamina (acabado, uso recomendado, cuando NO es la mejor opcion frente a fenolica/metalica), enlazando de forma explicita hacia las paginas hermanas del cluster (colegios, escolares, fenolica) en vez de competir con ellas por las mismas keywords, y evitando cualquier bloque de precios/plazos concretos que no esten confirmados.",
        "contentType": "title_meta_improvement",
        "targetBrand": "zentry",
        "recommendedStructure": {
          "h1": "Taquillas de Melamina",
          "sections": [
            {
              "heading": "Que son las taquillas de melamina",
              "level": "H2",
              "purpose": "Definir el material y su acabado, y situar de inmediato en que entornos encaja (oficinas, colegios, vestuarios secos) para que el lector confirme que es la pagina que buscaba."
            },
            {
              "heading": "Ventajas del acabado en melamina",
              "level": "H2",
              "purpose": "Explicar acabado calido tipo madera, buena relacion calidad-precio y resistencia media a la humedad, usando solo el catalogo de materiales confirmado."
            },
            {
              "heading": "Melamina vs fenolica vs metalica: como elegir el material",
              "level": "H2",
              "purpose": "Tabla comparativa de los tres materiales confirmados con sus usos tipicos, ayudando a decidir y enlazando de forma natural hacia las paginas del cluster sobre fenolica/metalica."
            },
            {
              "heading": "Diferencias entre uso en colegios y otros entornos",
              "level": "H3",
              "purpose": "Conectar con la intencion de busqueda de las keywords relacionadas de colegios/escolares sin duplicar esas paginas, remitiendo a ellas para mas detalle."
            },
            {
              "heading": "Como elegir la medida y configuracion de taquilla",
              "level": "H2",
              "purpose": "Guia general de criterios de eleccion (numero de compartimentos, tamano de usuario/objeto) sin inventar dimensiones o modelos concretos no presentes en el contexto."
            },
            {
              "heading": "Solicita tu presupuesto de taquillas de melamina",
              "level": "H2",
              "purpose": "Bloque de conversion que remite a presupuesto a medida sin afirmar precios ni plazos concretos, ya que no hay cifras confirmadas en el contexto."
            },
            {
              "heading": "Preguntas frecuentes sobre taquillas de melamina",
              "level": "H2",
              "purpose": "Resolver dudas habituales de compra (mantenimiento, durabilidad, comparacion con otros materiales) usando solo hechos del catalogo confirmado, sin afirmar garantia ni fabricante directo."
            }
          ]
        },
        "ctaStrategy": {
          "primaryCta": "Solicitar presupuesto sin compromiso",
          "secondaryCta": "Ver taquillas para colegios y vestuarios",
          "rationale": "El intent es comercial/comparativo (el usuario evalua el material antes de comprar), por lo que un CTA de presupuesto encaja mejor que uno de contenido puramente informativo; se mantiene el CTA sugerido por el pipeline (recommendedCtaHint) por ser coherente con el brandIntent zentry_locker_core. El CTA secundario dirige trafico dentro del cluster (colegios/escolares) sin repetir el mensaje principal."
        },
        "internalLinks": [
          {
            "anchorIdea": "Compara materiales: taquillas fenolicas y metalicas",
            "targetDescription": "pagina/categoria de taquillas fenolicas, keyword relacionada: taquillas fenólicas en palencia",
            "isRealLink": false
          },
          {
            "anchorIdea": "Taquillas para colegios",
            "targetDescription": "pagina de categoria taquillas escolares/colegios, keywords relacionadas: taquillas colegios, taquillas escolares",
            "isRealLink": false
          },
          {
            "anchorIdea": "Ver catalogo completo y pedir presupuesto",
            "targetDescription": "pagina/landing general de compra de taquillas, keyword relacionada: comprar taquillas",
            "isRealLink": false
          }
        ],
        "supportingEvidence": [
          "clusterNote del contexto: posible cluster SEO con taquillas de melamina, taquillas colegios, taquillas escolares, taquillas fenólicas en palencia y comprar taquillas, con recomendacion explicita de enlazado interno entre esas paginas.",
          "currentAssumptions confirma que se asume que la pagina https://zentrylockers.com/taquillas-melamina/ sigue existiendo en esa URL, por lo que se trata de una actualizacion de pagina existente, no de contenido nuevo.",
          "Decision humana previa ya aprobada: 'Cerrar los actionItems de canibalizacion de taquillas melamina y revisar la aprobacion critica pendiente relacionada', lo que respalda tratar el riesgo de canibalizacion como algo ya gestionado a nivel de portfolio, aunque conviene verificar que la accion se ejecuto antes de publicar.",
          "secondaryKeywords del contexto (taquillas de melamina, taquillas colegios, taquillas escolares, comprar taquillas) respaldan el angulo de audiencia colegios/oficinas y la intencion comercial."
        ],
        "priority": "medium",
        "risksAndUnknowns": [
          "Riesgo de canibalizacion SEO con paginas del mismo cluster (colegios, escolares, fenolica en Palencia, comprar taquillas) si no se coordina el enlazado interno y la diferenciacion tematica.",
          "El changePack aprobado sobre cierre de canibalizacion de 'taquillas melamina' deberia verificarse como ya ejecutado antes de publicar este cambio, para no reabrir el mismo conflicto.",
          "No hay en el contexto ninguna cifra de precio, plazo de entrega ni condicion de garantia: cualquier bloque de 'Precios y presupuesto' debe remitir a solicitar presupuesto, sin inventar numeros.",
          "No se dispone del title/meta actual de la pagina para comparar contra el propuesto, lo que limita evaluar cuanto cambia realmente el CTR.",
          "currentAssumptions marca que se asume vigencia de la keyword y del brief: si la relevancia de 'taquillas melamina' ha cambiado desde que se genero la work order, este brief podria quedar desactualizado."
        ],
        "reasoningNotes": [
          "Se mantiene contentType como title_meta_improvement (coincide con contentTypeHint) aunque proposedStructureHint describe una estructura de articulo completo; se interpreta que, al ser changeType 'content_update' (no solo meta), el ambito incluye tambien un refresco de contenido on-page que soporte el nuevo title/meta, sin que esto implique reescribir la pagina entera desde cero.",
          "Se sustituyo la seccion 'Precios y presupuesto' del hint por 'Solicita tu presupuesto de taquillas de melamina' para evitar cualquier lectura de que se van a mostrar precios concretos, ya que no hay cifras en currentAssumptions ni en el resto del contexto (regla anti-fabricacion).",
          "searchIntent se marca como 'commercial' y no 'informational' porque las secondaryKeywords incluyen 'comprar taquillas', senal de intencion de compra cercana, no solo busqueda de definicion.",
          "priority se mantiene en 'medium' heredada del contexto: no hay senal en el input (trafico, impresiones, CTR) que justifique subirla o bajarla respecto a lo ya decidido por el pipeline determinista."
        ]
      }
    },
    {
      "employee": "analytics-specialist",
      "status": "executed",
      "note": "analytics-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
      "sourceRunId": "dept-2026-08-17T230452Z",
      "output": {
        "runSummary": {
          "departmentRunId": "dept-2026-08-17T230452Z",
          "reportGeneratedAt": "2026-08-17T23:05:13.044Z",
          "ga4Connected": true,
          "gtmConnected": true
        },
        "measurementFindings": [
          {
            "claimType": "FACT",
            "statement": "En esta pasada GA4 y GTM se leyeron en vivo (ga4Connected=true, gtmConnected=true) para el rango 2026-07-19 a 2026-08-16.",
            "evidenceIds": []
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Del catalogo de 7 eventos clave observados en GA4, 6 se dispararon en el periodo (generate_lead_form_submit, click_whatsapp, click_request_quote, click_catalog_download, view_quote_page, view_contact_page) y 1 (click_phone) no registro ninguna ocurrencia.",
            "evidenceIds": [
              "E10",
              "E23"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "La version live del contenedor GTM se llama O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5).",
            "evidenceIds": [
              "E19"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Existe una landing page registrada como (not set) con 4 sesiones y 2 conversiones, lo que indica que en algunos casos GA4 no capturo el path de la landing page.",
            "evidenceIds": [
              "E7"
            ]
          }
        ],
        "funnelObservations": [
          {
            "claimType": "OBSERVATION",
            "statement": "click_request_quote registro 65 ocurrencias, view_quote_page solo 12 y generate_lead_form_submit 6, mostrando una caida marcada entre el clic en solicitar presupuesto y el envio final del formulario.",
            "evidenceIds": [
              "E11",
              "E12",
              "E13"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "view_quote_page tiene 12 ocurrencias pero 0 conversiones, mientras que click_request_quote tiene 65 ocurrencias y 65 conversiones, pese a que ambos figuran en el catalogo de eventos clave observado.",
            "evidenceIds": [
              "E12",
              "E11",
              "E23"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "click_whatsapp (15/15) y generate_lead_form_submit (6/6), junto con click_request_quote (65/65), son los eventos cuyo numero de ocurrencias coincide exactamente con el de conversiones.",
            "evidenceIds": [
              "E16",
              "E13",
              "E11"
            ]
          }
        ],
        "trafficObservations": [
          {
            "claimType": "OBSERVATION",
            "statement": "El canal Direct concentra la gran mayoria de las sesiones (172) y de las conversiones (81) registradas en el listado de canales del periodo.",
            "evidenceIds": [
              "E1",
              "E17"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Organic Search (6 sesiones) y Referral (3 sesiones) representan una fraccion muy pequena del trafico total frente al canal Direct.",
            "evidenceIds": [
              "E1",
              "E2",
              "E3"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "Aparece un canal AI Assistant con 2 sesiones y 0 conversiones, proveniente de la fuente/medio chatgpt.com / ai-assistant.",
            "evidenceIds": [
              "E4",
              "E18"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page / concentra 114 de las sesiones del listado de top landing pages, con una tasa de bounce de 31.6%.",
            "evidenceIds": [
              "E5"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "Varias landing pages secundarias muestran una tasa de bounce igual o superior al 50%, como /digitalizacion-taquillas y /taquillas-para-empresas (66.7%) o (not set) (50%).",
            "evidenceIds": [
              "E8",
              "E9",
              "E7"
            ]
          }
        ],
        "conversionObservations": [
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page / registra 58 conversiones sobre 114 sesiones, una proporcion mayor a la del resto de landing pages del listado.",
            "evidenceIds": [
              "E5"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "La landing page /configurador-bancos registro 10 sesiones y 6 conversiones, con una tasa de bounce del 10%.",
            "evidenceIds": [
              "E6"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "El canal Direct concentra 81 de las conversiones registradas en channelTraffic, muy por encima de Organic Search (3) y Referral (2).",
            "evidenceIds": [
              "E1",
              "E2",
              "E3"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El canal AI Assistant no registro ninguna conversion en el periodo (0 conversiones sobre 2 sesiones).",
            "evidenceIds": [
              "E4"
            ]
          }
        ],
        "trackingIssues": [
          {
            "claimType": "FACT",
            "statement": "El evento clave click_phone no se disparo ninguna vez en el periodo (fired=false, 0 ocurrencias), pese a que en GTM existe el tag GA4 Event - click_phone (no pausado) y el trigger click_phone de tipo linkClick.",
            "evidenceIds": [
              "E10",
              "E20",
              "E21"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La version live del contenedor GTM incluye en su nombre la anotacion sin publicar, pendiente aprobacion Pau, lo que genera ambiguedad sobre si la configuracion de tags y triggers analizada corresponde a lo realmente activo en el sitio durante el periodo.",
            "evidenceIds": [
              "E19"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "El evento click_catalog_download se disparo 3 veces pero registro 0 conversiones, a diferencia de otros eventos del catalogo (click_whatsapp, click_request_quote, generate_lead_form_submit) donde ocurrencias y conversiones coinciden.",
            "evidenceIds": [
              "E14",
              "E16",
              "E11",
              "E13"
            ]
          },
          {
            "claimType": "FACT",
            "statement": "view_quote_page (12 ocurrencias) y view_contact_page (38 ocurrencias) no registran ninguna conversion en GA4, a diferencia de otros eventos del catalogo observado.",
            "evidenceIds": [
              "E12",
              "E15"
            ]
          }
        ],
        "anomalyCandidates": [
          {
            "claimType": "OBSERVATION",
            "statement": "click_request_quote (65 ocurrencias) supera ampliamente a view_quote_page (12 ocurrencias), pese a que los triggers de GTM /solicitar-presupuesto/ y Page Path equals /solicitar-presupuesto/ sugieren una relacion directa entre ambos eventos.",
            "evidenceIds": [
              "E11",
              "E12",
              "E22"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "La landing page / muestra una tasa de conversion aparente cercana al 51% (58 de 114 sesiones), notablemente superior a la del resto de landing pages del listado.",
            "evidenceIds": [
              "E5"
            ]
          },
          {
            "claimType": "OBSERVATION",
            "statement": "El canal Direct con fuente/medio (direct)/(none) concentra 172 sesiones y 81 conversiones, una proporcion desproporcionada frente al resto de canales identificados en el periodo.",
            "evidenceIds": [
              "E1",
              "E17"
            ]
          }
        ],
        "hypotheses": [
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion de que click_phone no se haya disparado en el periodo es que el elemento de la pagina que activa el trigger click_phone no fue interactuado por ningun usuario, o que el trigger ya no esta correctamente vinculado al elemento actual del sitio; esto no puede confirmarse solo con este contexto.",
            "evidenceIds": [
              "E10",
              "E20",
              "E21"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "La discrepancia entre click_request_quote (65) y view_quote_page (12) podria deberse a que el evento click_request_quote se dispara en multiples ubicaciones del sitio y no solo en la ruta hacia la pagina de presupuesto, aunque esto no se puede confirmar con los datos disponibles.",
            "evidenceIds": [
              "E11",
              "E12"
            ]
          },
          {
            "claimType": "HYPOTHESIS",
            "statement": "Una posible explicacion del volumen desproporcionado del canal Direct podria ser que trafico proveniente de otros canales (por ejemplo enlaces sin parametros UTM, apps de mensajeria o campanas) se este clasificando como Direct en GA4, aunque esto no puede confirmarse con el contexto entregado.",
            "evidenceIds": [
              "E1",
              "E17"
            ]
          }
        ],
        "recommendedMeasurements": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView si el evento click_phone se dispara correctamente al interactuar con el elemento de telefono del sitio, dado que el tag y el trigger existen en GTM pero GA4 no registro ninguna ocurrencia en el periodo.",
            "evidenceIds": [
              "E10",
              "E20",
              "E21"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Revisar y, si aplica, publicar la version del contenedor GTM cuyo nombre indica sin publicar, pendiente aprobacion Pau, para confirmar que la configuracion de tags y triggers analizada corresponde a lo realmente activo en el sitio.",
            "evidenceIds": [
              "E19"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Investigar por que view_quote_page y view_contact_page no estan marcados con conversiones en GA4 pese a estar en el listado de eventos clave observados, y decidir si deben marcarse como eventos de conversion o mantenerse como eventos informativos.",
            "evidenceIds": [
              "E12",
              "E15",
              "E23"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Crear una segmentacion adicional en GA4 para las sesiones del canal Direct con fuente/medio (direct)/(none), revisando si hay enlaces sin parametros UTM que deberian etiquetarse a otro canal.",
            "evidenceIds": [
              "E1",
              "E17"
            ]
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Auditar los puntos del sitio donde se dispara el trigger asociado a click_request_quote para clarificar por que su volumen de ocurrencias (65) es mucho mayor al de view_quote_page (12).",
            "evidenceIds": [
              "E11",
              "E12"
            ]
          }
        ],
        "prioritizedActions": [
          {
            "claimType": "RECOMMENDATION",
            "statement": "Validar en GA4 DebugView el disparo del evento click_phone, ya que el tag y trigger existen en GTM pero no hay ninguna ocurrencia registrada en GA4 en el periodo.",
            "evidenceIds": [
              "E10",
              "E20",
              "E21"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Revisar y decidir sobre la publicacion de la version del contenedor GTM marcada como sin publicar, pendiente aprobacion Pau, para asegurar que la configuracion vigente es la analizada.",
            "evidenceIds": [
              "E19"
            ],
            "priority": "high"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Investigar la discrepancia entre click_request_quote (65) y view_quote_page (12) para entender el recorrido real hacia la pagina de presupuesto.",
            "evidenceIds": [
              "E11",
              "E12"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Aclarar y homogeneizar por que view_quote_page y view_contact_page no cuentan como conversion en GA4 a diferencia de otros eventos del catalogo.",
            "evidenceIds": [
              "E12",
              "E15"
            ],
            "priority": "medium"
          },
          {
            "claimType": "RECOMMENDATION",
            "statement": "Segmentar y auditar el trafico Direct/(direct)/(none) para revisar posible falta de etiquetado UTM en otros canales.",
            "evidenceIds": [
              "E1",
              "E17"
            ],
            "priority": "low"
          }
        ],
        "evidence": [
          {
            "id": "E1",
            "source": "ga4_channel_traffic",
            "description": "Canal Direct: 172 sesiones, 69 usuarios activos, 81 conversiones."
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
            "description": "Canal AI Assistant: 2 sesiones, 2 usuarios activos, 0 conversiones."
          },
          {
            "id": "E5",
            "source": "ga4_landing_pages",
            "description": "Landing page /: 114 sesiones, 58 conversiones, bounce rate 31.6%."
          },
          {
            "id": "E6",
            "source": "ga4_landing_pages",
            "description": "Landing page /configurador-bancos: 10 sesiones, 6 conversiones, bounce rate 10%."
          },
          {
            "id": "E7",
            "source": "ga4_landing_pages",
            "description": "Landing page (not set): 4 sesiones, 2 conversiones, bounce rate 50%."
          },
          {
            "id": "E8",
            "source": "ga4_landing_pages",
            "description": "Landing page /digitalizacion-taquillas: 3 sesiones, 0 conversiones, bounce rate 66.7%."
          },
          {
            "id": "E9",
            "source": "ga4_landing_pages",
            "description": "Landing page /taquillas-para-empresas: 3 sesiones, 0 conversiones, bounce rate 66.7%."
          },
          {
            "id": "E10",
            "source": "ga4_key_events",
            "description": "Evento click_phone: fired=false, 0 ocurrencias, 0 conversiones."
          },
          {
            "id": "E11",
            "source": "ga4_key_events",
            "description": "Evento click_request_quote: fired=true, 65 ocurrencias, 65 conversiones."
          },
          {
            "id": "E12",
            "source": "ga4_key_events",
            "description": "Evento view_quote_page: fired=true, 12 ocurrencias, 0 conversiones."
          },
          {
            "id": "E13",
            "source": "ga4_key_events",
            "description": "Evento generate_lead_form_submit: fired=true, 6 ocurrencias, 6 conversiones."
          },
          {
            "id": "E14",
            "source": "ga4_key_events",
            "description": "Evento click_catalog_download: fired=true, 3 ocurrencias, 0 conversiones."
          },
          {
            "id": "E15",
            "source": "ga4_key_events",
            "description": "Evento view_contact_page: fired=true, 38 ocurrencias, 0 conversiones."
          },
          {
            "id": "E16",
            "source": "ga4_key_events",
            "description": "Evento click_whatsapp: fired=true, 15 ocurrencias, 15 conversiones."
          },
          {
            "id": "E17",
            "source": "ga4_source_medium",
            "description": "Fuente/medio (direct)/(none): 172 sesiones, 81 conversiones."
          },
          {
            "id": "E18",
            "source": "ga4_source_medium",
            "description": "Fuente/medio chatgpt.com/ai-assistant: 2 sesiones, 0 conversiones."
          },
          {
            "id": "E19",
            "source": "gtm_container",
            "description": "liveVersionName del contenedor GTM: O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)."
          },
          {
            "id": "E20",
            "source": "gtm_tags",
            "description": "Tag GA4 Event - click_phone, tipo gaawe, paused=false."
          },
          {
            "id": "E21",
            "source": "gtm_triggers",
            "description": "Trigger click_phone, tipo linkClick."
          },
          {
            "id": "E22",
            "source": "gtm_triggers",
            "description": "Triggers /solicitar-presupuesto/ (linkClick) y Page Path equals /solicitar-presupuesto/ (pageview)."
          },
          {
            "id": "E23",
            "source": "key_events_catalog",
            "description": "Catalogo de 7 eventos clave observados en ga4.keyEvents: generate_lead_form_submit, click_whatsapp, click_phone, click_request_quote, click_catalog_download, view_quote_page, view_contact_page."
          }
        ],
        "unknowns": [
          "No se dispone de datos de dispositivo, ubicacion geografica ni comparacion con periodos anteriores para contextualizar si las cifras actuales son atipicas.",
          "No se sabe con certeza si la version del contenedor GTM O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) corresponde a la configuracion realmente publicada en el sitio durante el periodo analizado (2026-07-19 a 2026-08-16).",
          "No se dispone de un documento separado del catalogo completo de eventos clave esperados que confirme cuales de los 7 eventos observados deberian marcarse como conversion en GA4.",
          "No hay informacion sobre por que la landing page /solicitar-presupuesto/ no aparece en el listado de top landing pages pese a tener triggers dedicados en GTM.",
          "No se dispone de datos sobre campanas pagadas (Google Ads, Meta Ads u otras) que permitan confirmar o descartar si parte del trafico Direct corresponde a enlaces sin etiquetar."
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

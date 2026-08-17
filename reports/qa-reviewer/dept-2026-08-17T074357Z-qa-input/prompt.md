# Prompt preparado para qa-reviewer -- artifact dept-2026-08-17T074357Z-qa-input

Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado del artifact bajo revision.
Pegalo tal cual como prompt del subagente `qa-reviewer` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.

---

## 1. Instrucciones del subagente

Eres `qa-reviewer`, el revisor independiente de calidad del departamento
IA de Zentry/Tukandado. Tu unico trabajo es RAZONAR sobre un artifact ya
producido por otro empleado (o por un runner determinista) que se te
entrega completo dentro del prompt, y devolver una revision de calidad
tambien estructurada. No tienes herramientas: no puedes leer ficheros, no
puedes navegar el repositorio, no puedes ejecutar comandos, no puedes
escribir en ningun sistema (ni interno ni externo). Todo lo que necesitas
saber sobre el artifact viene ya incluido en el mensaje que recibes -- si
algo no esta ahi, no existe para ti: no lo inventes, no lo asumas, no lo
completes con conocimiento general.

## Que se te entrega

El runner te pasa siempre, dentro del propio prompt:

1. La identidad del artifact bajo revision (`reviewedArtifact`):
   `sourceEmployee` (que empleado o proceso lo genero), `artifactType`
   (que forma tiene), `artifactId` y `artifactPath` (para trazabilidad).
   Debes devolver estos 4 campos EXACTAMENTE igual en tu salida, dentro de
   tu propio `reviewedArtifact` -- son la prueba de que estas revisando lo
   que de verdad se te suministro, no otra cosa. Un valor distinto se
   trata como fallo (ver "Que NUNCA debes hacer").
2. El contenido JSON completo del artifact a revisar.

## Que NO es tu trabajo

- El schema/contract compliance del artifact (que tenga la forma
  correcta, que pase JSON Schema, que `additionalProperties` este
  respetado) **ya esta resuelto deterministicamente** antes de que tu
  intervengas -- por el runtime comun (`json-schema-lite.ts`) y por el
  validador de dominio propio de cada empleado. No repitas ese trabajo ni
  lo reclames como tuyo en `findings`; si detectas algo de forma
  incidental (p.ej. un campo que parece incoherente con su propio schema)
  puedes mencionarlo como `finding` de categoria `schema_compliance`,
  pero tu funcion NO es sustituir esa capa.
- No vuelves a generar el contenido del artifact ni produces una version
  "mejorada" -- no hay `hero`, `landing`, `sections` reescritas en tu
  salida. Solo evaluas lo que ya existe.
- No decides autonomamente si el artifact se aplica o no -- tu
  `approvalRecommendation` es una RECOMENDACION para que un humano decida,
  nunca una aprobacion real ni una accion.

## Que debes evaluar

Sobre el artifact que se te entrega, en la medida en que aplique a su
contenido concreto:

- **evidence coverage**: cada afirmacion relevante del artifact, ¿esta
  respaldada por datos/contexto que el propio artifact incluye, o es una
  afirmacion suelta sin respaldo visible?
- **unsupported claims**: afirmaciones concretas (cifras, garantias,
  plazos, "fabricante directo", capacidades universales de producto,
  etc.) que no vienen respaldadas dentro del propio artifact.
- **fabrication risk**: contenido que suena a inventado (nombres,
  URLs, datos) sin ninguna referencia al input/contexto que el artifact
  documenta.
- **contradictions**: afirmaciones del artifact que se contradicen entre
  si (p.ej. un CTA que remite a un enlace real pero el artifact tambien
  dice que no hay enlaces internos disponibles).
- **actionability**: ¿el artifact deja claro que hacer despues, o es
  ambiguo/incompleto para que un humano actue sobre el?
- **priority consistency**: si el artifact declara una prioridad/riesgo,
  ¿es coherente con el contenido real (p.ej. una prioridad "low" para algo
  que el propio artifact describe como cambio de alto riesgo)?
- **missing assumptions**: supuestos que el artifact deberia declarar
  explicitamente (p.ej. "se asume que la pagina sigue existiendo") y no
  declara.
- **unsafe proposed actions**: cualquier accion propuesta en el artifact
  que, de aplicarse tal cual, escribiria en un sistema externo (WordPress,
  Ads, GA4/GTM, Search Console, produccion) sin pasar por aprobacion
  humana explicita, o que se salte cualquier guard determinista existente
  -- repórtalo en `safetyConcerns`.
- **approval requirements**: si el artifact deberia requerir aprobacion
  humana antes de aplicarse, y si el propio artifact lo refleja
  correctamente.

## Que debes producir

Un unico objeto JSON (sin texto antes ni despues, sin markdown fences)
que siga exactamente esta forma:

```json
{
  "reviewStatus": "pass|pass_with_warnings|fail",
  "reviewedArtifact": {
    "sourceEmployee": "string",
    "artifactType": "string",
    "artifactId": "string",
    "artifactPath": "string"
  },
  "findings": [
    { "category": "schema_compliance|evidence_coverage|unsupported_claims|fabrication_risk|contradictions|actionability|priority_consistency|missing_assumptions|unsafe_actions|approval_requirements|other", "severity": "info|warning|critical", "description": "string" }
  ],
  "unsupportedClaims": ["string"],
  "contradictions": ["string"],
  "safetyConcerns": ["string"],
  "requiredCorrections": ["string"],
  "approvalRecommendation": {
    "recommendedStatus": "approved|rejected|pending",
    "riskLevel": "none|low_medium|medium|high|critical",
    "rationale": "string"
  },
  "evidence": ["string"],
  "summary": "string"
}
```

Reglas de contenido:

- `reviewStatus` es `fail` SOLO si hay al menos un `finding` de severidad
  `critical` o al menos un `safetyConcerns` real. `pass_with_warnings` si
  hay `findings` de severidad `warning`, `unsupportedClaims` o
  `contradictions` no vacios pero nada critico. `pass` en cualquier otro
  caso.
- `evidence` debe anclar tus conclusiones a campos/valores CONCRETOS del
  artifact recibido (p.ej. citar el texto exacto de un campo) -- nunca una
  afirmacion generica sin referencia real.
- `approvalRecommendation.recommendedStatus`: usa `pending` cuando la
  decision requiere de verdad un humano (la mayoria de los casos reales);
  usa `approved`/`rejected` solo cuando el artifact sea inequivocamente
  bueno o inequivocamente problematico segun tus propios `findings`.
- `approvalRecommendation.riskLevel` refleja el riesgo de las acciones que
  el artifact propone (no el riesgo de tu propia revision).
- Si no encuentras nada que reportar en alguna categoria (p.ej. no hay
  ninguna contradiccion), devuelve un array vacio -- nunca inventes un
  hallazgo para "rellenar".

## Que NUNCA debes hacer

- No pidas acceso a ficheros, al repositorio, a WordPress, a Search
  Console, a Google Ads, a GA4/GTM, a ningun MCP ni a ningun sistema
  externo -- no tienes herramientas y no las necesitas para esta tarea.
- No escribas nada en ningun sistema, ni propongas escribirlo tu mismo --
  tu unica salida es el JSON de revision descrito arriba.
- No vuelvas a generar ni "mejorar" el contenido del artifact revisado --
  esa es la funcion del empleado original, no la tuya.
- No declares `reviewedArtifact` con valores distintos a los que se te
  suministraron en el contexto -- si lo haces, el runner que procesa tu
  respuesta rechaza tu salida entera de forma fail-closed (ver
  `src/employees/qa-reviewer/output.ts`, `assertReviewedArtifactMatches`).
- No te conviertas en una autoridad que sustituye a los guards
  deterministas del sistema (`subagent-tool-guard.ts`,
  `json-schema-lite.ts`, el schema/contract compliance ya validado antes
  de que tu intervengas). Tu opinion es sobre CALIDAD de contenido, nunca
  sobre infraestructura -- no decidas ni afirmes que un guard deterministico
  esta de mas, ni recomiendes saltartelo.
- No inventes datos de negocio (precios, plazos, garantias, nombres de
  producto) que no aparezcan ya en el artifact que estas revisando --
  esto aplica tanto a tu evaluacion como a cualquier ejemplo que cites.

---

## 2. Contexto estructurado (QaReviewerContext)

```json
{
  "identity": {
    "sourceEmployee": "unknown",
    "artifactType": "generic_json_artifact",
    "artifactId": "dept-2026-08-17T074357Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-17T074357Z/dept-2026-08-17T074357Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-17T074357Z",
    "generatedAt": "2026-08-17T07:56:55.214Z",
    "reviewInstructionsForQa": [
      "Este artifact es el resultado COMPLETO de una pasada coordinada del departamento: las salidas reales de los especialistas (SEO / Content / Analytics) y la sintesis del Growth Director sobre ellas.",
      "Revisa las dos capas: (a) los outputs de los especialistas y (b) la sintesis/priorizacion de growth-director-v2 sobre ellos.",
      "Busca especificamente: afirmaciones sin evidencia que las respalde dentro de este mismo artifact, contradicciones entre especialistas o entre un especialista y Growth, recomendaciones debiles o no accionables, riesgos, problemas de seguridad, y cualquier elemento que exija aprobacion humana antes de tocar nada.",
      "Un especialista con status distinto de `executed` NO aporto datos en esta pasada: si Growth afirma algo que solo podria salir de ese especialista ausente, eso es un hallazgo (fabricacion o claim sin respaldo), no una omision menor.",
      "sem-specialist esta fuera de esta fase por decision explicita: su ausencia NO es un defecto de calidad de este artifact y no debe reportarse como tal. Si alguna afirmacion del artifact asume datos de SEM, ESO si es un hallazgo.",
      "Se concreto: cuando marques una recomendacion como problematica, cita su titulo EXACTO tal como aparece en `growth.output.recommendedPriorities[].title`. El departamento usa esa coincidencia literal de titulo para decidir, de forma deterministica, que recomendaciones NO se promueven a la fase de ingenieria.",
      "Un hallazgo `critical` o cualquier entrada en `safetyConcerns` BLOQUEA la promocion de la recomendacion citada. No uses `critical` para matices de estilo, ni `info` para un riesgo real.",
      "Ninguna parte de este artifact se ha aplicado a ningun sistema: es una propuesta de solo lectura. No evalues como si ya estuviera publicado."
    ],
    "stages": [
      {
        "employee": "seo-specialist",
        "status": "executed",
        "note": "seo-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
        "sourceRunId": null
      },
      {
        "employee": "content-strategist",
        "status": "executed",
        "note": "content-strategist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
        "sourceRunId": null
      },
      {
        "employee": "analytics-specialist",
        "status": "executed",
        "note": "analytics-specialist: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.",
        "sourceRunId": "dept-2026-08-17T074357Z"
      },
      {
        "employee": "sem-specialist",
        "status": "not_available",
        "note": "sem-specialist queda EXPLICITAMENTE FUERA de esta fase (pendiente / temporalmente no disponible). No hay ninguna senal de SEM/Google Ads en esta pasada: no asumas gasto, CPC, impresiones, campanas activas ni ningun otro dato de Ads, y no trates su ausencia como si SEM estuviera sano o vacio. Su ausencia NUNCA bloquea esta pasada.",
        "sourceRunId": null
      }
    ],
    "specialistOutputs": [
      {
        "employee": "seo-specialist",
        "status": "executed",
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
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "Backlog del departamento robusto (105 acciones vivas, 113 work orders listas, 1 aprobacion critica pendiente) con senal cruzada de tres especialistas ejecutados en esta pasada (seo-specialist, content-strategist, analytics-specialist) mas sem-specialist ausente. El hallazgo mas accionable y de menor esfuerzo es tecnico-SEO: hay tareas activas apuntando a una pagina obsoleta (/cerraduras/, en papelera con 301) y a keywords de melamina generica mal enrutadas pese a una decision de cluster ya aprobada (O29.1); corregir esto no requiere crear nada nuevo. En paralelo, analytics-specialist detecta brechas reales de medicion (evento click_phone sin ninguna ocurrencia en el periodo pese a tag/trigger activos en GTM, y una version live de GTM cuyo propio nombre sugiere cambios pendientes de aprobar) que conviene validar antes de fiarse de las cifras de conversion CTA. content-strategist propone una mejora de bajo esfuerzo sobre una pagina ya indexada (taquillas-fenolicas) para una keyword local de Palencia, con riesgos de canibalizacion ya identificados por el propio especialista. Existe una contradiccion relevante entre la recomendacion de seo-specialist de publicar ya las paginas nuevas de staging (metalicas, vestuarios, universidades) por estar visualmente aprobadas, y una decision humana previa (2026-08-16) que rechazo exactamente esa misma propuesta por considerarlas demasiado basicas visualmente y sin suficientes imagenes; esta sintesis prioriza seguir el criterio humano y tratar la publicacion como bloqueada hasta una segunda iteracion. sem-specialist queda fuera de esta fase: no hay ninguna senal de SEM/Google Ads en este informe.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "Dos problemas de enrutado activos en el backlog: tareas dirigidas a /cerraduras/ (pagina en papelera con redireccion 301 real a /cerraduras-para-taquillas/) y action items de melamina generica apuntando a /taquillas-melamina-fenolico/ pese a la decision O29.1 ya aprobada que resuelve esa canibalizacion.",
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-action-2"
            ]
          },
          {
            "channel": "seo",
            "description": "Patron sistemico de CTR 0% con impresiones reales (20-86 por keyword) en varias paginas de producto/sector (melamina, colegios, empresas, fenolicas, hospitales), lo que apunta a snippets poco atractivos a nivel de plantilla, no a un caso aislado.",
            "evidenceRefs": [
              "dept-seo-action-5"
            ]
          },
          {
            "channel": "content",
            "description": "Oportunidad de reforzar una pagina ya indexada (/taquillas-fenolicas/) con contenido y title/meta orientados a la keyword local 'taquillas fenolicas en palencia', sin necesidad de crear pagina nueva; el propio especialista senala riesgo de canibalizacion con melamina/colegios/comprar-taquillas si no se coordina el enlazado interno.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-risks"
            ]
          },
          {
            "channel": "analytics",
            "description": "GA4/GTM conectados y con datos reales de esta pasada, pero con 4 problemas de medicion detectados: click_phone sin ocurrencias pese a tag/trigger activos; version live de GTM con nombre que sugiere cambios pendientes de aprobacion; 3 eventos que se disparan pero no acumulan conversiones; y trafico de una herramienta de depuracion (tagassistant.google.com) mezclado en el canal Referral.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2",
              "dept-analytics-tracking-issue-3",
              "dept-analytics-tracking-issue-4"
            ]
          },
          {
            "channel": "ops",
            "description": "Backlog deterministico activo y saludable en volumen: 105 acciones vivas, 113 work orders listas para revisar, 5 change packs listos, pero solo 1 solicitud de aprobacion pendiente y esta marcada como riesgo critico (taquillas melamina, production_deployment_plan).",
            "evidenceRefs": [
              "actions-live",
              "workorders-ready",
              "changepacks-ready",
              "approvals-pending"
            ]
          }
        ],
        "bottlenecks": [
          {
            "channel": "seo",
            "description": "Contradiccion detectada entre la recomendacion de seo-specialist (publicar ya a produccion las paginas nuevas de staging de metalicas, vestuarios y universidades por estar visualmente aprobadas) y una decision humana previa que rechazo explicitamente esa misma propuesta el 2026-08-16, indicando que las paginas de staging se ven demasiado basicas y sin suficientes imagenes/fotografias y necesitan una segunda iteracion visual y de contenido antes de publicarse. Se prioriza el criterio humano ya expresado; la confianza en cualquier plan de publicacion inmediata queda reducida.",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject-v1"
            ]
          },
          {
            "channel": "analytics",
            "description": "La version live del contenedor GTM se llama 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)', lo que introduce incertidumbre sobre si los tags/triggers de eventos CTA actualmente en produccion son los definitivos o estan a medio aprobar; esto afecta la fiabilidad de cualquier metrica de conversion basada en esos eventos.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "channel": "ops",
            "description": "Gran parte del pipeline de change packs esta bloqueado por cluster gate (2 en SEO, 10 en contenido, 1 en CRO segun la actividad de esta pasada), lo que limita cuanto trabajo nuevo puede avanzar aunque el backlog de acciones sea amplio.",
            "evidenceRefs": [
              "changepack-cluster-gate-blocked"
            ]
          },
          {
            "channel": "cro",
            "description": "Staging QA detecto 2 avisos en esta pasada (1 borrador con problemas, reportado dos veces) sobre un total de 21 borradores revisados, lo que refuerza la necesidad de una segunda pasada de calidad antes de cualquier despliegue.",
            "evidenceRefs": [
              "department-warnings",
              "agent-activity"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "Quick wins de on-page en siete keywords ya cercanas a top10 (cerraduras inteligentes para taquillas, taquillas colegios, cerraduras electronicas para taquillas, taquillas vestuarios de melamina, taquillas de melamina, taquillas para hospital, comprar taquillas para hospitales) mediante refuerzo de H1/H2, contenido y meta title/description.",
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "channel": "content",
            "description": "Enriquecer /taquillas-fenolicas/ con una estructura de 6 secciones (resistencia a humedad, comparativa de materiales, guia de medidas, presupuesto, FAQ) orientada a la keyword local 'taquillas fenolicas en palencia', con CTA primario de presupuesto y secundario de consulta tecnica.",
            "evidenceRefs": [
              "dept-content-structure",
              "dept-content-cta"
            ]
          },
          {
            "channel": "analytics",
            "description": "Resolver las brechas de medicion identificadas (validar click_phone en DebugView, confirmar estado real de la version live de GTM, revisar marca de key events para 3 eventos sin conversiones) mejoraria la fiabilidad de los datos que alimentan futuras decisiones de CRO/SEM.",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-action-2",
              "dept-analytics-action-3"
            ]
          },
          {
            "channel": "seo",
            "description": "Implementar el enlazado interno recomendado entre paginas diferenciadas (cerraduras informativo vs comercial, melamina generico vs fenolico, empresas vs oficinas) para reforzar la diferenciacion de clusters sin fusionar contenido.",
            "evidenceRefs": [
              "dept-seo-action-8"
            ]
          }
        ],
        "experiments": [
          {
            "title": "Reescritura de meta title/description en paginas con CTR 0% sistematico",
            "hypothesis": "Mejorar los snippets de las paginas con CTR 0% pese a impresiones reales aumentara el CTR sin necesidad de cambiar el ranking actual.",
            "channel": "seo",
            "successMetric": "El CTR medio de las paginas afectadas (melamina, colegios, empresas, fenolicas, hospitales) sube de 0% a un valor positivo medible tras publicar los nuevos title/meta.",
            "evidenceRefs": [
              "dept-seo-action-5"
            ]
          },
          {
            "title": "Validacion en GA4 DebugView del evento click_phone",
            "hypothesis": "El tag y trigger de click_phone estan correctamente configurados en GTM pero simplemente no hubo clics reales en el periodo analizado, no un fallo de tracking.",
            "channel": "analytics",
            "successMetric": "Confirmacion en DebugView de que el evento se dispara ante un clic real en un enlace de telefono, o identificacion del fallo real si no se dispara.",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "title": "Segunda iteracion visual y de contenido de las paginas de staging antes de reintentar publicacion",
            "hypothesis": "Anadir mas fotografias/imagenes y profundidad de contenido a las paginas de staging (metalicas, vestuarios, universidades, taquillas inteligentes general) resolvera el motivo de rechazo humano previo y permitira una aprobacion posterior para produccion.",
            "channel": "cro",
            "successMetric": "Aprobacion humana explicita de la nueva iteracion visual/de contenido, verificable antes de replantear cualquier plan de despliegue a produccion.",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject-v1"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Corregir el enrutado tecnico de tareas SEO mal dirigidas (pagina obsoleta /cerraduras/ y melamina generica mal enrutada)",
            "rationale": "Impacto alto porque afecta a tareas activas sobre URLs incorrectas u obsoletas; confianza alta porque el propio catalogo de clusters documenta ambos casos con evidencia (pagina en papelera con 301, decision O29.1 ya aprobada); esfuerzo bajo porque es una correccion de enrutado, no creacion de contenido nuevo. Depende de una decision humana sobre el target correcto para las dos keywords de /cerraduras/ y de confirmar si el script de cierre de melamina ya se aplico.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Confirmacion humana del target correcto para /cerraduras/",
              "Verificar si scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto sobre estos action items"
            ],
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-action-2"
            ]
          },
          {
            "title": "Cerrar las brechas de medicion en Analytics antes de fiarse de las metricas de conversion CTA",
            "rationale": "Impacto alto porque afecta a la fiabilidad de todos los datos de conversion usados para priorizar otras decisiones de growth; confianza media porque las causas concretas (click_phone sin disparos, version de GTM con nombre ambiguo) son hipotesis del propio analytics-specialist pendientes de validacion, no hechos cerrados; esfuerzo bajo-medio porque son verificaciones puntuales en GA4/GTM.",
            "impact": "high",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Validacion en GA4 DebugView de click_phone",
              "Confirmacion del estado real de publicacion de la version live de GTM O44"
            ],
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-action-2",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "title": "Ejecutar una segunda iteracion visual y de contenido en las paginas de staging antes de replantear su publicacion",
            "rationale": "Impacto alto porque desbloquea contenido ya trabajado (metalicas, vestuarios, universidades) que hoy esta parado; confianza alta porque existe una decision humana explicita y reciente que rechazo la publicacion inmediata por motivos concretos (falta de imagenes/fotografias, necesidad de segunda iteracion); esfuerzo medio porque implica trabajo visual/de contenido adicional, no solo aprobacion. Esta prioridad sustituye directamente a la recomendacion de seo-specialist de publicar ya, que queda descartada por el criterio humano ya registrado.",
            "impact": "high",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Nueva iteracion visual con mas imagenes/fotografias segun el motivo textual del rechazo humano",
              "Aprobacion humana posterior de esa segunda iteracion"
            ],
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject-v1"
            ]
          },
          {
            "title": "Ejecutar los quick wins de on-page en keywords cercanas a top10",
            "rationale": "Impacto medio-alto porque son siete keywords a un empujon de primera pagina segun datos live de Search Console; confianza media porque depende de que los cambios de contenido/meta se ejecuten correctamente sin tocar las paginas con problemas de enrutado; esfuerzo medio porque implica trabajo de contenido en varias paginas. Conviene secuenciarlo despues de resolver el enrutado para no mezclar esfuerzo con URLs incorrectas.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "medium",
            "dependsOn": [
              "Corregir el enrutado tecnico de tareas SEO mal dirigidas (pagina obsoleta /cerraduras/ y melamina generica mal enrutada)"
            ],
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "title": "Enriquecer /taquillas-fenolicas/ para la keyword local 'taquillas fenolicas en palencia'",
            "rationale": "Impacto medio porque es una keyword de nicho local sobre una pagina ya indexada, de bajo riesgo; confianza media porque el propio content-strategist declara varios riesgos no confirmados (cobertura/logistica en Palencia, precios); esfuerzo bajo porque es una actualizacion de contenido existente, no una pagina nueva.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Coordinar el enlazado interno hacia melamina/colegios/comprar-taquillas para evitar canibalizacion, segun dept-content-risks"
            ],
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-structure"
            ]
          },
          {
            "title": "Revisar la solicitud de aprobacion critica pendiente sobre 'taquillas melamina' antes de avanzar en ese cluster",
            "rationale": "Impacto alto porque es la unica aprobacion pendiente marcada con riesgo critico y coincide con el cluster de melamina que ya tiene un problema de enrutado detectado por seo-specialist; confianza media porque el contexto no detalla el contenido exacto del plan de despliegue, solo su existencia y nivel de riesgo; esfuerzo bajo porque es una revision, no una ejecucion.",
            "impact": "high",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Revision humana directa de la solicitud pendiente de riesgo critico"
            ],
            "evidenceRefs": [
              "approvals-pending"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada; su salida real se uso para sintetizar prioridades de enrutado y quick wins."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada; su salida real se uso para la oportunidad de contenido sobre taquillas fenolicas en Palencia."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada; su salida real se uso para las brechas de medicion en GA4/GTM."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "status=not_available en esta fase segun specialistInputs; no hay ninguna senal de SEM/Google Ads en esta pasada y no se ha inferido nada sobre gasto, CPC ni campanas."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "El agente existe en el repositorio pero no aparece en specialistInputs de esta pasada coordinada; no hay salida real de qa-reviewer que sintetizar, solo los avisos deterministicos de staging-qa-agent."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "El agente existe en el repositorio pero no aparece en specialistInputs de esta pasada coordinada; no hay salida real de web-engineer que sintetizar."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "Conectado (connected=true) segun agentActivity, con 70 candidatas SEM detectadas, pero sin sintesis estrategica de sem-specialist que las interprete en esta pasada."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "GA4 y GTM conectados, lo que respalda los datos usados por analytics-specialist en esta pasada."
          }
        ],
        "risks": [
          {
            "description": "Existe 1 solicitud de aprobacion pendiente con riesgo critico sobre 'taquillas melamina' (production_deployment_plan), en el mismo cluster donde seo-specialist ya detecto action items mal enrutados; avanzar sin revisar esta solicitud podria desplegar sobre una base de enrutado aun no resuelta.",
            "severity": "high",
            "evidenceRefs": [
              "approvals-pending",
              "dept-seo-action-2"
            ]
          },
          {
            "description": "seo-specialist recomienda publicar ya a produccion las paginas de staging por estar visualmente aprobadas, pero una decision humana explicita del 2026-08-16 rechazo esa misma propuesta por considerarlas demasiado basicas y sin suficientes imagenes; publicar sin la segunda iteracion solicitada contradice directamente el criterio humano ya expresado.",
            "severity": "high",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject-v1"
            ]
          },
          {
            "description": "El evento clave click_phone no registro ninguna ocurrencia en el periodo pese a tener tag y trigger activos en GTM; si el problema es tecnico y no de comportamiento del usuario, se estaria perdiendo atribucion de leads por telefono sin que nadie lo note.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "description": "El nombre de la version live de GTM sugiere cambios de eventos CTA pendientes de aprobacion, lo que introduce incertidumbre sobre si los datos de conversion actuales en produccion son definitivos.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-3"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "human-decision-staging-reject-v1",
            "description": "Decision humana registrada el 2026-08-16 (version 1, rechazada) sobre la propuesta de publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general). Motivo textual dado por la persona: las paginas de staging se ven demasiado basicas y sin suficientes imagenes/fotografias, y necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion. Esta decision proviene de la seccion 3 del contexto entregado a este agente, no de un ref del evidenceCatalog original."
          },
          {
            "ref": "changepack-cluster-gate-blocked",
            "description": "Cruce de los resumenes de actividad de agentActivity de esta pasada: seo-change-pack-builder finalizo con 0 change packs nuevos y 2 bloqueados por cluster gate; content-change-pack-builder con 0 nuevos y 10 bloqueados por cluster gate; cro-change-pack-builder con 0 nuevos y 1 bloqueado por cluster gate. Los tres datos provienen literalmente de los campos lastSummary de agentActivity[] en el contexto entregado."
          }
        ],
        "unknowns": [
          "No hay ninguna senal de SEM/Google Ads en esta pasada porque sem-specialist quedo explicitamente fuera de esta fase; no se puede evaluar el canal de pago ni contrastarlo con SEO/contenido.",
          "No hay salida real de qa-reviewer ni de web-engineer en esta pasada coordinada (no aparecen en specialistInputs), por lo que no se puede sintetizar ninguna senal tecnica o de QA mas alla de los avisos deterministicos de staging-qa-agent.",
          "seo-specialist declara no poder confirmar si el script de cierre de la canibalizacion de melamina (O29.1) ya se ejecuto sobre los action items actuales, por lo que no se sabe con certeza si esos items estan realmente pendientes de cierre o son residuales de una ejecucion anterior.",
          "analytics-specialist declara no poder confirmar si el nombre de la version live de GTM ('sin publicar, pendiente aprobacion Pau') refleja un estado real de publicacion pendiente o es solo una etiqueta de nomenclatura interna.",
          "No hay criterio explicito y verificable en el contexto sobre que constituye una 'segunda iteracion visual/de contenido' suficiente para las paginas de staging, mas alla del motivo textual del rechazo humano; cualquier plan de re-publicacion necesitara validacion humana adicional."
        ]
      },
      "auditWarnings": []
    },
    "semStatus": {
      "employee": "sem-specialist",
      "status": "not_available",
      "note": "sem-specialist queda EXPLICITAMENTE FUERA de esta fase (pendiente / temporalmente no disponible). No hay ninguna senal de SEM/Google Ads en esta pasada: no asumas gasto, CPC, impresiones, campanas activas ni ningun otro dato de Ads, y no trates su ausencia como si SEM estuviera sano o vacio. Su ausencia NUNCA bloquea esta pasada."
    }
  }
}
```

Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional. `reviewedArtifact` en tu salida debe ser EXACTAMENTE `context.identity` de arriba.

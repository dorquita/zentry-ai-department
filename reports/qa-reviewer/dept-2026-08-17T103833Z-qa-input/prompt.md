# Prompt preparado para qa-reviewer -- artifact dept-2026-08-17T103833Z-qa-input

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
    "artifactId": "dept-2026-08-17T103833Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-17T103833Z/dept-2026-08-17T103833Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-17T103833Z",
    "generatedAt": "2026-08-17T10:50:41.851Z",
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
        "sourceRunId": "dept-2026-08-17T103833Z"
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
          "executiveSummary": "Se analizan 20 action items reales de Search Console (run seo-watcher-2026-08-17T103842Z, datos live de esta misma pasada, 0h de antiguedad) junto con el catalogo de 10 keywords objetivo y 20 clusters SEO. El hallazgo mas urgente es tecnico-estrategico: dos action items siguen apuntando a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters marca como en papelera con redireccion 301 desde O22 -- cualquier trabajo on-page ahi se perderia. Ademas se detecta una posible canibalizacion no documentada (\"cerraduras sostenibles para gimnasios\" repartida entre dos paginas distintas) y una canibalizacion que el catalogo da por resuelta en O29.1 pero que sigue apareciendo en el backlog vivo (\"taquillas melamina\"/\"taquillas de melamina\" enrutando trafico hacia /taquillas-melamina-fenolico/ en vez de /taquillas-melamina/). En el lado positivo, hay un quick win claro y de alta prioridad (\"cerraduras inteligentes para taquillas\", posicion 20.5, 47 impresiones) y varios quick wins de bajo esfuerzo con CTR 0% pese a impresiones reales. El catalogo de clusters ya tiene identificados 4 huecos de contenido aprobados en staging (universidades, taquillas metalicas, vestuarios, taquillas inteligentes general) pendientes de pasar a produccion, y 3 keywords objetivo del negocio (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) sin cluster ni pagina asociada visible en este contexto.",
          "findings": [
            {
              "id": "f1",
              "category": "technical",
              "description": "Dos action items en vivo (\"cerraduras inteligentes para centros deportivos\" y \"cerraduras sostenibles para gimnasios\") recomiendan crear/reforzar contenido en https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real hacia /cerraduras-para-taquillas/. Ejecutar esas acciones tal cual desperdiciaria esfuerzo sobre una pagina que no sirve trafico real.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev2",
                "ev3",
                "ev4"
              ]
            },
            {
              "id": "f2",
              "category": "cannibalization",
              "description": "La keyword \"cerraduras sostenibles para gimnasios\" genera dos action items distintos apuntando a dos paginas diferentes (/cerraduras/ y /cerraduras-inteligentes-taquillas/), sin que ningun cluster del catalogo documente ni resuelva esta interseccion -- posible canibalizacion no gestionada.",
              "basis": "inference",
              "evidenceRefs": [
                "ev4",
                "ev5"
              ]
            },
            {
              "id": "f3",
              "category": "cannibalization",
              "description": "El cluster taquillas_melamina_fenolico documenta explicitamente (decision O29.1) que la keyword generica \"melamina\" NO debe apuntar a /taquillas-melamina-fenolico/ y que cualquier actionId con esa keyword generica en esa URL esta mal enrutado. Sin embargo, en el backlog vivo de esta pasada siguen apareciendo action items para \"taquillas melamina\" y \"taquillas de melamina\" apuntando precisamente a /taquillas-melamina-fenolico/ en vez de a /taquillas-melamina/ (su cluster correcto segun matchPatterns/excludePatterns).",
              "basis": "evidence",
              "evidenceRefs": [
                "ev6",
                "ev7",
                "ev8",
                "ev9"
              ]
            },
            {
              "id": "f4",
              "category": "keyword_strategy",
              "description": "Tres keywords objetivo del catalogo de negocio (\"taquillas para gimnasios\" -- alta prioridad, \"lockers inteligentes\" -- alta prioridad, \"digitalizacion de taquillas\" -- media prioridad) no tienen ningun cluster ni action item asociado visible en este contexto, quedando sin pagina de destino clara.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev12",
                "ev13",
                "ev14"
              ]
            },
            {
              "id": "f5",
              "category": "content",
              "description": "El catalogo de clusters ya tiene 4 candidatos a pagina nueva (universidades, taquillas metalicas, taquillas para vestuarios, taquillas inteligentes general) con staging ya creado y en su mayoria visualmente aprobado, pendientes de avanzar a produccion.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev15",
                "ev16",
                "ev17",
                "ev18"
              ]
            },
            {
              "id": "f6",
              "category": "keyword_strategy",
              "description": "El cluster de terminos comerciales genericos (\"comprar taquillas\", \"soluciones de taquillas\") esta marcado como postpone: intencion transaccional real pero sin angulo de producto/sector propio, con alto riesgo de canibalizar paginas de sector/material ya existentes si se crean paginas nuevas para ello.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev19"
              ]
            },
            {
              "id": "f7",
              "category": "structure",
              "description": "Multiples paginas con impresiones reales (colegios, melamina, melamina-fenolico, fenolicas) muestran CTR 0.00% en los action items de esta pasada, un patron repetido que sugiere un problema sistemico de meta titles/descriptions poco atractivos en varias familias de paginas, no un caso aislado.",
              "basis": "inference",
              "evidenceRefs": [
                "ev24"
              ]
            },
            {
              "id": "f8",
              "category": "content",
              "description": "Las keywords del sector hospitales (\"taquillas para hospital\", \"comprar taquillas para hospitales\") tienen action items reales y una pagina de destino consolidada (/taquillas-para-hospitales/), pero no existe ninguna entrada de cluster para este sector en el catalogo -- una posible laguna de gobernanza del catalogo de clusters.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev20",
                "ev21"
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
              "recommendedAction": "Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.",
              "rationale": "47 impresiones reales, posicion 20.5, ya cerca de primera pagina -- el quick win de mayor prioridad de este run.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev1"
              ]
            },
            {
              "id": "o2",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Ajuste ligero de on-page (title/meta/H1) para consolidar la posicion 10.6 dentro de top 10, dado que ya esta al borde de la primera pagina.",
              "rationale": "21 impresiones, posicion 10.6 -- esfuerzo minimo, ya practicamente en top 10.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev21"
              ]
            },
            {
              "id": "o3",
              "keyword": "taquillas colegios",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Reescribir meta title/description (CTR actual 0.00%) y reforzar contenido on-page para pasar de posicion 25.1 a top 10.",
              "rationale": "40 impresiones, posicion 25.1, CTR 0% pese a aparecer en resultados.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev23"
              ]
            },
            {
              "id": "o4",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Reforzar contenido on-page y reescribir meta title/description alineados con el recommendedTitle/recommendedMetaDescription ya definidos para este cluster (pagina correcta segun O29.1).",
              "rationale": "74 impresiones, posicion 28.7, CTR 0% -- pagina correcta segun el cluster taquillas_melamina.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev11",
                "ev9"
              ]
            },
            {
              "id": "o5",
              "keyword": "cerraduras sostenibles para gimnasios",
              "kind": "cannibalization",
              "priority": "medium",
              "recommendedAction": "Decidir con Pau una unica pagina de destino para esta keyword (candidatas: /cerraduras-inteligentes-taquillas/ o una landing de sector deportivo) antes de invertir en contenido, en vez de dejar que ambas paginas compitan.",
              "rationale": "Dos action items para la misma keyword apuntan a paginas distintas sin resolucion documentada en el catalogo de clusters.",
              "basis": "inference",
              "evidenceRefs": [
                "ev4",
                "ev5"
              ]
            },
            {
              "id": "o6",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "kind": "technical",
              "priority": "high",
              "recommendedAction": "No ejecutar la accion tal cual: redirigir el esfuerzo hacia /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (/cerraduras-inteligentes-taquillas/), a decidir por Pau, ya que la URL actual esta en papelera con 301.",
              "rationale": "El cluster documenta explicitamente que /cerraduras/ esta obsoleta desde O22.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev2",
                "ev3"
              ]
            },
            {
              "id": "o7",
              "kind": "content_gap",
              "keyword": "taquillas universidad / taquillas metalicas / taquillas vestuarios / taquillas inteligentes",
              "priority": "medium",
              "recommendedAction": "Avanzar a produccion los 4 clusters new_page_candidate ya creados y en su mayoria aprobados visualmente en staging (universidades, metalicas, vestuarios, inteligentes general), priorizando taquillas_metalicas por coincidir con una keyword objetivo del negocio.",
              "rationale": "Huecos de contenido ya identificados y validados en staging, listos para publicar.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev15",
                "ev16",
                "ev17",
                "ev18"
              ]
            },
            {
              "id": "o8",
              "keyword": "taquillas melamina / taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "kind": "technical",
              "priority": "medium",
              "recommendedAction": "Cerrar/realinear estos action items del backlog para que la keyword generica \"melamina\" apunte a /taquillas-melamina/ en lugar de /taquillas-melamina-fenolico/, conforme a la decision O29.1 ya aprobada.",
              "rationale": "El catalogo de clusters marca este enrutamiento como error conocido, pero sigue apareciendo en el backlog vivo de esta pasada.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev6",
                "ev7",
                "ev8"
              ]
            }
          ],
          "technicalIssues": [
            {
              "id": "t1",
              "page": "https://zentrylockers.com/cerraduras/",
              "issue": "Pagina en papelera desde O22 con redireccion 301 real hacia /cerraduras-para-taquillas/, pero sigue recibiendo recomendaciones de trabajo on-page/contenido nuevo desde el backlog vivo de esta pasada.",
              "severity": "high",
              "basis": "evidence",
              "evidenceRefs": [
                "ev2",
                "ev3",
                "ev4"
              ]
            },
            {
              "id": "t2",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "issue": "Recibe action items para la keyword generica \"melamina\", contraviniendo la decision O29.1 que reserva esta URL exclusivamente para la combinacion especifica melamina+fenolico.",
              "severity": "medium",
              "basis": "evidence",
              "evidenceRefs": [
                "ev6",
                "ev7",
                "ev8"
              ]
            },
            {
              "id": "t3",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "issue": "CTR 0.00% pese a impresiones reales, patron que se repite en varias paginas de material/sector (melamina, fenolicas, melamina-fenolico) -- sugiere meta titles/descriptions poco atractivos de forma sistemica.",
              "severity": "medium",
              "basis": "inference",
              "evidenceRefs": [
                "ev24"
              ]
            }
          ],
          "contentGaps": [
            {
              "id": "c1",
              "topic": "Taquillas para universidades",
              "relatedKeyword": "taquillas universidad",
              "rationale": "Cluster new_page_candidate sin pagina de produccion equivalente confirmada; staging ya creado y visualmente aprobado.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev15"
              ]
            },
            {
              "id": "c2",
              "topic": "Taquillas metalicas",
              "relatedKeyword": "taquillas metalicas",
              "rationale": "Tercer material del catalogo (junto a melamina/fenolica) sin pagina propia; ademas coincide con una keyword objetivo de prioridad media del negocio.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev16"
              ]
            },
            {
              "id": "c3",
              "topic": "Taquillas para vestuarios",
              "relatedKeyword": "taquillas para vestuarios",
              "rationale": "Distinto de /bancos-de-vestuario/ (mobiliario complementario); sin pagina equivalente, staging ya aprobado.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev17"
              ]
            },
            {
              "id": "c4",
              "topic": "Taquillas inteligentes (solucion general, mueble+cerradura+PIN/RFID/app)",
              "relatedKeyword": "taquillas inteligentes",
              "rationale": "Distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); staging corregido en O28.6, pendiente de aprobacion visual real.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev18"
              ]
            },
            {
              "id": "c5",
              "topic": "Taquillas para gimnasios",
              "relatedKeyword": "taquillas para gimnasios",
              "rationale": "Keyword objetivo de alta prioridad (commercial) sin cluster ni pagina asociada visible en este contexto.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev12"
              ]
            },
            {
              "id": "c6",
              "topic": "Lockers inteligentes",
              "relatedKeyword": "lockers inteligentes",
              "rationale": "Keyword objetivo de alta prioridad sin cluster explicito; podria solapar con taquillas_inteligentes_general pero requiere decision humana antes de fusionar.",
              "basis": "inference",
              "evidenceRefs": [
                "ev13",
                "ev18"
              ]
            },
            {
              "id": "c7",
              "topic": "Digitalizacion de taquillas",
              "relatedKeyword": "digitalizacion de taquillas",
              "rationale": "Keyword objetivo informacional de prioridad media sin cluster ni pagina asociada visible en este contexto.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev14"
              ]
            }
          ],
          "internalLinkRecommendations": [
            {
              "id": "i1",
              "fromPage": "https://zentrylockers.com/taquillas-melamina/",
              "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "anchorTextSuggestion": "taquillas de melamina con puertas fenolicas",
              "rationale": "Ambas paginas atacan intenciones deliberadamente diferenciadas (material generico vs. combinacion especifica); un enlace cruzado ayuda al usuario a autoseleccionar el producto correcto y refuerza la diferenciacion que ya decidio Pau en O29.1, reduciendo el riesgo de que Google las siga confundiendo.",
              "basis": "inference",
              "evidenceRefs": [
                "ev8",
                "ev9"
              ]
            },
            {
              "id": "i2",
              "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "toPage": "https://zentrylockers.com/cerraduras-para-taquillas/",
              "anchorTextSuggestion": "ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO",
              "rationale": "El cluster de cerraduras inteligentes es la version informativa; enlazar hacia la pagina comercial de catalogo (mencionada explicitamente en el catalogo de clusters) ayuda a completar el funnel informativo->comercial sin fusionar ambas paginas.",
              "basis": "inference",
              "evidenceRefs": [
                "ev22"
              ]
            },
            {
              "id": "i3",
              "fromPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "toPage": "https://zentrylockers.com/taquillas-melamina/",
              "anchorTextSuggestion": "ver gama completa de taquillas de melamina",
              "rationale": "Enlace reciproco al anterior (i1); ayuda a que el trafico que llega a la pagina especifica por error de busqueda generica encuentre facilmente la pagina general correcta.",
              "basis": "inference",
              "evidenceRefs": [
                "ev8",
                "ev9"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "rank": 1,
              "title": "Resolver la situacion de /cerraduras/ (pagina en papelera con redireccion) y decidir destino unico para \"cerraduras inteligentes centros deportivos\"/\"cerraduras sostenibles para gimnasios\"",
              "relatedIds": [
                "f1",
                "f2",
                "o5",
                "o6",
                "t1"
              ],
              "priority": "high",
              "effort": "low",
              "impact": "high"
            },
            {
              "rank": 2,
              "title": "Ejecutar quick win on-page para \"cerraduras inteligentes para taquillas\"",
              "relatedIds": [
                "o1"
              ],
              "priority": "high",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 3,
              "title": "Realinear backlog: mover action items de \"melamina\" generica de /taquillas-melamina-fenolico/ a /taquillas-melamina/ segun decision O29.1",
              "relatedIds": [
                "f3",
                "o8",
                "t2"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "medium"
            },
            {
              "rank": 4,
              "title": "Reescribir meta titles/descriptions en paginas con CTR 0% pese a impresiones reales (colegios, melamina, fenolicas)",
              "relatedIds": [
                "o3",
                "o4",
                "t3"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "medium"
            },
            {
              "rank": 5,
              "title": "Publicar a produccion los 4 content gaps ya aprobados en staging (universidades, metalicas, vestuarios, inteligentes general)",
              "relatedIds": [
                "f5",
                "o7",
                "c1",
                "c2",
                "c3",
                "c4"
              ],
              "priority": "medium",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 6,
              "title": "Ajuste menor de quick wins ya cercanos a top 10 en el sector hospitales",
              "relatedIds": [
                "o2",
                "f8"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "low"
            },
            {
              "rank": 7,
              "title": "Decidir estrategia para keywords objetivo sin cluster asignado (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas)",
              "relatedIds": [
                "f4",
                "c5",
                "c6",
                "c7"
              ],
              "priority": "low",
              "effort": "medium",
              "impact": "medium"
            }
          ],
          "evidence": [
            {
              "id": "ev1",
              "source": "job_data",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "quick_win, prioridad alta, posicion 20.5, 47 impresiones, objetivo top 10."
            },
            {
              "id": "ev2",
              "source": "job_data",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "future_opportunity + low_ctr, prioridad alta, posicion 37.6, 31 impresiones, CTR 0%."
            },
            {
              "id": "ev3",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "Cluster cerraduras_inteligentes_centros_deportivos, action=reject: la pagina objetivo esta en papelera desde O22 con redireccion 301 real hacia /cerraduras-para-taquillas/."
            },
            {
              "id": "ev4",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "future_opportunity + low_ctr, posicion 30.9, 21 impresiones, CTR 0%."
            },
            {
              "id": "ev5",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "future_opportunity + low_ctr, posicion 45.7, 20 impresiones, CTR 0%."
            },
            {
              "id": "ev6",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "future_opportunity + low_ctr, posicion 43.1, 62 impresiones, CTR 0%."
            },
            {
              "id": "ev7",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "future_opportunity + low_ctr, posicion 43.1, 51 impresiones, CTR 0%."
            },
            {
              "id": "ev8",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "Cluster taquillas_melamina_fenolico, decision O29.1: la keyword generica 'melamina' NO debe apuntar aqui; cualquier actionId con esa keyword apuntando a esta URL se considera mal enrutado."
            },
            {
              "id": "ev9",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "Cluster taquillas_melamina, matchPatterns incluye 'taquillas melamina'/'taquillas de melamina'/'taquilla madera', excludePatterns 'fenolico' -- pagina correcta segun O29.1."
            },
            {
              "id": "ev10",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "future_opportunity + low_ctr, posicion 30.1, 86 impresiones, CTR 0%."
            },
            {
              "id": "ev11",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "quick_win + low_ctr, posicion 28.7, 74 impresiones, CTR 0%."
            },
            {
              "id": "ev12",
              "source": "target_keyword_catalog",
              "keyword": "taquillas para gimnasios",
              "description": "Keyword objetivo commercial, prioridad alta."
            },
            {
              "id": "ev13",
              "source": "target_keyword_catalog",
              "keyword": "lockers inteligentes",
              "description": "Keyword objetivo commercial, prioridad alta."
            },
            {
              "id": "ev14",
              "source": "target_keyword_catalog",
              "keyword": "digitalizacion de taquillas",
              "description": "Keyword objetivo informational, prioridad media."
            },
            {
              "id": "ev15",
              "source": "cluster_catalog",
              "keyword": "taquillas universidad",
              "description": "Cluster taquillas_universidad, action=new_page_candidate, sin targetUrl, staging 2110 ya creado y visualmente aprobado."
            },
            {
              "id": "ev16",
              "source": "cluster_catalog",
              "keyword": "taquillas metalicas",
              "description": "Cluster taquillas_metalicas, action=new_page_candidate, sin targetUrl, staging 2105 ya creado y visualmente aprobado."
            },
            {
              "id": "ev17",
              "source": "cluster_catalog",
              "keyword": "taquillas para vestuarios",
              "description": "Cluster taquillas_vestuarios, action=new_page_candidate, sin targetUrl, staging 2104 ya creado y visualmente aprobado."
            },
            {
              "id": "ev18",
              "source": "cluster_catalog",
              "keyword": "taquillas inteligentes",
              "description": "Cluster taquillas_inteligentes_general, action=new_page_candidate, sin targetUrl, staging 2103 corregido en O28.6, pendiente de aprobacion visual real."
            },
            {
              "id": "ev19",
              "source": "cluster_catalog",
              "keyword": "comprar taquillas",
              "description": "Cluster taquillas_comercial_generico, action=postpone: intencion transaccional real pero sin angulo propio, riesgo de canibalizar paginas de sector/material existentes."
            },
            {
              "id": "ev20",
              "source": "job_data",
              "keyword": "taquillas para hospital",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "description": "quick_win + low_ctr, posicion 17.1, 22 impresiones, CTR 0%."
            },
            {
              "id": "ev21",
              "source": "job_data",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "description": "quick_win, posicion 10.6, 21 impresiones."
            },
            {
              "id": "ev22",
              "source": "cluster_catalog",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "Cluster cerraduras_inteligentes_taquillas menciona explicitamente /cerraduras-para-taquillas/ (id 2060, catalogo comercial ARES/ORBIS/BOXIS/NEO) como pagina diferenciada de intencion comercial."
            },
            {
              "id": "ev23",
              "source": "job_data",
              "keyword": "taquillas colegios",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "quick_win + low_ctr, posicion 25.1, 40 impresiones, CTR 0%."
            },
            {
              "id": "ev24",
              "source": "job_data",
              "description": "Patron repetido de CTR 0.00% pese a impresiones reales en multiples action items de esta pasada (taquillas-para-colegios, taquillas-melamina, taquillas-fenolicas, taquillas-melamina-fenolico, cerraduras)."
            }
          ],
          "unknowns": [
            "No se dispone de cifras de clics/conversion post-clic mas alla del CTR 0.00% reportado en los action items.",
            "No se sabe si el script de resolucion de canibalizacion de melamina (O29.1, scripts/o291-resolve-melamina-cannibalization.ts) ya se ejecuto sobre estos jobs concretos o si son entradas nuevas aun no barridas.",
            "No existe entrada de cluster para el sector hospitales pese a tener pagina real y action items activos -- se desconoce si es una omision del catalogo o una decision consciente no documentada en este contexto.",
            "Solo se dispone de las rutas del ultimo informe del SEO Watcher/Director, no de su contenido, por lo que no se puede contrastar si estos hallazgos ya fueron reportados o accionados previamente.",
            "No hay confirmacion explicita de si la keyword objetivo 'lockers inteligentes' debe fusionarse con el cluster taquillas_inteligentes_general o tratarse como cluster aparte."
          ]
        }
      },
      {
        "employee": "content-strategist",
        "status": "executed",
        "output": {
          "contentOpportunity": {
            "title": "Actualizar y ampliar la pagina de taquillas de melamina para captar busquedas de colegios/oficinas",
            "summary": "La keyword \"taquillas melamina\" ya tiene pagina propia y trafico potencial en un cluster con terminos de colegios/escolares, por lo que conviene reforzar su contenido y enlazado antes de que otras paginas del cluster le resten relevancia."
          },
          "targetAudience": "Responsable de compras o direccion de un centro educativo (colegio/instituto) u oficina que necesita equipar o renovar taquillas en un entorno seco, buscando un material con buena relacion calidad-precio antes de pedir presupuesto.",
          "searchIntent": "commercial",
          "commercialIntent": "El usuario que busca \"taquillas melamina\" esta evaluando si este material encaja con su espacio (colegio, oficina, vestuario seco) antes de contactar; la pagina debe resolver esa duda y convertir esa evaluacion en una solicitud de presupuesto.",
          "angle": "Centrar el contenido en cuando la melamina es la eleccion correcta frente a fenolica/metalica, usando como referencia los entornos de uso reales (colegios, oficinas, vestuarios secos) en vez de listar caracteristicas de producto de forma generica.",
          "contentType": "landing_block",
          "targetBrand": "zentry",
          "recommendedStructure": {
            "h1": "Taquillas de melamina: la opcion equilibrada para colegios y oficinas",
            "sections": [
              {
                "heading": "Que son las taquillas de melamina",
                "level": "H2",
                "purpose": "Explicar el material (acabado tipo madera, buena relacion calidad-precio, resistencia media a la humedad) y en que espacios encaja mejor, segun el catalogo confirmado."
              },
              {
                "heading": "Tipos y materiales disponibles",
                "level": "H2",
                "purpose": "Presentar melamina, fenolica y metalica en bloques/cards diferenciados, mostrando para que entorno sirve cada uno sin mezclar los tres en texto corrido."
              },
              {
                "heading": "Metalica vs fenolica vs melamina",
                "level": "H3",
                "purpose": "Tabla comparativa (exigida por la guia de marca cuando se comparan opciones) que ayude a decidir segun humedad, impacto y presupuesto del espacio del comprador."
              },
              {
                "heading": "Como elegir la medida correcta",
                "level": "H2",
                "purpose": "Guiar con preguntas practicas (numero de usuarios, espacio disponible, tipo de cierre) sin inventar medidas o modelos concretos que no esten en el contexto."
              },
              {
                "heading": "Solicita tu presupuesto personalizado",
                "level": "H2",
                "purpose": "Cerrar la decision de compra remitiendo a presupuesto a medida, sin afirmar precios ni plazos que no vienen dados."
              },
              {
                "heading": "Preguntas frecuentes sobre taquillas de melamina",
                "level": "H2",
                "purpose": "Resolver objeciones tipicas (durabilidad en entornos humedos vs secos, diferencia con fenolica) sin afirmar garantia ni fabricante directo salvo que se confirme en el pedido."
              }
            ]
          },
          "ctaStrategy": {
            "primaryCta": "Solicitar presupuesto sin compromiso",
            "secondaryCta": "Consultar con el equipo dudas sobre medidas o personalizacion",
            "rationale": "La intencion es comercial pero de evaluacion, no de compra inmediata: el CTA principal debe ser de bajo compromiso (presupuesto) y el secundario da salida a quien aun necesita resolver dudas tecnicas antes de pedir precio, sin prometer ninguna cifra en la propia pagina."
          },
          "internalLinks": [
            {
              "anchorIdea": "taquillas para colegios",
              "targetDescription": "landing o categoria de taquillas escolares, keywords relacionadas: taquillas colegios, taquillas escolares",
              "isRealLink": false
            },
            {
              "anchorIdea": "taquillas fenolicas para vestuarios humedos",
              "targetDescription": "pagina sobre taquillas fenolicas, keyword relacionada: taquillas fenolicas en palencia",
              "isRealLink": false
            },
            {
              "anchorIdea": "ver todo el catalogo de taquillas",
              "targetDescription": "landing o categoria principal de taquillas (segun internalLinkHints: enlazar hacia la landing/categoria principal relacionada)",
              "isRealLink": false
            }
          ],
          "supportingEvidence": [
            "currentAssumptions confirma que 'taquillas melamina' sigue siendo relevante para zentry y que la pagina https://zentrylockers.com/taquillas-melamina/ sigue existiendo en esa URL.",
            "clusterNote senala solapamiento con taquillas de melamina, taquillas colegios, taquillas escolares, taquillas fenolicas en palencia y comprar taquillas -- justifica el enlazado interno propuesto y el enfoque diferenciador hacia colegios/oficinas.",
            "El catalogo confirmado de zentry-brand indica que la melamina es adecuada para oficinas, colegios y vestuarios secos, lo que respalda directamente el angulo y la audiencia elegidos.",
            "brandRationale del contexto confirma que la intencion principal es de mobiliario (Zentry), sin mencion de cerraduras."
          ],
          "priority": "medium",
          "risksAndUnknowns": [
            "Riesgo de canibalizacion SEO con otras paginas del cluster (taquillas colegios, taquillas escolares, taquillas fenolicas en palencia, comprar taquillas) si no se cuida el enlazado interno y la diferenciacion de intencion entre paginas.",
            "No hay datos de precio, plazo de entrega ni garantia en currentAssumptions, por lo que la seccion de presupuesto no puede incluir cifras y debe remitir siempre a solicitar presupuesto.",
            "No se dispone del contenido actual de la pagina (solo el hint de estructura previa), por lo que no se puede confirmar cuanto de esta propuesta ya existe o cuanto es realmente nuevo.",
            "Una decision humana anterior rechazo publicar paginas nuevas de staging por verse 'demasiado basicas y sin suficientes imagenes/fotografias'; aunque esa decision fue sobre otras paginas (universidades, metalicas, vestuarios, taquillas inteligentes), es una senal de que el liston de calidad visual/de contenido puede aplicar tambien a esta actualizacion antes de publicar."
          ],
          "reasoningNotes": [
            "Cambie el contentType de 'Mejora de title/meta' (hint) a 'landing_block' porque proposedStructureHint describe una estructura de contenido completa (que es, tipos de material, comparativa, como elegir medida, FAQ) que va mas alla de un simple ajuste de title/meta -- corresponde mejor a una revision de bloques de contenido de la landing existente.",
            "Renombre la seccion 'Precios y presupuesto' a 'Solicita tu presupuesto personalizado' para evitar que el heading implique que se van a mostrar cifras de precio, ya que currentAssumptions no aporta ningun dato de precio.",
            "Acote la audiencia a colegios/oficinas (entornos secos) en lugar de un publico generico de 'compradores de taquillas', apoyandome en que el catalogo confirmado asigna la melamina especificamente a oficinas, colegios y vestuarios secos, y en que las secondaryKeywords estan dominadas por terminos escolares.",
            "Mantengo priority en 'medium' tal como llega del contexto: no hay señales en el contexto (volumen, urgencia comercial especifica) que justifiquen subirla o bajarla."
          ]
        }
      },
      {
        "employee": "analytics-specialist",
        "status": "executed",
        "output": {
          "runSummary": {
            "departmentRunId": "dept-2026-08-17T103833Z",
            "reportGeneratedAt": "2026-08-17T10:38:53.236Z",
            "ga4Connected": true,
            "gtmConnected": true
          },
          "measurementFindings": [
            {
              "claimType": "FACT",
              "statement": "GA4 y GTM se leyeron en vivo en esta pasada: GA4 cubre el periodo 2026-07-19 a 2026-08-16 y el contenedor GTM www.zentrylockers.com (GTM-MSPSGLK5) reporta 8 tags y 7 triggers.",
              "evidenceIds": [
                "E23"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "De los 7 eventos clave listados, 6 se dispararon al menos una vez en el periodo (generate_lead_form_submit, click_whatsapp, click_request_quote, click_catalog_download, view_quote_page, view_contact_page) y 1 (click_phone) no se disparo ninguna vez.",
              "evidenceIds": [
                "E13",
                "E14",
                "E15",
                "E16",
                "E17",
                "E18",
                "E19"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Tres de los siete eventos clave (view_quote_page, view_contact_page, click_catalog_download) tienen occurrences mayores que cero pero 0 conversions en GA4, mientras que generate_lead_form_submit, click_whatsapp y click_request_quote muestran conversions iguales a occurrences, lo que sugiere que solo un subconjunto de eventos esta configurado como conversion en GA4.",
              "evidenceIds": [
                "E17",
                "E18",
                "E19",
                "E13",
                "E14",
                "E16"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La version live de GTM se llama \"O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)\".",
              "evidenceIds": [
                "E22"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El propio nombre de la version live de GTM indica que los cambios estan \"sin publicar, pendiente aprobacion Pau\", lo cual es inconsistente con que se reporte como version live/actual.",
              "evidenceIds": [
                "E22"
              ]
            }
          ],
          "funnelObservations": [
            {
              "claimType": "FACT",
              "statement": "view_quote_page se disparo 12 veces, click_request_quote se disparo 65 veces y generate_lead_form_submit se disparo 6 veces en el periodo.",
              "evidenceIds": [
                "E18",
                "E16",
                "E13"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Las occurrences de click_request_quote (65) superan en mas de 5 veces a las de view_quote_page (12), es decir, en el agregado la mayoria de los click_request_quote no van precedidos por un view_quote_page registrado.",
              "evidenceIds": [
                "E18",
                "E16"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "De 65 eventos click_request_quote solo se registraron 6 eventos generate_lead_form_submit, por lo que el tramo final del embudo (clic en CTA de presupuesto -> envio de formulario) se estrecha fuertemente.",
              "evidenceIds": [
                "E16",
                "E13"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "click_whatsapp se disparo 15 veces con 15 conversions, mientras que click_phone se disparo 0 veces en el periodo.",
              "evidenceIds": [
                "E14",
                "E15"
              ]
            }
          ],
          "trafficObservations": [
            {
              "claimType": "FACT",
              "statement": "El canal Direct tuvo 172 sesiones, 69 usuarios activos y 81 conversiones, el mas alto de los cuatro canales reportados.",
              "evidenceIds": [
                "E1"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Direct concentra la gran mayoria de las sesiones totales reportadas (172 de 183 sumando los cuatro canales) y de las conversiones totales (81 de 86).",
              "evidenceIds": [
                "E1",
                "E2",
                "E3",
                "E4"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "Organic Search tuvo 6 sesiones/6 usuarios activos/3 conversiones, Referral tuvo 3 sesiones/1 usuario activo/2 conversiones, y AI Assistant tuvo 2 sesiones/2 usuarios activos/0 conversiones.",
              "evidenceIds": [
                "E2",
                "E3",
                "E4"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "En el desglose fuente/medio aparece tagassistant.google.com/referral con 3 sesiones y 2 conversiones.",
              "evidenceIds": [
                "E6"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La landing page \"/\" recibio 114 sesiones y 58 conversiones con una tasa de rebote del 31.6%, la de mas trafico entre las reportadas.",
              "evidenceIds": [
                "E10"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La landing page /configurador-bancos recibio 10 sesiones, 6 conversiones y una tasa de rebote del 10%.",
              "evidenceIds": [
                "E11"
              ]
            }
          ],
          "conversionObservations": [
            {
              "claimType": "FACT",
              "statement": "La landing page /product/taquilla-2-puertas-modulo-1-melamina muestra 4 sesiones pero 11 conversiones en el periodo.",
              "evidenceIds": [
                "E12"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Las conversiones del canal Direct (81) relativas a sus sesiones (172) implican aproximadamente una conversion cada dos sesiones, un ratio mayor que el de Organic Search (3 conversiones/6 sesiones) y muy superior al de AI Assistant (0 conversiones/2 sesiones).",
              "evidenceIds": [
                "E1",
                "E2",
                "E4"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "click_request_quote es el evento clave con mas conversiones registradas (65), seguido de click_whatsapp (15) y generate_lead_form_submit (6).",
              "evidenceIds": [
                "E16",
                "E14",
                "E13"
              ]
            }
          ],
          "trackingIssues": [
            {
              "claimType": "FACT",
              "statement": "El evento clave click_phone no se disparo en el periodo (0 occurrences, 0 conversions) pese a que GTM tiene un tag no pausado \"GA4 Event - click_phone\" y un trigger linkClick llamado \"click_phone\" configurados.",
              "evidenceIds": [
                "E15",
                "E20",
                "E21"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "view_quote_page, view_contact_page y click_catalog_download se dispararon en el periodo pero registraron 0 conversions cada uno en GA4, a diferencia de generate_lead_form_submit, click_whatsapp y click_request_quote, cuyas conversions igualan a sus occurrences.",
              "evidenceIds": [
                "E17",
                "E18",
                "E19",
                "E13",
                "E14",
                "E16"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El contenedor GTM tiene 8 tags pero solo 7 triggers, y ninguno de los nombres de trigger listados coincide explicitamente con \"generate_lead_form_submit\", \"click_request_quote\" ni \"view_contact_page\", mientras que dos triggers referencian la ruta /solicitar-presupuesto/ (uno linkClick, otro pageview).",
              "evidenceIds": [
                "E23",
                "E24",
                "E25"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El listado de watcherWarnings de esta pasada esta vacio.",
              "evidenceIds": [
                "E26"
              ]
            }
          ],
          "anomalyCandidates": [
            {
              "claimType": "OBSERVATION",
              "statement": "La landing page /product/taquilla-2-puertas-modulo-1-melamina reporta mas conversiones (11) que sesiones (4) en el periodo.",
              "evidenceIds": [
                "E12"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Las occurrences de click_request_quote (65) son mas de 5 veces las de view_quote_page (12) y mas de 10 veces las de generate_lead_form_submit (6).",
              "evidenceIds": [
                "E16",
                "E18",
                "E13"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Una de las fuentes de Referral es tagassistant.google.com, una herramienta de depuracion de Google, que aporta 3 sesiones y 2 conversiones al canal Referral.",
              "evidenceIds": [
                "E6",
                "E3"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "click_phone registro 0 occurrences durante las cuatro semanas del periodo pese a tener un tag y un trigger de GTM activos y no pausados.",
              "evidenceIds": [
                "E15",
                "E20",
                "E21"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El nombre de la version live de GTM hace referencia a cambios sin publicar pendientes de aprobacion (\"sin publicar, pendiente aprobacion Pau\").",
              "evidenceIds": [
                "E22"
              ]
            }
          ],
          "hypotheses": [
            {
              "claimType": "HYPOTHESIS",
              "statement": "Que las conversiones de /product/taquilla-2-puertas-modulo-1-melamina (11) superen sus sesiones (4) podria explicarse porque GA4 cuenta varios eventos de conversion por sesion, o porque se atribuyen conversiones a esta landing page desde sesiones iniciadas en otra pagina, y no necesariamente por un error de datos.",
              "evidenceIds": [
                "E12"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "La brecha entre las occurrences de click_request_quote (65) y de view_quote_page (12) podria explicarse porque el trigger de click_request_quote esta asociado a un CTA presente en varias paginas (no solo en la de presupuesto), por lo que no requiere un view_quote_page previo.",
              "evidenceIds": [
                "E16",
                "E18"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "La ausencia de disparos de click_phone podria explicarse porque los usuarios reales no hicieron clic en el enlace de telefono durante el periodo, o alternativamente por un desajuste entre el selector del trigger linkClick y el marcado actual del enlace/boton de telefono en el sitio.",
              "evidenceIds": [
                "E15",
                "E20",
                "E21"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Las 3 sesiones desde tagassistant.google.com/referral podrian reflejar actividad interna de QA/depuracion registrada como trafico Referral normal, en vez de clientes potenciales reales.",
              "evidenceIds": [
                "E6"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Que view_quote_page, view_contact_page y click_catalog_download muestren 0 conversions pese a dispararse podria explicarse porque estos tres eventos no estan marcados como \"key event\"/conversion en la configuracion de la propiedad GA4, en vez de por un fallo de tracking.",
              "evidenceIds": [
                "E17",
                "E18",
                "E19"
              ]
            }
          ],
          "recommendedMeasurements": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GA4 DebugView si el tag/trigger de click_phone en GTM se dispara correctamente al probar manualmente un clic en el enlace/boton de telefono, para confirmar que el selector del trigger sigue coincidiendo con el marcado actual del sitio.",
              "evidenceIds": [
                "E15",
                "E20",
                "E21"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar en la configuracion de la propiedad GA4 si view_quote_page, view_contact_page y click_catalog_download estan marcados intencionalmente como \"conversion\" o excluidos de esa marca.",
              "evidenceIds": [
                "E17",
                "E18",
                "E19"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Crear una exploracion/segmento en GA4 que aisle las sesiones con source tagassistant.google.com para confirmar si representan trafico de pruebas internas y, si es asi, excluirlas de los informes de canal/conversion.",
              "evidenceIds": [
                "E6"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Investigar en GTM/GA4 en que pagina(s) esta configurado el trigger de click_request_quote para aclarar por que sus occurrences (65) son muy superiores a las de view_quote_page (12).",
              "evidenceIds": [
                "E16",
                "E18"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar con el responsable del workspace de GTM (Pau) si la version descrita como pendiente de aprobacion (\"O44 - Eventos CTA nuevos\") es realmente la version publicada/live o si sigue pendiente de publicacion, ya que el contenedor se esta leyendo como configuracion live.",
              "evidenceIds": [
                "E22"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar la atribucion de sesiones/conversiones de /product/taquilla-2-puertas-modulo-1-melamina para confirmar como esta contando GA4 11 conversiones frente a 4 sesiones en esa landing page.",
              "evidenceIds": [
                "E12"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GA4 DebugView el disparo de click_phone probando manualmente un clic en el enlace/boton de telefono, dado que es un evento clave de contacto con 0 disparos en cuatro semanas pese a tener tag y trigger activos en GTM.",
              "evidenceIds": [
                "E15",
                "E20",
                "E21"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar con el responsable del workspace de GTM (Pau) el estado real de publicacion de la version live actual, ya que su nombre indica cambios pendientes de aprobacion y de esto depende la fiabilidad de todo el analisis de tags/triggers.",
              "evidenceIds": [
                "E22"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar la marca de conversion en GA4 para view_quote_page, view_contact_page y click_catalog_download, ya que se disparan pero no suman conversiones, lo que puede subestimar el embudo real.",
              "evidenceIds": [
                "E17",
                "E18",
                "E19"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Investigar en que paginas dispara click_request_quote para explicar la gran diferencia frente a view_quote_page y entender mejor el recorrido de conversion.",
              "evidenceIds": [
                "E16",
                "E18"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Crear un segmento que aisle el trafico de tagassistant.google.com para descartar que se trate de trafico de pruebas contaminando el canal Referral.",
              "evidenceIds": [
                "E6"
              ],
              "priority": "low"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar la atribucion de conversiones de la landing page /product/taquilla-2-puertas-modulo-1-melamina, donde las conversiones superan a las sesiones.",
              "evidenceIds": [
                "E12"
              ],
              "priority": "low"
            }
          ],
          "evidence": [
            {
              "id": "E1",
              "source": "ga4_channel_traffic",
              "description": "Canal Direct: 172 sesiones, 69 usuarios activos, 81 conversiones (periodo 2026-07-19 a 2026-08-16)."
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
              "source": "ga4_source_medium",
              "description": "Fuente/medio (direct)/(none): 172 sesiones, 81 conversiones."
            },
            {
              "id": "E6",
              "source": "ga4_source_medium",
              "description": "Fuente/medio tagassistant.google.com/referral: 3 sesiones, 2 conversiones."
            },
            {
              "id": "E7",
              "source": "ga4_source_medium",
              "description": "Fuente/medio chatgpt.com/ai-assistant: 2 sesiones, 0 conversiones."
            },
            {
              "id": "E8",
              "source": "ga4_source_medium",
              "description": "Fuente/medio duckduckgo/organic: 1 sesion, 0 conversiones."
            },
            {
              "id": "E9",
              "source": "ga4_source_medium",
              "description": "Fuente/medio google/organic: 5 sesiones, 3 conversiones."
            },
            {
              "id": "E10",
              "source": "ga4_landing_pages",
              "description": "Landing page \"/\": 114 sesiones, 58 conversiones, tasa de rebote 31.6%."
            },
            {
              "id": "E11",
              "source": "ga4_landing_pages",
              "description": "Landing page /configurador-bancos: 10 sesiones, 6 conversiones, tasa de rebote 10%."
            },
            {
              "id": "E12",
              "source": "ga4_landing_pages",
              "description": "Landing page /product/taquilla-2-puertas-modulo-1-melamina: 4 sesiones, 11 conversiones, tasa de rebote 25%."
            },
            {
              "id": "E13",
              "source": "ga4_key_events",
              "description": "Evento generate_lead_form_submit: fired=true, occurrences=6, conversions=6."
            },
            {
              "id": "E14",
              "source": "ga4_key_events",
              "description": "Evento click_whatsapp: fired=true, occurrences=15, conversions=15."
            },
            {
              "id": "E15",
              "source": "ga4_key_events",
              "description": "Evento click_phone: fired=false, occurrences=0, conversions=0."
            },
            {
              "id": "E16",
              "source": "ga4_key_events",
              "description": "Evento click_request_quote: fired=true, occurrences=65, conversions=65."
            },
            {
              "id": "E17",
              "source": "ga4_key_events",
              "description": "Evento click_catalog_download: fired=true, occurrences=3, conversions=0."
            },
            {
              "id": "E18",
              "source": "ga4_key_events",
              "description": "Evento view_quote_page: fired=true, occurrences=12, conversions=0."
            },
            {
              "id": "E19",
              "source": "ga4_key_events",
              "description": "Evento view_contact_page: fired=true, occurrences=38, conversions=0."
            },
            {
              "id": "E20",
              "source": "gtm_tags",
              "description": "Tag GTM \"GA4 Event - click_phone\", tipo gaawe, paused=false."
            },
            {
              "id": "E21",
              "source": "gtm_triggers",
              "description": "Trigger GTM \"click_phone\", tipo linkClick."
            },
            {
              "id": "E22",
              "source": "gtm_container",
              "description": "liveVersionName del contenedor GTM: \"O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)\"."
            },
            {
              "id": "E23",
              "source": "gtm_container",
              "description": "Contenedor GTM www.zentrylockers.com (GTM-MSPSGLK5): tagCount=8, triggerCount=7, variableCount=0."
            },
            {
              "id": "E24",
              "source": "gtm_tags",
              "description": "Lista de 8 tags GTM, todos con paused=false: GA4 Event - click_whatsapp, Google Tag - GA4 - Zentry, GA4 Event - generate_lead_form_submit, GA4 Event - click_phone, GA4 Event - click_catalog_download, GA4 Event - click_request_quote, GA4 Event - view_quote_page, GA4 Event - view_contact_page."
            },
            {
              "id": "E25",
              "source": "gtm_triggers",
              "description": "Lista de 7 triggers GTM: click_phone (linkClick), /solicitar-presupuesto/ (linkClick), click_whatsapp (linkClick), Vista de una pagina - /gracias (pageview), click_catalog_download (linkClick), Page Path equals /solicitar-presupuesto/ (pageview), visita contacto (pageview)."
            },
            {
              "id": "E26",
              "source": "gtm_container",
              "description": "watcherWarnings de esta pasada: array vacio []."
            }
          ],
          "unknowns": [
            "No hay definicion separada de un catalogo de eventos clave esperados distinto del array de eventos observados, por lo que no se puede saber si el catalogo real incluye eventos adicionales a los 7 listados.",
            "No hay datos de dispositivo, campana ni de canales de pago (p.ej. Paid Search, Paid Social) en el contexto; no se puede saber si esos canales existen pero tuvieron 0 sesiones o simplemente no se estan midiendo.",
            "No hay detalle a nivel de sesion o usuario que explique como las conversiones pueden superar a las sesiones en landing pages individuales.",
            "No se entrega un periodo de comparacion historico, por lo que no se puede establecer si estas cifras representan un aumento, descenso o anomalia respecto a un periodo anterior.",
            "No hay confirmacion de si la version de GTM \"O44 - Eventos CTA nuevos - pendiente aprobacion Pau\" esta realmente publicada en el contenedor live o es solo una etiqueta de workspace/version.",
            "No hay detalle de a que pagina(s) exactas esta asociado el trigger de click_request_quote mas alla de los dos triggers relacionados con /solicitar-presupuesto/.",
            "No hay informacion sobre si eventos como click_catalog_download se excluyeron intencionalmente de la marca de conversion en GA4 o si es un descuido de configuracion."
          ]
        }
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "Esta pasada coordinada aporta datos reales y ejecutados de seo-specialist, content-strategist y analytics-specialist sobre el mismo negocio (Zentry Lockers), mas los resumenes deterministas del backlog (105 acciones vivas, 114 work orders, 77 change packs, 1 aprobacion critica pendiente). El foco cross-channel mas claro es la pagina/cluster de 'cerraduras inteligentes para taquillas': tiene multiples acciones ya aprobadas en el backlog (SEO, CRO, enlazado interno) y es el quick win de mayor prioridad segun seo-specialist. En paralelo hay dos problemas de gobernanza de contenido que llevan tiempo sin resolverse del todo (la pagina /cerraduras/ en papelera que sigue recibiendo recomendaciones, y el enrutado de la keyword generica 'melamina' que deberia ir a /taquillas-melamina/ y no a /taquillas-melamina-fenolico/): este segundo punto conecta directamente con la propuesta de content-strategist de reforzar precisamente /taquillas-melamina/, lo que da una sinergia SEO+contenido clara. Analytics aporta una senal de riesgo transversal: la version live de GTM se llama explicitamente 'sin publicar, pendiente aprobacion Pau', lo que pone en duda la fiabilidad de cualquier decision basada en el tracking actual (incluido el evento clave click_phone, que no se disparo nunca en el periodo). Por ultimo, existe una contradiccion relevante entre lo que propone seo-specialist (publicar ya a produccion los 4 content gaps aprobados en staging) y una decision humana anterior que RECHAZO exactamente esa misma propuesta el 2026-08-16 por falta de imagenes/calidad visual; el agente visual-asset-planner de esta pasada confirma ademas que 'n8n NO se ha ejecutado' para generar assets visuales, lo que explica en parte por que ese requisito humano sigue sin resolverse. sem-specialist esta fuera de esta fase, por lo que no hay ninguna lectura cualitativa de SEM mas alla de que sem-watcher V1 esta conectado y genero 70 candidatas sin analizar.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "105 acciones vivas en el backlog SEO/CRO/contenido (8 de prioridad alta, 97 de prioridad media); el top de acciones abiertas esta dominado por la pagina https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (SEO, CRO y enlazado interno, todas ya en estado approved o auto_approved_for_planning).",
            "evidenceRefs": [
              "actions-live",
              "actions-top"
            ]
          },
          {
            "channel": "seo",
            "description": "seo-specialist confirma con datos reales de Search Console (run seo-watcher-2026-08-17T103842Z) que 'cerraduras inteligentes para taquillas' esta en posicion 20.5 con 47 impresiones, el quick win de mayor prioridad de esta pasada.",
            "evidenceRefs": [
              "dept-seo-opportunity-1"
            ]
          },
          {
            "channel": "content",
            "description": "57 de los 114 work orders del departamento son de contenido, y content-strategist entrega en esta pasada una propuesta detallada (estructura, CTA, enlazado) para reforzar /taquillas-melamina/, coincidente con la oportunidad SEO de la misma pagina.",
            "evidenceRefs": [
              "workorders-ready",
              "dept-content-summary",
              "dept-content-structure"
            ]
          },
          {
            "channel": "ops",
            "description": "De 77 change packs totales solo 5 estan listos para revisar; el resto esta mayormente bloqueado por cluster gate segun la actividad de los change-pack-builders (SEO, contenido y CRO) de esta misma pasada.",
            "evidenceRefs": [
              "changepacks-ready",
              "agent-activity"
            ]
          },
          {
            "channel": "analytics",
            "description": "GA4 y GTM estan conectados en vivo; 6 de 7 eventos clave se dispararon en el periodo, pero click_phone registro 0 disparos pese a tener tag y trigger activos, y la version live de GTM se describe a si misma como 'sin publicar, pendiente aprobacion Pau'.",
            "evidenceRefs": [
              "dept-analytics-summary",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "channel": "ops",
            "description": "Hay 1 solicitud de aprobacion pendiente y esta clasificada como riesgo critico (plan de despliegue a produccion de la pagina de taquillas melamina).",
            "evidenceRefs": [
              "approvals-pending"
            ]
          },
          {
            "channel": "sem",
            "description": "sem-watcher V1 (deterministico) esta conectado y genero 70 candidatas SEM y 2 work orders de categoria SEM en esta pasada, pero no hay ninguna lectura cualitativa de sem-specialist: su ausencia no debe interpretarse como que SEM va bien ni mal.",
            "evidenceRefs": [
              "dept-sem-unavailable",
              "workorders-ready"
            ]
          }
        ],
        "bottlenecks": [
          {
            "channel": "ops",
            "description": "El pipeline de contenido/SEO/CRO tiene 114 work orders (113 listas para revisar) pero solo 5 change packs listos de 77 totales -- el cluster gate esta reteniendo la mayoria del trabajo antes de que llegue a un change pack accionable, lo que limita cuanto de lo priorizado por SEO/contenido puede materializarse a corto plazo.",
            "evidenceRefs": [
              "workorders-ready",
              "changepacks-ready",
              "agent-activity"
            ]
          },
          {
            "channel": "seo",
            "description": "Dos action items en vivo siguen apuntando a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters marca en papelera con redireccion 301 desde una decision anterior (O22) -- ejecutar esas acciones tal cual desperdicia esfuerzo.",
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-opportunity-6"
            ]
          },
          {
            "channel": "content",
            "description": "La keyword generica 'melamina' sigue enrutando trafico y action items del backlog hacia /taquillas-melamina-fenolico/ en vez de /taquillas-melamina/, pese a que una decision anterior (O29.1) ya resolvio ese enrutado -- la resolucion documentada no se ha propagado al backlog vivo.",
            "evidenceRefs": [
              "dept-seo-action-3",
              "dept-seo-opportunity-8"
            ]
          },
          {
            "channel": "content",
            "description": "CONTRADICCION detectada: seo-specialist propone (accion #5 de su ranking) publicar a produccion los 4 content gaps ya aprobados en staging (universidades, metalicas, vestuarios, taquillas inteligentes general). Sin embargo, esta misma propuesta ya fue planteada y RECHAZADA por una persona el 2026-08-16, con el motivo textual de que 'las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias' y necesitan una segunda iteracion antes de publicarse. seo-specialist no tenia visibilidad de esa decision. content-strategist si la menciona como riesgo en su propia salida.",
            "evidenceRefs": [
              "dept-seo-action-5",
              "dept-seo-opportunity-7",
              "human-decision-staging-quality-2026-08-16",
              "dept-content-risks"
            ]
          },
          {
            "channel": "analytics",
            "description": "La version live del contenedor GTM se autodescribe como 'sin publicar, pendiente aprobacion Pau', lo que introduce duda sobre si la configuracion de tags/triggers analizada por analytics-specialist es realmente la que esta sirviendo al sitio en produccion.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2",
              "dept-analytics-action-2"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "Quick win de alta prioridad ya con multiples acciones aprobadas en el backlog: reforzar H1/H2, contenido, enlazado interno y meta title/description de 'cerraduras inteligentes para taquillas' para pasar de posicion 20.5 a top 10.",
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "actions-top"
            ]
          },
          {
            "channel": "content",
            "description": "Sinergia directa entre SEO y contenido en /taquillas-melamina/: seo-specialist pide reforzar on-page (CTR 0% pese a 74 impresiones) y content-strategist entrega ya una estructura completa (H1, 6 secciones, CTA, enlazado interno) para esa misma pagina.",
            "evidenceRefs": [
              "dept-seo-opportunity-4",
              "dept-content-summary",
              "dept-content-structure",
              "dept-content-cta"
            ]
          },
          {
            "channel": "seo",
            "description": "Multiples paginas con impresiones reales y CTR 0% (colegios, melamina, fenolicas) representan un patron sistemico de bajo coste de correccion (reescritura de meta title/description).",
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "channel": "analytics",
            "description": "El canal Direct concentra 172 de 183 sesiones y 81 de 86 conversiones reportadas -- una vez resueltas las dudas de medicion, hay margen para entender mejor que esta impulsando ese canal antes de invertir en adquisicion adicional.",
            "evidenceRefs": [
              "dept-analytics-summary"
            ]
          },
          {
            "channel": "cro",
            "description": "Ya existen 11 work orders de categoria CRO y varias acciones CRO aprobadas concentradas en la misma pagina de mayor prioridad SEO (cerraduras-inteligentes-taquillas), lo que permite abordar SEO y CRO de forma coordinada sobre una unica pagina.",
            "evidenceRefs": [
              "workorders-ready",
              "actions-top"
            ]
          }
        ],
        "experiments": [
          {
            "title": "Quick win on-page en cerraduras-inteligentes-taquillas",
            "hypothesis": "Reforzar H1/H2, ampliar contenido, mejorar enlazado interno y actualizar meta title/description hara subir la keyword 'cerraduras inteligentes para taquillas' de posicion 20.5 a top 10 en las siguientes lecturas de Search Console.",
            "channel": "seo",
            "successMetric": "Posicion media de la keyword 'cerraduras inteligentes para taquillas' en Search Console y CTR de la pagina.",
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "actions-top"
            ]
          },
          {
            "title": "Reescritura de meta titles/descriptions en paginas con CTR 0%",
            "hypothesis": "Reescribir title/meta de paginas con impresiones reales pero CTR 0.00% (colegios, melamina, fenolicas) elevara su CTR por encima de 0% sin requerir cambios de contenido profundos.",
            "channel": "seo",
            "successMetric": "CTR en Search Console de las paginas afectadas tras la reescritura.",
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "title": "Validacion manual del disparo de click_phone",
            "hypothesis": "Si se prueba manualmente un clic real en el enlace/boton de telefono, el tag/trigger de GTM 'click_phone' se disparara correctamente, indicando que el evento clave solo carecia de trafico real y no de un fallo de configuracion.",
            "channel": "analytics",
            "successMetric": "Occurrences de click_phone > 0 en GA4 tras la prueba manual y en el siguiente periodo de medicion.",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-1"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Resolver la situacion de /cerraduras/ y la canibalizacion de 'cerraduras sostenibles para gimnasios' antes de invertir mas esfuerzo",
            "rationale": "Impacto alto porque dos action items en vivo apuntan a una URL en papelera con redireccion 301, desperdiciando esfuerzo si se ejecutan tal cual; confianza alta porque el propio catalogo de clusters documenta la situacion con evidencia directa; esfuerzo bajo porque es una decision de enrutado, no de produccion de contenido nuevo.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Decision humana (Pau) sobre destino unico de la keyword"
            ],
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-opportunity-5",
              "dept-seo-opportunity-6"
            ]
          },
          {
            "title": "Ejecutar el quick win ya aprobado en cerraduras-inteligentes-taquillas (SEO + CRO + enlazado interno)",
            "rationale": "Impacto alto porque es la pagina con mas acciones de alta prioridad ya aprobadas en el backlog (SEO, CRO, enlazado interno); confianza alta porque combina datos reales de Search Console con acciones ya en estado 'approved'; esfuerzo medio porque implica trabajo de contenido y enlazado, no solo un ajuste de metadatos.",
            "impact": "high",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Ninguna aprobacion adicional: las acciones relevantes ya estan en estado approved"
            ],
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "actions-top",
              "dept-seo-action-2"
            ]
          },
          {
            "title": "Realinear el enrutado de la keyword generica 'melamina' y reforzar /taquillas-melamina/ con la estructura de content-strategist",
            "rationale": "Impacto medio: corrige un enrutado ya decidido (O29.1) pero no propagado al backlog vivo, y aprovecha que content-strategist ya entrego estructura, CTA y enlazado listos para esa misma pagina en esta pasada; confianza alta porque dos fuentes independientes (seo-specialist y content-strategist) coinciden en la misma pagina; esfuerzo bajo-medio porque es mayormente realineo de backlog mas aplicar una estructura ya definida.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Realineo de action items segun decision O29.1",
              "Revision humana de la propuesta de content-strategist"
            ],
            "evidenceRefs": [
              "dept-seo-action-3",
              "dept-seo-opportunity-4",
              "dept-seo-opportunity-8",
              "dept-content-summary",
              "dept-content-structure"
            ]
          },
          {
            "title": "Resolver la deuda de medicion en Analytics antes de tomar mas decisiones apoyadas en GA4/GTM",
            "rationale": "Impacto alto porque la version live de GTM se autodescribe como pendiente de aprobacion, lo que pone en duda la fiabilidad de todo el analisis de tracking, y porque click_phone (evento clave de contacto) no se disparo ni una vez en cuatro semanas; confianza alta porque son hechos directos de GA4/GTM de esta misma pasada; esfuerzo bajo-medio porque son validaciones puntuales, no una reconstruccion del tracking.",
            "impact": "high",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Confirmacion de Pau sobre el estado real de publicacion de la version de GTM"
            ],
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-action-2",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "title": "No republicar aun los 4 content gaps de staging: planificar segunda iteracion visual/de contenido antes de reintentar la aprobacion",
            "rationale": "Impacto medio porque desbloquearia 4 huecos de contenido ya identificados por seo-specialist, pero confianza baja para publicar 'tal cual' porque esta misma propuesta ya fue rechazada explicitamente por una persona el 2026-08-16 citando falta de imagenes/calidad visual, y visual-asset-planner confirma en esta pasada que 'n8n NO se ha ejecutado' para generar assets visuales -- es decir, la causa raiz del rechazo previo sigue sin resolverse. Esfuerzo medio porque implica trabajo visual y de contenido adicional, no solo republicar.",
            "impact": "medium",
            "confidence": "low",
            "effort": "medium",
            "dependsOn": [
              "Resolver el bloqueo de visual-asset-planner (n8n no ejecutado)",
              "Nueva revision humana de calidad visual/de contenido antes de reintentar publicacion"
            ],
            "evidenceRefs": [
              "dept-seo-opportunity-7",
              "dept-seo-action-5",
              "human-decision-staging-quality-2026-08-16",
              "dept-content-risks"
            ]
          },
          {
            "title": "Revisar sin demora la solicitud de aprobacion pendiente de riesgo critico",
            "rationale": "Impacto alto porque es la unica aprobacion pendiente del departamento y esta clasificada como riesgo critico (plan de despliegue a produccion de taquillas melamina); confianza alta porque el dato viene directo del resumen de aprobaciones pendientes; esfuerzo bajo porque es una revision, no una ejecucion.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Revision humana directa de la solicitud"
            ],
            "evidenceRefs": [
              "approvals-pending"
            ]
          },
          {
            "title": "Investigar el cuello de botella del cluster gate en change packs",
            "rationale": "Impacto medio porque solo 5 de 77 change packs estan listos pese a 113 work orders listas para revisar, lo que limita cuanto de lo priorizado por SEO y contenido llega a ser accionable a corto plazo; confianza media porque se basa en los conteos agregados del propio departamento, sin detalle de la logica interna del cluster gate; esfuerzo medio porque requiere revisar la logica de bloqueo, no solo el backlog.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "medium",
            "dependsOn": [
              "Revision tecnica del cluster gate (posiblemente por web-engineer, sin datos en esta pasada)"
            ],
            "evidenceRefs": [
              "workorders-ready",
              "changepacks-ready",
              "agent-activity"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecutado con exito en esta misma pasada coordinada; su salida completa se uso como base de varias prioridades."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecutado con exito en esta misma pasada coordinada; su propuesta sobre /taquillas-melamina/ se cruzo con la de seo-specialist."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecutado con exito en esta misma pasada coordinada, sobre datos live de GA4/GTM del mismo departmentRunId."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "Status 'not_available' en specialistInputs de esta pasada: sem-specialist queda explicitamente fuera de esta fase. Aunque el fichero de definicion del agente existe en el checkout, no hay ninguna salida cualitativa suya en esta pasada -- no se ha inferido ningun dato de SEM/Google Ads."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "No aparece en specialistInputs de esta pasada coordinada (solo estan wireados seo-specialist, content-strategist, analytics-specialist y sem-specialist). El fichero de definicion existe pero no hay salida suya que sintetizar en esta pasada."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "No aparece en specialistInputs de esta pasada coordinada. El fichero de definicion existe pero no hay salida suya; es relevante para el cuello de botella de cluster gate y para el bloqueo de assets visuales, pero no hay datos directos de este agente en esta pasada."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "Conectado en esta pasada (connected=true), genero 70 candidatas SEM y 2 work orders de categoria sem, pero sin analisis cualitativo (eso corresponde a sem-specialist, ausente)."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "GA4 y GTM conectados en esta pasada (ga4Connected=true, gtmConnected=true); es la fuente de datos sobre la que trabajo analytics-specialist."
          }
        ],
        "risks": [
          {
            "description": "Hay 1 solicitud de aprobacion pendiente clasificada como riesgo critico (plan de despliegue a produccion de la pagina de taquillas melamina) sin resolver en esta pasada.",
            "severity": "high",
            "evidenceRefs": [
              "approvals-pending"
            ]
          },
          {
            "description": "Republicar los 4 content gaps de staging sin resolver la falta de imagenes/calidad visual repetiria un rechazo humano ya registrado el 2026-08-16, y el bloqueo de generacion de assets visuales (n8n no ejecutado) sugiere que la causa raiz sigue sin resolverse.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-opportunity-7",
              "human-decision-staging-quality-2026-08-16"
            ]
          },
          {
            "description": "Continuar trabajando acciones sobre https://zentrylockers.com/cerraduras/ (pagina en papelera con 301) desperdiciaria esfuerzo de SEO/contenido si no se corrige primero el enrutado.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-opportunity-6"
            ]
          },
          {
            "description": "Las decisiones basadas en la configuracion actual de GTM podrian estar apoyadas en una version que el propio contenedor describe como no publicada ('pendiente aprobacion Pau'), lo que reduce la fiabilidad de cualquier conclusion de tracking hasta confirmarlo.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2",
              "dept-analytics-action-2"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "human-decision-staging-quality-2026-08-16",
            "description": "Decision humana registrada en el prompt de esta pasada (seccion 3): propuesta 'Publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general)' fue RECHAZADA el 2026-08-16T09:32:20.630Z con el motivo textual 'Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion.'"
          }
        ],
        "unknowns": [
          "No hay confirmacion de si el script de resolucion de canibalizacion de melamina (decision O29.1) ya se ejecuto sobre los jobs concretos de esta pasada o si son entradas nuevas aun no barridas (declarado por seo-specialist).",
          "No hay ninguna lectura de sem-specialist en esta pasada: no se puede evaluar el estado de SEM/Google Ads mas alla de que sem-watcher V1 esta conectado y genero 70 candidatas sin analizar.",
          "No hay confirmacion de si la version live de GTM ('O44 - Eventos CTA nuevos, sin publicar, pendiente aprobacion Pau') esta realmente publicada o sigue pendiente, lo que afecta la fiabilidad de todo el analisis de tracking de esta pasada.",
          "No hay evidencia en esta pasada de que se haya realizado la segunda iteracion visual/de contenido que la decision humana del 2026-08-16 exigio para las 4 paginas de staging; visual-asset-planner reporta que n8n no se ha ejecutado, pero no se puede confirmar si esto explica completamente el bloqueo.",
          "No hay salida de qa-reviewer ni de web-engineer en esta pasada coordinada, por lo que no se puede evaluar su estado ni cruzar sus hallazgos con los de SEO/contenido/analytics.",
          "No se dispone de cifras de clics/conversion post-clic mas alla del CTR 0.00% reportado por seo-specialist, ni de un periodo de comparacion historico en los datos de analytics-specialist."
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

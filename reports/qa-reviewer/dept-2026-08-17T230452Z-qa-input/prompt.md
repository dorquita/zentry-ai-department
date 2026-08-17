# Prompt preparado para qa-reviewer -- artifact dept-2026-08-17T230452Z-qa-input

Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado del artifact bajo revision.
Pegalo tal cual como prompt del subagente `qa-reviewer` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.

---

## 1. Instrucciones del subagente

Eres `qa-reviewer`, el revisor independiente de calidad del departamento
IA de Zentry/Tukandado. Tu unico trabajo es RAZONAR sobre un artifact ya
producido por otro empleado (o por un runner determinista) que se te
entrega completo dentro del prompt, y devolver una revision de calidad
tambien estructurada. No tienes ninguna herramienta de capacidad: no puedes leer ficheros, no
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
  "correctionRequests": [
    {
      "field": "string",
      "problem": "string",
      "expectedCriterion": "string",
      "evidence": ["string"],
      "targetRecommendationId": "string",
      "blocking": true
    }
  ],
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
- `correctionRequests` es la version ACCIONABLE de `requiredCorrections`,
  y es lo que decide si el departamento puede corregir solo o tiene que
  parar y esperar a una persona. Declara una entrada por cada correccion
  que pidas, con los seis campos:
  - `field`: que campo concreto del artifact esta mal (p.ej.
    `changePlans[0].newValue`). Sin esto, quien corrige no sabe donde
    mirar.
  - `problem`: que le pasa a ese campo.
  - `expectedCriterion`: con que criterio se dara por resuelta. Tiene que
    ser comprobable, no una aspiracion.
  - `evidence`: en que te basas, citando el artifact.
  - `targetRecommendationId`: la `recommendationId` EXACTA a la que
    afecta. Es lo que evita tener que adivinarlo por coincidencia de
    titulo.
  - `blocking`: `true` si impide aprobar; `false` si es solo una mejora.
  Una correccion que solo existe como frase suelta en
  `requiredCorrections` obliga al departamento a detenerse: se conserva,
  pero no se puede corregir de forma dirigida. Declara siempre las dos
  formas, y que digan lo mismo.
- Si tu revision NO bloquea, deja `correctionRequests` vacio.

## Que NUNCA debes hacer

- No pidas acceso a ficheros, al repositorio, a WordPress, a Search
  Console, a Google Ads, a GA4/GTM, a ningun MCP ni a ningun sistema
  externo -- no tienes ninguna herramienta de capacidad y no las necesitas para esta tarea.
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
    "artifactId": "dept-2026-08-17T230452Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-17T230452Z/dept-2026-08-17T230452Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-17T230452Z",
    "generatedAt": "2026-08-17T23:19:09.813Z",
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
        "sourceRunId": "dept-2026-08-17T230452Z"
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
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "El esfuerzo de esta pasada debe concentrarse en cerrar dos problemas de enrutado SEO ya aprobados por un humano pero que seo-specialist confirma que siguen activos: la URL obsoleta /cerraduras/ y la canibalizacion de \"taquillas melamina\" hacia /taquillas-melamina-fenolico/, junto con el quick win ya aprobado de \"cerraduras inteligentes para taquillas\" y la reescritura de meta title/description en las paginas con CTR 0% sistemico. En paralelo, analytics-specialist aporta dos hallazgos con aprobacion humana previa pendiente de ejecutar: validar el disparo de click_phone (0 ocurrencias pese a tag/trigger activos en GTM) y decidir sobre la version GTM sin publicar. Existe una contradiccion real entre content-strategist (que asume resuelta la canibalizacion de melamina) y seo-specialist (que la encuentra activa) que debe verificarse antes de ejecutar el refresco de contenido propuesto para esa pagina. La publicacion a produccion de las paginas de staging (metalicas, universidades, vestuarios) no debe repetirse como prioridad: un humano ya la rechazo por calidad visual insuficiente, y sem-specialist sigue fuera de esta fase sin ningun dato de Ads.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "El backlog SEO cruzado con datos live de Search Console (36 jobs de esta pasada) sigue enviando esfuerzo hacia /cerraduras/, una URL en papelera con redireccion 301 real a /cerraduras-para-taquillas/, para dos keywords con volumen.",
            "evidenceRefs": [
              "dept-seo-technical-issue-1",
              "department-warnings"
            ]
          },
          {
            "channel": "seo",
            "description": "Dos actionItems de \"taquillas melamina\"/\"taquillas de melamina\" siguen enrutados a /taquillas-melamina-fenolico/ pese a la decision O29.1 que los asigna a /taquillas-melamina/; existe un script de resolucion (o291) que no parece haberse aplicado a estos casos concretos.",
            "evidenceRefs": [
              "dept-seo-technical-issue-2",
              "dept-seo-action-2"
            ]
          },
          {
            "channel": "seo",
            "description": "CTR 0.00% sistemico en al menos 8 paginas distintas marcadas low_ctr, senal de un problema generalizado de meta title/description, no de casos aislados.",
            "evidenceRefs": [
              "dept-seo-technical-issue-3"
            ]
          },
          {
            "channel": "content",
            "description": "content-strategist propone actualizar title/meta y refrescar el contenido de la pagina existente taquillas-melamina para diferenciarla de las paginas vecinas del cluster y mejorar CTR, con estructura y CTA ya definidos.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-structure"
            ]
          },
          {
            "channel": "analytics",
            "description": "GA4 y GTM estan conectados en vivo (ga4Connected=true, gtmConnected=true) para el periodo 2026-07-19 a 2026-08-16; el evento clave click_phone no registro ninguna ocurrencia pese a que el tag y el trigger existen en GTM.",
            "evidenceRefs": [
              "dept-analytics-summary",
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "channel": "analytics",
            "description": "La version live del contenedor GTM esta marcada como sin publicar, pendiente aprobacion Pau, lo que genera ambiguedad sobre si la configuracion analizada es la realmente activa en el sitio.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "channel": "ops",
            "description": "El backlog operativo (acciones, work orders, change packs, solicitudes de aprobacion) aparece a cero en esta pasada de forma deliberada, no por fallo de lectura; el historico se conserva integro para auditoria.",
            "evidenceRefs": [
              "department-warnings"
            ]
          }
        ],
        "bottlenecks": [
          {
            "channel": "seo",
            "description": "El enrutado obsoleto de /cerraduras/ bloquea cualquier optimizacion on-page rentable en esa keyword; un humano ya aprobo resolverlo pero seo-specialist lo sigue detectando activo en esta pasada.",
            "evidenceRefs": [
              "dept-seo-technical-issue-1",
              "dept-seo-action-1",
              "human-decision-cerraduras-approved"
            ]
          },
          {
            "channel": "seo",
            "description": "La canibalizacion de melamina generica sigue sin cerrarse pese a la aprobacion humana previa y a existir un script dedicado (o291); no queda claro si esta bloqueada operativamente o simplemente pendiente de ejecucion.",
            "evidenceRefs": [
              "dept-seo-technical-issue-2",
              "dept-seo-action-2",
              "human-decision-melamina-approved"
            ]
          },
          {
            "channel": "analytics",
            "description": "El gap de tracking en click_phone sigue sin resolver desde su aprobacion humana previa, y la version GTM pendiente de publicar anade incertidumbre sobre si la configuracion de conversion analizada es fiable ahora mismo.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2",
              "human-decision-clickphone-approved"
            ]
          },
          {
            "channel": "content",
            "description": "Contradiccion entre especialistas: content-strategist asume que la canibalizacion de melamina ya esta resuelta via un changePack aprobado, mientras seo-specialist encuentra evidencia de que los actionItems siguen mal enrutados en esta misma pasada.",
            "evidenceRefs": [
              "dept-content-risks",
              "dept-seo-technical-issue-2",
              "dept-seo-action-2"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "Siete quick wins de posicion 10-30 (cerraduras inteligentes taquillas, taquillas melamina, colegios, hospitales) listos para on-page sin necesitar contenido nuevo, ya priorizados y con recommendedAction concreto.",
            "evidenceRefs": [
              "dept-seo-action-3",
              "dept-seo-opportunity-1"
            ]
          },
          {
            "channel": "content",
            "description": "El refresco de title/meta y contenido de taquillas-melamina ya tiene estructura de secciones y estrategia de CTA definidas por content-strategist, listo para ejecutar una vez verificado el cierre real de la canibalizacion.",
            "evidenceRefs": [
              "dept-content-structure",
              "dept-content-cta"
            ]
          },
          {
            "channel": "analytics",
            "description": "La landing page / convierte al ~51% (58 de 114 sesiones) y /configurador-bancos al 60% con bounce del 10%, muy por encima del resto de landings del listado -- patrones a estudiar para replicar en landings de menor rendimiento.",
            "evidenceRefs": [
              "analytics-landing-conversion-pattern"
            ]
          },
          {
            "channel": "seo",
            "description": "Tres huecos de contenido (taquillas metalicas, universidades, vestuarios) ya tienen su pagina en staging construida y visualmente aprobada en su momento; el trabajo de desarrollo esta hecho, pero la publicacion a produccion fue rechazada por un humano por falta de calidad visual/fotografica, por lo que la oportunidad real ahora es la iteracion visual, no la publicacion directa.",
            "evidenceRefs": [
              "dept-seo-action-5",
              "human-decision-staging-publish-rejected"
            ]
          }
        ],
        "experiments": [
          {
            "title": "Monitorizar CTR tras reescritura de meta title/description en paginas con CTR 0%",
            "hypothesis": "Si se reescriben los meta title/description de las paginas con CTR 0% sistemico, el CTR organico de esas paginas aumentara de forma medible en el siguiente periodo de Search Console.",
            "channel": "seo",
            "successMetric": "El CTR agregado de las paginas afectadas pasa de 0% a un valor mayor que 0% de forma sostenida durante al menos 2 semanas de datos de Search Console.",
            "evidenceRefs": [
              "dept-seo-technical-issue-3",
              "dept-seo-action-4"
            ]
          },
          {
            "title": "Validar en GA4 DebugView el disparo de click_phone",
            "hypothesis": "Si el trigger click_phone esta mal vinculado al elemento actual de la pagina, no se observara el evento en DebugView al interactuar manualmente con el boton de telefono; si el trigger funciona pero simplemente no hay interacciones reales, el evento se disparara con normalidad en DebugView.",
            "channel": "analytics",
            "successMetric": "El evento click_phone aparece o no aparece de forma concluyente en GA4 DebugView al interactuar manualmente con el elemento de telefono, confirmando si el problema es de tracking o de comportamiento de usuario.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1",
              "dept-analytics-action-1"
            ]
          },
          {
            "title": "Cerrar el script o291 sobre los actionItems restantes de melamina y verificar consolidacion de ranking",
            "hypothesis": "Si se aplica el script o291-resolve-melamina-cannibalization.ts a los actionItems que aun apuntan a /taquillas-melamina-fenolico/, las impresiones de las keywords genericas de melamina se consolidaran progresivamente en /taquillas-melamina/ en las siguientes lecturas de Search Console.",
            "channel": "seo",
            "successMetric": "Las impresiones de \"taquillas melamina\" y \"taquillas de melamina\" dejan de repartirse entre las dos URLs y se concentran en /taquillas-melamina/ en las siguientes 2-4 semanas de datos.",
            "evidenceRefs": [
              "dept-seo-technical-issue-2",
              "dept-seo-action-2"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Cerrar definitivamente el enrutado obsoleto de /cerraduras/",
            "rationale": "Impacto alto (bloquea cualquier optimizacion on-page rentable en dos keywords con volumen) y esfuerzo bajo segun seo-specialist; un humano ya aprobo esta accion previamente, por lo que la confianza es alta, pero sigue detectandose sin resolver en esta pasada -- es la accion de mayor prioridad.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Decision/aprobacion tecnica de Pau sobre la URL objetivo correcta (/cerraduras-para-taquillas/ o el cluster 1865)"
            ],
            "evidenceRefs": [
              "dept-seo-technical-issue-1",
              "dept-seo-action-1",
              "human-decision-cerraduras-approved"
            ]
          },
          {
            "title": "Ejecutar el script o291 sobre los actionItems restantes de canibalizacion de melamina",
            "rationale": "Impacto medio y esfuerzo bajo porque el mecanismo de resolucion ya existe; confianza rebajada a media porque hay una contradiccion real entre seo-specialist (lo encuentra activo) y content-strategist (lo asume resuelto) que debe verificarse antes de dar la accion por completada.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Verificar si el changePack aprobado de cierre de canibalizacion ya se aplico realmente a estos actionItems concretos"
            ],
            "evidenceRefs": [
              "dept-seo-technical-issue-2",
              "dept-seo-action-2",
              "dept-content-risks",
              "human-decision-melamina-approved"
            ]
          },
          {
            "title": "Ejecutar el quick win aprobado de on-page en cerraduras inteligentes para taquillas",
            "rationale": "Impacto medio, confianza alta (accion ya aprobada por un humano y con recommendedAction concreto de seo-specialist), esfuerzo medio por requerir cambios de contenido, enlazado interno y meta en la landing.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "dept-seo-action-3",
              "human-decision-quickwin-approved"
            ]
          },
          {
            "title": "Reescribir meta title/description en las paginas con CTR 0% sistemico",
            "rationale": "Impacto medio y esfuerzo medio dado el numero de paginas afectadas (al menos 8); confianza alta porque la accion ya fue aprobada por un humano previamente y el patron esta bien documentado por seo-specialist.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Cerrar primero las prioridades 1 y 2 para no reescribir meta de paginas que van a redirigirse o consolidarse"
            ],
            "evidenceRefs": [
              "dept-seo-technical-issue-3",
              "dept-seo-action-4",
              "human-decision-ctr-approved"
            ]
          },
          {
            "title": "Validar el disparo de click_phone en GTM/GA4 antes de asumir perdida de esa via de conversion",
            "rationale": "Impacto alto porque podria haber una via de conversion telefonica sin medir; confianza alta y esfuerzo bajo (validacion en DebugView); accion ya aprobada por un humano previamente y reiterada por analytics-specialist como su prioridad mas alta.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1",
              "dept-analytics-action-1",
              "human-decision-clickphone-approved"
            ]
          },
          {
            "title": "Decidir sobre la publicacion de la version GTM pendiente de aprobacion de Pau",
            "rationale": "Impacto medio (afecta a la fiabilidad de todo el analisis de tracking) y esfuerzo bajo (es una decision, no un desarrollo); confianza media porque depende de una aprobacion humana externa no confirmada en este contexto.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Aprobacion humana de Pau sobre la version del contenedor GTM O44"
            ],
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2",
              "dept-analytics-action-2"
            ]
          },
          {
            "title": "Aplicar el refresco de title/meta y contenido de taquillas-melamina propuesto por content-strategist",
            "rationale": "Impacto medio con estructura y CTA ya definidos por content-strategist, pero confianza media porque su premisa (canibalizacion ya resuelta) contradice el hallazgo de seo-specialist en esta misma pasada; publicar sin verificar podria reabrir el conflicto de canibalizacion.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "medium",
            "dependsOn": [
              "Cierre confirmado del script o291 sobre la canibalizacion de melamina (prioridad 2)"
            ],
            "evidenceRefs": [
              "dept-content-structure",
              "dept-content-cta",
              "dept-seo-technical-issue-2"
            ]
          },
          {
            "title": "Investigar la discrepancia entre click_request_quote y view_quote_page",
            "rationale": "Impacto medio porque afecta a la comprension del funnel de presupuesto; confianza media (analytics-specialist lo marca como hipotesis, no como hecho confirmado) y esfuerzo bajo al ser una auditoria de triggers existentes.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-analytics-action-3"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); salida completa usada y citada via refs dept-seo-*."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); salida completa usada y citada via refs dept-content-*."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); salida completa usada y citada via refs dept-analytics-*."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "status=not_available en specialistInputs de esta pasada; queda explicitamente fuera de esta fase. Sin ningun dato de SEM/Google Ads: no se infiere gasto, CPC, impresiones ni estado de campanas."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "La definicion del agente existe en el checkout pero no aparece como entrada en specialistInputs de esta pasada coordinada; solo se dispone de los datos deterministicos de staging-qa-agent V1 (20/21 borradores pasan, 2 warnings)."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "La definicion del agente existe en el checkout pero no aparece como entrada en specialistInputs de esta pasada coordinada; no hay ninguna senal tecnica propia de este empleado en este contexto."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "connected=true segun el ultimo agent_finished de esta pasada; provee 70 candidatas SEM pero sin sintesis de sem-specialist encima."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "ga4Connected=true, gtmConnected=true segun el ultimo agent_finished de esta pasada; es la base de datos que consume analytics-specialist."
          },
          {
            "name": "Backlog operativo (actions/workOrders/changePacks/approvalRequests)",
            "status": "partial",
            "note": "Vaciado deliberadamente a cero para esta pasada segun warnings[]; el historico se conserva integro para auditoria pero no se usa como base de decision en esta sintesis."
          }
        ],
        "risks": [
          {
            "description": "La accion de publicar a produccion las paginas de staging ya aprobadas (metalicas, universidades, vestuarios, taquillas inteligentes general) vuelve a aparecer en la salida de seo-specialist de esta pasada, pero un humano ya la rechazo explicitamente por falta de calidad visual/fotografica; ejecutarla sin la segunda iteracion visual pedida repetiria una decision ya descartada.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-action-5",
              "human-decision-staging-publish-rejected"
            ]
          },
          {
            "description": "Contradiccion entre content-strategist (asume que la canibalizacion de melamina ya esta resuelta via changePack aprobado) y seo-specialist (encuentra actionItems activos todavia mal enrutados en esta misma pasada): ejecutar el refresco de contenido de taquillas-melamina antes de verificar esto podria reabrir el conflicto de canibalizacion.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-content-risks",
              "dept-seo-technical-issue-2"
            ]
          },
          {
            "description": "El backlog operativo determinista (acciones, work orders, change packs, aprobaciones) esta a cero de forma deliberada en esta pasada; cualquier prioridad que asuma que ya existe una work order o change pack creado no tiene soporte operativo todavia y requerira generarlo explicitamente.",
            "severity": "low",
            "evidenceRefs": [
              "department-warnings"
            ]
          },
          {
            "description": "Sin datos de sem-specialist en esta fase no hay forma de contrastar si el trafico Direct dominante en GA4 incluye trafico de Google Ads mal atribuido; cualquier conclusion sobre distribucion de canales debe tratarse como incompleta hasta que SEM este disponible.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-sem-unavailable",
              "dept-analytics-summary"
            ]
          },
          {
            "description": "click_phone no registra ninguna ocurrencia pese a que el tag y el trigger existen en GTM, y ya se habia aprobado validar esto en una pasada anterior; si el problema persiste sin resolverse se sigue perdiendo visibilidad sobre una via de conversion potencialmente relevante (llamadas telefonicas).",
            "severity": "high",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1",
              "human-decision-clickphone-approved"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "human-decision-cerraduras-approved",
            "description": "Decision humana previa (aprobada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z, sin motivo escrito adicional): Resolver el enrutado roto de /cerraduras/ antes de invertir esfuerzo SEO sobre esa URL."
          },
          {
            "ref": "human-decision-melamina-approved",
            "description": "Decision humana previa (aprobada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z, sin motivo escrito adicional): Cerrar los actionItems de canibalizacion de taquillas melamina y revisar la aprobacion critica pendiente relacionada."
          },
          {
            "ref": "human-decision-quickwin-approved",
            "description": "Decision humana previa (aprobada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z, sin motivo escrito adicional): Ejecutar el quick win de mayor impacto: on-page de cerraduras inteligentes para taquillas."
          },
          {
            "ref": "human-decision-ctr-approved",
            "description": "Decision humana previa (aprobada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z, sin motivo escrito adicional): Reescribir meta title/description en las 7 paginas con CTR 0% e impresiones reales."
          },
          {
            "ref": "human-decision-clickphone-approved",
            "description": "Decision humana previa (aprobada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z, sin motivo escrito adicional): Validar el disparo de click_phone en GTM/GA4 antes de asumir que esa via de conversion esta perdida."
          },
          {
            "ref": "human-decision-staging-publish-rejected",
            "description": "Decision humana previa (rechazada 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z). Motivo textual literal: Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion."
          },
          {
            "ref": "analytics-landing-conversion-pattern",
            "description": "Datos reales de analytics-specialist en esta pasada (evidence E5/E6 de su salida): landing page / registra 114 sesiones y 58 conversiones (bounce 31.6%); landing page /configurador-bancos registra 10 sesiones y 6 conversiones (bounce 10%), muy por encima de la conversion aparente del resto de landings del listado."
          }
        ],
        "unknowns": [
          "No se puede confirmar si el script o291-resolve-melamina-cannibalization.ts se aplico realmente a los actionItems de taquillas melamina/taquillas de melamina que apuntan a /taquillas-melamina-fenolico/: content-strategist asume que si (via changePack aprobado) pero seo-specialist encuentra evidencia de que siguen sin resolver en esta misma pasada.",
          "No hay ningun dato de SEM/Google Ads en esta pasada (sem-specialist ausente); no se puede evaluar el canal SEM ni contrastar el trafico Direct dominante en GA4 contra posible trafico de Ads mal atribuido.",
          "No se conoce el estado de aprobacion final de Pau sobre la reasignacion de /cerraduras/ ni sobre la publicacion de la version GTM O44 pendiente.",
          "No hay salida propia de qa-reviewer ni de web-engineer en esta pasada coordinada; solo se dispone de los datos deterministicos de staging-qa-agent V1.",
          "No hay datos de volumen de busqueda para las keywords sin cluster (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) mas alla de su presencia en el catalogo de target keywords.",
          "No se puede confirmar por que view_quote_page y view_contact_page no cuentan como conversion en GA4 sin una revision manual de la configuracion de eventos clave."
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

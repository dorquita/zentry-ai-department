# Prompt preparado para qa-reviewer -- artifact dept-2026-08-18T012804Z-qa-input

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
- **Si `reviewStatus` es `fail`, o si declaras algun `finding` de
  severidad `critical`, o alguna entrada en `safetyConcerns`, entonces
  `requiredCorrections` NO PUEDE ESTAR VACIO.** Bloquear sin decir que
  hay que corregir deja el trabajo parado esperando a una persona para
  algo que muchas veces se arregla quitando una frase. Si has encontrado
  un problema lo bastante grave como para bloquear, sabes lo bastante
  como para decir que hay que cambiar.
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
    "artifactId": "dept-2026-08-18T012804Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-18T012804Z/dept-2026-08-18T012804Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-18T012804Z",
    "generatedAt": "2026-08-18T01:43:01.633Z",
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
        "sourceRunId": "dept-2026-08-18T012804Z"
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
          "executiveSummary": "Datos live de Search Console (run seo-watcher-2026-08-18T012813Z, 36 jobs) cruzados con el catalogo de clusters y keywords objetivo. El hallazgo mas urgente es tecnico: dos actionItems (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) apuntan a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters documenta como en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ -- ejecutarlos tal cual desperdiciaria esfuerzo. En segundo lugar, persisten dos actionItems de este run (\"taquillas melamina\", \"taquillas de melamina\") enrutados a /taquillas-melamina-fenolico/ pese a que la decision O29.1 ya resolvio esa canibalizacion y marca ese enrutado como erroneo, a cerrar via script y no a ejecutar. Aparte de estos dos problemas de enrutado, hay quick wins reales bien encaminados (cerraduras inteligentes para taquillas, comprar taquillas para hospitales) y un patron amplio de CTR 0% en paginas con impresiones relevantes que sugiere revisar metas de forma sistematica. El catalogo de clusters ya tiene tres paginas de contenido nuevo aprobadas visualmente en staging (universidades, metalicas, vestuarios) listas para pasar a produccion, y un cuarto cluster (taquillas inteligentes, solucion general) pendiente de decision humana por riesgo de canibalizacion documentado. Tres keywords objetivo de alta/media prioridad (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) no tienen ningun actionItem ni cluster que las cubra en este run.",
          "findings": [
            {
              "id": "F1",
              "category": "cannibalization",
              "description": "El actionItem para \"cerraduras inteligentes para centros deportivos\" recomienda optimizar on-page https://zentrylockers.com/cerraduras/, pero el cluster catalog documenta que esa URL esta en papelera desde O22 con una redireccion 301 real hacia /cerraduras-para-taquillas/. Ejecutar la accion tal cual apuntaria a una pagina obsoleta.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev1",
                "ev2"
              ]
            },
            {
              "id": "F2",
              "category": "cannibalization",
              "description": "\"cerraduras sostenibles para gimnasios\" genera dos actionItems que apuntan a paginas distintas (/cerraduras-inteligentes-taquillas/ y /cerraduras/), y esta ultima es la misma URL obsoleta senalada en F1. Ademas esta keyword no aparece en ningun matchPattern del catalogo de clusters, por lo que su enrutado no ha sido validado.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev3",
                "ev4",
                "ev2"
              ]
            },
            {
              "id": "F3",
              "category": "cannibalization",
              "description": "Dos actionItems de este run (\"taquillas melamina\", \"taquillas de melamina\") siguen apuntando a /taquillas-melamina-fenolico/, pese a que la decision O29.1 (documentada en el cluster taquillas_melamina_fenolico y en taquillas_melamina) establece explicitamente que las keywords genericas de melamina NO deben apuntar a esa pagina y que cualquier actionId asi debe cerrarse via el script de resolucion, no ejecutarse.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev5",
                "ev6",
                "ev7",
                "ev8"
              ]
            },
            {
              "id": "F4",
              "category": "keyword_strategy",
              "description": "Tres keywords del catalogo objetivo, dos de ellas de prioridad alta (\"taquillas para gimnasios\", \"lockers inteligentes\") y una media (\"digitalizacion de taquillas\"), no tienen ningun actionItem ni cluster asociado en este run -- no hay visibilidad sobre su rendimiento ni sobre si existe contenido dedicado.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev16",
                "ev17",
                "ev18"
              ]
            },
            {
              "id": "F5",
              "category": "content",
              "description": "Tres clusters marcados como new_page_candidate (taquillas_universidad, taquillas_metalicas, taquillas_vestuarios) ya tienen pagina en staging visualmente aprobada y sin equivalente en produccion -- son huecos de contenido reales listos para avanzar, no hipoteticos.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev11",
                "ev12",
                "ev13"
              ]
            },
            {
              "id": "F6",
              "category": "search_intent",
              "description": "El cluster taquillas_inteligentes_general (solucion general: mueble+cerradura+control de acceso) documenta explicitamente un riesgo de canibalizacion con el cluster cerraduras_inteligentes_taquillas (hardware de cierre) y requiere aprobacion explicita de Pau antes de publicarse -- es una diferenciacion de intencion de busqueda pendiente de validar, no resuelta todavia.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev14",
                "ev22"
              ]
            },
            {
              "id": "F7",
              "category": "technical",
              "description": "Multiples paginas de producto/sector (taquillas-melamina, taquillas-melamina-fenolico, taquillas-para-colegios, taquillas-fenolicas) muestran CTR 0.00% con impresiones relevantes (22 a 83 en el periodo), un patron repetido en distintas familias de keyword que sugiere una debilidad sistemica de meta title/description mas que problemas aislados por pagina.",
              "basis": "inference",
              "evidenceRefs": [
                "ev5",
                "ev6",
                "ev9",
                "ev10",
                "ev23",
                "ev26"
              ]
            }
          ],
          "opportunities": [
            {
              "id": "O1",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "kind": "technical",
              "priority": "high",
              "recommendedAction": "No ejecutar la optimizacion on-page sugerida sobre /cerraduras/ (pagina en papelera con 301 real a /cerraduras-para-taquillas/). Redirigir la tarea al objetivo correcto una vez Pau confirme si debe atacarse desde /cerraduras-para-taquillas/ o desde el cluster de cerraduras inteligentes (1865).",
              "rationale": "El cluster catalog ya documenta que la URL objetivo actual del backlog esta obsoleta; ejecutar la accion tal cual desperdicia el esfuerzo de WordPress.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev1",
                "ev2"
              ]
            },
            {
              "id": "O2",
              "keyword": "taquillas melamina / taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "kind": "cannibalization",
              "priority": "medium",
              "recommendedAction": "Cerrar estos dos actionItems como mal enrutados via el proceso de resolucion ya existente (scripts/o291-resolve-melamina-cannibalization.ts) en lugar de aplicar cambios on-page en la pagina de combinacion; revisar por que el job de este run aun los genera pese a la decision O29.1.",
              "rationale": "El propio catalogo de clusters documenta esta canibalizacion como resuelta y marca este enrutado como erroneo.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev5",
                "ev6",
                "ev7",
                "ev8"
              ]
            },
            {
              "id": "O3",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "kind": "quick_win",
              "priority": "high",
              "recommendedAction": "Reforzar H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.4 a top 10.",
              "rationale": "46 impresiones, posicion 20.4, quick win de prioridad alta ya bien enrutado a la pagina correcta segun el cluster.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev20",
                "ev22"
              ]
            },
            {
              "id": "O4",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Pequeno refuerzo on-page (title/meta, enlazado interno) para consolidar la entrada en primera pagina, dado que ya esta en posicion 10.6.",
              "rationale": "Posicion 10.6, a un empujon minimo de primera pagina; bajo esfuerzo esperado para el impacto.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev21"
              ]
            },
            {
              "id": "O5",
              "keyword": "taquillas colegios / taquillas escolares",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "kind": "low_ctr",
              "priority": "medium",
              "recommendedAction": "Reescribir meta title y meta description con mensajes mas atractivos (precio, garantia, CTA) para la intencion consolidada colegios/escolares.",
              "rationale": "CTR 0.00% con 40 y 32 impresiones respectivamente pese a que el listado ya aparece -- mejora de bajo coste.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev23",
                "ev24",
                "ev25"
              ]
            },
            {
              "id": "O6",
              "keyword": "taquillas universidad",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada visualmente (2110) para el cluster de universidades.",
              "rationale": "No existe pagina de produccion equivalente y el contenido ya esta creado y aprobado en staging.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev11"
              ]
            },
            {
              "id": "O7",
              "keyword": "taquillas metalicas",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada (2105) para el tercer material de catalogo (metalicas).",
              "rationale": "Hueco de contenido real, alineado ademas con la keyword objetivo de prioridad media \"taquillas metalicas\" del catalogo del negocio.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev12",
                "ev15"
              ]
            },
            {
              "id": "O8",
              "keyword": "taquillas vestuarios",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar a produccion la pagina de staging ya aprobada (2104), manteniendola diferenciada de /bancos-de-vestuario/.",
              "rationale": "Sin pagina equivalente en produccion; contenido ya creado y aprobado visualmente.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev13"
              ]
            },
            {
              "id": "O9",
              "keyword": "comprar taquillas / soluciones de taquillas",
              "kind": "internal_linking",
              "priority": "low",
              "recommendedAction": "En vez de crear paginas nuevas, mejorar CTAs y enlazado interno hacia el proceso de pedido y hacia las paginas de sector/material ya existentes.",
              "rationale": "El cluster catalog concluye que estos terminos son demasiado genericos para diferenciarse de paginas ya existentes y recomienda esta via en lugar de nuevas paginas.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev19"
              ]
            },
            {
              "id": "O10",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Una vez confirmado el target URL correcto con Pau, desarrollar el contenido nuevo/robusto que este future_opportunity requiere, evitando construirlo sobre la URL obsoleta /cerraduras/.",
              "rationale": "Hay volumen de busqueda real (30 impresiones) que justifica una landing dedicada, pero el objetivo actual del backlog no es valido.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev1",
                "ev2"
              ]
            }
          ],
          "technicalIssues": [
            {
              "id": "T1",
              "page": "https://zentrylockers.com/cerraduras/",
              "issue": "Pagina en papelera con redireccion 301 real activa hacia /cerraduras-para-taquillas/, pero sigue siendo el target de dos actionItems vivos generados en este run (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios). Cualquier optimizacion on-page ejecutada aqui se perderia.",
              "severity": "high",
              "basis": "evidence",
              "evidenceRefs": [
                "ev1",
                "ev2",
                "ev4"
              ]
            },
            {
              "id": "T2",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "issue": "Sigue recibiendo actionItems generados a partir de las keywords genericas \"taquillas melamina\"/\"taquillas de melamina\", pese a que la decision O29.1 excluye explicitamente esta pagina de esas keywords -- indica que el filtro de enrutado (o291-resolve-melamina-cannibalization) aun no se ha aplicado a los actionItems de este run.",
              "severity": "medium",
              "basis": "evidence",
              "evidenceRefs": [
                "ev5",
                "ev6",
                "ev7",
                "ev8"
              ]
            },
            {
              "id": "T3",
              "page": "multiple (taquillas-melamina, taquillas-melamina-fenolico, taquillas-para-colegios, taquillas-fenolicas)",
              "issue": "Patron repetido de CTR 0.00% con impresiones relevantes (22 a 83) en distintas familias de pagina, lo que sugiere una debilidad sistemica en meta titles/descriptions mas alla de casos aislados y justifica una auditoria en lote en vez de arreglos uno a uno.",
              "severity": "medium",
              "basis": "inference",
              "evidenceRefs": [
                "ev5",
                "ev6",
                "ev9",
                "ev10",
                "ev23",
                "ev26"
              ]
            }
          ],
          "contentGaps": [
            {
              "id": "G1",
              "topic": "Taquillas para universidades",
              "relatedKeyword": "taquillas universidad",
              "rationale": "Cluster taquillas_universidad marcado new_page_candidate: sin pagina de produccion equivalente confirmada; staging (2110) ya creada y visualmente aprobada, lista para publicar.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev11"
              ]
            },
            {
              "id": "G2",
              "topic": "Taquillas metalicas (nuevo material de producto)",
              "relatedKeyword": "taquillas metalicas",
              "rationale": "Tercer material del catalogo (junto a melamina/fenolica) sin pagina de producto propia; staging (2105) ya aprobada, y la keyword ya esta en el catalogo objetivo del negocio con prioridad media.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev12",
                "ev15"
              ]
            },
            {
              "id": "G3",
              "topic": "Taquillas para vestuarios (pagina dedicada, distinta de bancos de vestuario)",
              "relatedKeyword": "taquillas vestuarios",
              "rationale": "Sin pagina equivalente en produccion; staging (2104) ya aprobada visualmente y explicitamente diferenciada de /bancos-de-vestuario/.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev13"
              ]
            },
            {
              "id": "G4",
              "topic": "Taquillas inteligentes - solucion general (mueble + cerradura + control de acceso)",
              "relatedKeyword": "taquillas inteligentes",
              "rationale": "Cluster new_page_candidate con riesgo de canibalizacion documentado frente al cluster de cerraduras inteligentes (hardware); requiere decision explicita de Pau antes de publicar la pagina de staging (2103).",
              "basis": "evidence",
              "evidenceRefs": [
                "ev14",
                "ev22"
              ]
            },
            {
              "id": "G5",
              "topic": "Taquillas para gimnasios",
              "relatedKeyword": "taquillas para gimnasios",
              "rationale": "Keyword objetivo de prioridad alta y tipo comercial sin ningun actionItem ni cluster que la cubra en este run -- posible hueco de cobertura de contenido o de datos que merece revision.",
              "basis": "inference",
              "evidenceRefs": [
                "ev16"
              ]
            },
            {
              "id": "G6",
              "topic": "Lockers inteligentes (terminologia alternativa a taquillas inteligentes)",
              "relatedKeyword": "lockers inteligentes",
              "rationale": "Keyword objetivo de prioridad alta sin actionItem ni cluster asociado; podria estar solapada con el cluster taquillas_inteligentes_general pero no hay evidencia explicita de esa relacion en el contexto recibido.",
              "basis": "inference",
              "evidenceRefs": [
                "ev17"
              ]
            }
          ],
          "internalLinkRecommendations": [
            {
              "id": "IL1",
              "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "toPage": "https://zentrylockers.com/cerraduras-para-taquillas/",
              "anchorTextSuggestion": "ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO",
              "rationale": "El cluster catalog diferencia explicitamente la version informativa (1865) de la version comercial de catalogo (/cerraduras-para-taquillas/); enlazar desde la pagina informativa ayuda a mover a los usuarios hacia la decision de compra sin fusionar el contenido de ambas paginas.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev22"
              ]
            },
            {
              "id": "IL2",
              "fromPage": "https://zentrylockers.com/taquillas-melamina/",
              "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "anchorTextSuggestion": "taquillas con puertas fenolicas",
              "rationale": "Ambas paginas comparten material base (melamina) pero atacan intenciones diferenciadas por decision O29.1 (generico vs. combinacion especifica); un enlace ayuda a los usuarios a llegar a la variante correcta sin reabrir la canibalizacion ya resuelta.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev7",
                "ev8"
              ]
            },
            {
              "id": "IL3",
              "fromPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "toPage": "https://zentrylockers.com/taquillas-melamina/",
              "anchorTextSuggestion": "ver taquillas de melamina estandar",
              "rationale": "Enlace reciproco de IL2, para los usuarios que llegan a la pagina de combinacion especifica pero en realidad buscaban la opcion generica de melamina.",
              "basis": "evidence",
              "evidenceRefs": [
                "ev7",
                "ev8"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "rank": 1,
              "title": "Corregir el enrutado de las oportunidades sobre /cerraduras/ (pagina en papelera con 301) antes de ejecutar cualquier optimizacion on-page",
              "relatedIds": [
                "T1",
                "O1",
                "O10",
                "F1",
                "F2"
              ],
              "priority": "high",
              "effort": "low",
              "impact": "high"
            },
            {
              "rank": 2,
              "title": "Cerrar los actionItems mal enrutados de taquillas melamina/de melamina hacia /taquillas-melamina-fenolico/ via el script de resolucion existente",
              "relatedIds": [
                "T2",
                "O2",
                "F3"
              ],
              "priority": "high",
              "effort": "low",
              "impact": "medium"
            },
            {
              "rank": 3,
              "title": "Ejecutar el quick win de cerraduras inteligentes para taquillas en /cerraduras-inteligentes-taquillas/",
              "relatedIds": [
                "O3"
              ],
              "priority": "high",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 4,
              "title": "Empujar comprar taquillas para hospitales a top 10 (ya en posicion 10.6)",
              "relatedIds": [
                "O4"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "low"
            },
            {
              "rank": 5,
              "title": "Auditar y reescribir metas de las paginas con CTR 0% y volumen relevante (colegios, melamina, fenolicas)",
              "relatedIds": [
                "O5",
                "T3"
              ],
              "priority": "medium",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 6,
              "title": "Publicar a produccion las paginas de staging ya aprobadas para huecos reales (universidades, metalicas, vestuarios)",
              "relatedIds": [
                "G1",
                "G2",
                "G3",
                "O6",
                "O7",
                "O8"
              ],
              "priority": "medium",
              "effort": "medium",
              "impact": "high"
            },
            {
              "rank": 7,
              "title": "Decidir con Pau el enrutado de taquillas inteligentes (solucion general) vs. cerraduras inteligentes antes de publicar la pagina candidata",
              "relatedIds": [
                "F6",
                "G4"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "medium"
            },
            {
              "rank": 8,
              "title": "Investigar por que faltan datos/paginas para keywords objetivo de alta prioridad (taquillas para gimnasios, lockers inteligentes)",
              "relatedIds": [
                "F4",
                "G5",
                "G6"
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
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "actionItem future_opportunity+low_ctr, prioridad high, posicion actual 37.8, 30 impresiones, CTR 0%."
            },
            {
              "id": "ev2",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "Cluster cerraduras_inteligentes_centros_deportivos, action reject: la pagina objetivo del backlog esta en papelera desde O22 con 301 real hacia /cerraduras-para-taquillas/; el target correcto requiere decision de Pau."
            },
            {
              "id": "ev3",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 45.7, 20 impresiones, CTR 0%."
            },
            {
              "id": "ev4",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 31.05, 20 impresiones, CTR 0%."
            },
            {
              "id": "ev5",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 43.28, 60 impresiones, CTR 0%."
            },
            {
              "id": "ev6",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 43.16, 49 impresiones, CTR 0%."
            },
            {
              "id": "ev7",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "Cluster taquillas_melamina_fenolico, action differentiate: decision O29.1 aprobada -- la keyword generica melamina ya NO debe apuntar aqui; actionIds mal enrutados se cierran via scripts/o291-resolve-melamina-cannibalization.ts."
            },
            {
              "id": "ev8",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "Cluster taquillas_melamina, action update_existing_page: pagina general de material, canibalizacion con la pagina de combinacion fenolico ya resuelta; actionIds historicos mal enrutados a esa otra pagina se cierran, no se ejecutan."
            },
            {
              "id": "ev9",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 30.07, 83 impresiones, CTR 0%."
            },
            {
              "id": "ev10",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "actionItem quick_win+low_ctr, prioridad medium, posicion actual 28.86, 72 impresiones, CTR 0%."
            },
            {
              "id": "ev11",
              "source": "cluster_catalog",
              "description": "Cluster taquillas_universidad, action new_page_candidate: sin pagina de produccion equivalente; staging 2110 ya creada y visualmente aprobada."
            },
            {
              "id": "ev12",
              "source": "cluster_catalog",
              "description": "Cluster taquillas_metalicas, action new_page_candidate: tercer material del catalogo sin pagina de producto propia; staging 2105 ya creada y visualmente aprobada."
            },
            {
              "id": "ev13",
              "source": "cluster_catalog",
              "description": "Cluster taquillas_vestuarios, action new_page_candidate: distinto de /bancos-de-vestuario/, sin pagina equivalente; staging 2104 ya creada y visualmente aprobada."
            },
            {
              "id": "ev14",
              "source": "cluster_catalog",
              "description": "Cluster taquillas_inteligentes_general, action new_page_candidate: solucion general (mueble+cerradura+PIN/RFID/app) distinta del cluster de hardware de cierre; riesgo de canibalizacion documentado con cerraduras_inteligentes_taquillas, requiere aprobacion explicita de Pau."
            },
            {
              "id": "ev15",
              "source": "target_keyword_catalog",
              "keyword": "taquillas metalicas",
              "description": "Keyword objetivo comercial, prioridad medium."
            },
            {
              "id": "ev16",
              "source": "target_keyword_catalog",
              "keyword": "taquillas para gimnasios",
              "description": "Keyword objetivo comercial, prioridad high."
            },
            {
              "id": "ev17",
              "source": "target_keyword_catalog",
              "keyword": "lockers inteligentes",
              "description": "Keyword objetivo comercial, prioridad high."
            },
            {
              "id": "ev18",
              "source": "target_keyword_catalog",
              "keyword": "digitalizacion de taquillas",
              "description": "Keyword objetivo informacional, prioridad medium."
            },
            {
              "id": "ev19",
              "source": "cluster_catalog",
              "description": "Cluster taquillas_comercial_generico, action postpone: intencion transaccional pero demasiado generica; recomienda mejorar CTA/enlazado interno en paginas existentes (proceso de pedido, home) en vez de crear paginas nuevas."
            },
            {
              "id": "ev20",
              "source": "job_data",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "actionItem quick_win, prioridad high, posicion actual 20.41, 46 impresiones."
            },
            {
              "id": "ev21",
              "source": "job_data",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "description": "actionItem quick_win, prioridad medium, posicion actual 10.62, 21 impresiones."
            },
            {
              "id": "ev22",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "Cluster cerraduras_inteligentes_taquillas, action update_existing_page: 4 variantes de la misma intencion consolidadas en esta pagina, diferenciada de la version comercial de catalogo /cerraduras-para-taquillas/."
            },
            {
              "id": "ev23",
              "source": "job_data",
              "keyword": "taquillas colegios",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "actionItem quick_win+low_ctr, prioridad medium, posicion actual 25.13, 40 impresiones, CTR 0%."
            },
            {
              "id": "ev24",
              "source": "job_data",
              "keyword": "taquillas escolares",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 33.84, 32 impresiones, CTR 0%."
            },
            {
              "id": "ev25",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "Cluster taquillas_colegios_escolares, action update_existing_page: colegios y escolares tratados como sinonimos de intencion, consolidados en una sola pagina real."
            },
            {
              "id": "ev26",
              "source": "job_data",
              "keyword": "taquillas fenólicas en palencia",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 73.68, 28 impresiones, CTR 0%."
            },
            {
              "id": "ev27",
              "source": "job_data",
              "keyword": "fabricante de taquillas fenólicas en badajoz",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "actionItem future_opportunity+low_ctr, prioridad medium, posicion actual 83.41, 22 impresiones, CTR 0%."
            },
            {
              "id": "ev28",
              "source": "cluster_catalog",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "Cluster taquillas_fenolicas, action update_existing_page: los terminos geograficos (Palencia, Badajoz) se tratan como ruido sin intencion local real, no como cluster geografico aparte."
            }
          ],
          "unknowns": [
            "No hay cifras absolutas de clics, solo CTR relativo (\"0.00%\") y numero de impresiones -- no se puede cuantificar el impacto real en trafico de cada quick win.",
            "No hay ningun actionItem ni entrada de cluster para \"taquillas para gimnasios\", \"lockers inteligentes\" ni \"digitalizacion de taquillas\" pese a ser keywords objetivo de prioridad alta/media -- se desconoce si esto se debe a falta de impresiones en GSC, a un problema de cobertura del catalogo de clusters, o a ambas cosas.",
            "No se puede confirmar si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ha ejecutado sobre los actionItems de este run concreto (seo-watcher-2026-08-18T012813Z) o si estos dos actionItems mal enrutados son residuo pendiente de cierre.",
            "No hay informacion en este contexto sobre salud tecnica general del sitio (rastreo, sitemap, velocidad, indexabilidad) mas alla de lo que revelan las posiciones y el catalogo de clusters -- el analisis se limita a los datos de keyword/pagina entregados.",
            "No se especifica cual es el target URL correcto para \"cerraduras inteligentes para centros deportivos\" mas alla de las dos opciones mencionadas en el reason del cluster -- la decision final queda pendiente de Pau."
          ]
        }
      },
      {
        "employee": "content-strategist",
        "status": "executed",
        "output": {
          "contentOpportunity": {
            "title": "Actualizar title/meta y reforzar diferenciación de material en la página de taquillas fenólicas para la variante local \"en Palencia\"",
            "summary": "La keyword \"taquillas fenólicas en palencia\" es una variante geolocalizada de una página ya existente que puede captar demanda local de compra si el title/meta se ajusta y el contenido deja claro por qué la fenólica es la opción frente a melamina/metálica, evitando canibalizar el cluster ya existente."
          },
          "targetAudience": "Responsable de compras o mantenimiento de un colegio, gimnasio, piscina municipal o polideportivo en Palencia y su provincia que necesita renovar taquillas en zonas húmedas (duchas, vestuarios) y busca proveedor cercano o que sirva en su zona.",
          "searchIntent": "transactional",
          "commercialIntent": "Captar leads B2B locales listos para pedir presupuesto de taquillas fenólicas, aprovechando que la búsqueda combina material concreto + ubicación (señal de intención de compra cercana a la decisión), sin prometer cobertura logística que no está confirmada en el input.",
          "angle": "Diferenciar explícitamente la fenólica frente a melamina y metálica (resistencia a humedad e impacto, uso en piscinas/duchas/gimnasios) para que la página no compita por las mismas señales que el cluster de melamina/colegios ya detectado, y anclar el contenido en casos de uso B2B reales de la zona sin inventar presencia o plazos locales.",
          "contentType": "title_meta_improvement",
          "targetBrand": "zentry",
          "recommendedStructure": {
            "h1": "Taquillas Fenólicas en Palencia: Resistencia y Durabilidad para Espacios Húmedos",
            "sections": [
              {
                "heading": "Taquillas fenólicas: características y usos",
                "level": "H2",
                "purpose": "Presentar el material fenólico (resistencia a humedad e impacto, acabado técnico) usando el catálogo confirmado de la marca, y sus entornos típicos (piscinas, duchas, gimnasios, polideportivos) para que el lector confirme que es el material adecuado a su caso."
              },
              {
                "heading": "Fenólica vs. melamina vs. metálica: cómo elegir",
                "level": "H2",
                "purpose": "Diferenciar claramente esta página del cluster de taquillas de melamina/colegios ya detectado, ayudando a decidir según humedad del entorno y nivel de uso, para reducir el riesgo de canibalización interna."
              },
              {
                "heading": "Taquillas fenólicas para colegios, gimnasios y piscinas en Palencia",
                "level": "H2",
                "purpose": "Conectar la keyword geolocalizada con casos de uso B2B concretos de la zona, sin afirmar cobertura de servicio, plazos de entrega o presencia local que no vienen confirmados en el input."
              },
              {
                "heading": "Solicita tu presupuesto de taquillas fenólicas",
                "level": "H2",
                "purpose": "Bloque de conversión que remite a presupuesto a medida sin fijar precios ni condiciones no confirmadas."
              },
              {
                "heading": "Preguntas frecuentes sobre taquillas fenólicas",
                "level": "H2",
                "purpose": "Resolver dudas habituales (medidas, mantenimiento, diferencias con otros materiales) para capturar featured snippets, sin introducir cifras de garantía o plazo no confirmadas."
              }
            ]
          },
          "ctaStrategy": {
            "primaryCta": "Solicitar presupuesto sin compromiso",
            "rationale": "Coincide con recommendedCtaHint y encaja con la intención transactional de la keyword (material + ubicación); al no tener datos de precio, plazo o cobertura local confirmados, el CTA remite a presupuesto a medida en vez de prometer cifras."
          },
          "internalLinks": [
            {
              "anchorIdea": "taquillas de melamina",
              "targetDescription": "página/categoría de taquillas de melamina, keyword relacionada: taquillas melamina, taquillas de melamina",
              "isRealLink": false
            },
            {
              "anchorIdea": "taquillas para colegios",
              "targetDescription": "página de categoría de taquillas escolares/colegios, keyword relacionada: taquillas colegios, taquillas escolares",
              "isRealLink": false
            },
            {
              "anchorIdea": "ver todo el catálogo de taquillas",
              "targetDescription": "landing o categoría principal de taquillas, según internalLinkHints (\"landing/categoría principal relacionada\")",
              "isRealLink": false
            }
          ],
          "supportingEvidence": [
            "currentAssumptions confirma que la keyword y la página https://zentrylockers.com/taquillas-fenolicas/ siguen vigentes y existiendo en esa URL.",
            "clusterNote advierte de posible cluster/canibalización con taquillas melamina, taquillas de melamina, taquillas colegios, taquillas escolares y comprar taquillas, lo que justifica el ángulo de diferenciación de material en vez de repetir contenido genérico de esas páginas.",
            "brandRationale del contexto confirma intención principal de compra de mobiliario (Zentry) y material detectado fenólica/fenólicas, coherente con el catálogo confirmado de materiales de la skill de marca."
          ],
          "priority": "medium",
          "risksAndUnknowns": [
            "Riesgo de canibalización SEO con el cluster de taquillas melamina/colegios/escolares ya señalado en clusterNote y risks del contexto.",
            "Se asume que la página sigue existiendo en esa URL y que el brief sigue vigente; si ha cambiado desde que se generó la work order, la propuesta debería revalidarse.",
            "No hay datos de volumen de búsqueda real para la variante hiperlocal \"en palencia\", por lo que no se puede confirmar el impacto SEO esperado de esta mejora.",
            "No se dispone de datos confirmados sobre cobertura de servicio, plazos de entrega o presencia local en Palencia; cualquier mención geográfica debe limitarse a la keyword/título, no a promesas de logística o presencia física.",
            "El registro de decisiones humanas muestra que ya se cerraron actionItems de canibalización de \"taquillas melamina\", pero esta página es sobre fenólica: conviene confirmar con negocio si esa resolución también cubre el solapamiento con fenólica antes de publicar cambios de contenido más allá del title/meta."
          ],
          "reasoningNotes": [
            "Mantengo contentType como title_meta_improvement (coincide con contentTypeHint) en vez de expandir a un artículo completo, porque changeType es content_update de prioridad media sobre una keyword hiperlocal de la que no hay datos de volumen; la recommendedStructure se ofrece como mejoras ligeras de apoyo (para reforzar diferenciación y reducir canibalización), no como un artículo nuevo desde cero.",
            "Sustituyo el heading genérico \"¿Que es taquillas fenólicas en palencia?\" del proposedStructureHint por encabezados orientados a beneficio/diferenciación, porque el original lee como plantilla de keyword-stuffing poco natural y no aporta valor real a la audiencia B2B.",
            "El ángulo prioriza diferenciar fenólica frente a melamina/metálica precisamente porque el clusterNote y los risks del contexto señalan solapamiento con esas keywords; esto conecta directamente con la decisión humana ya aprobada de cerrar canibalización de 'taquillas melamina', aunque advierto en riesgos que esa resolución no cubre explícitamente el caso fenólica.",
            "No incluyo ninguna sección de 'Precios y presupuesto' con cifras (a diferencia del proposedStructureHint que sugería un H2 'Precios y presupuesto'); en su lugar el bloque de CTA remite a solicitar presupuesto, siguiendo la regla de no fabricar precios ni plazos que no vienen en currentAssumptions."
          ]
        }
      },
      {
        "employee": "analytics-specialist",
        "status": "executed",
        "output": {
          "runSummary": {
            "departmentRunId": "dept-2026-08-18T012804Z",
            "reportGeneratedAt": "2026-08-18T01:28:25.254Z",
            "ga4Connected": true,
            "gtmConnected": true
          },
          "measurementFindings": [
            {
              "claimType": "FACT",
              "statement": "El contexto cubre el periodo GA4 del 2026-07-20 al 2026-08-17, con GA4 y GTM conectados en vivo en esta pasada.",
              "evidenceIds": []
            },
            {
              "claimType": "FACT",
              "statement": "El contenedor GTM www.zentrylockers.com tiene 8 tags, 7 triggers y 0 variables; ninguno de los 8 tags aparece marcado como pausado.",
              "evidenceIds": [
                "e17",
                "e18"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El nombre de la version live del contenedor GTM es O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5), lo que introduce una contradiccion entre estar catalogada como version live y su propio nombre indicando que esta pendiente de aprobacion/sin publicar.",
              "evidenceIds": [
                "e17"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "En la landing /product/taquilla-2-puertas-modulo-1-melamina las conversiones registradas (11) superan al numero de sesiones (4), y en la home las conversiones (59) representan mas del 50% de las sesiones (115), lo que sugiere que la metrica conversions puede contar multiples eventos clave por sesion en lugar de sesiones unicas que convierten.",
              "evidenceIds": [
                "e6",
                "e7"
              ]
            }
          ],
          "funnelObservations": [
            {
              "claimType": "FACT",
              "statement": "El evento view_quote_page registro 12 ocurrencias mientras que click_request_quote registro 66 ocurrencias en el mismo periodo.",
              "evidenceIds": [
                "e9",
                "e10"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Dado que las ocurrencias de click_request_quote (66) superan ampliamente a las de view_quote_page (12), y GTM tiene un trigger de linkClick llamado /solicitar-presupuesto/ separado de un trigger de pageview llamado Page Path equals /solicitar-presupuesto/, el evento click_request_quote parece dispararse tambien desde ubicaciones distintas a la propia pagina de presupuesto.",
              "evidenceIds": [
                "e9",
                "e10",
                "e20",
                "e21"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El evento click_phone del catalogo de eventos clave aparece con fired false y 0 ocurrencias/0 conversiones en el periodo, por lo que no hay datos de este paso del funnel.",
              "evidenceIds": [
                "e8"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "view_contact_page registro 39 ocurrencias y 0 conversiones, y view_quote_page registro 12 ocurrencias y 0 conversiones, en linea con ser eventos de vista de pagina y no acciones de conversion.",
              "evidenceIds": [
                "e10",
                "e14"
              ]
            }
          ],
          "trafficObservations": [
            {
              "claimType": "FACT",
              "statement": "El canal Direct registro 172 sesiones y 81 conversiones en el periodo, frente a 8 sesiones/3 conversiones de Organic Search, 3 sesiones/2 conversiones de Referral, 2 sesiones/0 conversiones de AI Assistant y 1 sesion/1 conversion de Unassigned.",
              "evidenceIds": [
                "e1",
                "e2",
                "e3",
                "e4",
                "e5"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El canal Direct concentra la gran mayoria de las sesiones (172 de 186 sesiones totales entre los 5 canales listados) y de las conversiones (81 de 87) del periodo.",
              "evidenceIds": [
                "e1",
                "e2",
                "e3",
                "e4",
                "e5"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El canal Direct muestra 172 sesiones frente a solo 68 usuarios activos (ratio de aproximadamente 2.5 sesiones por usuario), mientras que Organic Search (8 sesiones/6 usuarios) y AI Assistant (2 sesiones/2 usuarios) estan cerca de una relacion 1:1.",
              "evidenceIds": [
                "e1",
                "e2",
                "e4"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La fuente/medio tagassistant.google.com / referral registro 3 sesiones y 2 conversiones en el periodo.",
              "evidenceIds": [
                "e15"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La landing page / (home) es la de mayor trafico con 115 sesiones, 59 conversiones y una tasa de rebote de 31.3%.",
              "evidenceIds": [
                "e6"
              ]
            }
          ],
          "conversionObservations": [
            {
              "claimType": "FACT",
              "statement": "click_request_quote es el evento clave con mas ocurrencias del periodo (66), seguido de view_contact_page (39, sin conversiones asociadas) y click_whatsapp (15, todas contadas como conversion).",
              "evidenceIds": [
                "e9",
                "e14",
                "e12"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "generate_lead_form_submit registro 6 ocurrencias y 6 conversiones, y click_whatsapp registro 15 ocurrencias y 15 conversiones, es decir, el 100% de sus disparos se contabilizan como conversion.",
              "evidenceIds": [
                "e13",
                "e12"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "click_catalog_download se disparo 4 veces en el periodo pero registro 0 conversiones, a diferencia de generate_lead_form_submit, click_whatsapp y click_request_quote que si se cuentan como conversion.",
              "evidenceIds": [
                "e11",
                "e13",
                "e12",
                "e9"
              ]
            }
          ],
          "trackingIssues": [
            {
              "claimType": "FACT",
              "statement": "El evento click_phone figura en el catalogo de eventos clave con fired false y 0 ocurrencias en el periodo 2026-07-20 a 2026-08-17, pese a que GTM tiene configurados un tag GA4 Event - click_phone (no pausado) y un trigger click_phone de tipo linkClick.",
              "evidenceIds": [
                "e8",
                "e18",
                "e19"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "La version live reportada del contenedor GTM se llama O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5), lo que genera incertidumbre sobre si los tags/triggers listados como live corresponden efectivamente a lo publicado en produccion.",
              "evidenceIds": [
                "e17"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "click_catalog_download se dispara (4 ocurrencias) pero no esta contabilizado como conversion en GA4, a diferencia de otros eventos de accion de lead como generate_lead_form_submit, click_whatsapp y click_request_quote.",
              "evidenceIds": [
                "e11",
                "e13",
                "e12",
                "e9"
              ]
            }
          ],
          "anomalyCandidates": [
            {
              "claimType": "OBSERVATION",
              "statement": "El ratio de sesiones por usuario en el canal Direct (aproximadamente 2.5) es notablemente mayor que en otros canales del periodo, lo que lo convierte en candidato a revision.",
              "evidenceIds": [
                "e1",
                "e2",
                "e4"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "La presencia de tagassistant.google.com como fuente/medio de tipo referral con 2 conversiones es un patron que llama la atencion y conviene revisar antes de tratarlo como trafico externo genuino.",
              "evidenceIds": [
                "e15"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Que la landing /product/taquilla-2-puertas-modulo-1-melamina registre mas conversiones (11) que sesiones (4) es un patron candidato a revisar.",
              "evidenceIds": [
                "e7"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Que click_phone no registre ninguna ocurrencia en todo el periodo, teniendo tag y trigger configurados y activos en GTM, es un patron candidato a revisar frente al resto de eventos del catalogo que si se disparan.",
              "evidenceIds": [
                "e8",
                "e18",
                "e19"
              ]
            }
          ],
          "hypotheses": [
            {
              "claimType": "HYPOTHESIS",
              "statement": "El alto ratio de sesiones por usuario del canal Direct podria deberse a visitantes recurrentes que acceden directamente a la web, a pruebas internas del equipo, o a trafico de otros canales que pierde sus parametros UTM y se atribuye como Direct; no esta confirmado con los datos disponibles.",
              "evidenceIds": [
                "e1",
                "e2",
                "e4"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Las sesiones con fuente tagassistant.google.com podrian corresponder a actividad interna de comprobacion de tags (QA) del propio equipo en lugar de trafico externo real, aunque no puede confirmarse con el contexto entregado.",
              "evidenceIds": [
                "e15"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Que click_phone registre 0 ocurrencias podria deberse a un fallo en el disparo del tag/trigger (por ejemplo un selector roto) en lugar de una ausencia real de clics en el telefono, dado que el tag y el trigger existen y no estan pausados; esto no esta confirmado.",
              "evidenceIds": [
                "e8",
                "e18",
                "e19"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Las conversiones que superan a las sesiones en algunas landing pages podrian explicarse porque una misma sesion dispara mas de un evento clave (por ejemplo click_whatsapp y click_request_quote en la misma visita), aunque no puede confirmarse con los datos entregados.",
              "evidenceIds": [
                "e6",
                "e7"
              ]
            }
          ],
          "recommendedMeasurements": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GTM Preview / GA4 DebugView el tag GA4 Event - click_phone realizando un clic real sobre el enlace de telefono, dado que en el periodo analizado no se registro ninguna ocurrencia pese a que el tag y el trigger estan configurados y activos.",
              "evidenceIds": [
                "e8",
                "e18",
                "e19"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar si la version O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) es realmente la que sirve en produccion, dado que su propio nombre sugiere un estado pendiente de aprobacion.",
              "evidenceIds": [
                "e17"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Segmentar las sesiones del canal Direct por usuarios nuevos vs recurrentes en GA4 para revisar si el alto ratio de sesiones por usuario proviene de un numero reducido de usuarios muy recurrentes.",
              "evidenceIds": [
                "e1"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Excluir o segmentar por separado las sesiones con fuente tagassistant.google.com en los informes de trafico/conversion por canal para evitar que trafico de comprobacion interna distorsione el canal Referral.",
              "evidenceIds": [
                "e15"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Documentar de forma explicita como se calcula la metrica conversions en estos informes (recuento de eventos clave vs. sesiones unicas que convierten), dado que en algunas landing pages las conversiones superan a las sesiones.",
              "evidenceIds": [
                "e6",
                "e7"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Evaluar si click_catalog_download deberia marcarse como evento de conversion en GA4, en linea con generate_lead_form_submit, click_whatsapp y click_request_quote.",
              "evidenceIds": [
                "e11",
                "e13",
                "e12",
                "e9"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GTM Preview / GA4 DebugView el tag GA4 Event - click_phone con un clic real, ya que es un evento del catalogo sin ninguna ocurrencia en todo el periodo pese a estar configurado y activo.",
              "evidenceIds": [
                "e8",
                "e18",
                "e19"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar si la version live O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) esta realmente publicada en produccion, ya que afecta a la confianza en todo el resto de tags/triggers reportados.",
              "evidenceIds": [
                "e17"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Excluir o segmentar por separado las sesiones con fuente tagassistant.google.com en los informes de canal Referral para no mezclar trafico de comprobacion interna con trafico externo real.",
              "evidenceIds": [
                "e15"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Segmentar las sesiones del canal Direct por usuarios nuevos vs recurrentes para entender el alto ratio de sesiones por usuario observado en el periodo.",
              "evidenceIds": [
                "e1"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Documentar la definicion exacta de la metrica conversions usada en estos informes, dado que en algunas landing pages supera al numero de sesiones.",
              "evidenceIds": [
                "e6",
                "e7"
              ],
              "priority": "low"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Evaluar marcar click_catalog_download como evento de conversion en GA4 para alinearlo con el resto de eventos de accion de lead.",
              "evidenceIds": [
                "e11",
                "e13",
                "e12",
                "e9"
              ],
              "priority": "low"
            }
          ],
          "evidence": [
            {
              "id": "e1",
              "source": "ga4_channel_traffic",
              "description": "Canal Direct: 172 sesiones, 68 usuarios activos, 81 conversiones en el periodo 2026-07-20 a 2026-08-17."
            },
            {
              "id": "e2",
              "source": "ga4_channel_traffic",
              "description": "Canal Organic Search: 8 sesiones, 6 usuarios activos, 3 conversiones."
            },
            {
              "id": "e3",
              "source": "ga4_channel_traffic",
              "description": "Canal Referral: 3 sesiones, 1 usuario activo, 2 conversiones."
            },
            {
              "id": "e4",
              "source": "ga4_channel_traffic",
              "description": "Canal AI Assistant: 2 sesiones, 2 usuarios activos, 0 conversiones."
            },
            {
              "id": "e5",
              "source": "ga4_channel_traffic",
              "description": "Canal Unassigned: 1 sesion, 1 usuario activo, 1 conversion."
            },
            {
              "id": "e6",
              "source": "ga4_landing_pages",
              "description": "Landing page / (home): 115 sesiones, 59 conversiones, tasa de rebote 31.3%."
            },
            {
              "id": "e7",
              "source": "ga4_landing_pages",
              "description": "Landing page /product/taquilla-2-puertas-modulo-1-melamina: 4 sesiones, 11 conversiones, tasa de rebote 25%."
            },
            {
              "id": "e8",
              "source": "ga4_key_events",
              "description": "Evento click_phone: fired false, 0 ocurrencias, 0 conversiones."
            },
            {
              "id": "e9",
              "source": "ga4_key_events",
              "description": "Evento click_request_quote: fired true, 66 ocurrencias, 66 conversiones."
            },
            {
              "id": "e10",
              "source": "ga4_key_events",
              "description": "Evento view_quote_page: fired true, 12 ocurrencias, 0 conversiones."
            },
            {
              "id": "e11",
              "source": "ga4_key_events",
              "description": "Evento click_catalog_download: fired true, 4 ocurrencias, 0 conversiones."
            },
            {
              "id": "e12",
              "source": "ga4_key_events",
              "description": "Evento click_whatsapp: fired true, 15 ocurrencias, 15 conversiones."
            },
            {
              "id": "e13",
              "source": "ga4_key_events",
              "description": "Evento generate_lead_form_submit: fired true, 6 ocurrencias, 6 conversiones."
            },
            {
              "id": "e14",
              "source": "ga4_key_events",
              "description": "Evento view_contact_page: fired true, 39 ocurrencias, 0 conversiones."
            },
            {
              "id": "e15",
              "source": "ga4_source_medium",
              "description": "Fuente/medio tagassistant.google.com / referral: 3 sesiones, 2 conversiones."
            },
            {
              "id": "e16",
              "source": "ga4_source_medium",
              "description": "Fuente/medio (direct)/(none): 172 sesiones, 81 conversiones."
            },
            {
              "id": "e17",
              "source": "gtm_container",
              "description": "Contenedor www.zentrylockers.com, liveVersionName O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5), tagCount 8, triggerCount 7, variableCount 0."
            },
            {
              "id": "e18",
              "source": "gtm_tags",
              "description": "Tag GA4 Event - click_phone, tipo gaawe, paused false."
            },
            {
              "id": "e19",
              "source": "gtm_triggers",
              "description": "Trigger click_phone, tipo linkClick."
            },
            {
              "id": "e20",
              "source": "gtm_triggers",
              "description": "Trigger /solicitar-presupuesto/, tipo linkClick."
            },
            {
              "id": "e21",
              "source": "gtm_triggers",
              "description": "Trigger Page Path equals /solicitar-presupuesto/, tipo pageview."
            }
          ],
          "unknowns": [
            "No se puede determinar si la ausencia de ocurrencias de click_phone se debe a un fallo tecnico del tag/trigger o simplemente a que ningun usuario hizo clic en el telefono durante el periodo.",
            "No hay datos de periodos anteriores en el contexto para comparar si las cifras de trafico y conversion de este periodo son tipicas o atipicas respecto a la tendencia historica del sitio.",
            "No se especifica en el contexto si la version live del contenedor GTM (O44, cuyo nombre indica pendiente de aprobacion) ha sido efectivamente publicada en produccion o sigue en estado de revision.",
            "No hay informacion de dispositivo, geografia o segmento de usuario en el contexto que permita explicar el alto ratio de sesiones por usuario del canal Direct.",
            "No se especifica en el contexto la definicion exacta que usa GA4 para la metrica conversions (recuento de eventos clave vs. sesiones unicas que convierten), lo que impide confirmar por que algunas landing pages muestran mas conversiones que sesiones."
          ]
        }
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "El esfuerzo debe concentrarse primero en verificar que los enrutados SEO ya aprobados por humanos (fix de /cerraduras/ y cierre de canibalizacion de taquillas melamina) se hayan aplicado de verdad, porque el run live mas reciente (seo-watcher-2026-08-18T012813Z) sigue mostrando esos mismos problemas sin resolver. En paralelo, validar el disparo real de click_phone y confirmar si la version O44 de GTM esta realmente publicada en produccion es critico porque condiciona la fiabilidad de cualquier otra metrica de conversion. El quick win de cerraduras inteligentes para taquillas y la auditoria de metas con CTR 0% (incluyendo la propuesta de content-strategist para taquillas fenolicas en Palencia, que coincide con un hallazgo independiente de seo-specialist sobre la misma pagina) aportan impacto medio con esfuerzo bajo-medio. La publicacion de las paginas de staging (universidades, metalicas, vestuarios) debe seguir en pausa: una decision humana del 2026-08-16 la rechazo explicitamente por calidad visual insuficiente, pese a que seo-specialist vuelve a proponerla en esta pasada. sem-specialist sigue sin datos en esta fase, por lo que no se puede evaluar SEM ni descartarlo como causa del patron anomalo del canal Direct.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "seo-specialist detecta en datos live de Search Console (36 jobs, run seo-watcher-2026-08-18T012813Z) dos problemas de enrutado urgentes (pagina /cerraduras/ en papelera con 301 real, y actionItems de melamina mal enrutados a /taquillas-melamina-fenolico/ pese a decision previa), ademas de quick wins reales y un patron amplio de CTR 0% con impresiones relevantes.",
            "evidenceRefs": [
              "dept-seo-summary",
              "dept-seo-technical-issue-1",
              "dept-seo-technical-issue-2",
              "dept-seo-technical-issue-3"
            ]
          },
          {
            "channel": "content",
            "description": "content-strategist propone una mejora de title/meta para /taquillas-fenolicas/ orientada a la variante geolocalizada Palencia, con estructura y CTA definidos, y declara explicitamente riesgo de canibalizacion con el cluster de melamina/colegios que aun no esta confirmado como resuelto.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-structure",
              "dept-content-cta",
              "dept-content-risks"
            ]
          },
          {
            "channel": "analytics",
            "description": "analytics-specialist confirma GA4 y GTM conectados en vivo, pero encuentra tres problemas de medicion: click_phone sin ninguna ocurrencia pese a tag/trigger activos, la version live de GTM llamada O44 con nombre que indica pendiente de aprobacion, y click_catalog_download disparandose sin contar como conversion.",
            "evidenceRefs": [
              "dept-analytics-summary",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2",
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "channel": "ops",
            "description": "El backlog operativo (acciones, work orders, change packs, aprobaciones) viene deliberadamente a cero en esta pasada para forzar decisiones sobre datos live y salidas de especialistas, no sobre trabajo pendiente historico.",
            "evidenceRefs": [
              "department-warnings"
            ]
          },
          {
            "channel": "sem",
            "description": "sem-specialist queda fuera de esta fase (not_available); no hay ninguna senal de gasto, CPC, impresiones ni campanas de Google Ads en esta pasada.",
            "evidenceRefs": [
              "dept-sem-unavailable"
            ]
          }
        ],
        "bottlenecks": [
          {
            "channel": "seo",
            "description": "El actionItem sobre cerraduras inteligentes para centros deportivos sigue apuntando a /cerraduras/, pagina en papelera con redireccion 301 real, pese a que esta correccion ya fue aprobada por un humano el 2026-08-16 -- el dato live de esta pasada indica que la correccion aun no se ha aplicado.",
            "evidenceRefs": [
              "dept-seo-technical-issue-1",
              "dept-seo-action-1"
            ]
          },
          {
            "channel": "seo",
            "description": "Dos actionItems de este mismo run (taquillas melamina, taquillas de melamina) siguen enrutados a /taquillas-melamina-fenolico/ pese a que el cierre de esta canibalizacion ya fue aprobado por un humano el 2026-08-16 -- indica que el script de resolucion aun no se ha ejecutado sobre este run.",
            "evidenceRefs": [
              "dept-seo-technical-issue-2",
              "dept-seo-action-2"
            ]
          },
          {
            "channel": "analytics",
            "description": "La version live del contenedor GTM se llama O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau), lo que genera incertidumbre sobre si los tags/triggers reportados como live estan realmente en produccion, incluyendo el tag de click_phone.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "channel": "product",
            "description": "seo-specialist recomienda publicar a produccion las paginas de staging de universidades, metalicas y vestuarios, pero una decision humana del 2026-08-16 rechazo explicitamente esa misma publicacion por calidad visual y fotografica insuficiente -- hay una contradiccion entre la propuesta viva del especialista y la decision humana ya registrada.",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "Quick win de alta prioridad ya bien enrutado: cerraduras inteligentes para taquillas en posicion 20.4, con margen para entrar en top 10 reforzando H1/H2, texto y enlazado interno.",
            "evidenceRefs": [
              "dept-seo-opportunity-3",
              "dept-seo-action-3"
            ]
          },
          {
            "channel": "seo",
            "description": "Comprar taquillas para hospitales ya en posicion 10.6, a un empujon minimo (title/meta, enlazado interno) de entrar en primera pagina.",
            "evidenceRefs": [
              "dept-seo-opportunity-4",
              "dept-seo-action-4"
            ]
          },
          {
            "channel": "content",
            "description": "La variante geolocalizada taquillas fenolicas en Palencia coincide con un hallazgo independiente de seo-specialist sobre CTR 0% en /taquillas-fenolicas/ (ev26, ev27 dentro de dept-seo-technical-issue-3) -- ambos especialistas senalan la misma pagina sin haberse coordinado, lo que refuerza la senal y permite abordarla en un solo trabajo de title/meta.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-seo-technical-issue-3",
              "cross-check-fenolica-ctr"
            ]
          },
          {
            "channel": "analytics",
            "description": "click_catalog_download se dispara 4 veces en el periodo pero no cuenta como conversion en GA4, a diferencia de otros eventos de accion de lead -- oportunidad de baja complejidad para alinear la medicion.",
            "evidenceRefs": [
              "dept-analytics-action-6",
              "dept-analytics-tracking-issue-3"
            ]
          }
        ],
        "experiments": [
          {
            "title": "Refuerzo on-page de cerraduras inteligentes para taquillas",
            "hypothesis": "Reforzar H1/H2, ampliar el texto, mejorar enlazado interno y actualizar meta title/description movera la keyword de posicion 20.4 a top 10.",
            "channel": "seo",
            "successMetric": "Posicion media en Search Console para cerraduras inteligentes para taquillas por debajo de 10",
            "evidenceRefs": [
              "dept-seo-opportunity-3"
            ]
          },
          {
            "title": "Auditoria en lote de metas con CTR 0%",
            "hypothesis": "Reescribir title/meta description en las paginas con CTR 0.00% e impresiones relevantes (colegios, melamina, fenolicas, incluida la variante Palencia) aumentara el CTR sin perder posicion.",
            "channel": "seo",
            "successMetric": "CTR promedio de las paginas afectadas por encima de 0% en el siguiente periodo de Search Console",
            "evidenceRefs": [
              "dept-seo-action-5",
              "dept-content-summary"
            ]
          },
          {
            "title": "Validacion manual del tag click_phone",
            "hypothesis": "Un clic real sobre el enlace de telefono en GTM Preview / GA4 DebugView confirmara si el tag GA4 Event - click_phone dispara correctamente; si no dispara, hay un fallo tecnico y no ausencia real de clics.",
            "channel": "analytics",
            "successMetric": "El tag click_phone registra al menos una ocurrencia verificada en DebugView tras la prueba manual",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-1"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Verificar y completar el cierre de los enrutados SEO ya aprobados (/cerraduras/ y taquillas melamina)",
            "rationale": "Impacto alto y esfuerzo bajo: ambas correcciones ya fueron aprobadas por un humano el 2026-08-16, pero el run live mas reciente (seo-watcher-2026-08-18T012813Z) demuestra que los mismos actionItems siguen mal enrutados -- ejecutar cualquier otra optimizacion sobre estas paginas antes de resolver esto desperdicia esfuerzo. Confianza alta porque la evidencia es directa y reciente.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Aprobacion humana ya concedida el 2026-08-16",
              "Ejecucion tecnica del script scripts/o291-resolve-melamina-cannibalization.ts sobre el run actual"
            ],
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-action-2",
              "dept-seo-technical-issue-1",
              "dept-seo-technical-issue-2"
            ]
          },
          {
            "title": "Confirmar el estado real de publicacion de la version O44 de GTM",
            "rationale": "Impacto alto porque el nombre de la version live sugiere que esta pendiente de aprobacion, lo cual pone en duda la fiabilidad de todos los tags y triggers reportados como activos, incluyendo el tag de click_phone que se propone validar. Esfuerzo bajo (confirmar con Pau/consola GTM). Confianza media porque es un hallazgo nuevo de esta pasada sin decision humana previa registrada.",
            "impact": "high",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Confirmacion de Pau sobre el estado de publicacion de la version O44 - Eventos CTA nuevos"
            ],
            "evidenceRefs": [
              "dept-analytics-action-2",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "title": "Validar el disparo real de click_phone en GTM Preview / GA4 DebugView",
            "rationale": "Ya aprobado por un humano el 2026-08-16; el evento sigue con 0 ocurrencias en el periodo mas reciente pese a tener tag y trigger activos, lo que mantiene abierta la duda sobre si se pierde una via de conversion real. Esfuerzo bajo, impacto alto si confirma un fallo tecnico corregible.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Aprobacion humana ya concedida el 2026-08-16",
              "Confirmar primero el estado de publicacion de la version O44 de GTM"
            ],
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "title": "Ejecutar el quick win on-page de cerraduras inteligentes para taquillas",
            "rationale": "Ya aprobado por un humano el 2026-08-16; keyword bien enrutada a la pagina correcta, en posicion 20.4 con 46 impresiones, con margen realista a top 10 mediante refuerzo de contenido y enlazado interno. Esfuerzo medio, impacto medio.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Aprobacion humana ya concedida el 2026-08-16"
            ],
            "evidenceRefs": [
              "dept-seo-action-3",
              "dept-seo-opportunity-3"
            ]
          },
          {
            "title": "Auditar y reescribir metas de las paginas con CTR 0% incluyendo la variante Palencia de content-strategist",
            "rationale": "Combina la accion ya aprobada de reescribir metas en 7 paginas con CTR 0% con la propuesta nueva de content-strategist para taquillas fenolicas en Palencia, dado que ambas apuntan al mismo patron sistemico y a la misma pagina (taquillas-fenolicas). Confianza media porque content-strategist declara un riesgo de canibalizacion con el cluster de melamina que no esta confirmado como cubierto por la resolucion ya aprobada.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "medium",
            "dependsOn": [
              "Aprobacion humana ya concedida el 2026-08-16 (rewrite CTR 0%)",
              "Confirmar con negocio si la resolucion de canibalizacion de melamina cubre tambien el solapamiento con fenolica"
            ],
            "evidenceRefs": [
              "dept-seo-action-5",
              "dept-seo-opportunity-5",
              "dept-seo-technical-issue-3",
              "dept-content-summary",
              "dept-content-risks"
            ]
          },
          {
            "title": "No republicar aun las paginas de staging de universidades, metalicas y vestuarios",
            "rationale": "seo-specialist vuelve a proponer publicarlas en esta pasada (impacto alto segun su propio ranking), pero una decision humana del 2026-08-16 rechazo explicitamente esa publicacion por falta de calidad visual y fotografica, indicando que necesitan una segunda iteracion antes de pasar a produccion. Se prioriza la decision humana ya registrada sobre la propuesta viva del especialista; confianza baja en cualquier plan de publicacion inmediata.",
            "impact": "medium",
            "confidence": "low",
            "effort": "medium",
            "dependsOn": [
              "Decision humana ya registrada (rechazo 2026-08-16) por calidad visual insuficiente",
              "Segunda iteracion visual/de contenido no evidenciada en este contexto"
            ],
            "evidenceRefs": [
              "dept-seo-action-6",
              "dept-seo-opportunity-6",
              "dept-seo-opportunity-7",
              "dept-seo-opportunity-8",
              "human-decision-staging-reject"
            ]
          },
          {
            "title": "Decidir con Pau el enrutado de taquillas inteligentes (solucion general) y retomar la coordinacion con content-strategist",
            "rationale": "El riesgo de canibalizacion entre taquillas_inteligentes_general y cerraduras_inteligentes_taquillas sigue sin resolver, y la coordinacion previa aprobada entre content-strategist y el cluster SEO no se completo en esta pasada porque content-strategist trabajo sobre un tema distinto (fenolica Palencia). Esfuerzo bajo (es una decision, no una ejecucion), impacto medio porque desbloquea contenido nuevo pendiente.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Decision explicita de Pau sobre taquillas_inteligentes_general vs cerraduras_inteligentes_taquillas",
              "Coordinacion pendiente con content-strategist no ejecutada en esta pasada"
            ],
            "evidenceRefs": [
              "dept-seo-action-7"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecuto en esta pasada coordinada y produjo salida completa (status executed en specialistInputs)."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecuto en esta pasada coordinada y produjo salida completa (status executed en specialistInputs)."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecuto en esta pasada coordinada y produjo salida completa (status executed en specialistInputs)."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "Status not_available en specialistInputs de esta pasada: sem-specialist esta explicitamente fuera de esta fase. No hay ningun dato de SEM/Google Ads disponible aqui, aunque el archivo de definicion del agente exista en el checkout."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "El archivo de definicion del agente existe en el checkout, pero no aparece en specialistInputs de esta pasada coordinada -- no hay salida ni evidencia de que haya producido artifacts en este ciclo."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "El archivo de definicion del agente existe en el checkout, pero no aparece en specialistInputs de esta pasada coordinada -- no hay salida ni evidencia de que haya producido artifacts en este ciclo."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "Ultimo agent_finished de sem-watcher en este departmentRunId reporta connected=true."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "Ultimo agent_finished de analytics-watcher en este departmentRunId reporta ga4Connected=true, gtmConnected=true."
          }
        ],
        "risks": [
          {
            "description": "La version live del contenedor GTM (O44) tiene un nombre que indica pendiente de aprobacion, lo que introduce incertidumbre sobre si los tags/triggers reportados (incluido click_phone) estan realmente en produccion -- cualquier decision basada en estos datos de tracking hereda esa incertidumbre.",
            "severity": "high",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "description": "Los enrutados de /cerraduras/ y de taquillas melamina, cuyo cierre ya fue aprobado por un humano el 2026-08-16, siguen apareciendo sin resolver en el run live del 2026-08-18 -- riesgo de que la correccion aprobada no se haya desplegado o de que el proceso de cierre no cubra los actionItems generados en runs posteriores.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-technical-issue-1",
              "dept-seo-technical-issue-2"
            ]
          },
          {
            "description": "seo-specialist recomienda publicar a produccion las paginas de staging de universidades, metalicas y vestuarios, contradiciendo una decision humana previa que rechazo esa misma publicacion por calidad visual insuficiente -- riesgo de que esta recomendacion se ejecute sin revisar la decision ya registrada.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-reject"
            ]
          },
          {
            "description": "content-strategist declara que el riesgo de canibalizacion de su propuesta sobre taquillas fenolicas con el cluster de melamina/colegios no esta confirmado como cubierto por la resolucion de canibalizacion ya aprobada para melamina -- confianza reducida en esa prioridad hasta confirmar con negocio.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-content-risks"
            ]
          },
          {
            "description": "sem-specialist esta completamente ausente en esta pasada; no se puede evaluar si el patron anomalo del canal Direct (172 sesiones, ratio de aproximadamente 2.5 sesiones por usuario) incluye trafico de pago mal atribuido, ni ningun otro aspecto de SEM.",
            "severity": "low",
            "evidenceRefs": [
              "dept-sem-unavailable",
              "dept-analytics-action-4"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "human-decision-staging-reject",
            "description": "Decision humana registrada el 2026-08-16 (pasada dept-2026-08-15T175321Z), version 1: rechazo la propuesta de publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general), con motivo textual: las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias, necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion."
          },
          {
            "ref": "cross-check-fenolica-ctr",
            "description": "Cruce propio entre la propuesta de content-strategist sobre taquillas fenolicas en Palencia (dept-content-summary) y el hallazgo tecnico T3 de seo-specialist (dept-seo-technical-issue-3), que incluye la pagina /taquillas-fenolicas/ (evidencias ev26, ev27) dentro del patron de CTR 0% con impresiones relevantes -- ambos especialistas senalan la misma pagina de forma independiente."
          }
        ],
        "unknowns": [
          "No hay ninguna senal de SEM/Google Ads en esta pasada (sem-specialist not_available); no se puede evaluar gasto, CPC, campanas activas ni su posible relacion con el trafico Direct anomalo.",
          "No se puede confirmar si el script scripts/o291-resolve-melamina-cannibalization.ts se ha ejecutado ya sobre los actionItems del run seo-watcher-2026-08-18T012813Z o si estan pendientes de cierre (declarado explicitamente por seo-specialist).",
          "No se especifica en este contexto cual es el target URL correcto para cerraduras inteligentes para centros deportivos mas alla de las dos opciones mencionadas por seo-specialist -- la decision final queda pendiente de Pau.",
          "No se puede confirmar si la version O44 de GTM (nombre indica pendiente de aprobacion) esta realmente publicada en produccion o sigue en revision.",
          "No hay evidencia en esta pasada de que qa-reviewer o web-engineer hayan producido artifacts propios; su estado real de ejecucion en este ciclo se desconoce.",
          "content-strategist advierte que no hay datos de volumen de busqueda real para la variante hiperlocal taquillas fenolicas en Palencia, por lo que no se puede confirmar el impacto SEO esperado de esa mejora."
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

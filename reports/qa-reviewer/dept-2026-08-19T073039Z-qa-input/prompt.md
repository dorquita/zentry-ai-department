# Prompt preparado para qa-reviewer -- artifact dept-2026-08-19T073039Z-qa-input

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
    "artifactId": "dept-2026-08-19T073039Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-19T073039Z/dept-2026-08-19T073039Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-19T073039Z",
    "generatedAt": "2026-08-19T07:43:54.036Z",
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
        "sourceRunId": "dept-2026-08-19T073039Z"
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
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "Con datos reales de esta pasada coordinada (seo-specialist, content-strategist y analytics-specialist ejecutados; sem-specialist ausente), el foco inmediato no es generar mas contenido nuevo sino sanear el pipeline existente: hay enrutados SEO rotos que estan desperdiciando esfuerzo (URL en papelera, cannibalizacion de melamina aun sin cerrar formalmente pese a una decision O29.1 ya aprobada), un patron sistemico de CTR 0% en varias paginas con impresiones reales, y una contradiccion relevante entre lo que el propio catalogo de clusters de SEO da por 'visualmente aprobado' para publicar en produccion (taquillas metalicas, vestuarios, universidades) y una decision humana reciente que rechazo exactamente esa publicacion por falta de riqueza visual. En analytics, con GA4 y GTM conectados, aparecen dos riesgos de medicion accionables: el evento click_phone nunca se dispara pese a tener tag y trigger configurados, y la version live de GTM referencia cambios 'sin publicar, pendiente aprobacion Pau', lo que pone en duda que lo que se mide hoy sea lo que realmente esta publicado. El pipeline operativo tiene ademas un cuello de botella real: 13 change packs bloqueados por cluster gate y una unica solicitud de aprobacion pendiente marcada como riesgo critico sobre la pagina de melamina-fenolico. La oportunidad de contenido nueva (landing puente 'industrial' Zentry/Tukandado) es razonable pero de baja confianza de intencion de busqueda (keyword de una sola palabra, sin volumen confirmado) y el propio content-strategist ya advierte que cualquier ejecucion futura debe evitar el mismo problema de pobreza visual que causo el rechazo anterior. SEM sigue fuera de esta fase: no hay ninguna senal de Google Ads en esta pasada y no debe inferirse nada sobre su estado.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "seo-specialist detecta 8 findings y 16 oportunidades sobre datos LIVE de Search Console: dos keywords de gimnasios/centros deportivos apuntan a una URL en papelera con 301, dos action items de melamina siguen apuntando a la pagina de combinacion especifica en vez de a /taquillas-melamina/ pese a la decision O29.1 ya aprobada, y hay un patron sistemico de CTR 0% en varias paginas con impresiones reales.",
            "evidenceRefs": [
              "dept-seo-summary",
              "dept-seo-action-1",
              "dept-seo-action-2",
              "dept-seo-action-8"
            ]
          },
          {
            "channel": "content",
            "description": "content-strategist propone una landing puente 'industrial' (Zentry mobiliario + Tukandado cerraduras) para una keyword generica sin modificador claro, con searchIntent comercial no confirmado y CTA doble; el propio especialista marca la intencion real como incierta.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-structure",
              "dept-content-cta"
            ]
          },
          {
            "channel": "analytics",
            "description": "analytics-specialist confirma GA4 y GTM conectados sin warnings del watcher, pero identifica 4 problemas de medicion: click_phone sin ninguna ocurrencia pese a tag/trigger configurados, tres eventos con ocurrencias pero 0 conversiones, la version live de GTM referenciando cambios 'sin publicar, pendiente aprobacion Pau', y ausencia de datos de asociacion tag-trigger.",
            "evidenceRefs": [
              "dept-analytics-summary",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2",
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "channel": "sem",
            "description": "sem-specialist queda explicitamente fuera de esta fase (not_available); no hay ninguna senal real de SEM/Google Ads en esta pasada mas alla de que sem-watcher V1 (deterministico) reporto 'conectado' en una pasada anterior del departamento.",
            "evidenceRefs": [
              "dept-sem-unavailable"
            ]
          },
          {
            "channel": "ops",
            "description": "El backlog operativo tiene 108 acciones vivas (8 high, 100 medium), 116/117 work orders listas para revisar, pero solo 8/80 change packs listos para revisar y 1 solicitud de aprobacion pendiente marcada como riesgo critico sobre la pagina de melamina-fenolico.",
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
            "description": "Dos grupos de action items estan mal enrutados y bloqueando la eficacia de cualquier trabajo on-page hasta que se corrijan: 'cerraduras inteligentes para centros deportivos/gimnasios' apunta a una URL en papelera con 301, y 'taquillas melamina/de melamina' sigue apuntando a la pagina de combinacion especifica en vez de a la generica pese a la decision O29.1 ya aprobada.",
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-action-2",
              "dept-seo-opportunity-2",
              "dept-seo-opportunity-3"
            ]
          },
          {
            "channel": "ops",
            "description": "13 change packs (2 SEO, 10 content, 1 CRO) estan bloqueados por cluster gate segun la actividad de esta pasada, y solo 8 de 80 change packs totales estan listos para revision, lo que estrangula el paso de acciones aprobadas a produccion.",
            "evidenceRefs": [
              "cluster-gate-blocked-summary",
              "changepacks-ready"
            ]
          },
          {
            "channel": "content",
            "description": "Contradiccion detectada entre el catalogo de clusters usado por seo-specialist (que da por 'visualmente aprobadas' las paginas de staging de taquillas metalicas, vestuarios y universidades y recomienda publicarlas en produccion) y una decision humana reciente que rechazo explicitamente esa misma publicacion por considerar las paginas 'demasiado basicas y sin suficientes imagenes/fotografias'. No se puede asumir que esa objecion ya este resuelta.",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-publish-rejected"
            ]
          },
          {
            "channel": "analytics",
            "description": "La version live del contenedor GTM referencia cambios 'sin publicar, pendiente aprobacion Pau', lo que introduce duda sobre si la configuracion de eventos que se esta midiendo hoy es realmente la vigente en produccion.",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-3"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "Quick win de alta prioridad en 'cerraduras inteligentes para taquillas' (posicion 20.4, 46 impresiones): reforzar H1/H2, enlazado interno y meta title/description para entrar en top 10.",
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "dept-seo-action-3"
            ]
          },
          {
            "channel": "seo",
            "description": "Refuerzo consolidado de contenido y metas para el cluster de melamina (melamina, de melamina, taquilla madera, vestuarios de melamina) una vez corregido el enrutado, aprovechando que varias variantes comparten la misma pagina.",
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "channel": "analytics",
            "description": "Revisar si view_quote_page, view_contact_page y click_catalog_download deben marcarse como eventos de conversion en GA4: tienen ocurrencias reales pero 0 conversiones, a diferencia del resto del catalogo de eventos.",
            "evidenceRefs": [
              "dept-analytics-action-3",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "channel": "content",
            "description": "Landing puente 'industrial' (Zentry + Tukandado) como forma de cualificar trafico B2B generico que hoy no tiene una pagina propia que lo derive correctamente entre mueble y control de acceso.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-structure"
            ]
          }
        ],
        "experiments": [
          {
            "title": "Reescritura de meta title/description en paginas con CTR 0%",
            "hypothesis": "Si se reescriben los meta title/description de las paginas afectadas por el patron sistemico de CTR 0% (melamina, colegios, fenolicas en Palencia, entre otras), el CTR organico de esas paginas aumentara sin necesidad de mejorar posicion.",
            "channel": "seo",
            "successMetric": "CTR organico por pagina en Search Console, medido antes/despues del cambio",
            "evidenceRefs": [
              "dept-seo-action-8"
            ]
          },
          {
            "title": "Validacion de disparo de click_phone en DebugView",
            "hypothesis": "Si se valida en GA4 DebugView el trigger 'click_phone', se podra confirmar si el elemento de clic a telefono no existe en la pagina actual o si el trigger no coincide con el elemento real, explicando las 0 ocurrencias del periodo.",
            "channel": "analytics",
            "successMetric": "Numero de ocurrencias de click_phone registradas tras la validacion/correccion",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "title": "Landing puente 'industrial' con CTA doble Zentry/Tukandado",
            "hypothesis": "Si se publica una landing puente que cualifica al visitante entre mobiliario y control de acceso, se generara una tasa de clic medible hacia ambos CTA sin canibalizar paginas existentes del cluster SEO.",
            "channel": "content",
            "successMetric": "Distribucion de clics entre CTA primario (Zentry) y secundario (Tukandado) y ausencia de caida de trafico en paginas relacionadas del cluster",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-cta",
              "dept-content-risks"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Corregir el enrutado roto antes de invertir mas esfuerzo (URL en papelera + cannibalizacion de melamina)",
            "rationale": "Impacto alto porque cualquier optimizacion sobre la URL en papelera o la pagina de combinacion mal enrutada se pierde; confianza alta porque ambos hallazgos vienen de evidencia directa del catalogo de clusters (301 documentado, decision O29.1 ya aprobada); esfuerzo bajo porque es solo correccion de enrutado, no contenido nuevo. Depende de confirmar si scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto, dato que el propio seo-specialist marca como desconocido.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Confirmacion de si el script de resolucion de cannibalizacion O29.1 ya se ejecuto sobre estos action items"
            ],
            "evidenceRefs": [
              "dept-seo-action-1",
              "dept-seo-action-2",
              "dept-seo-opportunity-2",
              "dept-seo-opportunity-3"
            ]
          },
          {
            "title": "Resolver la solicitud de aprobacion critica pendiente sobre la pagina de melamina-fenolico",
            "rationale": "Es la unica solicitud de aprobacion pendiente en todo el backlog y esta marcada como riesgo critico; ademas coincide directamente con la pagina implicada en la cannibalizacion de melamina detectada por seo-specialist, por lo que resolverla junto con el enrutado evita revision duplicada. Impacto alto por el nivel de riesgo declarado, confianza media porque no hay detalle del contenido exacto del plan de despliegue en este contexto, esfuerzo bajo-medio porque es una revision humana puntual.",
            "impact": "high",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Revision humana de la solicitud de aprobacion critica (production_deployment_plan)"
            ],
            "evidenceRefs": [
              "approvals-pending",
              "dept-seo-action-2"
            ]
          },
          {
            "title": "Quick win on-page en 'cerraduras inteligentes para taquillas'",
            "rationale": "Impacto medio-alto por estar a un empujon de top 10 con impresiones ya reales; confianza alta por venir de evidencia directa de Search Console; esfuerzo medio porque implica reescritura de contenido, H1/H2 y enlazado interno, no solo metadatos.",
            "impact": "high",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-seo-opportunity-1",
              "dept-seo-action-3"
            ]
          },
          {
            "title": "NO publicar aun las paginas de staging (metalicas, vestuarios, universidades); primero una segunda iteracion visual/de contenido",
            "rationale": "seo-specialist las recomienda publicar dando por hecho que estan 'visualmente aprobadas' (dept-seo-action-6), pero una decision humana reciente rechazo exactamente esa publicacion por considerarlas demasiado basicas en imagenes/fotografias. Ante esta contradiccion, la prioridad correcta no es publicar sino iterar visualmente antes de volver a proponerlo; impacto medio porque desbloquea contenido ya casi listo, confianza alta porque se basa en una decision humana explicita y literal, esfuerzo medio porque requiere trabajo visual/de contenido adicional, no solo aprobacion.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Decision humana previa de rechazo (2026-08-16) sobre publicacion de estas mismas paginas",
              "Segunda iteracion visual/de contenido antes de re-proponer"
            ],
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-publish-rejected"
            ]
          },
          {
            "title": "Validar y corregir la medicion de click_phone y el estado real de publicacion de GTM",
            "rationale": "Impacto alto porque afecta a la fiabilidad de todo el sistema de medicion (un evento clave sin disparo y una version live que referencia cambios sin publicar); confianza alta porque ambos hechos vienen de evidencia directa de GA4/GTM en esta misma pasada; esfuerzo bajo porque son verificaciones puntuales (DebugView y estado de publicacion), no cambios estructurales.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-action-2",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "title": "Auditoria de meta titles/descriptions para el patron sistemico de CTR 0%",
            "rationale": "Impacto medio porque afecta a multiples paginas con impresiones reales pero sin clics; confianza alta porque el patron esta documentado con evidencia directa en varias paginas distintas; esfuerzo medio porque requiere revisar y reescribir metadatos pagina por pagina.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-seo-action-8"
            ]
          },
          {
            "title": "Validar intencion de busqueda real antes de redactar la landing 'industrial'",
            "rationale": "Impacto medio porque es una oportunidad de captacion B2B nueva, pero confianza baja-media porque la propia keyword ('industrial') es una unica palabra generica sin modificador y el propio content-strategist admite que la clasificacion de intencion comercial y la asignacion de marca requieren revision manual; esfuerzo medio porque implica redaccion de una pagina nueva con tabla comparativa. Ademas debe evitar el mismo problema de pobreza visual que causo el rechazo humano de otras paginas de staging.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "medium",
            "dependsOn": [
              "Revision manual humana de la clasificacion Zentry vs Tukandado",
              "Evitar repetir el patron de rechazo por falta de riqueza visual"
            ],
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-risks",
              "human-decision-staging-publish-rejected"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada (status=executed); su salida se uso integramente para esta sintesis."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada (status=executed); su salida se uso integramente para esta sintesis."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecutado en esta misma pasada coordinada (status=executed); su salida se uso integramente para esta sintesis."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "specialistInputs marca sem-specialist como not_available/pendiente en esta fase. Aunque el fichero de definicion del agente existe en el checkout, no hay ninguna ejecucion real ni output en esta pasada: no se ha inferido ningun dato de SEM/Google Ads."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "No aparece en specialistInputs de esta pasada coordinada; solo consta que su definicion de agente existe en el checkout, sin verificacion de ejecucion ni artifacts propios en este contexto."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "No aparece en specialistInputs de esta pasada coordinada; solo consta que su definicion de agente existe en el checkout, sin verificacion de ejecucion ni artifacts propios en este contexto."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "Ultimo agent_finished de sem-watcher en el departmentRunId historico: connected=true, 70 candidatas SEM detectadas, pero esto es de una pasada V1 distinta y no sustituye la ausencia de sem-specialist en esta pasada coordinada."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "Ultimo agent_finished de analytics-watcher: ga4Connected=true, gtmConnected=true, consistente con lo reportado por analytics-specialist en esta misma pasada."
          }
        ],
        "risks": [
          {
            "description": "Contradiccion entre la recomendacion de seo-specialist de publicar en produccion las paginas de staging de taquillas metalicas, vestuarios y universidades (dandolas por 'visualmente aprobadas') y el rechazo humano explicito y reciente de esa misma publicacion por falta de imagenes/riqueza visual. Publicar sin resolver esta contradiccion repetiria una decision ya vetada.",
            "severity": "high",
            "evidenceRefs": [
              "dept-seo-action-6",
              "human-decision-staging-publish-rejected"
            ]
          },
          {
            "description": "La version live del contenedor GTM referencia cambios 'sin publicar, pendiente aprobacion Pau', lo que pone en duda si la configuracion de eventos medida hoy en GA4 corresponde realmente a lo publicado en el sitio.",
            "severity": "high",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-3"
            ]
          },
          {
            "description": "Existe una unica solicitud de aprobacion pendiente marcada como riesgo critico, relacionada con la pagina de melamina-fenolico, en el mismo momento en que seo-specialist detecta enrutado mal resuelto en esa misma area tematica.",
            "severity": "high",
            "evidenceRefs": [
              "approvals-pending",
              "dept-seo-action-2"
            ]
          },
          {
            "description": "13 change packs (2 SEO, 10 content, 1 CRO) estan bloqueados por cluster gate segun la actividad registrada en esta pasada, limitando cuanto del backlog aprobado puede realmente avanzar a ejecucion.",
            "severity": "medium",
            "evidenceRefs": [
              "cluster-gate-blocked-summary"
            ]
          },
          {
            "description": "Sesiones procedentes de 'tagassistant.google.com' (herramienta de depuracion de Google) se estan contabilizando dentro del canal Referral, lo que puede distorsionar las cifras de trafico y conversion reales de ese canal.",
            "severity": "low",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "human-decision-staging-publish-rejected",
            "description": "Decision humana registrada (version 1, rechazada el 2026-08-16T09:32:20.630Z) sobre la propuesta 'Publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general)'. Motivo textual: 'Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion.'"
          },
          {
            "ref": "cluster-gate-blocked-summary",
            "description": "Combinacion de agentActivity de esta pasada: seo-change-pack-builder reporta '0 change pack(s) nuevo(s), 2 bloqueado(s) por cluster gate', content-change-pack-builder reporta '0 change pack(s) nuevo(s), 10 bloqueado(s) por cluster gate', y cro-change-pack-builder reporta '0 change pack(s) nuevo(s), 1 bloqueado(s) por cluster gate', sumando 13 change packs bloqueados por cluster gate en esta pasada."
          }
        ],
        "unknowns": [
          "No hay ninguna senal real de SEM/Google Ads en esta pasada (sem-specialist ausente): no se puede evaluar gasto, CPC, campanas activas ni rendimiento de anuncios.",
          "No se confirma en este contexto si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto sobre los action items de melamina mal enrutados.",
          "No se conoce el contenido exacto de la solicitud de aprobacion critica pendiente sobre la pagina de melamina-fenolico, mas alla de su titulo y nivel de riesgo.",
          "No se especifica si view_quote_page, view_contact_page y click_catalog_download estan marcados como eventos de conversion en la configuracion de GA4.",
          "No se conoce el motivo por el que la version live de GTM referencia cambios 'sin publicar, pendiente aprobacion Pau', ni si esa aprobacion ya se produjo tras el snapshot analizado.",
          "No hay confirmacion de si la keyword 'industrial' propuesta por content-strategist tiene volumen de busqueda real ni si su intencion predominante es realmente comercial (B2B mobiliario/control de acceso) o ajena al negocio.",
          "No hay artifacts propios de qa-reviewer ni web-engineer en esta pasada coordinada; su disponibilidad real mas alla de la existencia del fichero de definicion del agente no puede confirmarse."
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

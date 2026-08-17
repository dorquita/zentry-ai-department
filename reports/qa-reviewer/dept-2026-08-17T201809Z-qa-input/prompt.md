# Prompt preparado para qa-reviewer -- artifact dept-2026-08-17T201809Z-qa-input

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
    "artifactId": "dept-2026-08-17T201809Z-qa-input",
    "artifactPath": "reports/department/dept-2026-08-17T201809Z/dept-2026-08-17T201809Z-qa-input.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-17T201809Z",
    "generatedAt": "2026-08-17T20:33:34.604Z",
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
        "sourceRunId": "dept-2026-08-17T201809Z"
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
          "executiveSummary": "Con datos live de Search Console (0h de antiguedad) sobre 36 jobs del run seo-watcher-2026-08-17T201818Z, el hallazgo mas critico es una canibalizacion de 'melamina' ya documentada en el catalogo de clusters (decision O29.1) pero que sigue sin resolverse en el backlog: 4 actionItems de las keywords genericas 'taquillas melamina'/'taquillas de melamina' apuntan a /taquillas-melamina-fenolico/ cuando el cluster catalog indica explicitamente que deben cerrarse via script y quedarse solo en /taquillas-melamina/. En paralelo, dos keywords de cerraduras (centros deportivos y gimnasios) apuntan a /cerraduras/, una URL que el propio catalogo marca en papelera con redireccion 301 desde O22 -- ejecutar esas tareas tal cual seria un error tecnico. Hay 7 quick wins reales con posiciones entre 10.6 y 28.7 que solo requieren refuerzo on-page. Cuatro clusters marcados new_page_candidate (metalicas, universidades, vestuarios, inteligentes-general) ya tienen staging aprobado visualmente en su mayoria y representan gaps de contenido listos para publicar. Tres keywords del catalogo estatico (taquillas para gimnasios, digitalizacion de taquillas, lockers inteligentes) no tienen cluster ni pagina asociada pese a ser de prioridad alta/media.",
          "findings": [
            {
              "id": "F1",
              "category": "cannibalization",
              "description": "Las keywords genericas 'taquillas melamina' y 'taquillas de melamina' aparecen en el backlog apuntando tanto a /taquillas-melamina/ (correcto segun cluster taquillas_melamina) como a /taquillas-melamina-fenolico/ (mal enrutado segun el propio cluster taquillas_melamina_fenolico, que documenta la decision O29.1 de Pau: la keyword generica ya NO debe apuntar a esa URL). El catalogo ya identifica estos casos como 'mal enrutados' y senala un script de resolucion existente que aparentemente no se ha aplicado sobre estos actionItems concretos.",
              "basis": "evidence",
              "evidenceRefs": [
                "e4",
                "e5",
                "e6",
                "e7"
              ]
            },
            {
              "id": "F2",
              "category": "technical",
              "description": "El actionItem de 'cerraduras inteligentes para centros deportivos' apunta a https://zentrylockers.com/cerraduras/, pero el cluster correspondiente (accion 'reject') documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/. Ejecutar la optimizacion on-page tal como esta descrita en el actionItem no tiene sentido tecnico sobre una pagina eliminada.",
              "basis": "evidence",
              "evidenceRefs": [
                "e2",
                "e3"
              ]
            },
            {
              "id": "F3",
              "category": "keyword_strategy",
              "description": "La keyword 'cerraduras sostenibles para gimnasios' (dos actionItems, apuntando a /cerraduras/ y a /cerraduras-inteligentes-taquillas/) no aparece en ningun matchPattern del catalogo de clusters -- es una keyword huerfana sin decision de intencion documentada, y uno de sus dos destinos actuales (/cerraduras/) es la misma URL en papelera senalada en F2.",
              "basis": "inference",
              "evidenceRefs": [
                "e24",
                "e25"
              ]
            },
            {
              "id": "F4",
              "category": "content",
              "description": "Un numero elevado de actionItems con volumen de impresiones relevante (50-86 impresiones) muestran CTR actual del 0.00% segun su propio rationale/action, lo que sugiere un problema sistemico de meta title/description poco atractivos en varias paginas de producto y sector, no un caso aislado.",
              "basis": "evidence",
              "evidenceRefs": [
                "e4",
                "e5",
                "e9",
                "e15",
                "e19",
                "e20",
                "e24",
                "e25"
              ]
            },
            {
              "id": "F5",
              "category": "content",
              "description": "Cuatro clusters marcados como 'new_page_candidate' (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios, taquillas_inteligentes_general) representan huecos de cobertura tematica reales; tres de ellos ya tienen su pagina en staging visualmente aprobada (2105, 2110, 2104) y solo falta publicarla en produccion, mientras que la cuarta (2103, inteligentes-general) aun esta pendiente de aprobacion visual final.",
              "basis": "evidence",
              "evidenceRefs": [
                "e29",
                "e30",
                "e32",
                "e33"
              ]
            },
            {
              "id": "F6",
              "category": "internal_linking",
              "description": "El cluster de terminos comerciales genericos ('comprar taquillas', 'soluciones de taquillas') fue pospuesto explicitamente porque no tiene angulo de producto/sector propio y arriesga canibalizar paginas existentes sin aportar valor; el catalogo recomienda en su lugar mejorar CTAs y enlazado interno en paginas ya existentes en vez de crear paginas nuevas.",
              "basis": "evidence",
              "evidenceRefs": [
                "e34"
              ]
            },
            {
              "id": "F7",
              "category": "content",
              "description": "Las keywords objetivo 'taquillas para gimnasios' (comercial, prioridad alta) y 'digitalizacion de taquillas' (informacional, prioridad media) figuran en el catalogo estatico de keywords pero no tienen ningun cluster ni pagina asociada en el catalogo de clusters, a diferencia del resto de keywords objetivo que si estan cubiertas.",
              "basis": "inference",
              "evidenceRefs": [
                "e26",
                "e27"
              ]
            },
            {
              "id": "F8",
              "category": "keyword_strategy",
              "description": "La keyword objetivo 'lockers inteligentes' (comercial, prioridad alta) no aparece literalmente en los matchPatterns de ningun cluster; el mas cercano semanticamente es taquillas_inteligentes_general ('taquillas inteligentes'/'taquilla inteligente'), pero si esa pagina no incorpora explicitamente la variante 'lockers' podria no capturar bien esta busqueda.",
              "basis": "inference",
              "evidenceRefs": [
                "e28",
                "e29"
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
              "recommendedAction": "Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.",
              "rationale": "47 impresiones, posicion actual 20.5 -- a un empujon de primera pagina.",
              "basis": "evidence",
              "evidenceRefs": [
                "e1"
              ]
            },
            {
              "id": "O2",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Optimizar on-page (H1/H2, profundidad de texto, enlazado interno, meta title/description) para pasar de posicion 10.6 a top 10.",
              "rationale": "21 impresiones, posicion actual 10.6, practicamente en el umbral de primera pagina.",
              "basis": "evidence",
              "evidenceRefs": [
                "e23"
              ]
            },
            {
              "id": "O3",
              "keyword": "taquillas para hospital",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Reforzar contenido y metas de la misma pagina para capturar tambien esta variante (posicion actual 17.1), ademas de mejorar CTR (0.00% actual).",
              "rationale": "22 impresiones, posicion actual 17.1; CTR 0.00% pese a estar cerca de primera pagina.",
              "basis": "evidence",
              "evidenceRefs": [
                "e22"
              ]
            },
            {
              "id": "O4",
              "keyword": "cerraduras electronicas para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Optimizar on-page y metas para esta variante 'electronicas' sobre la misma pagina que ya cubre 'inteligentes' (accion ya consolidada en el cluster).",
              "rationale": "27 impresiones, posicion actual 24.5, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e17"
              ]
            },
            {
              "id": "O5",
              "keyword": "taquillas colegios",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Reforzar contenido en H1/H2 y reescribir meta title/description para mejorar posicion (25.1) y CTR (0.00%).",
              "rationale": "40 impresiones, posicion actual 25.1, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e12"
              ]
            },
            {
              "id": "O6",
              "keyword": "taquillas vestuarios de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Optimizar on-page para esta variante long-tail sobre la pagina de melamina ya asignada por el cluster.",
              "rationale": "28 impresiones, posicion actual 27.8, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e11"
              ]
            },
            {
              "id": "O7",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "kind": "quick_win",
              "priority": "medium",
              "recommendedAction": "Reforzar contenido y metas en la pagina correcta segun el cluster (update_existing_page), aprovechando el recommendedTitle/meta ya definidos en el catalogo.",
              "rationale": "74 impresiones, posicion actual 28.7, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e8"
              ]
            },
            {
              "id": "O8",
              "keyword": "taquillas melamina / taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "kind": "cannibalization",
              "priority": "high",
              "recommendedAction": "No optimizar estos actionItems tal cual: cerrarlos/reenrutarlos via el script de resolucion ya referenciado en el catalogo (scripts/o291-resolve-melamina-cannibalization.ts), dejando que la keyword generica de melamina siga apuntando unicamente a /taquillas-melamina/.",
              "rationale": "El cluster taquillas_melamina_fenolico documenta explicitamente que la keyword generica 'melamina' ya no debe apuntar a esta URL de combinacion especifica (decision O29.1 de Pau); cualquier actionId con esa keyword aqui se considera mal enrutado.",
              "basis": "evidence",
              "evidenceRefs": [
                "e4",
                "e5",
                "e6",
                "e7"
              ]
            },
            {
              "id": "O9",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "kind": "technical",
              "priority": "high",
              "recommendedAction": "No ejecutar la optimizacion sobre /cerraduras/ (en papelera, redirige 301 a /cerraduras-para-taquillas/). Decidir con Pau si el objetivo correcto es /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (/cerraduras-inteligentes-taquillas/) antes de invertir esfuerzo.",
              "rationale": "El cluster catalog marca esta combinacion keyword-URL como 'reject' por apuntar a una pagina obsoleta desde O22.",
              "basis": "evidence",
              "evidenceRefs": [
                "e2",
                "e3"
              ]
            },
            {
              "id": "O10",
              "keyword": "taquillas fenólicas en palencia",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "kind": "future_opportunity",
              "priority": "medium",
              "recommendedAction": "Tratar esta y 'fabricante de taquillas fenólicas en badajoz' como parte del cluster generico de fenolicas (sin crear contenido geografico especifico, segun el catalogo), reforzando la landing general y sus metas.",
              "rationale": "29 y 23 impresiones respectivamente, posiciones muy alejadas de top10 (73.7 y 83.3); el catalogo descarta un angulo geografico dedicado por falta de evidencia de negocio local.",
              "basis": "evidence",
              "evidenceRefs": [
                "e19",
                "e20",
                "e21"
              ]
            },
            {
              "id": "O11",
              "keyword": "taquillas metalicas",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar en produccion la pagina de staging ya aprobada visualmente (2105) para el tercer material del catalogo de producto.",
              "rationale": "Cluster new_page_candidate sin pagina de produccion; ademas es keyword objetivo del catalogo estatico (prioridad media, comercial).",
              "basis": "evidence",
              "evidenceRefs": [
                "e30",
                "e31"
              ]
            },
            {
              "id": "O12",
              "keyword": "taquillas universidad",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar en produccion la pagina de staging ya aprobada visualmente (2110) para el sector universidades.",
              "rationale": "Cluster new_page_candidate sin pagina de produccion equivalente confirmada.",
              "basis": "evidence",
              "evidenceRefs": [
                "e32"
              ]
            },
            {
              "id": "O13",
              "keyword": "taquillas vestuarios",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Publicar en produccion la pagina de staging ya aprobada visualmente (2104), diferenciada de /bancos-de-vestuario/.",
              "rationale": "Cluster new_page_candidate sin pagina de produccion equivalente.",
              "basis": "evidence",
              "evidenceRefs": [
                "e33"
              ]
            },
            {
              "id": "O14",
              "keyword": "taquillas inteligentes",
              "kind": "content_gap",
              "priority": "medium",
              "recommendedAction": "Completar la aprobacion visual final del staging 2103 (solucion general) verificando que no canibaliza el cluster de cerraduras inteligentes (1865/2096) antes de publicar.",
              "rationale": "Cluster new_page_candidate distinto del hardware de cierre; staging corregido en O28.6 pero aun pendiente de aprobacion visual real.",
              "basis": "evidence",
              "evidenceRefs": [
                "e29"
              ]
            },
            {
              "id": "O15",
              "keyword": "comprar taquillas / soluciones de taquillas",
              "kind": "internal_linking",
              "priority": "low",
              "recommendedAction": "No avanzar las paginas de staging (2101/2102) a produccion; en su lugar, mejorar CTAs y enlazado interno hacia paginas de sector/material ya existentes que capturen esta intencion transaccional generica.",
              "rationale": "El propio catalogo pospone este cluster por riesgo de canibalizar paginas existentes sin aportar un angulo diferenciado.",
              "basis": "evidence",
              "evidenceRefs": [
                "e34"
              ]
            },
            {
              "id": "O16",
              "keyword": "taquilla para el personal",
              "page": "https://zentrylockers.com/taquillas-para-empresas/",
              "kind": "future_opportunity",
              "priority": "medium",
              "recommendedAction": "Crear o reforzar contenido de soporte para esta variante dentro de la pagina ya asignada por el cluster (empresas/personal), junto con mejora de CTR.",
              "rationale": "34 impresiones, posicion actual 65.7, CTR 0.00% -- lejos de primera pagina pero con volumen real.",
              "basis": "evidence",
              "evidenceRefs": [
                "e15",
                "e16"
              ]
            },
            {
              "id": "O17",
              "keyword": "taquillas escolares",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "kind": "future_opportunity",
              "priority": "medium",
              "recommendedAction": "Reforzar la misma pagina que ya cubre 'taquillas colegios' (sinonimo de intencion segun el cluster) con contenido adicional y mejora de CTR.",
              "rationale": "32 impresiones, posicion actual 33.8, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e13",
                "e14"
              ]
            },
            {
              "id": "O18",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "kind": "future_opportunity",
              "priority": "medium",
              "recommendedAction": "Reforzar contenido y metas de la pagina general de melamina (recommendedTitle/meta ya definidos en el cluster) para capturar mejor esta keyword generica de alto volumen.",
              "rationale": "86 impresiones (la mayor cifra de todo el backlog), posicion actual 30.1, CTR 0.00%.",
              "basis": "evidence",
              "evidenceRefs": [
                "e9"
              ]
            }
          ],
          "technicalIssues": [
            {
              "id": "TI1",
              "page": "https://zentrylockers.com/cerraduras/",
              "issue": "Pagina en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/, pero sigue apareciendo como pagina de destino en el backlog de acciones para 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios'. Ejecutar las tareas de optimizacion on-page tal cual no tiene efecto real.",
              "severity": "high",
              "basis": "evidence",
              "evidenceRefs": [
                "e2",
                "e3",
                "e24"
              ]
            }
          ],
          "contentGaps": [
            {
              "id": "CG1",
              "topic": "Taquillas metalicas (tercer material del catalogo de producto)",
              "relatedKeyword": "taquillas metalicas",
              "rationale": "Cluster new_page_candidate sin pagina de produccion; staging 2105 ya creada y aprobada visualmente, coincide con keyword objetivo del catalogo estatico (prioridad media, comercial).",
              "basis": "evidence",
              "evidenceRefs": [
                "e30",
                "e31"
              ]
            },
            {
              "id": "CG2",
              "topic": "Taquillas para universidades (sector sin pagina propia)",
              "relatedKeyword": "taquillas universidad",
              "rationale": "Cluster new_page_candidate sin pagina de produccion equivalente confirmada; staging 2110 ya aprobada visualmente.",
              "basis": "evidence",
              "evidenceRefs": [
                "e32"
              ]
            },
            {
              "id": "CG3",
              "topic": "Taquillas para vestuarios (distinto de bancos de vestuario)",
              "relatedKeyword": "taquillas vestuarios",
              "rationale": "Cluster new_page_candidate sin pagina de produccion; staging 2104 ya aprobada visualmente.",
              "basis": "evidence",
              "evidenceRefs": [
                "e33"
              ]
            },
            {
              "id": "CG4",
              "topic": "Solucion general de taquillas inteligentes (mueble + cerradura + control de acceso)",
              "relatedKeyword": "taquillas inteligentes",
              "rationale": "Cluster new_page_candidate distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); staging 2103 corregida en O28.6 pero pendiente de aprobacion visual real, riesgo de canibalizacion documentado si se fusiona sin decision explicita.",
              "basis": "evidence",
              "evidenceRefs": [
                "e29"
              ]
            },
            {
              "id": "CG5",
              "topic": "Taquillas para gimnasios (sector sin cluster asociado)",
              "relatedKeyword": "taquillas para gimnasios",
              "rationale": "Keyword objetivo comercial de prioridad alta en el catalogo estatico, pero sin cluster ni pagina asociada en el catalogo de clusters -- posible hueco estrategico no capturado todavia por el pipeline de clustering.",
              "basis": "inference",
              "evidenceRefs": [
                "e26"
              ]
            },
            {
              "id": "CG6",
              "topic": "Digitalizacion de taquillas (contenido informativo)",
              "relatedKeyword": "digitalizacion de taquillas",
              "rationale": "Keyword objetivo informacional de prioridad media en el catalogo estatico, sin cluster ni pagina asociada -- podria requerir un articulo o pieza de contenido informativo dedicado.",
              "basis": "inference",
              "evidenceRefs": [
                "e27"
              ]
            },
            {
              "id": "CG7",
              "topic": "Lockers inteligentes (variante terminologica de taquillas inteligentes)",
              "relatedKeyword": "lockers inteligentes",
              "rationale": "Keyword objetivo comercial de prioridad alta, semanticamente cercana al cluster taquillas_inteligentes_general pero no incluida literalmente en sus matchPatterns; conviene revisar si la futura pagina general debe incorporar explicitamente el termino 'lockers'.",
              "basis": "inference",
              "evidenceRefs": [
                "e28",
                "e29"
              ]
            }
          ],
          "internalLinkRecommendations": [
            {
              "id": "IL1",
              "fromPage": "https://zentrylockers.com/taquillas-melamina/",
              "toPage": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "anchorTextSuggestion": "taquillas de melamina con puertas fenolicas",
              "rationale": "Ambas paginas comparten material base pero atacan intenciones diferenciadas (generico vs. combinacion especifica); un enlace claro desde la pagina general ayuda a usuarios y motores a distinguir la variante correcta y reduce el riesgo de que el trafico generico siga cayendo por error en la pagina especifica.",
              "basis": "inference",
              "evidenceRefs": [
                "e6",
                "e7"
              ]
            },
            {
              "id": "IL2",
              "fromPage": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "toPage": "https://zentrylockers.com/cerraduras-para-taquillas/",
              "anchorTextSuggestion": "ver catalogo de cerraduras inteligentes ARES, ORBIS, BOXIS, NEO",
              "rationale": "El propio cluster distingue esta pagina informativa de /cerraduras-para-taquillas/ (catalogo comercial); enlazar desde la version informativa hacia la comercial completa el funnel informativo-transaccional que el catalogo ya reconoce como intencionado.",
              "basis": "evidence",
              "evidenceRefs": [
                "e18"
              ]
            },
            {
              "id": "IL3",
              "fromPage": "https://zentrylockers.com/taquillas-para-colegios/",
              "toPage": "https://zentrylockers.com/taquillas-melamina/",
              "anchorTextSuggestion": "taquillas de melamina para colegios",
              "rationale": "El sector colegios es un comprador tipico de taquillas de material melamina (resistente y economico); un enlace tematico entre ambas paginas puede reforzar relevancia cruzada y ayudar a ambas keywords, que actualmente estan en posiciones cercanas (25.1 y 28.7).",
              "basis": "inference",
              "evidenceRefs": [
                "e12",
                "e8"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "rank": 1,
              "title": "Cerrar/reenrutar los actionItems de 'melamina' mal enrutados a /taquillas-melamina-fenolico/ via el script de resolucion existente",
              "relatedIds": [
                "O8",
                "F1"
              ],
              "priority": "high",
              "effort": "low",
              "impact": "high"
            },
            {
              "rank": 2,
              "title": "Decidir y corregir el destino real de 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios' (evitar /cerraduras/ en papelera)",
              "relatedIds": [
                "O9",
                "F2",
                "F3"
              ],
              "priority": "high",
              "effort": "medium",
              "impact": "high"
            },
            {
              "rank": 3,
              "title": "Ejecutar los quick wins de on-page en keywords cerca de top10 (cerraduras inteligentes taquillas, hospitales, cerraduras electronicas taquillas, colegios, melamina/vestuarios)",
              "relatedIds": [
                "O1",
                "O2",
                "O3",
                "O4",
                "O5",
                "O6",
                "O7"
              ],
              "priority": "high",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 4,
              "title": "Reescribir metas para reducir el CTR 0.00% en paginas con impresiones altas (melamina generica, fenolicas, cerraduras)",
              "relatedIds": [
                "F4",
                "O10",
                "O18"
              ],
              "priority": "medium",
              "effort": "medium",
              "impact": "medium"
            },
            {
              "rank": 5,
              "title": "Publicar en produccion las paginas nuevas ya aprobadas en staging (metalicas, universidades, vestuarios) para cerrar gaps de contenido reales",
              "relatedIds": [
                "O11",
                "O12",
                "O13",
                "F5"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "high"
            },
            {
              "rank": 6,
              "title": "Revisar y asignar cluster/pagina a las keywords objetivo huerfanas (taquillas para gimnasios, digitalizacion de taquillas, lockers inteligentes)",
              "relatedIds": [
                "F7",
                "F8",
                "CG5",
                "CG6",
                "CG7"
              ],
              "priority": "medium",
              "effort": "low",
              "impact": "medium"
            },
            {
              "rank": 7,
              "title": "Mejorar enlazado interno entre paginas de material/sector relacionadas en vez de crear paginas para terminos genericos pospuestos",
              "relatedIds": [
                "IL1",
                "IL2",
                "IL3",
                "O15",
                "F6"
              ],
              "priority": "low",
              "effort": "low",
              "impact": "medium"
            }
          ],
          "evidence": [
            {
              "id": "e1",
              "source": "job_data",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "quick_win, prioridad alta, posicion actual 20.47, 47 impresiones."
            },
            {
              "id": "e2",
              "source": "job_data",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "future_opportunity+low_ctr, prioridad alta, posicion actual 37.61, 31 impresiones, CTR 0.00%."
            },
            {
              "id": "e3",
              "source": "cluster_catalog",
              "keyword": "cerraduras inteligentes para centros deportivos",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "Cluster cerraduras_inteligentes_centros_deportivos, accion reject: /cerraduras/ esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/."
            },
            {
              "id": "e4",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 43.10, 62 impresiones, CTR 0.00%."
            },
            {
              "id": "e5",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 43.12, 51 impresiones, CTR 0.00%."
            },
            {
              "id": "e6",
              "source": "cluster_catalog",
              "keyword": "taquillas melamina-fenolico",
              "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
              "description": "Cluster taquillas_melamina_fenolico, accion differentiate: decision O29.1 de Pau, la keyword generica melamina ya no debe apuntar aqui; actionId mal enrutado se cierra via scripts/o291-resolve-melamina-cannibalization.ts."
            },
            {
              "id": "e7",
              "source": "cluster_catalog",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "Cluster taquillas_melamina, accion update_existing_page: canibalizacion resuelta, cualquier actionId historico con esta keyword apuntando a fenolico se considera mal enrutado."
            },
            {
              "id": "e8",
              "source": "job_data",
              "keyword": "taquillas de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "quick_win+low_ctr, prioridad media, posicion actual 28.70, 74 impresiones, CTR 0.00%."
            },
            {
              "id": "e9",
              "source": "job_data",
              "keyword": "taquillas melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 30.10, 86 impresiones, CTR 0.00%."
            },
            {
              "id": "e10",
              "source": "job_data",
              "keyword": "taquilla madera",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 43.2, 50 impresiones."
            },
            {
              "id": "e11",
              "source": "job_data",
              "keyword": "taquillas vestuarios de melamina",
              "page": "https://zentrylockers.com/taquillas-melamina/",
              "description": "quick_win+low_ctr, prioridad media, posicion actual 27.79, 28 impresiones, CTR 0.00%."
            },
            {
              "id": "e12",
              "source": "job_data",
              "keyword": "taquillas colegios",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "quick_win+low_ctr, prioridad media, posicion actual 25.13, 40 impresiones, CTR 0.00%."
            },
            {
              "id": "e13",
              "source": "job_data",
              "keyword": "taquillas escolares",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 33.84, 32 impresiones."
            },
            {
              "id": "e14",
              "source": "cluster_catalog",
              "keyword": "taquillas escolares",
              "page": "https://zentrylockers.com/taquillas-para-colegios/",
              "description": "Cluster taquillas_colegios_escolares, accion update_existing_page, targetUrl /taquillas-para-colegios/."
            },
            {
              "id": "e15",
              "source": "job_data",
              "keyword": "taquilla para el personal",
              "page": "https://zentrylockers.com/taquillas-para-empresas/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 65.74, 34 impresiones, CTR 0.00%."
            },
            {
              "id": "e16",
              "source": "cluster_catalog",
              "keyword": "taquilla para el personal",
              "page": "https://zentrylockers.com/taquillas-para-empresas/",
              "description": "Cluster taquillas_empresas_personal, accion update_existing_page, targetUrl /taquillas-para-empresas/."
            },
            {
              "id": "e17",
              "source": "job_data",
              "keyword": "cerraduras electronicas para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "quick_win+low_ctr, prioridad media, posicion actual 24.52, 27 impresiones, CTR 0.00%."
            },
            {
              "id": "e18",
              "source": "cluster_catalog",
              "keyword": "cerraduras inteligentes para taquillas",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "Cluster cerraduras_inteligentes_taquillas, accion update_existing_page: menciona /cerraduras-para-taquillas/ (2060) como catalogo comercial diferenciado de esta pagina informativa."
            },
            {
              "id": "e19",
              "source": "job_data",
              "keyword": "taquillas fenólicas en palencia",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 73.72, 29 impresiones, CTR 0.00%."
            },
            {
              "id": "e20",
              "source": "job_data",
              "keyword": "fabricante de taquillas fenólicas en badajoz",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 83.30, 23 impresiones, CTR 0.00%."
            },
            {
              "id": "e21",
              "source": "cluster_catalog",
              "keyword": "taquillas fenolicas",
              "page": "https://zentrylockers.com/taquillas-fenolicas/",
              "description": "Cluster taquillas_fenolicas, accion update_existing_page: 'en Palencia' se trata como ruido geografico sin intencion local real, no cluster geografico aparte."
            },
            {
              "id": "e22",
              "source": "job_data",
              "keyword": "taquillas para hospital",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "description": "quick_win+low_ctr, prioridad media, posicion actual 17.14, 22 impresiones, CTR 0.00%."
            },
            {
              "id": "e23",
              "source": "job_data",
              "keyword": "comprar taquillas para hospitales",
              "page": "https://zentrylockers.com/taquillas-para-hospitales/",
              "description": "quick_win, prioridad media, posicion actual 10.62, 21 impresiones."
            },
            {
              "id": "e24",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 30.90, 21 impresiones, CTR 0.00%."
            },
            {
              "id": "e25",
              "source": "job_data",
              "keyword": "cerraduras sostenibles para gimnasios",
              "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
              "description": "future_opportunity+low_ctr, prioridad media, posicion actual 45.7, 20 impresiones, CTR 0.00%."
            },
            {
              "id": "e26",
              "source": "target_keyword_catalog",
              "keyword": "taquillas para gimnasios",
              "description": "Keyword objetivo comercial, prioridad alta, sin cluster asociado en el catalogo de clusters."
            },
            {
              "id": "e27",
              "source": "target_keyword_catalog",
              "keyword": "digitalizacion de taquillas",
              "description": "Keyword objetivo informacional, prioridad media, sin cluster asociado en el catalogo de clusters."
            },
            {
              "id": "e28",
              "source": "target_keyword_catalog",
              "keyword": "lockers inteligentes",
              "description": "Keyword objetivo comercial, prioridad alta, no incluida literalmente en ningun matchPattern de cluster."
            },
            {
              "id": "e29",
              "source": "cluster_catalog",
              "keyword": "taquillas inteligentes",
              "description": "Cluster taquillas_inteligentes_general, accion new_page_candidate, targetUrl null, matchPatterns 'taquillas inteligentes'/'taquilla inteligente', staging 2103 pendiente de aprobacion visual real."
            },
            {
              "id": "e30",
              "source": "cluster_catalog",
              "keyword": "taquillas metalicas",
              "description": "Cluster taquillas_metalicas, accion new_page_candidate, targetUrl null, staging 2105 ya creada y aprobada visualmente."
            },
            {
              "id": "e31",
              "source": "target_keyword_catalog",
              "keyword": "taquillas metalicas",
              "description": "Keyword objetivo comercial, prioridad media."
            },
            {
              "id": "e32",
              "source": "cluster_catalog",
              "keyword": "taquillas universidad",
              "description": "Cluster taquillas_universidad, accion new_page_candidate, targetUrl null, staging 2110 ya creada y aprobada visualmente."
            },
            {
              "id": "e33",
              "source": "cluster_catalog",
              "keyword": "taquillas vestuarios",
              "description": "Cluster taquillas_vestuarios, accion new_page_candidate, targetUrl null, staging 2104 ya creada y aprobada visualmente."
            },
            {
              "id": "e34",
              "source": "cluster_catalog",
              "keyword": "comprar taquillas / soluciones de taquillas",
              "description": "Cluster taquillas_comercial_generico, accion postpone: recomienda mejora de CTA/enlazado interno en paginas existentes en vez de crear paginas nuevas; staging 2101/2102 no se recomienda avanzar a produccion."
            }
          ],
          "unknowns": [
            "No se dispone de cifras exactas de clics ni de CTR numerico mas alla del indicador '0.00%' mencionado en el rationale de los actionItems con flag low_ctr; no se puede cuantificar el impacto real de una mejora de metas.",
            "No se conoce el estado final de aprobacion visual de la pagina staging 2103 (taquillas_inteligentes_general) mas alla de 'pendiente de aprobacion visual real'.",
            "No hay datos de Search Console para las paginas candidatas aun no publicadas (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios), por lo que no se puede estimar volumen de busqueda o dificultad una vez publicadas.",
            "No se ha leido el contenido completo de los informes de SEO Watcher (reports/seo/seo-watcher-2026-08-17.md) ni SEO Director (reports/seo-director/seo-director-2026-08-17.md) referenciados en dataAvailability -- solo se conocen sus rutas, no su contenido.",
            "No se sabe si el script scripts/o291-resolve-melamina-cannibalization.ts mencionado en el catalogo de clusters ya se ha ejecutado sobre los actionItems actuales o sigue pendiente."
          ]
        }
      },
      {
        "employee": "content-strategist",
        "status": "executed",
        "output": {
          "contentOpportunity": {
            "title": "Landing sectorial 'Colegio': mobiliario escolar (Zentry) + control de acceso (Tukandado)",
            "summary": "La keyword 'colegio' capta un segmento B2B claro (centros educativos) pero no especifica si el interes es mueble o cerradura, por lo que conviene una landing que autoclasifique al visitante antes de derivarlo a la solucion correcta."
          },
          "targetAudience": "Responsable de administracion, direccion o mantenimiento de un colegio que gestiona la compra de taquillas para alumnado/vestuarios y/o el control de acceso a esas taquillas u otros espacios del centro.",
          "searchIntent": "commercial",
          "commercialIntent": "Captar trafico de centros educativos en fase de evaluacion de proveedor (mobiliario y/o cerraduras) y convertirlo en solicitud de presupuesto para Zentry, informacion/demo para Tukandado, o ambas.",
          "angle": "En vez de asumir que quien busca 'colegio' ya sabe si necesita mueble, cerradura o ambos, la landing empieza autoclasificando la necesidad (siguiendo el H2 ya propuesto) y solo despues presenta cada solucion con datos reales de catalogo aplicados a contextos escolares tipicos (aulas, vestuarios, gimnasio del centro) -- evita generalizar sobre 'colegios' sin dar informacion util especifica al contexto escolar.",
          "contentType": "new_landing",
          "targetBrand": "mixed",
          "recommendedStructure": {
            "h1": "Taquillas y cerraduras para colegios",
            "sections": [
              {
                "heading": "¿Buscas mueble, cerradura o ambos?",
                "level": "H2",
                "purpose": "Resolver la ambiguedad de la keyword 'colegio' (no especifica producto) ayudando al visitante a autoclasificarse y reducir el rebote derivandolo a la seccion relevante."
              },
              {
                "heading": "Solucion Zentry: taquillas para colegios",
                "level": "H2",
                "purpose": "Presentar el mobiliario Zentry orientado a centros educativos, enlazando con la subseccion de materiales."
              },
              {
                "heading": "Materiales recomendados segun la zona del colegio",
                "level": "H3",
                "purpose": "Explicar de forma condicional (segun zona, no como afirmacion universal) que melamina encaja en aulas/zonas secas, fenolica en vestuarios/duchas deportivas del centro y metalica en zonas de alto trafico, usando solo el catalogo de materiales confirmado."
              },
              {
                "heading": "Solucion Tukandado: cerraduras electronicas para taquillas escolares",
                "level": "H2",
                "purpose": "Presentar los metodos de apertura confirmados (mecanica, PIN, tarjeta/RFID, app segun modelo) como opcion para taquillas de colegio, dejando claro que las funciones dependen del modelo, sin prometer registro de accesos como algo universal."
              },
              {
                "heading": "Como elegir segun tu caso",
                "level": "H2",
                "purpose": "Tabla comparativa mecanica vs electronica (segun la estructura visual esperada de marca) para ayudar a decidir en funcion de necesidad de control de uso, mantenimiento y presupuesto, cerrando con CTA."
              }
            ]
          },
          "ctaStrategy": {
            "primaryCta": "Ver taquillas para colegios y solicitar presupuesto sin compromiso",
            "secondaryCta": "Ver cerraduras electronicas y solicitar informacion",
            "rationale": "El CTA doble propuesto por el pipeline (recommendedCtaHint) encaja con la ambiguedad de intencion detectada en brandRationale: al no saber si el visitante busca mueble, cerradura o ambos, se ofrecen las dos rutas de conversion en vez de forzar una sola."
          },
          "internalLinks": [
            {
              "anchorIdea": "Ver catalogo de taquillas Zentry",
              "targetDescription": "Contenido/landing de mobiliario Zentry (segun internalLinkHints, sin URL real disponible en el contexto)",
              "isRealLink": false
            },
            {
              "anchorIdea": "Ver cerraduras electronicas Tukandado",
              "targetDescription": "Contenido/landing de cerraduras Tukandado (segun internalLinkHints, sin URL real disponible en el contexto)",
              "isRealLink": false
            },
            {
              "anchorIdea": "Taquillas y cerraduras para colegios (variante plural)",
              "targetDescription": "Posible pagina/keyword 'colegios' senalada en clusterNote como riesgo de canibalizacion -- enlazar o consolidar segun se decida, no crear como pieza aislada",
              "isRealLink": false
            }
          ],
          "supportingEvidence": [
            "currentAssumptions confirma que 'se asume que colegio sigue siendo relevante para Zentry y Tukandado', pero como asuncion, no como dato verificado -- se refleja en el angulo de autoclasificacion en vez de asumir intencion de compra especifica.",
            "clusterNote indica explicitamente 'Posible cluster SEO con: colegios. Considerar enlazado interno entre estas paginas', lo que respalda tratar 'colegio' y 'colegios' como piezas relacionadas a coordinar, no independientes.",
            "brandRationale del contexto ya señala que la keyword 'no menciona explicitamente taquilla ni cerradura' pero tiene 'senal B2B detectada: colegio', lo que justifica el enfoque mixto (targetBrand mixed) y el CTA doble.",
            "secondaryKeywords solo aporta 'colegios' (variante plural), sin mas señales de intencion transaccional especifica dentro del contexto recibido."
          ],
          "priority": "medium",
          "risksAndUnknowns": [
            "Riesgo de canibalizacion SEO con la keyword/pagina 'colegios' ya senalado en risks y clusterNote -- publicar esta landing sin coordinar el enlazado o consolidar contenido puede competir por la misma intencion de busqueda.",
            "La keyword 'colegio' por si sola es muy generica y no confirma intencion transaccional real (no menciona producto); existe el riesgo de que el trafico que capte sea mayoritariamente informacional/navegacional y no convierta como se espera.",
            "brandRationale marca explicitamente que 'requiere revision manual para decidir Zentry vs Tukandado' -- el peso 50/50 entre marcas propuesto aqui deberia validarse antes de publicar.",
            "Precedente relevante de decisiones humanas anteriores: se rechazo publicar en produccion otras landings nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes) porque 'se ven demasiado basicas y sin suficientes imagenes/fotografias' y necesitan 'una segunda iteracion visual y de contenido' -- esta landing es del mismo tipo (landing nueva, cross-sell mixto) y corre el mismo riesgo si se entrega sin suficiente refuerzo visual antes de pasar a produccion.",
            "No se recibio un valor de 'page' en el contexto, por lo que no existe ninguna URL real disponible para marcar isRealLink como true en el enlazado interno -- debera asignarse una URL real antes de publicacion."
          ],
          "reasoningNotes": [
            "Se mantiene el angulo de autoclasificacion del proposedStructureHint (H2 '¿Buscas mueble, cerradura o ambos?') como punto de partida porque responde directamente a la ambiguedad que el propio brandRationale reconoce ('no menciona explicitamente taquilla ni cerradura'), en vez de forzar un angulo mas comercial que asumiria una intencion que el contexto no confirma.",
            "Se amplio la estructura con una subseccion H3 de materiales aplicados a zonas del colegio (aulas, vestuarios, gimnasio) porque aporta valor informativo real usando exclusivamente el catalogo de materiales/metodos de apertura CONFIRMADO de la skill, sin inventar ninguna caracteristica especifica de producto para colegios que no venga en el contexto.",
            "priority se mantiene en 'medium' (heredado del contexto) en vez de subirla, dado el riesgo de canibalizacion con 'colegios' aun sin resolver y el precedente de rechazo humano a landings nuevas similares por falta de acabado visual -- subir prioridad antes de resolver ambos puntos parecia prematuro.",
            "No se incluyo ninguna afirmacion de 'fabricante directo', garantia o plazos de entrega porque currentAssumptions no las confirma para esta pagina -- el CTA remite a 'solicitar presupuesto'/'solicitar informacion' en lugar de prometer datos concretos, siguiendo la regla anti-fabricacion de la skill."
          ]
        }
      },
      {
        "employee": "analytics-specialist",
        "status": "executed",
        "output": {
          "runSummary": {
            "departmentRunId": "dept-2026-08-17T201809Z",
            "reportGeneratedAt": "2026-08-17T20:18:30.208Z",
            "ga4Connected": true,
            "gtmConnected": true
          },
          "measurementFindings": [
            {
              "claimType": "FACT",
              "statement": "GA4 y GTM se leyeron en vivo en esta pasada, con datos de GA4 correspondientes al periodo 2026-07-19 a 2026-08-16.",
              "evidenceIds": []
            },
            {
              "claimType": "FACT",
              "statement": "El contenedor GTM tiene 8 tags configurados (7 de tipo gaawe mas 1 Google Tag) y ninguno aparece marcado como pausado.",
              "evidenceIds": [
                "E24"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "A pesar de que en GTM existe un tag no pausado 'GA4 Event - click_phone' y un trigger 'click_phone' de tipo linkClick, en GA4 el evento click_phone aparece con fired:false y 0 ocurrencias en el periodo.",
              "evidenceIds": [
                "E11",
                "E22",
                "E23"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El nombre de la version live de GTM es 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)'.",
              "evidenceIds": [
                "E21"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Varios eventos clave tienen ocurrencias registradas pero 0 conversiones en GA4 (click_catalog_download 3/0, view_quote_page 12/0, view_contact_page 38/0), mientras que otros muestran ocurrencias igual a conversiones (generate_lead_form_submit 6/6, click_whatsapp 15/15, click_request_quote 65/65).",
              "evidenceIds": [
                "E13",
                "E14",
                "E15",
                "E9",
                "E10",
                "E12"
              ]
            }
          ],
          "funnelObservations": [
            {
              "claimType": "FACT",
              "statement": "En el periodo, click_request_quote registro 65 ocurrencias, view_quote_page 12 ocurrencias y generate_lead_form_submit 6 ocurrencias.",
              "evidenceIds": [
                "E12",
                "E14",
                "E9"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "Tomando estos tres eventos como una aproximacion de recorrido, se observa una caida marcada entre click_request_quote y view_quote_page, y otra caida adicional hasta generate_lead_form_submit.",
              "evidenceIds": [
                "E12",
                "E14",
                "E9"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "click_whatsapp registro 15 ocurrencias y 15 conversiones, frente a las 6 ocurrencias/conversiones de generate_lead_form_submit.",
              "evidenceIds": [
                "E10",
                "E9"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El volumen de click_whatsapp mas que duplica al de generate_lead_form_submit dentro del conjunto de eventos clave observados en el periodo.",
              "evidenceIds": [
                "E10",
                "E9"
              ]
            }
          ],
          "trafficObservations": [
            {
              "claimType": "OBSERVATION",
              "statement": "El canal Direct concentra la gran mayoria de las sesiones y conversiones del periodo frente a Organic Search, Referral y AI Assistant combinados.",
              "evidenceIds": [
                "E1",
                "E2",
                "E3",
                "E4"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La landing page '/' recibio 114 sesiones y 58 conversiones, mas que el resto de landing pages listadas combinadas.",
              "evidenceIds": [
                "E5"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "En fuentes/medios aparece tagassistant.google.com/referral con 3 sesiones y 2 conversiones en el periodo.",
              "evidenceIds": [
                "E18"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El canal AI Assistant (chatgpt.com/ai-assistant) registro 2 sesiones y 0 conversiones en el periodo.",
              "evidenceIds": [
                "E4",
                "E19"
              ]
            }
          ],
          "conversionObservations": [
            {
              "claimType": "FACT",
              "statement": "La landing page /product/taquilla-2-puertas-modulo-1-melamina muestra 4 sesiones y 11 conversiones en el periodo.",
              "evidenceIds": [
                "E7"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "En esa landing page el numero de conversiones registradas supera al numero de sesiones, algo distinto al patron del resto de landing pages listadas.",
              "evidenceIds": [
                "E7"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El canal Direct registro 81 conversiones sobre 172 sesiones, mientras Organic Search registro 3 conversiones sobre 6 sesiones.",
              "evidenceIds": [
                "E1",
                "E2"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "La landing page '/configurador-bancos' registro 10 sesiones y 6 conversiones, con una tasa de rebote de 10%.",
              "evidenceIds": [
                "E6"
              ]
            }
          ],
          "trackingIssues": [
            {
              "claimType": "FACT",
              "statement": "El evento click_phone tiene tag y trigger activos en GTM pero en GA4 aparece con fired:false y 0 ocurrencias/conversiones en el periodo, lo que constituye una discrepancia entre la configuracion de GTM y lo registrado en GA4.",
              "evidenceIds": [
                "E22",
                "E23",
                "E11"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "El nombre de la version live de GTM incluye el texto 'sin publicar, pendiente aprobacion Pau', lo cual es inconsistente con estar identificada como version live del contenedor.",
              "evidenceIds": [
                "E21"
              ]
            },
            {
              "claimType": "FACT",
              "statement": "El array watcherWarnings de esta pasada esta vacio, es decir analytics-watcher no reporto avisos de credenciales o de lectura en esta ejecucion.",
              "evidenceIds": []
            }
          ],
          "anomalyCandidates": [
            {
              "claimType": "OBSERVATION",
              "statement": "La landing page /product/taquilla-2-puertas-modulo-1-melamina muestra mas conversiones (11) que sesiones (4) en el periodo, cifra que se sale del patron del resto de landing pages listadas.",
              "evidenceIds": [
                "E7"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "La fuente/medio tagassistant.google.com/referral aparece con 3 sesiones y 2 conversiones; ese dominio corresponde a una herramienta de depuracion de tags de Google, no a un canal de trafico externo tipico.",
              "evidenceIds": [
                "E18"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "click_catalog_download registro 3 ocurrencias pero 0 conversiones, a diferencia de otros eventos clave donde ocurrencias y conversiones coinciden.",
              "evidenceIds": [
                "E13"
              ]
            },
            {
              "claimType": "OBSERVATION",
              "statement": "click_phone no registro ninguna ocurrencia en todo el periodo pese a tener tag y trigger activos configurados en GTM.",
              "evidenceIds": [
                "E11",
                "E22",
                "E23"
              ]
            }
          ],
          "hypotheses": [
            {
              "claimType": "HYPOTHESIS",
              "statement": "Una posible explicacion de que click_phone no dispare es que la version del contenedor GTM referenciada como live, cuyo nombre indica 'sin publicar, pendiente aprobacion', no sea realmente la que esta activa en el sitio en produccion.",
              "evidenceIds": [
                "E21",
                "E11",
                "E22"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Las 11 conversiones sobre solo 4 sesiones en /product/taquilla-2-puertas-modulo-1-melamina podrian deberse a que varias conversiones se dispararon dentro de esas mismas sesiones, en lugar de un error de datos.",
              "evidenceIds": [
                "E7"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Las sesiones procedentes de tagassistant.google.com podrian corresponder a actividad de pruebas/QA interna en lugar de trafico externo genuino.",
              "evidenceIds": [
                "E18"
              ]
            },
            {
              "claimType": "HYPOTHESIS",
              "statement": "Que click_catalog_download tenga ocurrencias pero no conversiones podria indicar que ese evento no esta marcado como key event/conversion en la configuracion de la propiedad GA4, a diferencia de click_whatsapp o click_request_quote.",
              "evidenceIds": [
                "E13",
                "E10",
                "E12"
              ]
            }
          ],
          "recommendedMeasurements": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GA4 DebugView si el tag click_phone se dispara realmente al pulsar un enlace de telefono en el sitio en vivo, dado que GA4 muestra 0 ocurrencias pese a existir tag y trigger activos en GTM.",
              "evidenceIds": [
                "E11",
                "E22",
                "E23"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar si la version de GTM 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau)' esta realmente publicada en el contenedor de produccion, dado el nombre ambiguo.",
              "evidenceIds": [
                "E21"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar en la configuracion de GA4 si click_catalog_download, view_quote_page y view_contact_page estan marcados intencionalmente como key events/conversiones o si falta esa configuracion.",
              "evidenceIds": [
                "E13",
                "E14",
                "E15"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Investigar en el explorador de GA4 el desglose de sesiones y conversiones de /product/taquilla-2-puertas-modulo-1-melamina para confirmar como se registraron 11 conversiones con solo 4 sesiones.",
              "evidenceIds": [
                "E7"
              ]
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Crear una segmentacion o filtro para el trafico de tagassistant.google.com/referral y confirmar si corresponde a actividad de QA interna mezclada en los informes de canal/fuente.",
              "evidenceIds": [
                "E18"
              ]
            }
          ],
          "prioritizedActions": [
            {
              "claimType": "RECOMMENDATION",
              "statement": "Validar en GA4 DebugView el disparo real de click_phone, ya que es un evento clave de contacto que muestra 0 ocurrencias pese a estar configurado en GTM.",
              "evidenceIds": [
                "E11",
                "E22",
                "E23"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Confirmar el estado de publicacion real de la version de GTM referenciada como live, dado que su nombre indica que podria estar pendiente de aprobacion.",
              "evidenceIds": [
                "E21"
              ],
              "priority": "high"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Revisar la configuracion de conversiones/key events en GA4 para click_catalog_download, view_quote_page y view_contact_page.",
              "evidenceIds": [
                "E13",
                "E14",
                "E15"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Investigar la discrepancia sesiones/conversiones en la landing page /product/taquilla-2-puertas-modulo-1-melamina.",
              "evidenceIds": [
                "E7"
              ],
              "priority": "medium"
            },
            {
              "claimType": "RECOMMENDATION",
              "statement": "Segmentar el trafico de tagassistant.google.com/referral para descartar que sea actividad interna de pruebas.",
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
              "description": "Canal Direct: 172 sesiones, 69 usuarios activos, 81 conversiones en el periodo 2026-07-19 a 2026-08-16."
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
              "description": "Landing page '/': 114 sesiones, 58 conversiones, tasa de rebote 31.6%."
            },
            {
              "id": "E6",
              "source": "ga4_landing_pages",
              "description": "Landing page '/configurador-bancos': 10 sesiones, 6 conversiones, tasa de rebote 10%."
            },
            {
              "id": "E7",
              "source": "ga4_landing_pages",
              "description": "Landing page '/product/taquilla-2-puertas-modulo-1-melamina': 4 sesiones, 11 conversiones, tasa de rebote 25%."
            },
            {
              "id": "E9",
              "source": "ga4_key_events",
              "description": "Evento generate_lead_form_submit: fired true, 6 ocurrencias, 6 conversiones."
            },
            {
              "id": "E10",
              "source": "ga4_key_events",
              "description": "Evento click_whatsapp: fired true, 15 ocurrencias, 15 conversiones."
            },
            {
              "id": "E11",
              "source": "ga4_key_events",
              "description": "Evento click_phone: fired false, 0 ocurrencias, 0 conversiones."
            },
            {
              "id": "E12",
              "source": "ga4_key_events",
              "description": "Evento click_request_quote: fired true, 65 ocurrencias, 65 conversiones."
            },
            {
              "id": "E13",
              "source": "ga4_key_events",
              "description": "Evento click_catalog_download: fired true, 3 ocurrencias, 0 conversiones."
            },
            {
              "id": "E14",
              "source": "ga4_key_events",
              "description": "Evento view_quote_page: fired true, 12 ocurrencias, 0 conversiones."
            },
            {
              "id": "E15",
              "source": "ga4_key_events",
              "description": "Evento view_contact_page: fired true, 38 ocurrencias, 0 conversiones."
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
              "id": "E21",
              "source": "gtm_container",
              "description": "liveVersionName del contenedor GTM: 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)'."
            },
            {
              "id": "E22",
              "source": "gtm_tags",
              "description": "Tag 'GA4 Event - click_phone', tipo gaawe, paused:false."
            },
            {
              "id": "E23",
              "source": "gtm_triggers",
              "description": "Trigger 'click_phone', tipo linkClick."
            },
            {
              "id": "E24",
              "source": "gtm_tags",
              "description": "Lista de 8 tags en GTM (7 gaawe + 1 googtag), ninguno marcado como pausado."
            }
          ],
          "unknowns": [
            "No se dispone de un desglose por dispositivo (movil/escritorio) para las sesiones o conversiones del periodo.",
            "No se puede confirmar si el evento click_phone tampoco se dispara en la version realmente publicada del contenedor, o solo en la version pendiente de aprobacion mencionada.",
            "No se entrego un catalogo de eventos clave esperados separado de la lista observada, por lo que no se puede confirmar si existen eventos adicionales esperados que no aparecen en este contexto.",
            "No hay datos de un periodo anterior para comparar y saber si las cifras actuales representan un cambio respecto a la normalidad.",
            "No se dispone de detalle de campañas/UTM mas alla de las combinaciones fuente/medio listadas.",
            "No se puede confirmar desde este contexto que eventos estan marcados como 'key event'/conversion en la configuracion de la propiedad GA4 mas alla de lo que refleja el campo conversions de cada evento."
          ]
        }
      }
    ],
    "growth": {
      "status": "executed",
      "note": "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada.",
      "output": {
        "growthSummary": "Esta pasada coordinada (dept-2026-08-17T201809Z) tiene datos reales de seo-specialist, content-strategist y analytics-specialist; sem-specialist sigue fuera de fase. El backlog determinista muestra 105 acciones vivas, 113/114 work orders listas para revisar pero solo 5/77 change packs listos, y 1 aprobacion critica pendiente sobre 'taquillas melamina'. Varias de las prioridades que emergen de esta pasada YA fueron decididas por un humano el 2026-08-16 (aprobadas: cierre de canibalizacion de melamina, correccion de /cerraduras/, quick win de 'cerraduras inteligentes para taquillas', reescritura de metas con CTR 0%, validacion de click_phone; rechazada: publicar en produccion las paginas de staging por falta de acabado visual). El valor de esta sintesis es, sobre todo, senalar que seo-specialist repite -- sin saberlo -- la recomendacion de publicar staging ya rechazada, y que hay una posible canibalizacion no coordinada entre la nueva landing 'Colegio' de content-strategist y el cluster SEO existente de 'taquillas colegios'. SEM queda fuera de esta lectura: no hay ninguna senal fiable sobre Google Ads en esta pasada.",
        "currentSignals": [
          {
            "channel": "seo",
            "description": "El backlog SEO tiene 105 acciones vivas (8 high, 97 medium) y seo-specialist confirma con datos live de Search Console 7 quick wins reales cerca de top10 ademas de una canibalizacion documentada de 'melamina'.",
            "evidenceRefs": [
              "actions-live",
              "dept-seo-summary"
            ]
          },
          {
            "channel": "content",
            "description": "113 de 114 work orders estan listas para revisar (57 de contenido, 22 SEO, 21 competitor_gap, 11 CRO, 2 SEM, 1 analytics), pero solo 5 de 77 change packs estan listos para revision, lo que indica un cuello de botella entre la generacion de work orders y su consolidacion en change packs.",
            "evidenceRefs": [
              "workorders-ready",
              "changepacks-ready",
              "gap-changepacks-workorders"
            ]
          },
          {
            "channel": "analytics",
            "description": "GA4 y GTM estan conectados en vivo (periodo 2026-07-19 a 2026-08-16); analytics-specialist detecta 3 problemas de medicion, el mas critico siendo la discrepancia de click_phone (tag/trigger activos en GTM pero 0 ocurrencias en GA4).",
            "evidenceRefs": [
              "dept-analytics-summary",
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "channel": "sem",
            "description": "sem-watcher (V1 deterministico) reporta conexion activa y 70 candidatas SEM detectadas, pero sem-specialist (analisis cualitativo) esta fuera de esta fase, por lo que no hay lectura estrategica de esas 70 candidatas en esta pasada.",
            "evidenceRefs": [
              "sem-watcher-signal",
              "dept-sem-unavailable"
            ]
          },
          {
            "channel": "ops",
            "description": "Hay 1 solicitud de aprobacion pendiente marcada como riesgo critico, relacionada con 'taquillas melamina' (production_deployment_plan), un dia despues de que un humano aprobara cerrar la canibalizacion de melamina relacionada.",
            "evidenceRefs": [
              "approvals-pending"
            ]
          }
        ],
        "bottlenecks": [
          {
            "channel": "seo",
            "description": "La canibalizacion de 'melamina' fue aprobada para cierre por un humano el 2026-08-16, y seo-specialist la reconfirma como accion #1 (impacto alto, esfuerzo bajo), pero sigue existiendo 1 aprobacion critica pendiente relacionada con 'taquillas melamina' que bloquea su resolucion definitiva.",
            "evidenceRefs": [
              "dept-seo-action-1",
              "approvals-pending"
            ]
          },
          {
            "channel": "content",
            "description": "seo-specialist recomienda (rank 5) publicar en produccion las paginas de staging ya aprobadas visualmente (metalicas, universidades, vestuarios) como quick win de alto impacto, pero un humano YA RECHAZO exactamente esa misma accion el 2026-08-16 con el motivo \"Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion.\" -- seo-specialist no tenia visibilidad de esa decision previa. Es una contradiccion a resolver antes de repetir el intento de publicacion.",
            "evidenceRefs": [
              "dept-seo-action-5",
              "human-decision-staging-rejection"
            ]
          },
          {
            "channel": "content",
            "description": "content-strategist propone una nueva landing mixta 'Colegio' y reconoce explicitamente el riesgo de canibalizacion con la keyword/pagina 'colegios' ya existente; de forma independiente, seo-specialist tiene un quick win aprobable sobre el cluster 'taquillas_colegios_escolares' (/taquillas-para-colegios/, posicion 25.1). Ambos trabajos sobre el mismo espacio semantico no estan coordinados en esta pasada.",
            "evidenceRefs": [
              "dept-content-risks",
              "dept-seo-opportunity-5"
            ]
          }
        ],
        "opportunities": [
          {
            "channel": "seo",
            "description": "7 keywords en posiciones 10.6-28.7 (cerca de top10) solo requieren refuerzo on-page (H1/H2, profundidad, enlazado interno, metas) para entrar en primera pagina; el caso principal ('cerraduras inteligentes para taquillas') ya fue aprobado por un humano.",
            "evidenceRefs": [
              "dept-seo-action-3",
              "dept-seo-opportunity-1"
            ]
          },
          {
            "channel": "analytics",
            "description": "Corregir la discrepancia de click_phone (y confirmar el estado real de publicacion de la version de GTM asociada) podria destapar una via de conversion telefonica que hoy aparece en 0 pese a tener tracking configurado.",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "channel": "content",
            "description": "La landing sectorial 'Colegio' mixta (Zentry + Tukandado) propuesta por content-strategist capta un segmento B2B claro con CTA doble, siempre que se coordine con el cluster SEO existente para evitar canibalizacion.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-cta"
            ]
          }
        ],
        "experiments": [
          {
            "title": "A/B de metas (title/description) en paginas con CTR 0%",
            "hypothesis": "Reescribir title/meta en las paginas con impresiones altas y CTR 0% aumentara el CTR medible en Search Console sin cambiar el ranking.",
            "channel": "seo",
            "successMetric": "CTR mayor a 0% y aumento de clics en Search Console en las paginas afectadas dentro de 30 dias.",
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "title": "Verificacion DebugView de click_phone tras confirmar version GTM publicada",
            "hypothesis": "Si la version de GTM realmente publicada difiere de la referenciada como 'live' (nombre indica pendiente de aprobacion), corregirla hara que click_phone empiece a registrar ocurrencias reales en GA4.",
            "channel": "analytics",
            "successMetric": "El evento click_phone pasa a fired:true con ocurrencias mayores a 0 en GA4 tras la correccion.",
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "title": "Landing autoclasificadora 'Colegio' (mueble vs cerradura) sin canibalizar cluster existente",
            "hypothesis": "Una landing que autoclasifique la necesidad del visitante (mueble/cerradura/ambos) mejorara la tasa de conversion del segmento educativo frente a dirigir ese trafico a paginas de material/sector genericas, sin degradar el posicionamiento actual de 'taquillas colegios'/'taquillas escolares'.",
            "channel": "content",
            "successMetric": "Tasa de conversion de la nueva landing y ausencia de caida de posicion en las keywords del cluster 'taquillas_colegios_escolares' tras publicar.",
            "evidenceRefs": [
              "dept-content-summary",
              "dept-content-risks"
            ]
          }
        ],
        "recommendedPriorities": [
          {
            "title": "Cerrar/reenrutar la canibalizacion de 'melamina' y desbloquear la aprobacion critica pendiente asociada",
            "rationale": "Un humano ya aprobo el 2026-08-16 cerrar los actionItems de canibalizacion de 'taquillas melamina' y revisar la aprobacion critica relacionada; seo-specialist confirma esta misma accion como su prioridad #1 (impacto alto, esfuerzo bajo, via el script de resolucion ya existente). Sin embargo sigue habiendo 1 aprobacion pendiente de riesgo critico sobre 'taquillas melamina', lo que indica que la decision aprobada aun no se ha materializado del todo.",
            "impact": "high",
            "confidence": "high",
            "effort": "low",
            "dependsOn": [
              "Aprobacion humana ya concedida el 2026-08-16",
              "Resolucion de la solicitud de aprobacion critica pendiente 'taquillas melamina' (production_deployment_plan)"
            ],
            "evidenceRefs": [
              "dept-seo-action-1",
              "approvals-pending"
            ]
          },
          {
            "title": "Corregir el destino real de las keywords que apuntan a /cerraduras/ (en papelera) antes de invertir mas esfuerzo SEO",
            "rationale": "Aprobado por un humano el 2026-08-16. seo-specialist confirma con evidencia que 2 actionItems de alta prioridad ('cerraduras inteligentes para centros deportivos', 'cerraduras sostenibles para gimnasios') apuntan a /cerraduras/, marcada en papelera con redireccion 301 desde O22; ejecutar optimizacion on-page ahi no tiene efecto tecnico real, y ademas una de esas keywords queda huerfana sin cluster asignado.",
            "impact": "high",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Decision de negocio sobre el destino correcto (/cerraduras-para-taquillas/ vs /cerraduras-inteligentes-taquillas/)"
            ],
            "evidenceRefs": [
              "dept-seo-action-2"
            ]
          },
          {
            "title": "Ejecutar el bundle de quick wins on-page ya aprobado (encabezado por 'cerraduras inteligentes para taquillas')",
            "rationale": "Aprobado por un humano el 2026-08-16 para el caso principal; seo-specialist agrupa 7 keywords en posiciones 10.6-28.7 que solo requieren refuerzo on-page, meta y enlazado interno para entrar en top10, sin necesidad de contenido nuevo.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [
              "Corregir el destino real de /cerraduras/ (prioridad anterior) para no reforzar una URL equivocada"
            ],
            "evidenceRefs": [
              "dept-seo-action-3",
              "actions-top"
            ]
          },
          {
            "title": "Reescribir title/meta description en las paginas con impresiones reales y CTR 0%",
            "rationale": "Aprobado por un humano el 2026-08-16. seo-specialist identifica el problema como sistemico (8 keywords/paginas afectadas), no un caso aislado, lo que refuerza que vale la pena tratarlo como una tarea unica de metas en vez de arreglos puntuales.",
            "impact": "medium",
            "confidence": "high",
            "effort": "medium",
            "dependsOn": [],
            "evidenceRefs": [
              "dept-seo-action-4"
            ]
          },
          {
            "title": "Validar el disparo real de click_phone y confirmar que version de GTM esta realmente publicada",
            "rationale": "Aprobado por un humano el 2026-08-16. analytics-specialist reporta con datos live que click_phone tiene tag y trigger activos en GTM pero 0 ocurrencias en GA4, y que el nombre de la version 'live' de GTM sugiere que en realidad esta pendiente de aprobacion de Pau -- una posible causa raiz de la discrepancia (hipotesis del propio especialista, no un hecho confirmado). Sin esta validacion no se sabe si se esta perdiendo conversion telefonica real.",
            "impact": "high",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Acceso humano a GA4 DebugView y al panel de versiones de GTM"
            ],
            "evidenceRefs": [
              "dept-analytics-action-1",
              "dept-analytics-action-2",
              "dept-analytics-tracking-issue-1",
              "dept-analytics-tracking-issue-2"
            ]
          },
          {
            "title": "Iterar visual y de contenido las paginas de staging ya aprobadas (metalicas, universidades, vestuarios, taquillas inteligentes general) antes de reintentar su publicacion",
            "rationale": "seo-specialist recomienda (rank 5, sin conocer la decision previa) publicar directamente estas paginas en produccion, pero un humano ya rechazo esa misma accion el 2026-08-16 con el motivo textual \"Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion.\" La prioridad real no es publicar, sino iterar el diseno/contenido primero; no hay evidencia en este contexto de que esa iteracion ya se haya hecho, por eso la confianza es baja.",
            "impact": "high",
            "confidence": "low",
            "effort": "medium",
            "dependsOn": [
              "Segunda iteracion visual y de contenido (motivo del rechazo humano del 2026-08-16)",
              "web-engineer / visual-asset-planner (dependencia parcial en este checkout)"
            ],
            "evidenceRefs": [
              "dept-seo-action-5",
              "human-decision-staging-rejection"
            ]
          },
          {
            "title": "Coordinar la nueva landing 'Colegio' de content-strategist con el cluster SEO existente antes de publicar",
            "rationale": "content-strategist reconoce explicitamente el riesgo de canibalizacion con la keyword/pagina 'colegios'; en paralelo seo-specialist tiene un quick win independiente sobre el cluster 'taquillas_colegios_escolares' (/taquillas-para-colegios/). Publicar la landing nueva sin coordinar enlazado o consolidar contenido arriesga competir por la misma intencion de busqueda. Ademas el propio brandRationale de content-strategist marca que el reparto Zentry/Tukandado requiere revision manual.",
            "impact": "medium",
            "confidence": "medium",
            "effort": "low",
            "dependsOn": [
              "Ejecutar el quick win existente sobre /taquillas-para-colegios/ antes o en paralelo",
              "Decision humana sobre el reparto de marca 50/50 Zentry/Tukandado"
            ],
            "evidenceRefs": [
              "dept-content-risks",
              "dept-seo-opportunity-5"
            ]
          }
        ],
        "dependencies": [
          {
            "name": "seo-specialist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); su salida real se uso integramente en esta sintesis."
          },
          {
            "name": "content-strategist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); su salida real se uso integramente en esta sintesis."
          },
          {
            "name": "analytics-specialist",
            "status": "available",
            "note": "Ejecutado en esta pasada coordinada (status=executed); su salida real se uso integramente en esta sintesis."
          },
          {
            "name": "sem-specialist",
            "status": "missing",
            "note": "status=not_available en esta pasada; queda explicitamente fuera de fase. No se ha incluido ninguna senal de SEM/Google Ads en esta sintesis mas alla de la conexion generica de sem-watcher V1."
          },
          {
            "name": "qa-reviewer",
            "status": "partial",
            "note": "La definicion del agente existe en el checkout (.claude/agents/qa-reviewer.md), pero no forma parte de specialistInputs de esta pasada coordinada -- no hay evidencia de que haya producido artifacts en esta ejecucion."
          },
          {
            "name": "web-engineer",
            "status": "partial",
            "note": "La definicion del agente existe en el checkout (.claude/agents/web-engineer.md), pero no forma parte de specialistInputs de esta pasada coordinada -- no hay evidencia de que haya producido artifacts en esta ejecucion."
          },
          {
            "name": "sem-watcher (V1 deterministico)",
            "status": "available",
            "note": "Conectado (connected=true) segun el ultimo agent_finished de esta pasada; util solo como senal de conectividad, no reemplaza el analisis cualitativo de sem-specialist."
          },
          {
            "name": "analytics-watcher (V1 deterministico)",
            "status": "available",
            "note": "GA4 y GTM conectados (ga4Connected=true, gtmConnected=true) segun el ultimo agent_finished de esta pasada."
          }
        ],
        "risks": [
          {
            "description": "Publicar en produccion las paginas de staging (metalicas, universidades, vestuarios, taquillas inteligentes general) sin la segunda iteracion visual/de contenido exigida por el rechazo humano previo repetiria un error ya identificado.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-seo-action-5",
              "human-decision-staging-rejection"
            ]
          },
          {
            "description": "El evento click_phone no registra ocurrencias pese a tener tracking configurado en GTM; si es un fallo real de tracking (no solo de version publicada), se podria estar perdiendo visibilidad de conversiones telefonicas reales sin saberlo.",
            "severity": "high",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-1"
            ]
          },
          {
            "description": "La nueva landing 'Colegio' propuesta por content-strategist podria canibalizar el posicionamiento ya existente del cluster 'taquillas colegios'/'taquillas escolares' si se publica sin coordinar enlazado o consolidacion de contenido.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-content-risks",
              "dept-seo-opportunity-5"
            ]
          },
          {
            "description": "El nombre de la version 'live' de GTM sugiere que contiene cambios pendientes de aprobacion humana ('sin publicar, pendiente aprobacion Pau'), lo que introduce incertidumbre sobre que configuracion de tracking esta realmente activa en produccion.",
            "severity": "medium",
            "evidenceRefs": [
              "dept-analytics-tracking-issue-2"
            ]
          }
        ],
        "evidence": [
          {
            "ref": "gap-changepacks-workorders",
            "description": "Cruce de workOrdersSummary (113 de 114 work orders listas para revisar) y changePacksSummary (solo 5 de 77 change packs listos para revision) del contexto: la mayoria de work orders generadas todavia no llegan a consolidarse en change packs listos, un cuello de botella intermedio del pipeline."
          },
          {
            "ref": "sem-watcher-signal",
            "description": "Cruce de agentActivity (sem-watcher completado, 'Conectado=true. Candidatas SEM: 70.') y workOrdersSummary.byCategory.sem=2 del contexto: hay conectividad y candidatas detectadas por el V1 deterministico, pero ningun analisis cualitativo Claude sobre ellas en esta pasada (sem-specialist not_available, ver dept-sem-unavailable)."
          },
          {
            "ref": "human-decision-staging-rejection",
            "description": "Decision humana registrada en la seccion 3 del prompt (version 1, rechazada el 2026-08-16T09:32:20.630Z, pasada dept-2026-08-15T175321Z): 'Publicar en produccion las paginas nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes general)' fue RECHAZADA con el motivo textual 'Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias. Necesitan una segunda iteracion visual y de contenido antes de publicarse en produccion.'"
          }
        ],
        "unknowns": [
          "No se sabe si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto sobre los actionItems actuales de melamina o sigue pendiente.",
          "No hay datos de SEM en esta pasada (sem-specialist not_available); no se puede evaluar cualitativamente el estado de las 70 candidatas SEM detectadas por sem-watcher.",
          "No se puede confirmar si click_phone tambien falla en la version de GTM realmente publicada en produccion, o solo en la version nombrada como pendiente de aprobacion.",
          "No se conoce el estado final de aprobacion visual de la pagina de staging 2103 (taquillas_inteligentes_general) mas alla de 'pendiente de aprobacion visual real'.",
          "No hay confirmacion en este contexto de que qa-reviewer o web-engineer hayan producido artifacts en esta pasada coordinada; su estado real de ejecucion no es visible mas alla de la existencia de su definicion de agente."
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

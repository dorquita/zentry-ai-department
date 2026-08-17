# Prompt preparado para seo-specialist — run seo-specialist-2026-08-17T20-19-33-226Z-x43kny

Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado agregado de datos SEO locales.
Pegalo tal cual como prompt del subagente `seo-specialist`. El subagente no tiene herramientas -- todo lo que necesita esta aqui.

---

## 1. Instrucciones del subagente

Eres `seo-specialist`, un especialista SEO senior del departamento de
Zentry AI. Tu unico trabajo es RAZONAR sobre un paquete de contexto ya
estructurado que se te entrega en el prompt y devolver un analisis SEO
tambien estructurado, priorizado y accionable. No tienes ninguna
herramienta de capacidad: no puedes leer ficheros, no puedes
navegar el repositorio, no puedes
ejecutar comandos, no puedes consultar Search Console ni ningun otro
sistema en vivo, no puedes escribir en ningun sistema (ni interno ni
externo). Todo lo que necesitas saber viene ya incluido en el mensaje que
recibes -- si algo no esta ahi, no existe para ti: no lo inventes, no lo
asumas, no lo completes con conocimiento general sobre SEO de otras
empresas o sectores.

## Que se te entrega

El runner te pasa siempre, dentro del propio prompt, un objeto
`SeoSpecialistContext` en JSON (ver `src/employees/seo-specialist/context.ts`
para la definicion exacta del tipo) con:

- `dataAvailability`: si hay datos de jobs SEO, catalogo de keywords
  objetivo y/o catalogo de clusters disponibles, el `runId` mas reciente
  analizado, cuantos jobs tiene ese run, y las rutas (si existen) del
  ultimo informe del SEO Watcher/SEO Director. Si TODOS los indicadores
  de `dataAvailability` son negativos, no hay ningun dato real sobre el
  que razonar -- en ese caso tu unica salida valida es un
  `executiveSummary` que lo indique, arrays vacios en `findings`/
  `opportunities`/etc., y `unknowns` explicando la ausencia de datos.
- `actionItems`: oportunidades SEO reales ya agregadas por keyword+pagina
  a partir de `data/jobs.jsonl` (datos derivados de Google Search
  Console) -- cada una con `keyword`, `page`, `kinds` (quick_win/low_ctr/
  position_drop/future_opportunity), `priority`, `currentPosition`,
  `targetPosition`, `totalImpressions`, `action` (accion ya sugerida por
  el pipeline determinista), `rationale`, `effort`, `impact`,
  `requiresWordPress`, `requiresNewContent`, `requiresHumanReview`.
- `targetKeywords`: el catalogo estatico de keywords objetivo del
  negocio (`config/seo-target-keywords.json`), cada una con `type`
  (commercial/informational) y `priority`. Vacio si el fichero no existe
  o esta vacio.
- `clusters`: el catalogo de clusters SEO conocidos
  (`config/seo-clusters-catalog.json`) -- cada cluster agrupa variantes
  de keyword bajo una intencion de busqueda y una decision ya tomada
  (`action`: update_existing_page / new_page_candidate / differentiate /
  merge / postpone / reject), con `targetUrl` (puede ser `null` si no hay
  pagina todavia), `searchIntent`, `matchPatterns`, `excludePatterns`, y
  `reason` (la justificacion humana de esa decision, incluida cualquier
  nota de canibalizacion ya resuelta o pendiente). Vacio si el fichero no
  existe.

## Que debes producir

Un unico objeto JSON (sin texto antes ni despues, sin markdown fences)
que siga exactamente esta forma:

```json
{
  "executiveSummary": "string",
  "findings": [
    { "id": "string", "category": "technical|content|keyword_strategy|structure|search_intent|internal_linking|cannibalization|other", "description": "string", "basis": "evidence|inference", "evidenceRefs": ["string"] }
  ],
  "opportunities": [
    { "id": "string", "keyword": "string", "page": "string", "kind": "quick_win|low_ctr|position_drop|content_gap|internal_linking|technical|cannibalization|future_opportunity", "priority": "high|medium|low", "recommendedAction": "string", "rationale": "string", "basis": "evidence|inference", "evidenceRefs": ["string"] }
  ],
  "technicalIssues": [
    { "id": "string", "page": "string", "issue": "string", "severity": "high|medium|low", "basis": "evidence|inference", "evidenceRefs": ["string"] }
  ],
  "contentGaps": [
    { "id": "string", "topic": "string", "relatedKeyword": "string", "page": "string", "rationale": "string", "basis": "evidence|inference", "evidenceRefs": ["string"] }
  ],
  "internalLinkRecommendations": [
    { "id": "string", "fromPage": "string", "toPage": "string", "anchorTextSuggestion": "string", "rationale": "string", "basis": "evidence|inference", "evidenceRefs": ["string"] }
  ],
  "prioritizedActions": [
    { "rank": 1, "title": "string", "relatedIds": ["string"], "priority": "high|medium|low", "effort": "low|medium|high", "impact": "low|medium|high" }
  ],
  "evidence": [
    { "id": "string", "source": "job_data|target_keyword_catalog|cluster_catalog|prior_report|other", "keyword": "string", "page": "string", "description": "string" }
  ],
  "unknowns": ["string"]
}
```

`page`, `relatedKeyword` (en `contentGaps`), y `keyword`/`page` (en
`evidence`) son opcionales -- omitelos si no aplican, nunca pongas
`null`. Todos los demas campos listados son obligatorios, incluidos los
arrays (usa `[]` si de verdad no tienes nada que reportar en esa
categoria -- un array vacio es una respuesta honesta, nunca rellenes con
contenido generico para no dejarlo vacio).

## EVIDENCIA vs INFERENCIA (regla central)

Cada `finding`, `opportunity`, `technicalIssue`, `contentGap` e
`internalLinkRecommendation` lleva un campo `basis`:

- `"evidence"`: el dato viene DIRECTAMENTE del contexto que recibiste
  (un `actionItem` real, una entrada real de `targetKeywords` o de
  `clusters`). Si marcas `basis: "evidence"`, `evidenceRefs` debe
  contener el/los `id` de una o mas entradas de tu propio array
  `evidence[]` que respalden esa afirmacion -- y esas entradas de
  `evidence[]` deben a su vez citar (en `keyword`/`page`) valores que
  aparecen literalmente en el contexto recibido, nunca inventados.
- `"inference"`: es tu razonamiento SEO sobre lo anterior (una hipotesis,
  una recomendacion estrategica que combina varias senales) -- no un
  dato que puedas atribuir a una fuente concreta. Sigue siendo util,
  pero no la presentes como si fuera un hecho medido.

No fabricar datos: nunca inventes cifras de impresiones/clics/posicion,
nunca inventes una URL que no aparezca en el contexto, nunca inventes una
keyword que no aparezca en `actionItems`/`targetKeywords`/`clusters`.

## Tu trabajo NO es "poner keywords"

Debes razonar de verdad sobre:

- **Estructura SEO / titles / metas**: usa `action`/`recommendedAction`
  de `actionItems` y los `recommendedTitle`/`recommendedMetaDescription`
  de `clusters` (cuando existan) para detectar paginas con problemas de
  on-page reales.
- **Intencion de busqueda**: usa `searchIntent` de `clusters` y el `kind`
  de cada `actionItem` para clasificar cada oportunidad correctamente
  (no traduzcas mecanicamente "keyword -> pagina" sin mirar la intencion).
- **Canibalizacion**: busca clusters cuyo `label`/`matchPatterns` sean
  semanticamente cercanos pero con `targetUrl` distintos (p.ej. material
  generico vs. combinacion especifica de materiales) -- si el `reason`
  del cluster ya documenta una decision de no fusionar o una
  canibalizacion resuelta, respetala; si detectas una posible
  canibalizacion NO documentada en `reason`, repórtala como `finding`
  con `basis: "inference"`.
- **Cobertura tematica / content gaps**: clusters con `action:
  "new_page_candidate"` son huecos de contenido reales ya detectados --
  no los ignores. Tambien puedes proponer `contentGaps` adicionales SOLO
  si se derivan de `targetKeywords`/`actionItems` sin pagina asociada
  clara en `clusters`.
- **Enlazado interno**: propone `internalLinkRecommendations` entre
  paginas reales que aparezcan en `actionItems`/`clusters` (nunca
  inventes una URL) cuando el tema de una se beneficie claramente de
  enlazar a otra ya existente.
- **Priorizacion**: `prioritizedActions` debe ser una lista corta y
  ordenada (campo `rank`, empezando en 1) que combine impacto/esfuerzo,
  no una simple copia de `opportunities` sin criterio.

## Que NUNCA debes hacer

- No pidas acceso a ficheros, al repositorio, a Search Console, a
  Google Ads, a GA4/GTM, a WordPress ni a ningun sistema externo -- no
  tienes herramientas y no las necesitas para esta tarea.
- No te autoevalues ni declares tu propio analisis como "completo" o
  "definitivo" -- la decision de que aplicar la toma un humano por
  fuera, leyendo el artefacto que genera el runner.
- No escribas en ningun sistema, no propongas comandos a ejecutar, no
  generes HTML ni contenido de publicacion -- solo el JSON de analisis
  descrito arriba.
- No inventes cifras (impresiones, clics, posicion), URLs, nombres de
  paginas, ni keywords que no aparezcan literalmente en el contexto que
  recibiste.
- No dejes `evidenceRefs` vacio en un `finding`/`opportunity`/etc. cuyo
  `basis` sea `"evidence"` -- si no tienes una entrada de `evidence[]`
  real que lo respalde, marca ese elemento como `basis: "inference"` en
  su lugar, nunca fuerces una referencia falsa.

---

## 2. PROCEDENCIA Y FRESCURA DE ESTOS DATOS (leer antes que las cifras)

- **Estado:** `live_this_run`
- **Fuente de los datos:** `search_console`
- **Search Console se leyo de verdad el:** 2026-08-17T20:18:19.480Z
- **Antigüedad:** 0 h (umbral 26 h)
- **Generado en esta pasada:** SI

DATOS LIVE DE ESTA PASADA: la fuente externa se leyo en esta misma ejecucion (2026-08-17T20:18:19.480Z, hace 0 h). Puedes hablar de estos datos como el estado actual.

---

## 3. Contexto estructurado (SeoSpecialistContext)

```json
{
  "generatedAt": "2026-08-17T20:19:33.337Z",
  "sourceGeneratedAt": "2026-08-17T20:18:19.480Z",
  "sourceKind": "search_console",
  "freshness": {
    "status": "live_this_run",
    "ageHours": 0,
    "maxAgeHours": 26,
    "sourceGeneratedAt": "2026-08-17T20:18:19.480Z",
    "producedInThisRun": true,
    "humanSummary": "DATOS LIVE DE ESTA PASADA: la fuente externa se leyo en esta misma ejecucion (2026-08-17T20:18:19.480Z, hace 0 h). Puedes hablar de estos datos como el estado actual."
  },
  "dataAvailability": {
    "hasJobData": true,
    "hasTargetKeywordCatalog": true,
    "hasClusterCatalog": true,
    "latestRunId": "seo-watcher-2026-08-17T201818Z",
    "totalJobsInLatestRun": 36,
    "seoDirectorReportPath": "/home/runner/work/zentry-ai-department/zentry-ai-department/reports/seo-director/seo-director-2026-08-17.md",
    "seoWatcherReportPath": "/home/runner/work/zentry-ai-department/zentry-ai-department/reports/seo/seo-watcher-2026-08-17.md"
  },
  "actionItems": [
    {
      "keyword": "cerraduras inteligentes para taquillas",
      "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
      "kinds": [
        "quick_win"
      ],
      "priority": "high",
      "currentPosition": 20.46808510638298,
      "targetPosition": 10,
      "totalImpressions": 47,
      "action": "Optimizar on-page para \"cerraduras inteligentes para taquillas\" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 20.5 a top 10.",
      "rationale": "47 impresiones en el periodo analizado; posicion actual 20.5, a un empujon de primera pagina.",
      "effort": "medium",
      "impact": "medium",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "9a25142b-7887-403c-926f-041aa5b0baad"
      ]
    },
    {
      "keyword": "cerraduras inteligentes para centros deportivos",
      "page": "https://zentrylockers.com/cerraduras/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "high",
      "currentPosition": 37.61290322580645,
      "targetPosition": 10,
      "totalImpressions": 31,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"cerraduras inteligentes para centros deportivos\" (posicion actual 37.6, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para \"cerraduras inteligentes para centros deportivos\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "31 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "medium",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "a76259c6-a05b-4713-9fed-adc05ff314f9",
        "18903174-f882-483d-944b-a5f6d5a5a277"
      ]
    },
    {
      "keyword": "taquillas melamina",
      "page": "https://zentrylockers.com/taquillas-melamina/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 30.1046511627907,
      "targetPosition": 10,
      "totalImpressions": 86,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquillas melamina\" (posicion actual 30.1, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para \"taquillas melamina\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "86 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "60d8384b-8189-479b-b8a3-0eccf83fd6a5",
        "82d469ca-b37a-4725-ba72-e7197522d682"
      ]
    },
    {
      "keyword": "taquillas de melamina",
      "page": "https://zentrylockers.com/taquillas-melamina/",
      "kinds": [
        "quick_win",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 28.7027027027027,
      "targetPosition": 10,
      "totalImpressions": 74,
      "action": "Optimizar on-page para \"taquillas de melamina\" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 28.7 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para \"taquillas de melamina\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "74 impresiones en el periodo analizado; posicion actual 28.7, a un empujon de primera pagina; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "b0dad8b1-4c53-4403-bcb6-5eedb58f27a9",
        "15fc6385-4da8-4f8f-a5b7-d583623ea1c6"
      ]
    },
    {
      "keyword": "taquillas melamina",
      "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 43.096774193548384,
      "targetPosition": 10,
      "totalImpressions": 62,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquillas melamina\" (posicion actual 43.1, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para \"taquillas melamina\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "62 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "526ad1a7-2386-420f-b402-fab390527e52",
        "bb6a10c8-66ac-410f-bf8e-a6552474e756"
      ]
    },
    {
      "keyword": "taquillas de melamina",
      "page": "https://zentrylockers.com/taquillas-melamina-fenolico/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 43.11764705882353,
      "targetPosition": 10,
      "totalImpressions": 51,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquillas de melamina\" (posicion actual 43.1, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para \"taquillas de melamina\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "51 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "6f482b04-f1fd-4b87-afdc-d41d4c84befe",
        "96364d9a-20ca-440b-85a5-24a43984464e"
      ]
    },
    {
      "keyword": "taquilla madera",
      "page": "https://zentrylockers.com/taquillas-melamina/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 43.2,
      "targetPosition": 10,
      "totalImpressions": 50,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquilla madera\" (posicion actual 43.2, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para \"taquilla madera\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "50 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "223ac831-8f1f-4f6b-9e3e-b91a1a7e0195",
        "cbb868f0-5dcb-4506-83b5-16a590fe686e"
      ]
    },
    {
      "keyword": "taquillas colegios",
      "page": "https://zentrylockers.com/taquillas-para-colegios/",
      "kinds": [
        "quick_win",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 25.125,
      "targetPosition": 10,
      "totalImpressions": 40,
      "action": "Optimizar on-page para \"taquillas colegios\" en https://zentrylockers.com/taquillas-para-colegios/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 25.1 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para \"taquillas colegios\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "40 impresiones en el periodo analizado; posicion actual 25.1, a un empujon de primera pagina; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "17250954-4e48-4cba-9a5d-c39409531678",
        "a7f3da43-62e4-45b7-ad15-659bc329f3ba"
      ]
    },
    {
      "keyword": "taquilla para el personal",
      "page": "https://zentrylockers.com/taquillas-para-empresas/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 65.73529411764706,
      "targetPosition": 10,
      "totalImpressions": 34,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquilla para el personal\" (posicion actual 65.7, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-empresas/ para \"taquilla para el personal\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "34 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "e036520d-d25e-4bda-8a8a-5e22e845669f",
        "2540b08c-de3e-419b-9390-eaf2bb0add43"
      ]
    },
    {
      "keyword": "cerraduras electrónicas taquillas",
      "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 34.625,
      "targetPosition": 10,
      "totalImpressions": 32,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"cerraduras electrónicas taquillas\" (posicion actual 34.6, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para \"cerraduras electrónicas taquillas\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "32 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "dbf02c02-685c-4e07-a1fc-27343fd44a2a",
        "ad9bf37d-9f4c-4ca4-8e71-7acacdae57e1"
      ]
    },
    {
      "keyword": "taquillas escolares",
      "page": "https://zentrylockers.com/taquillas-para-colegios/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 33.84375,
      "targetPosition": 10,
      "totalImpressions": 32,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquillas escolares\" (posicion actual 33.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para \"taquillas escolares\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "32 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "b9f55e70-76ef-44da-84c3-9dee2ee12bed",
        "95917b12-394a-42f7-84a9-933ca38ed2be"
      ]
    },
    {
      "keyword": "taquillas fenólicas en palencia",
      "page": "https://zentrylockers.com/taquillas-fenolicas/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 73.72413793103448,
      "targetPosition": 10,
      "totalImpressions": 29,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"taquillas fenólicas en palencia\" (posicion actual 73.7, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-fenolicas/ para \"taquillas fenólicas en palencia\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "29 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "72188378-bc7d-4ff0-a3f1-91c4c0f1e50b",
        "121b45a6-4dc9-48e8-8f38-7bc2dae6e764"
      ]
    },
    {
      "keyword": "taquillas vestuarios de melamina",
      "page": "https://zentrylockers.com/taquillas-melamina/",
      "kinds": [
        "quick_win",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 27.785714285714285,
      "targetPosition": 10,
      "totalImpressions": 28,
      "action": "Optimizar on-page para \"taquillas vestuarios de melamina\" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 27.8 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para \"taquillas vestuarios de melamina\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "28 impresiones en el periodo analizado; posicion actual 27.8, a un empujon de primera pagina; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "98b67f26-aeab-4cbd-ab8c-1a2b34d55a63",
        "9e99f8bd-ff6a-4756-a4ec-77de7e3e0e9d"
      ]
    },
    {
      "keyword": "cerraduras electronicas para taquillas",
      "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
      "kinds": [
        "quick_win",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 24.51851851851852,
      "targetPosition": 10,
      "totalImpressions": 27,
      "action": "Optimizar on-page para \"cerraduras electronicas para taquillas\" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 24.5 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para \"cerraduras electronicas para taquillas\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "27 impresiones en el periodo analizado; posicion actual 24.5, a un empujon de primera pagina; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "b8dfd50c-2aad-4a01-88e4-39d0206d4f90",
        "5812a99a-de4f-4683-bcdd-0952f608f20f"
      ]
    },
    {
      "keyword": "fabricante de taquillas fenólicas en badajoz",
      "page": "https://zentrylockers.com/taquillas-fenolicas/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 83.30434782608695,
      "targetPosition": 10,
      "totalImpressions": 23,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"fabricante de taquillas fenólicas en badajoz\" (posicion actual 83.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-fenolicas/ para \"fabricante de taquillas fenólicas en badajoz\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "23 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "96773d45-a5a5-4158-8b28-b68e00322804",
        "5c6ea80f-9341-4225-8267-e5cff4cee401"
      ]
    },
    {
      "keyword": "taquillas para hospital",
      "page": "https://zentrylockers.com/taquillas-para-hospitales/",
      "kinds": [
        "quick_win",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 17.136363636363637,
      "targetPosition": 10,
      "totalImpressions": 22,
      "action": "Optimizar on-page para \"taquillas para hospital\" en https://zentrylockers.com/taquillas-para-hospitales/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 17.1 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-hospitales/ para \"taquillas para hospital\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "22 impresiones en el periodo analizado; posicion actual 17.1, a un empujon de primera pagina; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "457c5e54-9426-40c1-8ca5-75477fe285d1",
        "698a4c2c-f5ac-432a-85a2-d673fc71a5e7"
      ]
    },
    {
      "keyword": "comprar taquillas para hospitales",
      "page": "https://zentrylockers.com/taquillas-para-hospitales/",
      "kinds": [
        "quick_win"
      ],
      "priority": "medium",
      "currentPosition": 10.619047619047619,
      "targetPosition": 10,
      "totalImpressions": 21,
      "action": "Optimizar on-page para \"comprar taquillas para hospitales\" en https://zentrylockers.com/taquillas-para-hospitales/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 10.6 a top 10.",
      "rationale": "21 impresiones en el periodo analizado; posicion actual 10.6, a un empujon de primera pagina.",
      "effort": "medium",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": false,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "9a58dafe-ee00-4d22-8101-1303d7cf5550"
      ]
    },
    {
      "keyword": "cerraduras sostenibles para gimnasios",
      "page": "https://zentrylockers.com/cerraduras/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 30.904761904761905,
      "targetPosition": 10,
      "totalImpressions": 21,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"cerraduras sostenibles para gimnasios\" (posicion actual 30.9, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para \"cerraduras sostenibles para gimnasios\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "21 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "4f3f9b9b-1089-4818-89dd-c148dfc153fc",
        "50054933-a5e6-4b4a-b9d8-09d38f5138ec"
      ]
    },
    {
      "keyword": "cerraduras sostenibles para gimnasios",
      "page": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
      "kinds": [
        "future_opportunity",
        "low_ctr"
      ],
      "priority": "medium",
      "currentPosition": 45.7,
      "targetPosition": 10,
      "totalImpressions": 20,
      "action": "Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para \"cerraduras sostenibles para gimnasios\" (posicion actual 45.7, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para \"cerraduras sostenibles para gimnasios\" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.",
      "rationale": "20 impresiones en el periodo analizado; el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata; esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo.",
      "effort": "high",
      "impact": "low",
      "requiresWordPress": true,
      "requiresNewContent": true,
      "requiresHumanReview": true,
      "sourceJobIds": [
        "6e05018d-404d-44b2-9cac-5eabadf3be53",
        "849095e3-b96d-4a3c-8cab-48802716cd9a"
      ]
    }
  ],
  "targetKeywords": [
    {
      "keyword": "cerraduras inteligentes para taquillas",
      "type": "commercial",
      "priority": "high"
    },
    {
      "keyword": "taquillas de melamina",
      "type": "commercial",
      "priority": "medium"
    },
    {
      "keyword": "taquillas para gimnasios",
      "type": "commercial",
      "priority": "high"
    },
    {
      "keyword": "taquillas escolares",
      "type": "commercial",
      "priority": "medium"
    },
    {
      "keyword": "cerraduras inteligentes para centros deportivos",
      "type": "commercial",
      "priority": "high"
    },
    {
      "keyword": "digitalizacion de taquillas",
      "type": "informational",
      "priority": "medium"
    },
    {
      "keyword": "taquillas para empresas",
      "type": "commercial",
      "priority": "high"
    },
    {
      "keyword": "lockers inteligentes",
      "type": "commercial",
      "priority": "high"
    },
    {
      "keyword": "taquillas fenolicas",
      "type": "commercial",
      "priority": "medium"
    },
    {
      "keyword": "taquillas metalicas",
      "type": "commercial",
      "priority": "medium"
    }
  ],
  "clusters": [
    {
      "clusterKey": "cerraduras_inteligentes_taquillas",
      "label": "Cerraduras inteligentes/electrónicas para taquillas",
      "matchPatterns": [
        "cerraduras inteligentes para taquillas",
        "cerraduras electronicas para taquillas",
        "cerraduras electronicas taquillas",
        "cerraduras inteligentes taquillas"
      ],
      "excludePatterns": [],
      "searchIntent": "informativo",
      "targetUrl": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
      "targetPageId": 1865,
      "relatedStagingPageIds": [
        2096
      ],
      "action": "update_existing_page",
      "reason": "4 variantes de la misma intencion (electronica=inteligente en el lenguaje de busqueda de estos usuarios) sobre la MISMA pagina real. Decision ya tomada en O27.2: diferenciar de /cerraduras-para-taquillas/ (2060, catalogo comercial ARES/ORBIS/BOXIS/NEO) -- esta URL es la version SEO informativa, no se fusiona sin nueva aprobacion de Pau."
    },
    {
      "clusterKey": "cerraduras_inteligentes_centros_deportivos",
      "label": "Cerraduras inteligentes para centros deportivos (URL obsoleta)",
      "matchPatterns": [
        "cerraduras inteligentes para centros deportivos"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/cerraduras/",
      "targetPageId": null,
      "relatedStagingPageIds": [],
      "action": "reject",
      "reason": "La pagina objetivo actual del backlog (/cerraduras/, id 1751) esta en PAPELERA desde O22, con redireccion 301 real a /cerraduras-para-taquillas/ (2060). La tarea en el backlog apunta a una URL obsoleta -- no ejecutar tal cual. Si se quiere atacar esta keyword de verdad, el objetivo correcto seria /cerraduras-para-taquillas/ (2060) o el cluster de cerraduras inteligentes (1865), a decidir por Pau -- no automatico."
    },
    {
      "clusterKey": "taquillas_colegios_escolares",
      "label": "Taquillas para colegios / escolares",
      "matchPatterns": [
        "taquillas colegios",
        "taquillas escolares",
        "taquillas para colegios",
        "taquillas centros educativos",
        "taquillas para centros educativos"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/taquillas-para-colegios/",
      "targetPageId": 127,
      "relatedStagingPageIds": [
        2098
      ],
      "action": "update_existing_page",
      "reason": "\"Colegios\" y \"escolares\" son sinonimos de intencion identica en este catalogo -- una sola pagina real ya existe. 2093 (SEO, superseded_by 2098 en O28.6) consolidado en 2098 (content, ya visualmente aprobada) -- relatedStagingPageIds solo incluye la version viva (2098), 2093 esta cancelada."
    },
    {
      "clusterKey": "colegio_generico",
      "label": "\"Colegio\"/\"colegios\" sueltos (sin contexto de producto)",
      "matchPatterns": [
        "^colegio$",
        "^colegios$"
      ],
      "excludePatterns": [],
      "searchIntent": "mixta",
      "targetUrl": "https://zentrylockers.com/taquillas-para-colegios/",
      "targetPageId": 127,
      "relatedStagingPageIds": [
        2109
      ],
      "action": "merge",
      "reason": "Keyword de una sola palabra, sin \"taquillas\" -- demasiado generica para saber si la intencion es de producto. Se fusiona en el cluster de colegios/escolares en vez de crear una tarea aparte; 2109 (staging_draft de 'colegio', ya visualmente aprobada) apunta correctamente a la misma pagina real (1960, taquillas-escolares -- ver nota de discrepancia de URL en el informe)."
    },
    {
      "clusterKey": "taquillas_empresas_personal",
      "label": "Taquillas para empresas / personal",
      "matchPatterns": [
        "taquilla para el personal",
        "taquillas para empresas",
        "taquillas empresas"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/taquillas-para-empresas/",
      "targetPageId": 129,
      "relatedStagingPageIds": [
        2099
      ],
      "action": "update_existing_page",
      "reason": "\"Taquilla para el personal\" es la misma intencion comercial que \"taquillas para empresas\" (personal = empleados de una empresa). 2094 (SEO, superseded_by 2099 en O28.6) consolidado en 2099 (content, visualmente aprobada) -- relatedStagingPageIds solo incluye la version viva (2099)."
    },
    {
      "clusterKey": "taquillas_oficinas",
      "label": "Taquillas para oficinas",
      "matchPatterns": [
        "oficinas taquillas",
        "taquillas para oficinas",
        "^oficina$",
        "^oficinas$"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/taquillas-para-oficinas/",
      "targetPageId": 1822,
      "relatedStagingPageIds": [
        2108
      ],
      "action": "update_existing_page",
      "reason": "Distinto de \"taquillas para empresas\" (129): oficinas es un ENTORNO fisico concreto (mobiliario de oficina), empresas es el CLIENTE B2B generico -- se mantienen como clusters separados, no se fusionan, aunque comparten cliente final. 2108 ya visualmente aprobada."
    },
    {
      "clusterKey": "taquillas_melamina_fenolico",
      "label": "Taquillas melamina-fenólico (acabado combinado)",
      "matchPatterns": [
        "melamina con puertas fenolicas",
        "melamina con puerta fenolica",
        "melamina fenolico",
        "melamina-fenolico"
      ],
      "excludePatterns": [],
      "searchIntent": "producto",
      "targetUrl": "https://zentrylockers.com/taquillas-melamina-fenolico/",
      "targetPageId": 1269,
      "relatedStagingPageIds": [
        2092
      ],
      "action": "differentiate",
      "cannibalizationRiskOverride": "bajo",
      "recommendedTitle": "Taquillas de Melamina con Puertas Fenólicas | Zentry Lockers",
      "recommendedMetaDescription": "Taquillas con cuerpo en melamina y puertas fenólicas: mayor resistencia a la humedad y a los impactos en la zona de mayor uso. Ideal para vestuarios exigentes. Pide presupuesto.",
      "reason": "DECISION O29.1 (Pau, aprobada): NO fusionar con /taquillas-melamina/. Esta URL ataca la long-tail especifica de la combinacion de materiales (cuerpo melamina + puerta fenolica) -- pagina especifica de combinacion, no de material generico. La keyword generica \"melamina\" ya NO debe apuntar aqui (ver taquillas_melamina); cualquier actionId del backlog con esa keyword generica apuntando a esta pagina se considera mal enrutado y se cierra via scripts/o291-resolve-melamina-cannibalization.ts."
    },
    {
      "clusterKey": "taquillas_melamina",
      "label": "Taquillas de melamina",
      "matchPatterns": [
        "taquillas melamina",
        "taquilla melamina",
        "taquillas de melamina",
        "taquilla madera",
        "taquillas madera",
        "taquillas vestuarios de melamina"
      ],
      "excludePatterns": [
        "fenolico"
      ],
      "searchIntent": "producto",
      "targetUrl": "https://zentrylockers.com/taquillas-melamina/",
      "targetPageId": 470,
      "relatedStagingPageIds": [
        2097
      ],
      "action": "update_existing_page",
      "cannibalizationRiskOverride": "bajo",
      "recommendedTitle": "Taquillas de Melamina | Resistentes y Personalizables - Zentry Lockers",
      "recommendedMetaDescription": "Taquillas de melamina para vestuarios, colegios y empresas: resistentes, personalizables y con acabados a medida. Pide presupuesto sin compromiso.",
      "reason": "DECISION O29.1 (Pau, aprobada): pagina general de producto/material -- ataca la keyword principal (\"taquillas melamina\", \"taquillas de melamina\", \"taquilla melamina\" y variantes como \"taquilla madera\"). NO se fusiona con /taquillas-melamina-fenolico/ (esa URL es la long-tail especifica de combinacion melamina+fenolico). \"taquilla madera\" se incluye porque el acabado melamina imita madera y el backlog ya la apunta a esta misma URL. 2091 (SEO, superseded_by 2097 en O28.6) consolidado en 2097 (content, visualmente aprobada) -- relatedStagingPageIds solo incluye la version viva (2097). Canibalizacion RESUELTA: cualquier actionId historico con esta keyword generica que apuntara a /taquillas-melamina-fenolico/ se considera mal enrutado y se cierra via scripts/o291-resolve-melamina-cannibalization.ts, no se ejecuta tal cual."
    },
    {
      "clusterKey": "taquillas_fenolicas_perfileria",
      "label": "Taquillas fenólicas con perfilería",
      "matchPatterns": [
        "fenolicas con perfil",
        "fenolicas perfileria",
        "fenolica perfileria"
      ],
      "excludePatterns": [],
      "searchIntent": "producto",
      "targetUrl": "https://zentrylockers.com/taquillas-fenolicas-perfileria/",
      "targetPageId": 1271,
      "relatedStagingPageIds": [
        2106
      ],
      "action": "differentiate",
      "reason": "\"Perfileria\" es una variante de producto real (perfil/marco distinto), no un duplicado de \"taquillas fenolicas\" a secas -- se mantiene diferenciada, no se fusiona. 2106 ya visualmente aprobada."
    },
    {
      "clusterKey": "taquillas_fenolicas",
      "label": "Taquillas fenólicas",
      "matchPatterns": [
        "taquillas fenolicas en palencia",
        "taquillas fenolicas",
        "taquillas fenolica",
        "^fenolico$",
        "^fenolica$"
      ],
      "excludePatterns": [
        "perfil"
      ],
      "searchIntent": "producto",
      "targetUrl": "https://zentrylockers.com/taquillas-fenolicas/",
      "targetPageId": 468,
      "relatedStagingPageIds": [
        2100
      ],
      "action": "update_existing_page",
      "reason": "\"En Palencia\" es ruido geografico sin intencion comercial local real detectada (Zentry fabrica y envia a nivel nacional, no hay evidencia de negocio local especifico en Palencia) -- se trata como el cluster generico de fenolicas, no como cluster geografico aparte. 2095 (SEO, superseded_by 2100 en O28.6) consolidado en 2100 (content, visualmente aprobada) -- relatedStagingPageIds solo incluye la version viva (2100)."
    },
    {
      "clusterKey": "taquillas_industria",
      "label": "Taquillas para industria",
      "matchPatterns": [
        "^industrial$",
        "taquillas industria",
        "taquillas industriales"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/taquillas-para-industria/",
      "targetPageId": 1823,
      "relatedStagingPageIds": [
        2107
      ],
      "action": "update_existing_page",
      "reason": "2107 ya visualmente aprobada, apunta a la pagina real correcta."
    },
    {
      "clusterKey": "taquillas_hoteles",
      "label": "Taquillas para hoteles",
      "matchPatterns": [
        "^hotel$",
        "^hoteles$",
        "taquillas hoteles",
        "taquillas para hoteles"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": "https://zentrylockers.com/taquillas-para-hoteles/",
      "targetPageId": 131,
      "relatedStagingPageIds": [
        2111
      ],
      "action": "update_existing_page",
      "reason": "2111 ya visualmente aprobada, apunta a la pagina real correcta."
    },
    {
      "clusterKey": "taquillas_universidad",
      "label": "Taquillas para universidades",
      "matchPatterns": [
        "^universidad$",
        "^universidades$",
        "taquillas universidad",
        "taquillas universidades"
      ],
      "excludePatterns": [],
      "searchIntent": "sector",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [
        2110
      ],
      "action": "new_page_candidate",
      "reason": "Sin pagina de produccion equivalente confirmada (ver existing-page-audit.jsonl). 2110 ya creada y visualmente aprobada en staging -- candidata real a pagina nueva, no duplicado."
    },
    {
      "clusterKey": "taquillas_metalicas",
      "label": "Taquillas metálicas",
      "matchPatterns": [
        "metalicas taquillas",
        "taquillas metalicas",
        "taquilla metalica"
      ],
      "excludePatterns": [],
      "searchIntent": "producto",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [
        2105
      ],
      "action": "new_page_candidate",
      "reason": "Tercer material del catalogo (junto a melamina/fenolica) sin pagina de producto propia todavia -- hueco real detectado. 2105 ya creada y visualmente aprobada en staging."
    },
    {
      "clusterKey": "taquillas_vestuarios",
      "label": "Taquillas para vestuarios",
      "matchPatterns": [
        "taquillas para vestuarios",
        "para vestuarios",
        "taquillas vestuarios"
      ],
      "excludePatterns": [
        "melamina"
      ],
      "searchIntent": "sector",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [
        2104
      ],
      "action": "new_page_candidate",
      "reason": "Distinto de /bancos-de-vestuario/ (mobiliario complementario, O21) -- esto es sobre taquillas en si. Sin pagina equivalente. 2104 ya creada y visualmente aprobada en staging."
    },
    {
      "clusterKey": "taquillas_inteligentes_general",
      "label": "Taquillas inteligentes (solución general)",
      "matchPatterns": [
        "taquillas inteligentes",
        "taquilla inteligente"
      ],
      "excludePatterns": [
        "cerradura"
      ],
      "searchIntent": "producto",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [
        2103
      ],
      "action": "new_page_candidate",
      "reason": "Distinto del cluster cerraduras_inteligentes_taquillas: esta es la SOLUCION GENERAL (mueble+cerradura+PIN/RFID/app), no el hardware de cierre en si. No fusionar con 1865/2096 sin nueva decision explicita de Pau (riesgo de canibalizacion documentado, ver existing-page-audit.jsonl). 2103 corregida en O28.6, publicada en staging para revision en O28.7, pendiente de aprobacion visual real."
    },
    {
      "clusterKey": "taquillas_comercial_generico",
      "label": "Taquillas - términos comerciales genéricos (comprar/soluciones)",
      "matchPatterns": [
        "comprar taquillas",
        "soluciones de taquillas"
      ],
      "excludePatterns": [],
      "searchIntent": "transaccional",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [
        2101,
        2102
      ],
      "action": "postpone",
      "reason": "Intencion transaccional real pero SIN angulo de producto/sector propio -- demasiado generico para diferenciarse de la home/catalogo general, alto riesgo de canibalizar paginas ya existentes sin aportar nada nuevo. Recomendacion: no crear paginas nuevas para esto -- mejor como mejora de CTA/enlazado interno en paginas ya existentes (proceso de pedido, home). 2101/2102 ya existen en staging y estan visualmente aprobadas, pero se recomienda NO avanzarlas a produccion sin antes decidir si de verdad aportan algo distinto de las paginas de sector/material."
    },
    {
      "clusterKey": "cerradura_para_fragmentos",
      "label": "Fragmentos de keyword sin sentido propio (\"cerradura para\", \"cerradura para cada\")",
      "matchPatterns": [
        "cerradura para",
        "cerradura para cada"
      ],
      "excludePatterns": [],
      "searchIntent": "mixta",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [],
      "action": "reject",
      "reason": "Keywords truncadas/incompletas (parecen fragmentos de una consulta mas larga cortada por el origen de datos), 0 impresiones, sin intencion clara. Rechazar -- no generar ninguna tarea. Recomendado revisar la limpieza de queries en SEO Watcher para que no vuelvan a entrar asi."
    },
    {
      "clusterKey": "sistemas_de_cierre_generico",
      "label": "\"Sistemas de cierre\" (genérico, sin producto)",
      "matchPatterns": [
        "sistemas de cierre"
      ],
      "excludePatterns": [],
      "searchIntent": "informativo",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [],
      "action": "reject",
      "reason": "0 impresiones, termino generico que solapa conceptualmente con el cluster de cerraduras inteligentes sin aportar una intencion propia clara. Rechazar por ahora."
    },
    {
      "clusterKey": "tareas_no_seo",
      "label": "Tareas operativas (no son keywords SEO)",
      "matchPatterns": [
        "revision de campana sem",
        "validacion de tracking ga4"
      ],
      "excludePatterns": [],
      "searchIntent": "mixta",
      "targetUrl": null,
      "targetPageId": null,
      "relatedStagingPageIds": [],
      "action": "reject",
      "reason": "No son keywords de busqueda -- son tareas operativas (SEM/analitica) mezcladas en el mismo backlog. Excluidas del clustering SEO: no se tratan como oportunidad de contenido/pagina."
    }
  ]
}
```

Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.

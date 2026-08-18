# Prompt preparado para qa-reviewer -- artifact dept-2026-08-18T025944Z-plan-qa-input-round-0

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
    "artifactId": "dept-2026-08-18T025944Z-plan-qa-input-round-0",
    "artifactPath": "reports/department/dept-2026-08-18T025944Z/dept-2026-08-18T025944Z-plan-qa-input-round-0.json"
  },
  "artifact": {
    "contractVersion": "department-run/v1",
    "departmentRunId": "dept-2026-08-18T025944Z",
    "generatedAt": "2026-08-18T03:24:28.117Z",
    "round": 0,
    "reviewInstructionsForQa": [
      "Este artifact es la ESPECIFICACION TECNICA y los CHANGEPLANS que ha producido web-engineer para las recomendaciones ya aprobadas por Growth y por la revision anterior de QA.",
      "Es lo ULTIMO que se revisa antes de que el sistema escriba de verdad en staging. Un ChangePlan con estado ACTIONABLE que sobreviva esta revision SE EJECUTARA automaticamente sobre una pagina real. Revisalo con ese peso.",
      "Comprueba, plan a plan: (a) que el cambio responde de verdad a la recomendacion que dice responder, (b) que el valor nuevo (`afterValue`) es correcto, completo y publicable tal cual, (c) que no contradice el valor actual real (`beforeValue`) por accidente, (d) que la pagina objetivo es la que corresponde a la recomendacion.",
      "`beforeValue` es el estado REAL leido del sitio, no una declaracion del modelo: si el cambio propuesto ignora lo que ya hay, eso es un hallazgo.",
      "Vigila especialmente el contenido que se escribe: texto que promete plazos, cifras, garantias o afirmaciones de negocio no confirmadas es un `safetyConcern`, no un matiz de estilo.",
      "Un plan que NO es ACTIONABLE no se va a ejecutar: no lo marques como riesgo de escritura. Si su motivo de no serlo revela un error real de la propuesta, ESO si es un hallazgo.",
      "Cuando pidas una correccion, usa `correctionRequests[]` y se literal: que campo esta mal (`field`), que problema tiene (`problem`), con que criterio se sabra que quedo resuelto (`expectedCriterion`) y en que evidencia te basas (`evidence`). Una frase generica no se puede corregir de forma dirigida.",
      "Cita la `recommendationId` exacta en `targetRecommendationId`: el departamento la usa para saber a que recomendacion afecta cada correccion, sin adivinar.",
      "Si esta revision trae `previousCorrections`, tu primera tarea es comprobar UNA POR UNA si quedaron resueltas en esta version. No repitas una correccion ya resuelta, y no des por buena una que solo se ha reformulado.",
      "Nada de esto se ha aplicado todavia a ningun sistema. No lo evalues como si ya estuviera publicado."
    ],
    "approvedRecommendations": [
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-1",
        "rank": 1,
        "title": "Confirmar y desbloquear la correccion ya aprobada del enrutado roto hacia /cerraduras/",
        "rationale": "Esta correccion ya fue aprobada por una persona el 2026-08-16 pero el run SEO Watcher de hoy sigue generando actionItems que apuntan a /cerraduras/, URL en papelera con 301. Impacto alto porque evita malgastar esfuerzo sobre keywords mal enrutadas; confianza alta porque la evidencia es consistente entre pasadas; esfuerzo bajo porque es una correccion de enrutado, no contenido nuevo."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-2",
        "rank": 2,
        "title": "Verificar si la version live de GTM esta realmente publicada antes de confiar en los datos de conversion",
        "rationale": "La version live del contenedor se llama literalmente O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau), una contradiccion directa entre nombre y estado reportado como live. Impacto alto porque toda decision de CRO/analytics de esta pasada depende de que esos eventos esten realmente en produccion; confianza alta porque es un hecho reportado por analytics-specialist; esfuerzo bajo porque es solo una verificacion administrativa en GTM."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-3",
        "rank": 3,
        "title": "Validar en GA4 DebugView el disparo real de click_phone (accion ya aprobada, aun sin resolver)",
        "rationale": "Ya aprobada el 2026-08-16 sin motivo adicional escrito; analytics-specialist confirma en esta pasada que sigue en 0 ocurrencias pese a tag y trigger activos. Impacto alto por ser un evento clave de contacto; confianza media porque hay varias hipotesis posibles sin datos para descartar ninguna; esfuerzo bajo por tratarse de una prueba en DebugView."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-4",
        "rank": 4,
        "title": "Cerrar la canibalizacion taquillas melamina/de melamina via el script ya aprobado (O29.1)",
        "rationale": "Aprobada el 2026-08-16; el run de hoy sigue generando 2 actionItems que apuntan a /taquillas-melamina-fenolico/ en lugar de /taquillas-melamina/. Impacto medio porque afecta trafico generico, no el quick win principal; confianza alta porque el catalogo de clusters documenta la regla exacta; esfuerzo bajo porque el script ya existe y esta aprobado."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-5",
        "rank": 5,
        "title": "Ejecutar el on-page del quick win cerraduras inteligentes para taquillas (posicion 20.4)",
        "rationale": "Aprobada el 2026-08-16; sigue en posicion ~20.4 con 46 impresiones segun datos live de hoy, por lo que el trabajo aprobado aun no se ha aplicado. Impacto alto por ser un quick win cerca de top20; confianza media porque mover de posicion 20 a top10 no depende solo de on-page; esfuerzo medio porque implica reforzar H1/H2, contenido y enlazado interno."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-6",
        "rank": 6,
        "title": "Reescribir en bloque titles/meta descriptions de las paginas con CTR 0% (accion ya aprobada)",
        "rationale": "Aprobada el 2026-08-16; el run de hoy sigue mostrando CTR 0.00% en multiples paginas con impresiones reales de 20 a 83. Impacto medio porque es una mejora barata y transversal a varias URLs; confianza media porque no hay cifra numerica exacta de clics, solo el indicador textual; esfuerzo medio por el numero de paginas implicadas."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-7",
        "rank": 7,
        "title": "Ejecutar los quick wins on-page en /taquillas-para-hospitales/ (propuesta nueva, sin decision humana registrada)",
        "rationale": "A diferencia de las anteriores, esta propuesta de seo-specialist no aparece entre las decisiones humanas previas de este contexto. Impacto medio porque una de las dos keywords esta al borde del top10 (10.6); confianza media porque se basa en datos live de hoy; esfuerzo medio porque implica intervenir la misma pagina en una sola pasada para dos keywords."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-8",
        "rank": 8,
        "title": "Confirmar que click_catalog_download, view_quote_page y view_contact_page esten marcados como conversion en GA4",
        "rationale": "Estos tres eventos se disparan (4, 12 y 39 veces respectivamente) pero registran 0 conversiones, a diferencia de otros eventos de CTA donde conversion=ocurrencias. Impacto medio porque podria estar subestimando el funnel real; confianza alta porque es una observacion directa de datos GA4 de esta pasada; esfuerzo bajo porque es solo revisar configuracion de eventos clave."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-9",
        "rank": 9,
        "title": "Resolver el riesgo de canibalizacion hotel/hoteles antes de redactar o publicar la landing sectorial de hotel",
        "rationale": "content-strategist declara explicitamente este riesgo (cluster relacionado hoteles) y lo vincula con la practica ya aprobada de cerrar canibalizaciones de keywords similares. Impacto medio porque afecta a una pieza de contenido nueva antes de invertir en su redaccion; confianza media porque la intencion de hotel esta marcada como mixta/de revision manual, no confirmada al 100%; esfuerzo bajo porque es verificacion de cluster, no produccion de contenido."
      },
      {
        "recommendationId": "dept-2026-08-18T025944Z#rec-10",
        "rank": 10,
        "title": "Segmentar o excluir el trafico referral de tagassistant.google.com en los informes de GA4",
        "rationale": "Aporta 3 sesiones y 2 conversiones en el periodo y probablemente corresponde a actividad interna de QA/pruebas segun la propia hipotesis de analytics-specialist, contaminando ligeramente los informes. Impacto bajo por el volumen reducido; confianza media porque es una hipotesis, no un hecho confirmado; esfuerzo bajo por ser un filtro/segmento estandar en GA4."
      }
    ],
    "webEngineerOutput": {
      "implementationSummary": "Esta pasada coordinada no aporta ChangePacks ni inventario de staging (la lectura de staging.zentrylockers.com fallo por red), por lo que ninguna de las 10 recomendaciones aprobadas por Growth+QA puede resolverse contra una pagina verificada ni convertirse en un changePlan ejecutable. La especificacion cubre, en su lugar, el trabajo de ingenieria necesario para: (1) verificar y desbloquear 5 correcciones ya aprobadas por una persona el 2026-08-16 que, segun los datos live de hoy, parecen no haberse aplicado todavia (enrutado de /cerraduras/, canibalizacion de taquillas melamina, quick win de cerraduras inteligentes para taquillas, reescritura de metas con CTR 0%, validacion de click_phone); (2) resolver la contradiccion critica de la version live de GTM (nombre indica sin publicar, pendiente aprobacion Pau); y (3) especificar dos recomendaciones nuevas sin decision humana previa (quick wins en /taquillas-para-hospitales/ y revision de canibalizacion hotel/hoteles antes de publicar contenido nuevo), ademas de dos ajustes de configuracion de analytics de menor impacto. Nada de esto se ejecuta en esta fase; todo queda como especificacion pendiente de aprobacion y de una relectura exitosa del inventario de staging.",
      "targetPages": [
        "https://zentrylockers.com/cerraduras/ (URL citada por la evidencia; existencia y estado real NO confirmados en este contexto, ver unknowns)",
        "https://zentrylockers.com/taquillas-melamina-fenolico/ (URL citada por la evidencia; existencia NO confirmada)",
        "https://zentrylockers.com/taquillas-melamina/ (URL destino de consolidacion citada por la evidencia; existencia NO confirmada)",
        "https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (URL citada por la evidencia; existencia NO confirmada)",
        "https://zentrylockers.com/taquillas-para-hospitales/ (URL citada por la evidencia; existencia NO confirmada)",
        "Conjunto de paginas con CTR 0% e impresiones 20-83 en el periodo, identidad exacta de cada URL NO listada en este contexto",
        "Landing sectorial nueva 'hotel' propuesta por content-strategist -- pagina que probablemente NO existe todavia, sin slug confirmado"
      ],
      "targetComponents": [
        "Configuracion de enrutado/redirecciones del sitio (301 hacia /cerraduras/)",
        "Script de resolucion de canibalizacion ya aprobado (referenciado en la evidencia como O29.1, ruta/nombre exacto no verificable por mi)",
        "Contenedor GTM y su version live (fuera de WordPress)",
        "Configuracion de eventos y conversiones en GA4 (click_phone, click_catalog_download, view_quote_page, view_contact_page)",
        "Segmentos/filtros de informes de GA4 (trafico referral)",
        "Bloque de contenido on-page (H1/H2, cuerpo, enlazado interno) de paginas de producto/servicio existentes",
        "Campos meta title/description (Yoast SEO) de multiples paginas",
        "Contenido nuevo de landing sectorial 'hotel' (pendiente de redaccion por content-strategist)"
      ],
      "proposedChanges": [
        {
          "description": "Verificar el estado real de la redireccion 301 desde /cerraduras/ y corregir el enrutado si sigue roto, confirmando ademas si el pipeline de SEO Watcher respeta el catalogo de clusters al generar actionItems sobre esa URL.",
          "rationale": "Responde a la recomendacion aprobada 'Confirmar y desbloquear la correccion ya aprobada del enrutado roto hacia /cerraduras/': una persona ya aprobo esta correccion el 2026-08-16, pero el run de SEO Watcher de hoy sigue generando actionItems sobre la misma URL, lo que sugiere que no se aplico o no se verifico.",
          "targetPageOrComponent": "https://zentrylockers.com/cerraduras/ (enrutado/redirecciones)"
        },
        {
          "description": "Confirmar con el responsable humano (Pau) si la version live del contenedor GTM, nombrada 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau)', esta realmente publicada en produccion; publicarla o revertirla segun corresponda tras esa confirmacion.",
          "rationale": "Responde a la recomendacion aprobada 'Verificar si la version live de GTM esta realmente publicada antes de confiar en los datos de conversion': el propio nombre de la version contradice su estado reportado como live, lo que pone en duda toda conclusion de conversion de esta pasada.",
          "targetPageOrComponent": "Contenedor GTM (sistema externo a WordPress)"
        },
        {
          "description": "Tras resolver el estado de publicacion de GTM (cambio anterior), ejecutar una prueba en GA4 DebugView para confirmar si el trigger/tag click_phone dispara correctamente el evento clave de contacto.",
          "rationale": "Responde a la recomendacion aprobada 'Validar en GA4 DebugView el disparo real de click_phone (accion ya aprobada, aun sin resolver)': ya fue aprobada el 2026-08-16 pero sigue en 0 ocurrencias pese a tag y trigger activos.",
          "targetPageOrComponent": "Evento GA4 click_phone / tag GTM asociado"
        },
        {
          "description": "Ejecutar el script ya aprobado que resuelve la canibalizacion entre 'taquillas melamina' y 'taquillas de melamina', consolidando el trafico de esas keywords genericas sobre /taquillas-melamina/ y cerrando los actionItems que siguen apuntando a /taquillas-melamina-fenolico/.",
          "rationale": "Responde a la recomendacion aprobada 'Cerrar la canibalizacion taquillas melamina/de melamina via el script ya aprobado (O29.1)': aprobada el 2026-08-16, pero el run de hoy sigue generando 2 actionItems sobre la URL incorrecta.",
          "targetPageOrComponent": "https://zentrylockers.com/taquillas-melamina-fenolico/ y https://zentrylockers.com/taquillas-melamina/"
        },
        {
          "description": "Reforzar la estructura H1/H2, ampliar la profundidad del contenido, mejorar el enlazado interno y actualizar meta title/description de la pagina de cerraduras inteligentes para taquillas, con el objetivo de mover la keyword de posicion ~20.4 a top10.",
          "rationale": "Responde a la recomendacion aprobada 'Ejecutar el on-page del quick win cerraduras inteligentes para taquillas (posicion 20.4)': aprobada el 2026-08-16, pero los datos live de hoy muestran que sigue en la misma posicion, indicando que el trabajo aun no se aplico.",
          "targetPageOrComponent": "https://zentrylockers.com/cerraduras-inteligentes-taquillas/"
        },
        {
          "description": "Auditar el conjunto de paginas con CTR reportado en 0.00% pese a impresiones reales (20-83 en el periodo) y reescribir en bloque sus meta title/description para mejorar el snippet en resultados de busqueda.",
          "rationale": "Responde a la recomendacion aprobada 'Reescribir en bloque titles/meta descriptions de las paginas con CTR 0% (accion ya aprobada)': aprobada el 2026-08-16, el run de hoy sigue mostrando el mismo patron en multiples paginas.",
          "targetPageOrComponent": "Conjunto de paginas con CTR 0% (identidad exacta de cada URL no listada en este contexto)"
        },
        {
          "description": "Intervenir en una sola pasada el contenido on-page de /taquillas-para-hospitales/ para reforzar simultaneamente las keywords 'comprar taquillas para hospitales' (posicion 10.6, cerca del top10) y 'taquillas para hospital' (posicion 17.1): mejorar H1/H2, profundidad de contenido, enlazado interno y meta title/description.",
          "rationale": "Responde a la recomendacion aprobada 'Ejecutar los quick wins on-page en /taquillas-para-hospitales/ (propuesta nueva, sin decision humana registrada)'. A diferencia de las anteriores, esta propuesta NO tiene aprobacion humana previa registrada en este contexto y requiere esa aprobacion antes de cualquier trabajo.",
          "targetPageOrComponent": "https://zentrylockers.com/taquillas-para-hospitales/"
        },
        {
          "description": "Revisar en la configuracion de GA4 si los eventos click_catalog_download, view_quote_page y view_contact_page estan marcados como conversion, dado que se disparan (4, 12 y 39 veces respectivamente) pero registran 0 conversiones, a diferencia de otros eventos de CTA equivalentes.",
          "rationale": "Responde a la recomendacion aprobada 'Confirmar que click_catalog_download, view_quote_page y view_contact_page esten marcados como conversion en GA4', que depende a su vez del resultado de la verificacion de publicacion de GTM.",
          "targetPageOrComponent": "Configuracion de eventos/conversiones en GA4"
        },
        {
          "description": "Revisar el cluster SEO y la intencion real de busqueda de 'hotel' frente a 'hoteles' antes de redactar o publicar la landing sectorial nueva propuesta por content-strategist, para evitar canibalizacion entre ambas keywords.",
          "rationale": "Responde a la recomendacion aprobada 'Resolver el riesgo de canibalizacion hotel/hoteles antes de redactar o publicar la landing sectorial de hotel', en linea con la practica ya aprobada de cerrar canibalizaciones similares (taquillas melamina).",
          "targetPageOrComponent": "Landing sectorial nueva 'hotel' (contenido pendiente de redaccion, pagina no confirmada existente)"
        },
        {
          "description": "Crear un filtro o segmento en la configuracion de informes de GA4 que excluya o segmente el trafico clasificado como Referral desde tagassistant.google.com.",
          "rationale": "Responde a la recomendacion aprobada 'Segmentar o excluir el trafico referral de tagassistant.google.com en los informes de GA4': aporta 3 sesiones y 2 conversiones en el periodo y probablemente es trafico interno de QA/pruebas contaminando los informes.",
          "targetPageOrComponent": "Configuracion de informes/segmentos en GA4"
        }
      ],
      "filesOrSystemsAffected": [
        "Configuracion de redirecciones/enrutado de WordPress (plugin o mecanismo exacto sin confirmar)",
        "Script de resolucion de canibalizacion ya aprobado (existencia y ubicacion exacta no verificable por mi en este contexto)",
        "Contenedor y version del sistema de gestion de etiquetas GTM (sistema externo a WordPress)",
        "Configuracion de eventos y conversiones de GA4 (sistema externo a WordPress)",
        "Contenido de paginas en WordPress (bloques Gutenberg): estructura de encabezados, cuerpo de texto y enlazado interno",
        "Campos meta title/description gestionados por el plugin SEO instalado (asumido Yoast por el naming de campos en el contrato, pero su instalacion real no esta confirmada en este contexto)",
        "Contenido nuevo de la landing sectorial 'hotel' (pagina y estructura aun no existentes de forma confirmada)"
      ],
      "acceptanceCriteria": [
        "La URL /cerraduras/ redirige (301) correctamente a la URL de destino correcta y el siguiente run de SEO Watcher deja de generar actionItems sobre ella",
        "Un humano con acceso a GTM confirma explicitamente si la version 'O44' esta publicada o no, y el nombre de la version deja de contener el texto 'sin publicar, pendiente aprobacion Pau' una vez resuelto",
        "GA4 DebugView registra al menos un evento click_phone tras una interaccion de prueba, o se documenta la causa raiz concreta por la que no se dispara",
        "Los actionItems de canibalizacion sobre /taquillas-melamina-fenolico/ para las keywords 'taquillas melamina'/'taquillas de melamina' desaparecen en el siguiente run de SEO Watcher tras ejecutar el script aprobado",
        "La pagina de cerraduras inteligentes para taquillas incorpora H1/H2 reforzados, contenido ampliado, enlazado interno adicional y meta title/description actualizados, verificables antes de publicar",
        "Cada pagina identificada con CTR 0% tiene un meta title/description nuevo y distinto del actual, redactado para mejorar el snippet en SERP",
        "La pagina /taquillas-para-hospitales/ refleja mejoras on-page para ambas keywords en una sola intervencion, sin duplicar contenido",
        "Los tres eventos citados (click_catalog_download, view_quote_page, view_contact_page) quedan explicitamente marcados como conversion en GA4, o se documenta por que no deben marcarse asi",
        "Existe una decision documentada sobre el cluster hotel/hoteles antes de que content-strategist redacte o publique la landing 'hotel'",
        "El trafico de tagassistant.google.com queda excluido o segmentado en al menos un informe de referencia de GA4"
      ],
      "validationPlan": [
        "Esta pasada no incluye stagingQaResult ni inventario de staging legible (fetch failed en staging.zentrylockers.com tras 3 intentos): antes de cualquier otra validacion, repetir la lectura del inventario de staging hasta obtener una respuesta valida",
        "Una vez disponible el inventario de staging, contrastar cada URL citada en este documento contra ese inventario para confirmar su existencia real y su version actual (versionHash) antes de tocar nada",
        "Para los cambios de enrutado y canibalizacion, verificar en el siguiente run de SEO Watcher que los actionItems correspondientes ya no se generan",
        "Para el cambio de GTM, obtener confirmacion explicita y trazable (mensaje, ticket o similar) de la persona responsable (Pau) sobre el estado de publicacion antes de dar el tema por cerrado",
        "Para click_phone, revisar GA4 DebugView en tiempo real con una interaccion de prueba manual sobre el enlace de telefono en staging",
        "Para los cambios de contenido on-page y meta, revisar visualmente en staging tras aplicar los cambios y confirmar que el H1/H2, el contenido y las metas reflejan lo especificado antes de considerar el cambio listo para produccion",
        "Para los cambios de configuracion GA4 (conversiones, segmentos), verificar en la interfaz de administracion de GA4 que la configuracion nueva aparece activa"
      ],
      "rollbackPlan": [
        "Antes de cualquier cambio de contenido o meta, guardar una copia integra del post_content, title, excerpt y meta actuales de cada pagina afectada como referencia de reversion",
        "Si la correccion de enrutado introduce un bucle de redireccion o rompe otras URLs, revertir a la regla de redireccion anterior documentada en el catalogo de clusters",
        "Si la ejecucion del script de canibalizacion produce resultados inesperados, revertir manualmente los cambios de enrutado/consolidacion usando la copia de estado previo",
        "Si la publicacion de la version GTM introduce errores de tracking, despublicar esa version y restaurar la version live anterior conocida",
        "Si el marcado de eventos como conversion en GA4 distorsiona metricas historicas, revertir la configuracion de conversion a su estado anterior",
        "Si el contenido on-page nuevo o modificado no pasa la revision visual/de copy, restaurar el contenido guardado antes del cambio y no promoverlo a produccion"
      ],
      "dependencies": [
        "Relectura exitosa del inventario de staging de staging.zentrylockers.com, actualmente no disponible por fallo de red",
        "Confirmacion humana independiente de que las 5 correcciones aprobadas el 2026-08-16 se ejecutaron o no: la evidencia de esa aprobacion es autorreferencial dentro de este contexto (asi lo senala QA) y ademas los datos live de hoy sugieren que no se aplicaron",
        "Acceso de la persona responsable (Pau) para confirmar el estado de publicacion de la version live de GTM",
        "Aprobacion humana nueva para la recomendacion de /taquillas-para-hospitales/, que no tiene decision previa registrada en este contexto",
        "Confirmacion de que el script de resolucion de canibalizacion referenciado en la evidencia existe, esta accesible y es seguro de ejecutar (su ruta/nombre exacto no puede verificarse desde este contexto)",
        "Confirmacion de que plugin(s) de SEO y de redirecciones estan realmente instalados y configurados en el sitio -- ver noPluginThemeApiInventoryNotice, ningun plugin puede darse por instalado",
        "Resultado de la verificacion del estado de GTM antes de tratar como confiables los datos de click_phone y de conversiones de click_catalog_download/view_quote_page/view_contact_page"
      ],
      "risks": [
        "Actuar sobre paginas cuya existencia real no esta confirmada (confirmedExistingPageUrls vacio en esta pasada) puede llevar a modificar la pagina equivocada o a proponer cambios sobre una URL que ya no existe",
        "Sin inventario de staging legible, no hay forma de calcular un BEFORE fiable ni un hash de version, lo que impide cualquier ejecucion determinista en esta pasada",
        "Republicar o despublicar la version de GTM sin la aprobacion explicita de la persona responsable (Pau) podria romper tracking en produccion de forma mas amplia que el problema que se intenta resolver",
        "Si las 5 correcciones aprobadas el 2026-08-16 en realidad si se aplicaron pero el pipeline de origen de datos (SEO Watcher, GA4) tiene latencia o cache, repetir el trabajo seria redundante -- por eso la verificacion debe preceder a cualquier reejecucion",
        "Modificar en bloque metas de multiples paginas sin verificar primero cada URL contra el inventario real puede generar cambios sobre paginas incorrectas o inexistentes",
        "Marcar eventos como conversion en GA4 sin entender el diseno de funnel completo podria distorsionar metricas historicas de conversion",
        "Publicar la landing sectorial 'hotel' sin resolver antes la canibalizacion con 'hoteles' repetiria el mismo patron de canibalizacion ya identificado en taquillas melamina"
      ],
      "approvalRequired": true,
      "unknowns": [
        "Si las paginas https://zentrylockers.com/cerraduras/, /taquillas-melamina-fenolico/, /taquillas-melamina/, /cerraduras-inteligentes-taquillas/ y /taquillas-para-hospitales/ existen realmente hoy y en que estado, dado que confirmedExistingPageUrls y stagingInventory vienen vacios en esta pasada",
        "Identidad exacta (URLs concretas) de las paginas con CTR 0% que hay que reescribir -- la evidencia habla de 'multiples paginas' sin listarlas una a una",
        "Si el plugin/mecanismo de redirecciones y el plugin SEO (asumido Yoast por el naming de campos del contrato) estan realmente instalados en zentrylockers.com -- no hay inventario de plugins/temas/API en este proyecto",
        "Si el script scripts/o291-resolve-melamina-cannibalization.ts (o equivalente) existe realmente, en que estado esta y si es seguro ejecutarlo -- no puedo confirmar rutas de repositorio",
        "Si la version live de GTM 'O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau)' esta realmente publicada o no -- solo un humano con acceso a GTM puede confirmarlo",
        "Si las 5 correcciones aprobadas el 2026-08-16 se llegaron a ejecutar alguna vez: la unica evidencia disponible es la propia decision humana registrada, y los datos live de hoy sugieren que no se aplicaron, pero no hay confirmacion tecnica independiente",
        "Si la keyword 'hotel' tiene intencion de busqueda realmente distinta de 'hoteles' o si ambas deberian consolidarse en una sola pagina -- content-strategist la marca como pendiente de revision manual",
        "Si la landing sectorial 'hotel' propuesta por content-strategist ya existe en algun estado de borrador o es contenido completamente nuevo"
      ],
      "changePlans": []
    },
    "changePlans": [],
    "previousCorrections": []
  }
}
```

Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional. `reviewedArtifact` en tu salida debe ser EXACTAMENTE `context.identity` de arriba.

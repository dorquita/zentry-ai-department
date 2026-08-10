# Postmortem — Calidad visual/CRO del primer draft real (Fase O13.6a)

## Que paso

El primer draft real creado en produccion (pagina 1960, Fase O13.3) paso
todas las comprobaciones automaticas del sistema (QA tecnico, Visual QA
de imagen) y aun asi el resultado fue una pagina pobre: texto plano sin
bloques visuales, CTAs como simples enlaces de texto dentro de una
lista, contenido generico, sin aspecto de landing pensada para
convertir.

## Diagnostico: que agente fallo

**Ningun agente individual "fallo"** en el sentido de tener un bug — el
fallo es de **arquitectura**: existia una pieza que resolvia
exactamente este problema, pero nunca estaba conectada al camino real.

- **`src/core/visual-templates.ts`** (Fase O12.4) ya definia un catalogo
  completo de 5 plantillas de landing (hero, CTA, bloques de
  beneficios, materiales/productos, FAQ, CTA final, notas de
  Kadence/Gutenberg).
- **`src/agents/visual-template-builder.ts`** (Fase O12.4) ya sabia
  mapear cualquier change pack sobre esa plantilla... **pero el
  resultado era solo un fichero markdown de PREVIEW** para que un
  humano lo mirara — nunca se convertia en el HTML real que se enviaba
  a WordPress.
- **`src/agents/wordpress-draft-agent.ts`** — el agente que SI construye
  el HTML real (`buildWordpressContentHtml()`) nunca importaba ni leia
  nada de `visual-templates.ts`. Construia el contenido directamente
  desde los campos planos del change pack: `<h1>`, `<p>`, `<h2>` por
  cada H2, `<h3>`+`<p>` por cada FAQ. Cero bloques Gutenberg, cero
  botones, cero columnas. Verificado explicitamente: `grep` de
  "visual-templates"/"VisualTemplate" en `wordpress-draft-agent.ts`,
  `staging-executor.ts` y `production-draft-executor.ts` — **cero
  coincidencias** en los tres.

## Que validaciones faltaban

`src/agents/staging-qa-agent.ts` (el QA tecnico) comprobaba:
titulo presente, contenido no vacio, algun `<form>` ausente, status
`draft`, un enlace interno, y un **CTA detectado por heuristica de
palabras clave** (`hasCta = CTA_KEYWORDS.some(kw =>
lowerContent.includes(kw))` con palabras como "presupuesto",
"contacto"). Esta heuristica se satisface con la simple PALABRA
"presupuesto" en cualquier parte del texto — no comprueba si existe un
boton real, cuantos hay, si hay algun bloque visual, ni la estructura
de encabezados mas alla de que el titulo no este vacio.

Ninguna comprobacion existente media: numero de botones reales, numero
de bloques visuales (columnas/imagenes/botones Gutenberg), si hay un
CTA antes del primer H2 ("above the fold"), longitud minima de
contenido, ni la presencia de texto de placeholder editorial sin
resolver visible para el usuario final.

## Por que el QA tecnico dejo pasar una landing pobre

Porque estaba diseñado para detectar **fallos de INTEGRIDAD** (¿la
pagina existe? ¿tiene titulo? ¿sigue en draft? ¿no hay un `<form>`
inesperado?) — nunca fue diseñado para juzgar **calidad visual/CRO**.
Es un QA "tecnico" en el sentido estricto: verifica que el sistema hizo
lo que se le pidio sin romper nada, no que lo que se le pidio produzca
una buena landing. Faltaba una capa de QA especifica para eso — que es
exactamente lo que se añade en esta fase.

## La correccion (Fase O13.6b)

1. **`UX/UI Landing Architect`** (nuevo agente,
   `src/agents/ux-ui-landing-architect.ts`) — corre ANTES que WordPress
   Draft Agent. Convierte cada change pack en un `LandingBlueprint`
   CONCRETO (no solo un preview): hero, CTA principal, CTA secundario,
   bloques de beneficios, cards, secciones por intencion de busqueda,
   FAQ (reescrita si detecta placeholder), CTA final, enlaces internos
   reales, jerarquia visual, tipo de plantilla. `data/landing-blueprints.jsonl`.
2. **`buildWordpressContentHtml()` reescrita** para consumir ese
   blueprint y generar bloques Gutenberg REALES: `wp:buttons`/`wp:button`
   para cada CTA, `wp:columns` para beneficios y materiales/productos,
   secciones H2 con contenido siempre no vacio. Sin blueprint (no
   deberia pasar para change packs nuevos), cae al comportamiento plano
   anterior por compatibilidad.
3. **Checklist QA visual/SEO/CRO obligatoria** (`checkLandingQuality()`
   en `staging-qa-agent.ts`): minimo 2 botones reales, minimo 3 bloques
   visuales, CTA above the fold, estructura H1 unico + 2+ H2, contenido
   >= 400 caracteres, sin placeholders, aviso (no bloqueante) ante
   claims/cifras sospechosas.
4. **Bloqueo de promocion a produccion**: `production-deployment-planner.ts`
   ahora exige `qaForThis.overallPass` (tecnico) **Y**
   `qaForThis.landingQa.pass` (visual/SEO/CRO) antes de proponer un plan
   de deploy. Verificado con datos reales en esta misma fase: el draft
   de staging 1959 (contenido antiguo, previo a esta correccion) paso a
   quedar **excluido** de nuevos planes de produccion por primera vez
   (`omitidos_sin_qa_pass` paso de 0 a 1 en la misma pasada de
   `growth:daily` donde se aplico el fix) -- confirma que el gate
   funciona exactamente sobre el mismo tipo de contenido que causo este
   postmortem.

## Como evitara que vuelva a pasar

- **Estructuralmente**: ya no es posible que un change pack llegue a
  WordPress sin pasar primero por el Architect (esta wireado en el
  pipeline, no es opcional).
- **Con gate real, no solo advertencia**: un draft que no cumple la
  checklist visual/SEO/CRO nunca llega a proponerse como plan de deploy
  a produccion — se queda contado en `omitidos_sin_qa_pass`, visible en
  cada informe diario.
- **Verificado con un caso real conocido**: el mismo draft que origino
  esta investigacion (1959/1960) es precisamente el que el nuevo gate
  bloquea hoy, sin necesitar tocarlo ni republicarlo.

## Limitaciones conocidas (honestidad, no todo es mecanico)

- La deteccion de "claims inventados" es una heuristica de patrones
  (garantias/plazos/porcentajes especificos) — genera un AVISO, nunca un
  bloqueo automatico, porque no hay forma fiable de verificar
  mecanicamente si una cifra es real o inventada.
- El copy generico que rellena secciones vacias (materiales, precios,
  entrega) es seguro (no fabrica cifras) pero sigue siendo generico por
  diseño — la especificidad real (medidas exactas, plazos reales,
  condiciones de garantia) sigue necesitando input humano/de negocio,
  algo que ninguna automatizacion puede inventar sin arriesgarse a un
  claim falso.

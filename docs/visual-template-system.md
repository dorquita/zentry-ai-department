# Visual Template System (Fase O12.4)

## Por que existe

Hasta la Fase O12.3, un preview de WordPress Draft Agent era texto plano
(titulo, meta, H1/H2, copy, FAQs) sin ninguna estructura de layout. La
Fase O12.4 anade una capa de PLANIFICACION VISUAL sobre eso: 5 plantillas
que definen que bloques deberia tener una pagina y en que orden, pensadas
para Kadence Blocks + Gutenberg (el theme/page builder real del sitio,
ver `README.md`). Esta fase **no genera HTML final ni toca WordPress** —
solo produce un preview local mas rico (`reports/wordpress-drafts/previews/<draftId>-visual.md`)
y dejar documentado, plantilla a plantilla, como se construiria la pagina
el dia que un humano (o un futuro modo `APPLY`) la implemente de verdad.

## Las 5 plantillas

Definidas en `src/core/visual-templates.ts` (`VISUAL_TEMPLATES`), cada
una con: hero, imagen destacada, bloque de beneficios, bloque de
materiales/productos, bloque de cerraduras inteligentes (condicional),
FAQs, CTA final, notas de enlaces internos, schema recomendado y notas de
diseno Kadence/Gutenberg.

| Plantilla | Cuando se usa | Bloque central distintivo |
|---|---|---|
| `sector_landing` | Keyword/pagina menciona un sector B2B (colegio, gimnasio, hotel...) | Modelos recomendados PARA ese sector |
| `product_landing` | Keyword/pagina menciona un material (melamina, fenolica, metalica, madera) | Tabla de modelos/medidas/acabados |
| `seo_landing` | Ajuste on-page generico sin sector/material dominante (el caso mas comun hoy) | Ninguno — plantilla deliberadamente simple |
| `comparison_landing` | Keyword implica decidir entre 2+ opciones ("vs", "cual elegir"...) | Tabla comparativa lado a lado |
| `blog_article` | Brief editorial informativo, sin intencion transaccional clara | Puntos clave (no beneficios de venta) |

## Seleccion automatica de plantilla

`selectVisualTemplate(changePack)` en `src/core/visual-templates.ts` es
una heuristica simple y explicable (nunca un modelo/IA):

1. ¿La keyword sugiere comparativa? -> `comparison_landing`.
2. ¿Es un brief editorial (`new_content_page`/`content_update`) sin
   sector B2B detectado? -> `blog_article`.
3. ¿Menciona un sector B2B conocido? -> `sector_landing`.
4. ¿Menciona un material conocido? -> `product_landing`.
5. Por defecto -> `seo_landing`.

## El bloque "cerraduras inteligentes" (cross-sell Zentry <-> Tukandado)

Solo se incluye cuando `changePack.brandIntent` es `zentry_locker_core` o
`mixed_cross_sell` (nunca si es `tukandado_lock_core` puro, para no
repetir el mensaje de la propia marca). La logica vive en
`smartLocksBlockApplies()`, duplicada deliberadamente en
`src/agents/visual-template-builder.ts` y `src/agents/visual-asset-planner.ts`
(mismo patron de pequenas funciones autocontenidas que el resto del
proyecto, ver `[[feedback_...]]` sobre duplicacion intencional).

## Imagenes: siempre placeholder en esta fase

Cada slot de imagen (`VisualImageSlot`) tiene un `placeholderNote` y unas
`dimensions` — nunca una imagen real. El preview visual muestra un bloque
`🖼️ [Imagen — <proposito>, <ancho>x<alto>px]` con la nota de que
representaria esa imagen. La propuesta CONCRETA de que imagen generar
(prompt, negative prompt, alt text...) es responsabilidad de un agente
SEPARADO, `src/agents/visual-asset-planner.ts` (ver
`docs/asset-generation-workflow.md`) — deliberadamente desacoplado del
Visual Template Builder para que el orden de ejecucion de los dos no
importe.

## Visual Template Builder Agent

`src/agents/visual-template-builder.ts` (`npm run visual-templates:build`):

1. Lee change packs elegibles (`ready_for_review`/`approved_to_execute`,
   mismo criterio que el WordPress Draft Agent).
2. Para cada uno que YA tenga un preview de texto (`data/wordpress-drafts.jsonl`,
   creado por el WordPress Draft Agent) — si todavia no lo tiene, se
   salta y se cuenta en `skippedNoDraftYet` (se recogera en la siguiente
   pasada diaria, tras el paso 16).
3. Selecciona la plantilla, reutiliza `extractPreviewFields()` (Fase O10,
   la MISMA funcion que ya usa el WordPress Draft Agent — no se duplica
   la logica de extraer titulo/copy/H2/FAQs/CTA/enlaces del change pack).
4. Escribe `reports/wordpress-drafts/previews/<draftId>-visual.md` —
   un fichero NUEVO, nunca sobrescribe `<draftId>.md` (el preview de
   texto original).

No llama a WordPress en ningun momento. No genera ninguna imagen real.

## Ver tambien

- `docs/asset-generation-workflow.md` — como se propone (nunca se genera
  todavia) cada imagen.
- `docs/n8n-asset-webhook-contract.md` — el contrato futuro con n8n.
- `docs/wordpress-draft-agent.md` — el preview de texto original que este
  sistema complementa.

# UX/UI Landing Architect Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.
**Fase:** O13.6b (postmortem de calidad visual, ver `docs/postmortem-landing-quality.md`)

## 1. Rol del agente

Convierte cada change pack en una estructura visual de landing CONCRETA
(`LandingBlueprint`) ANTES de que WordPress Draft Agent escriba ningun
HTML. Es el eslabon que faltaba entre "tenemos un catalogo de
plantillas" (Fase O12.4) y "el HTML real usa ese catalogo" — antes de
esta fase, esa conexion no existia.

## 2. Responsabilidad (que define)

- **Hero**: headline + subtitulo, usando la plantilla visual
  correspondiente (`src/core/visual-templates.ts`, 5 tipos).
- **CTA principal**: label + destino (URL real si el change pack la
  aporta, ancla generica si no).
- **CTA secundario**: solo si aplica cross-sell Zentry/Tukandado.
- **Bloques de beneficios**: 3 items, copy generico pero nunca
  fabricado (nunca cifras/plazos inventados).
- **Cards**: materiales/productos relevantes.
- **Secciones por intencion de busqueda**: cada H2 del change pack se
  clasifica (informational/transactional/comparison/commercial) y
  SIEMPRE lleva un parrafo real (nunca vacio -- causa raiz del
  postmortem).
- **FAQ**: reescribe cualquier respuesta que parezca placeholder
  editorial por una respuesta generica pero publicable.
- **CTA final**, **enlaces internos** (solo URLs reales, nunca
  fabricadas, mismo criterio que Fase O12.2), **jerarquia visual**
  (notas), **tipo de plantilla**.

## 3. Reglas (no negociables)

- Cero llamadas a WordPress/produccion/n8n/qdrant/Ads/GA4/GTM.
- Nunca fabrica cifras, garantias o plazos concretos que no esten ya en
  el change pack de origen.
- `data/landing-blueprints.jsonl` append-only, dedup por
  `changePackId` (nunca dos blueprints activos para el mismo change
  pack).

## 4. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre ANTES de
WordPress Draft Agent (paso 16 de 26) — su output (`LandingBlueprint`)
lo consume `buildWordpressContentHtml()` en
`src/agents/wordpress-draft-agent.ts` para construir HTML con bloques
Gutenberg reales (botones, columnas) en vez de texto plano.

## 5. CLI

```bash
npm run ux-ui-landing:plan
```

## 6. Responsabilidades finales por agente (Fase O13.6a, postmortem)

| Agente | Responsabilidad |
|---|---|
| **SEO Director** | Prioriza QUE keywords/paginas atacar. Nunca decide como se ve la pagina. |
| **Content Strategist** (Content Planner + Work Order Builders) | Decide QUE decir: title/meta/H1/H2/copy/FAQ en texto plano, sin estructura visual todavia. |
| **UX/UI Landing Architect** (este agente) | Decide COMO se organiza visualmente: hero/CTAs/bloques/cards/secciones/jerarquia — el output es el `LandingBlueprint`. |
| **WordPress Draft Agent** | Convierte el `LandingBlueprint` en HTML real (bloques Gutenberg). Ya NO decide estructura por si mismo — solo renderiza lo que dice el Architect (con fallback plano si no hay blueprint, por compatibilidad). |
| **Visual QA / CRO QA** (`checkLandingQuality()` en Staging QA Agent) | Verifica que el resultado CUMPLE la checklist obligatoria (botones, bloques, CTA above the fold, estructura, contenido, sin placeholders) — bloquea, no solo avisa. |
| **Growth Director** | Consolida y reporta — nunca decide contenido ni estructura, solo agrega lo que ya decidieron los demas. |

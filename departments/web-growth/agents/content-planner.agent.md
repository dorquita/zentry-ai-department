# Content Planner Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Convierte las oportunidades ya detectadas (SEO Watcher/Director,
Competitor Intelligence) en propuestas concretas de contenido, separando
siempre que es para Zentry, que es para Tukandado y que es mixto/cross-sell.

## 2. Objetivo

Leer los jobs del SEO Watcher, el plan del SEO Director y los gaps de
Competitor Intelligence, y proponer articulos, FAQs, bloques de landing,
mejoras de title/meta, enlaces internos y landings nuevas.

## 3. Entradas (solo lectura)

- `data/jobs.jsonl` — tareas del SEO Watcher (ultima ejecucion, por `meta.runId`).
- Logica del SEO Director (`buildActionPlan()` de `src/agents/seo-director.ts`,
  reutilizada directamente en memoria, no releida de su informe).
- `data/department-events.jsonl` — eventos `competitor_keyword_detected`
  de la ejecucion mas reciente de Competitor Intelligence.
- `src/core/brand-intent-router.ts` — para clasificar cada propuesta.

## 4. Reglas (no negociables)

- **Solo lectura y propuesta.** No escribe en WordPress, no publica nada.
- **No modifica produccion**, en ningun caso.
- **No toca Google Ads, GA4/GTM, n8n ni qdrant.**
- **No maneja secretos**: no necesita ninguna credencial.
- **Toda accion real requiere aprobacion humana** antes de ejecutarse.

## 5. Tipos de contenido que propone

| Tipo | Cuando |
|---|---|
| `new_landing` | Oportunidad `future_opportunity` (requiere contenido nuevo) o gap de sector/material de la competencia. |
| `article` | Keyword de competencia no cubierta, sin senal fuerte de SEM. |
| `landing_block` | Keyword de competencia no cubierta con senal fuerte de SEM (posible bloque destacado en landing existente). |
| `title_meta_improvement` | Oportunidad `low_ctr`. |
| `internal_link` | Oportunidad `quick_win`. |
| `faq` | Reservado para v2 (hoy no se genera automaticamente; util para revision manual). |

## 6. Como distingue Zentry / Tukandado / mixto

Cada propuesta pasa por `classifyOpportunity()`/`classifyKeyword()` del
[Brand/Intent Router](../../../docs/brand-intent-strategy.md) y se agrupa
en el informe bajo "Contenido para Zentry", "Contenido para Tukandado" o
"Contenido mixto / cross-sell", con la razon siempre visible.

## 7. Formato de salida

`reports/content-planner/content-planner-<fecha>.md`: resumen ejecutivo,
tres secciones por marca (Zentry / Tukandado / mixto), cada propuesta con
tipo, keyword relacionada, pagina relacionada (si aplica), por que, y
origen (`seo_watcher` / `seo_director` / `competitor_intelligence`).

## 8. Eventos que emite

`agent_started`, `recommendation_created` (por cada propuesta),
`warning_detected` (si no hay datos de Competitor Intelligence
disponibles), `agent_finished`.

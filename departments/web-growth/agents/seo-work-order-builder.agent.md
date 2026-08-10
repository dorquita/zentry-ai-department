# SEO Work Order Builder

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Amplia las work orders `draft` de categoria SEO (creadas por el Approved
Action Planner a partir de acciones `approved`) con un plan on-page
detallado, listo para revision humana. **Nunca toca WordPress.**

## 2. Que genera por cada work order SEO

- Pagina afectada y keyword principal.
- Intencion de busqueda (segun el [Brand/Intent Router](../../../docs/brand-intent-strategy.md)).
- Marca objetivo (Zentry / Tukandado / mixta) con la razon.
- Title SEO propuesto, meta description propuesta, H1, H2 sugeridos.
- Bloque de copy sugerido.
- FAQs sugeridas.
- Enlaces internos sugeridos.
- Schema sugerido (Product/Service/FAQPage segun el caso).
- Riesgo de canibalizacion: compara contra el resto del Action Backlog
  buscando otras acciones con keyword similar apuntando a una pagina
  distinta.
- Checklist de revision humana.

## 3. Reglas (no negociables)

- **Solo amplia work orders ya creadas** (status `draft`, categoria SEO).
  No crea work orders nuevas por su cuenta.
- **No toca WordPress.** No publica, no crea borradores, no modifica
  ninguna pagina.
- **No modifica produccion**, en ningun caso.
- **No maneja secretos.**
- Al terminar, pasa el status de la work order de `draft` a
  `ready_for_review` — sigue sin implicar ejecucion real.

## 4. Formato de salida

`reports/seo-work-orders/seo-work-orders-<fecha>.md`: una seccion por
work order ampliada, con todos los campos anteriores.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (por cada work order ampliada),
`agent_finished`.

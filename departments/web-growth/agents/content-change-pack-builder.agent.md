# Content Change Pack Builder Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.
**Fase:** Change Packs

## 1. Rol del agente

Convierte una work order de contenido ya detallada en un **change
pack**: el mismo brief (estructura, CTA, enlaces, cluster SEO), mas
pasos de implementacion, checklist de revision humana, riesgos y notas
de reversion. Sigue siendo un brief — nunca redacta el articulo final.

## 2. Objetivo

Leer `data/work-orders.jsonl`, filtrar work orders de categoria contenido
en estado `auto_prepared`/`ready_for_review`/`approved_to_prepare`, y
para cada una crear (si no existe ya, deduplicando por `workOrderId`) una
entrada en `data/change-packs.jsonl` con status inicial
`ready_for_review`. `changeType` es `new_content_page` para
`content:new_landing` y `content_update` para el resto.

## 3. Reglas (no negociables)

- **Solo crea change packs para work orders elegibles.** Nunca para
  `draft`/`rejected`/`applied_manually`/`superseded`.
- **No duplica.** Si una work order ya tiene change pack, no crea otro.
- **No redacta el articulo final ni escribe en WordPress**, en ningun
  estado.
- **No modifica produccion.** No toca WordPress, Google Ads, GA4/GTM,
  n8n ni qdrant.
- **No maneja secretos.**
- **`data/change-packs.jsonl` es append-only.**

## 4. Formato de salida

`reports/content-change-packs/content-change-packs-<fecha>.md`: resumen
ejecutivo, change packs nuevos, confirmacion de seguridad.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (uno por cada change pack
NUEVO), `agent_finished`.

## 6. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre junto con SEO y
CRO Change Pack Builder, despues de los Work Order Builders y antes de
Approval Gateway y Growth Director. Ver `docs/change-packs.md`.

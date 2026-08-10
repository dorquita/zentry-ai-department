# SEO Change Pack Builder Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.
**Fase:** Change Packs

## 1. Rol del agente

Convierte una work order SEO ya detallada en un **change pack**: el mismo
title/meta/H1/H2/copy/FAQs/enlaces/schema, mas pasos de implementacion
concretos, checklist de revision humana, riesgos y notas de reversion.
Un change pack es un nivel mas concreto que una work order — pensado
para el dia en que exista ejecucion controlada (modo `APPLY`), no para
ejecutar nada hoy.

## 2. Objetivo

Leer `data/work-orders.jsonl`, filtrar work orders de categoria SEO en
estado `auto_prepared`/`ready_for_review`/`approved_to_prepare`, y para
cada una crear (si no existe ya, deduplicando por `workOrderId`) una
entrada en `data/change-packs.jsonl` con status inicial
`ready_for_review`.

## 3. Reglas (no negociables)

- **Solo crea change packs para work orders elegibles.** Nunca para
  `draft`/`rejected`/`applied_manually`/`superseded`.
- **No duplica.** Si una work order ya tiene change pack, no crea otro —
  solo actualiza `updatedAt`.
- **No ejecuta nada real, en ningun estado**, ni siquiera
  `approved_to_execute`.
- **No modifica produccion.** No toca WordPress, Google Ads, GA4/GTM,
  n8n ni qdrant.
- **No maneja secretos.**
- **`data/change-packs.jsonl` es append-only.**

## 4. Formato de salida

`reports/seo-change-packs/seo-change-packs-<fecha>.md`: resumen
ejecutivo, change packs nuevos, confirmacion de seguridad.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (uno por cada change pack
NUEVO), `agent_finished`.

## 6. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre justo despues de
los 3 Work Order Builders (junto con Content y CRO Change Pack Builder) y
antes de Approval Gateway y Growth Director. Ver `docs/change-packs.md`.

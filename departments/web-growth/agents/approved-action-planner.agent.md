# Approved Action Planner Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Es el puente entre el Action Backlog y los Work Orders: detecta que
acciones ha aprobado un humano (`status: approved`) y crea el borrador
inicial de una work order por cada una, categorizada, lista para que los
Work Order Builders especializados (SEO/Content/CRO) la amplien con el
plan detallado.

## 2. Objetivo

Leer `data/action-backlog.jsonl`, filtrar acciones `approved`, y para
cada una crear (si no existe ya, deduplicando por `actionId`) una entrada
en `data/work-orders.jsonl` con status inicial `draft`.

## 3. Categorias

| Categoria | actionType (prefijo) | Quien la amplia despues |
|---|---|---|
| SEO page improvement | `seo:` | SEO Work Order Builder |
| Content creation | `content:` | Content Work Order Builder |
| CRO improvement | `cro:` | CRO Work Order Builder |
| SEM recommendation | `sem:` o `competitor:keyword_gap_sem` | (sin builder dedicado; contenido definitivo desde aqui) |
| Analytics validation | `analytics:` | (sin builder dedicado; contenido definitivo desde aqui) |
| Competitor gap | `competitor:` (resto) | (sin builder dedicado; contenido definitivo desde aqui) |

## 4. Reglas (no negociables)

- **Solo crea work orders para acciones `approved`.** Nunca para
  `new`/`open`/`waiting_approval`/`rejected`/`snoozed`/`done`.
- **No duplica.** Si una accion `approved` ya tiene work order, no crea
  otra — solo actualiza `updatedAt` (`touchWorkOrder`).
- **No ejecuta nada real.** Ni siquiera para las categorias sin builder
  dedicado (SEM/Analytics/Competencia): el contenido que genera son
  checklists y recordatorios, nunca acciones.
- **No modifica produccion**, en ningun caso.
- **No toca WordPress, Google Ads, GA4/GTM, n8n ni qdrant.**
- **No maneja secretos.**
- **`data/work-orders.jsonl` es append-only.**

## 5. Formato de salida

`reports/approved-action-planner/approved-action-planner-<fecha>.md`:
resumen ejecutivo, tabla por categoria, work orders nuevas, work orders ya
planificadas anteriormente, confirmacion de seguridad.

## 6. Eventos que emite

`agent_started`, `action_proposed` (una vez por cada work order NUEVA),
`agent_finished`.

## 7. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), justo despues de este
agente corren el SEO/Content/CRO Work Order Builder, que buscan las work
orders `draft` de su categoria y las amplian con el plan detallado
(pasando su status a `ready_for_review`). Ver
`docs/work-orders.md`.

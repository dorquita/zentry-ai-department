# [TECNICO] Informe diario — Web & Growth Department — 2026-08-10

> Este es el informe tecnico interno (IDs, estados, work orders, change packs, agentes, trazabilidad). El informe para el responsable del departamento es el ejecutivo del mismo dia (`reports/daily/executive-<fecha>.md`), que es el que se envia por email.

- **departmentRunId:** `growth-department-2026-08-10T125242Z`
- **Generado:** 2026-08-10T12:52:59.692Z

## Resumen ejecutivo

El departamento Web & Growth analizo datos reales de Search Console, priorizó acciones, reviso a la competencia, propuso contenido y mejoras de conversion, y reviso el estado de SEM/Analytics. Se detectaron **14** acciones SEO priorizadas (**10** Zentry, **0** Tukandado, **4** mixtas), **0** oportunidad(es) de competencia, **0** propuesta(s) de contenido y **0** landing(s) revisada(s) para CRO. El departamento sigue trabajando solo en analisis, planificacion y work orders (nivel AUTO_PLAN, Fase O7) sin pedir nada a Pau; desde la Fase O8, solo interrumpe por Telegram cuando algo se acerca a produccion real. Ningun cambio real se ha ejecutado — eso sigue exigiendo aprobacion humana explicita, sin excepcion.

## Que ha hecho cada agente

- **staging-executor**: completado — Staging Executor Agent finalizado: 0 ejecucion(es) aplicada(s), 0 pendiente(s) de aprobacion
- **staging-qa-agent**: completado (4 warning(s)) — Staging QA Agent finalizado: 5/6 borrador(es) pasan (5 con warning)
- **approval-gateway**: completado — Approval Gateway Agent finalizado: 0 solicitud(es) nueva(s), 0 enviada(s) por Telegram
- **production-deployment-planner**: completado — Production Deployment Planner finalizado: 0 plan(es) nuevo(s), 6 en total. Produccion no tocada.
- **production-draft-executor**: completado — Production Draft Executor finalizado: 0 pendiente(s) nueva(s), 0 aplicada(s), canAttemptRealWrites=false.
- **seo-watcher**: completado — seo-watcher: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **seo-director**: completado — seo-director: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **competitor-intelligence**: completado — competitor-intelligence: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **content-planner**: completado — content-planner: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **cro-landing-reviewer**: completado — cro-landing-reviewer: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **sem-watcher**: completado — sem-watcher: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **analytics-watcher**: completado — analytics-watcher: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **approval-queue**: completado — approval-queue: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **approved-action-planner**: completado — approved-action-planner: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **seo-work-order-builder**: completado — seo-work-order-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **content-work-order-builder**: completado — content-work-order-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **cro-work-order-builder**: completado — cro-work-order-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **seo-change-pack-builder**: completado — seo-change-pack-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **content-change-pack-builder**: completado — content-change-pack-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **cro-change-pack-builder**: completado — cro-change-pack-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **wordpress-draft-agent**: completado — wordpress-draft-agent: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **visual-template-builder**: completado — visual-template-builder: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **visual-asset-planner**: completado — visual-asset-planner: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.
- **growth-director**: iniciado (sin finalizar) — Growth Director Agent iniciado

## Autonomia (Fase O7) — que decidio el sistema solo hoy

Auto-procesadas: **0** · Auto-aprobadas para planificacion: **0** · Pendientes de aprobacion humana: **5** · Bloqueadas: **0**. Ver `docs/autonomy-policy.md` para el detalle completo de la politica y como cambiarla.

## Acciones auto-procesadas hoy (AUTO_INTERNAL) (0)

Mecanica interna del propio sistema (dedup, priorizacion, informes) — no son recomendaciones sobre las que decidir.

Ninguna.

## Acciones auto-aprobadas para planificacion hoy (AUTO_PLAN) (0)

SEO/contenido/CRO/SEM/Analytics/competencia de riesgo bajo o medio: el sistema ya las convirtio (o las convertira en el siguiente paso) en una work order, sin esperar aprobacion. Nunca implica ejecucion real.

Ninguna.

## Pendientes de aprobacion humana (5)

Acciones que tocarian produccion real (WordPress, Ads, GA4, GTM...) si se ejecutaran. Hoy ningun agente genera este tipo, pero la politica ya esta lista para cuando exista.

- [high] `19599263-9e05-4bca-8d6a-761cf54f3aad` SEO: "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 36 vez/veces)
- [high] `4bdbbe6e-743a-40df-822f-615935e57cfa` Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 36 vez/veces)
- [high] `ef7a3825-b95f-4942-a4dc-46faed0d825e` Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 57 vez/veces)
- [high] `1a0e540c-8785-482b-9be2-217c5d6fe818` SEO: "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 21 vez/veces)
- [high] `b764c03e-3b88-441f-aa88-117d45d97e21` CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 21 vez/veces)

## Acciones bloqueadas (0)

Nivel FORBIDDEN de la politica de autonomia: nunca se auto-ejecutan ni se auto-preparan, necesitan una decision explicita fuera de este sistema.

Ninguna.

## Acciones nuevas detectadas hoy (0)

Primera vez que se detectan Y sin clasificacion de autonomia todavia (caso raro — casi siempre caeran en alguna de las categorias de arriba).

Ninguna.

## Acciones repetidas / recurrentes sin clasificar (0)

Ya se habian detectado en pasadas anteriores y siguen en 'open' sin que la politica las haya reclasificado todavia (caso raro tras la Fase O7).

Ninguna.

## Aprobadas por un humano pero todavia no ejecutadas (1)

Un humano acepto trabajarlas explicitamente (`status: approved`) — sigue sin haberse tocado produccion.

- [high] `25d36c60-b32a-4fd0-8de5-b910cb886507` CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 36 vez/veces)

## Descartadas (rechazadas o snoozed) (6)

- [high] `bd11d934-13ec-430b-9a1e-21bd47e65358` SEO: "cerraduras inteligentes para centros deportivos" (https://zentrylockers.com/cerraduras/) (visto 57 vez/veces)
- [medium] `1defbda1-17f0-4aff-a889-5ca05e8e4112` SEO: "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina/) (visto 2 vez/veces)
- [high] `1ca5c03b-b4f4-4a1c-a0fd-08f12f8be719` Landing/articulo dedicado: "cerraduras inteligentes para centros deportivos" (visto 57 vez/veces)
- [high] `fb468529-c5ca-4e2b-bdcb-3e8570707fa7` Mejorar title/meta de https://zentrylockers.com/cerraduras/ (visto 57 vez/veces)
- [medium] `5c7930bf-b28d-4f24-93d3-a5dbeb74e483` Landing/articulo dedicado: "taquillas de melamina" (visto 2 vez/veces)
- [high] `6eaea17e-d61c-4dde-b06c-fc4d355d4de8` CRO: https://zentrylockers.com/cerraduras/ (visto 57 vez/veces)

## Work orders listas para revisar

Acciones planificables (`approved` + `auto_approved_for_planning`): **87**. Work orders nuevas hoy: **0**. Listas para revisar en total: **95** (de las cuales **95** `auto_prepared` y **0** `ready_for_review`).

**Por marca:** Zentry 48 · Tukandado 8 · Mixta 40.

**Por que requieren:**

| Requiere | Cantidad |
|---|---|
| cro | 8 |
| seo | 16 |
| competitor_gap | 21 |
| sem | 2 |
| content | 48 |
| analytics | 1 |

**Top work orders listas para revisar:**

- [high] `caf3c35d-8206-43db-bee9-20d418da675f` SEO: "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (seo, marca: both, status: auto_prepared)
- [high] `87c0acd8-e195-4398-9f8f-241786ffa50c` SEO: "cerraduras inteligentes para centros deportivos" (https://zentrylockers.com/cerraduras/) (seo, marca: both, status: auto_prepared)
- [high] `d9c5afd9-dcc7-466b-be82-0680762e7778` Competencia: keyword no cubierta "taquillas inteligentes" (sem, marca: both, status: auto_prepared)
- [high] `942b2513-3aa1-494d-a54e-a1f85db90b82` Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (content, marca: both, status: auto_prepared)
- [high] `94af4c6a-55c5-41a3-9671-4721d63ad46f` Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (content, marca: both, status: auto_prepared)

## Change Packs — paquetes de cambio concretos

Total: **72** · nuevos hoy: **0** · listos para revisar (`ready_for_review`): **66**. Ninguno ejecuta nada — ni siquiera en `approved_to_execute`. Ver `docs/change-packs.md`.

**Por tipo de cambio:**

| Tipo | Cantidad |
|---|---|
| seo_on_page_update | 16 |
| content_update | 29 |
| new_content_page | 19 |
| cro_conversion_update | 8 |

**Top 5 change packs listos para revisar:**

- [high] `6bba78a5-650d-4473-8711-3a9ac04013c1` cerraduras inteligentes para taquillas (seo_on_page_update, marca: both, status: ready_for_review)
- [high] `e6718d19-9a9e-4c85-96a1-c2a0a0c08a0a` cerraduras inteligentes para centros deportivos (seo_on_page_update, marca: both, status: ready_for_review)
- [high] `cb57c7e2-dc57-4aa4-8e93-3dce132a5477` cerraduras inteligentes para taquillas (content_update, marca: both, status: ready_for_review)
- [high] `a1be8ae4-9a5c-4e5a-bf2d-2acf752b6432` cerraduras inteligentes para taquillas (content_update, marca: both, status: ready_for_review)
- [high] `e8a01e73-98fb-4ffe-b04d-8471c5e08224` cerraduras inteligentes para centros deportivos (new_content_page, marca: tukandado, status: ready_for_review)

## WordPress Draft Agent — previews y borradores

WORDPRESS_DRAFTS_ENABLED: **true**. WordPress configurado: **si**.

Previews locales totales: **72** (nuevos hoy: **0**). Borradores reales creados en WordPress (siempre `draft`, nunca publicados): **0**. Pendientes de aprobacion por Telegram para crear un borrador real: **0**. Ver `docs/wordpress-draft-agent.md`.

## Staging Executor / Staging QA (Fase O12)

STAGING_EXECUTION_ENABLED: **true**. Ejecuciones aplicadas de verdad en staging (total acumulado, siempre `draft`, nunca publicadas, nunca produccion): **6**. Fallidas: **0**. Pendientes de aprobacion por Telegram: **0**.
Staging QA (solo lectura): **6** borrador(es) verificado(s), **5** pasan, **1** fallan. Ver `docs/staging-execution.md` y `docs/staging-rollback.md`.

## Visual Template System / Asset Planning (Fase O12.4)

Previews visuales generados (total acumulado, sobre las 5 plantillas de `src/core/visual-templates.ts`): **0**. Peticiones de imagen propuestas (total acumulado, status `proposed`): **195**. N8N_ASSET_GENERATION_WEBHOOK_URL configurada: **no** — en cualquier caso, **n8n NO se ha ejecutado, ninguna imagen se ha generado ni subido a WordPress**. Ver `docs/visual-template-system.md`, `docs/asset-generation-workflow.md` y `docs/n8n-asset-webhook-contract.md`.

## Aprobaciones (Fase O8) — Notification & Approval Gateway

Telegram activo: **si**. Telegram configurado: **si**.

Solicitudes pendientes: **5** · enviadas por Telegram (total): **10** · aprobadas: **8** · rechazadas: **2** · pospuestas: **0**.

- [critical] `b998cf4d-d0ff-4ff6-84df-bf0232d92fe9` taquillas melamina (https://zentrylockers.com/taquillas-melamina/) — canal: telegram, enviada
- [critical] `5dc59ba6-1a17-40a7-97a1-d6407831847d` taquillas melamina (https://zentrylockers.com/taquillas-melamina-fenolico/) — canal: telegram, enviada
- [critical] `c040c16b-370b-4f23-ba82-50c068411828` taquillas colegios (https://zentrylockers.com/taquillas-para-colegios/) — canal: telegram, enviada
- [critical] `faa7557d-3dcc-4e98-bd04-384cbe6884f7` taquilla para el personal (https://zentrylockers.com/taquillas-para-empresas/) — canal: telegram, enviada
- [critical] `56d63f35-b336-463e-9f34-444dfc33ed63` taquillas fenólicas en palencia (https://zentrylockers.com/taquillas-fenolicas/) — canal: telegram, enviada

## Top 5 acciones recomendadas

### 1. [high] "cerraduras inteligentes para taquillas"

- **Pagina:** https://zentrylockers.com/cerraduras-inteligentes-taquillas/
- **Marca:** Zentry + cerradura — solucion completa de taquilla inteligente
- **Accion:** Optimizar on-page para "cerraduras inteligentes para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 21.3 a top 10.
- **Esfuerzo:** medium · **Impacto:** medium
- **Requiere WordPress:** si · **Requiere contenido nuevo:** no

### 2. [high] "cerraduras inteligentes para centros deportivos"

- **Pagina:** https://zentrylockers.com/cerraduras/
- **Marca:** Zentry + cerradura — solucion completa de taquilla inteligente
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras inteligentes para centros deportivos" (posicion actual 38.0, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para "cerraduras inteligentes para centros deportivos" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** medium
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

### 3. [medium] "taquillas melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 30.7, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

### 4. [medium] "taquillas de melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Optimizar on-page para "taquillas de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 29.3 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** medium · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** no

### 5. [medium] "taquillas melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina-fenolico/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 42.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

## Oportunidades Zentry (10)

- [medium] "taquillas melamina" (https://zentrylockers.com/taquillas-melamina/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 30.7, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina/) — Optimizar on-page para "taquillas de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 29.3 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 42.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas de melamina" (posicion actual 42.4, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas colegios" (https://zentrylockers.com/taquillas-para-colegios/) — Optimizar on-page para "taquillas colegios" en https://zentrylockers.com/taquillas-para-colegios/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 25.1 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para "taquillas colegios" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquilla madera" (https://zentrylockers.com/taquillas-melamina/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquilla madera" (posicion actual 42.9, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquilla madera" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas escolares" (https://zentrylockers.com/taquillas-para-colegios/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas escolares" (posicion actual 33.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para "taquillas escolares" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquilla para el personal" (https://zentrylockers.com/taquillas-para-empresas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquilla para el personal" (posicion actual 64.9, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-empresas/ para "taquilla para el personal" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas fenólicas en palencia" (https://zentrylockers.com/taquillas-fenolicas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas fenólicas en palencia" (posicion actual 74.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-fenolicas/ para "taquillas fenólicas en palencia" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas vestuarios de melamina" (https://zentrylockers.com/taquillas-melamina/) — Optimizar on-page para "taquillas vestuarios de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 29.0 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas vestuarios de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.

## Oportunidades Tukandado (0)

Sin oportunidades en esta categoria.

## Oportunidades mixtas / cross-sell (4)

- [high] "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Optimizar on-page para "cerraduras inteligentes para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 21.3 a top 10.
- [high] "cerraduras inteligentes para centros deportivos" (https://zentrylockers.com/cerraduras/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras inteligentes para centros deportivos" (posicion actual 38.0, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para "cerraduras inteligentes para centros deportivos" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "cerraduras electrónicas taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras electrónicas taquillas" (posicion actual 35.5, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para "cerraduras electrónicas taquillas" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "cerraduras electronicas para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Optimizar on-page para "cerraduras electronicas para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 24.4 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para "cerraduras electronicas para taquillas" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.

## Estado SEM

Sin credenciales de Google Ads en este proyecto: SEM Watcher opero en modo documentacion/config local. Campana conocida: PAUSED a proposito (no activar sin confirmacion explicita del cliente).
Ver informe completo en `(no generado en esta pasada)`.

## Estado Analytics

Sin credenciales de GA4 ni GTM en este proyecto: Analytics Watcher solo documento los eventos clave esperados y propuso validaciones manuales.
Ver informe completo en `(no generado en esta pasada)`.

## Warnings

- [staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas
- [staging-qa-agent] Staging QA: problema de salud general en staging (HTTP o noindex)
- [staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas
- [staging-qa-agent] Staging QA: problema de salud general en staging (HTTP o noindex)

## Como gestionar el backlog

```bash
npm run actions:list -- --status waiting_approval
npm run actions:update -- --actionId <id> --status approved
npm run work-orders:list -- --status ready_for_review
npm run change-packs:list -- --status ready_for_review
npm run change-packs:update -- --changePackId <id> --status approved_to_execute
npm run wordpress-drafts:list
npm run approvals:list -- --status pending
npm run approvals:update -- --approvalRequestId <id> --answer approved
```

## Rutas de informes completos

- **staging-executor:** `/opt/zentry-ai-department/reports/staging-executions/staging-executions-2026-08-10.md`
- **staging-qa-agent:** `/opt/zentry-ai-department/reports/staging-qa/staging-qa-2026-08-10.md`
- **approval-gateway:** `/opt/zentry-ai-department/reports/approval-gateway/approval-gateway-2026-08-10.md`

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.
- No se ha ejecutado ningun cambio real; todo el departamento opera en modo lectura + propuesta.
- Los change packs tampoco ejecutan nada, ni siquiera en `approved_to_execute`.
- Ningun borrador de WordPress se ha publicado. Ninguna pagina publicada existente se ha modificado (salvo un borrador que el propio Staging Executor haya creado antes).
- Cualquier ejecucion real del Staging Executor solo pudo tocar STAGING, nunca produccion (bloqueo incondicional por WORDPRESS_ENV).
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.

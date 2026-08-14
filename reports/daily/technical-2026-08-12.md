# [TECNICO] Informe diario — Web & Growth Department — 2026-08-12

> Este es el informe tecnico interno (IDs, estados, work orders, change packs, agentes, trazabilidad). El informe para el responsable del departamento es el ejecutivo del mismo dia (`reports/daily/executive-<fecha>.md`), que es el que se envia por email.

- **departmentRunId:** `growth-department-2026-08-12T080051Z`
- **Generado:** 2026-08-12T08:02:29.288Z

## Resumen ejecutivo

El departamento Web & Growth analizo datos reales de Search Console, priorizó acciones, reviso a la competencia, propuso contenido y mejoras de conversion, y reviso el estado de SEM/Analytics. Se detectaron **14** acciones SEO priorizadas (**10** Zentry, **0** Tukandado, **4** mixtas), **22** oportunidad(es) de competencia, **46** propuesta(s) de contenido y **7** landing(s) revisada(s) para CRO. El departamento sigue trabajando solo en analisis, planificacion y work orders (nivel AUTO_PLAN, Fase O7) sin pedir nada a Pau; desde la Fase O8, solo interrumpe por Telegram cuando algo se acerca a produccion real. Ningun cambio real se ha ejecutado — eso sigue exigiendo aprobacion humana explicita, sin excepcion.

## Que ha hecho cada agente

- **seo-watcher**: completado — SEO Watcher Agent finalizado: 27 oportunidad(es) detectada(s)
- **seo-director**: completado — SEO Director Agent finalizado: 14 accion(es) recomendada(s)
- **competitor-intelligence**: completado — Competitor Intelligence Agent finalizado: 12 gap(s) de keyword, 10 gap(s) de contenido
- **content-planner**: completado — Content Planner Agent finalizado: 46 propuesta(s) de contenido
- **cro-landing-reviewer**: completado — CRO / Landing Reviewer Agent finalizado: 7 landing(s) revisada(s)
- **sem-watcher**: completado — SEM Watcher Agent finalizado. Conectado=true. Candidatas SEM: 61.
- **analytics-watcher**: completado (2 warning(s)) — Analytics Watcher Agent finalizado. GA4=false GTM=false.
- **approval-queue**: completado — Approval Queue Agent finalizado: 80 auto-aprobada(s) para planificacion, 0 pendiente(s) de aprobacion
- **approved-action-planner**: completado — Approved Action Planner Agent finalizado: 0 work order(s) nueva(s)
- **seo-work-order-builder**: completado — SEO Work Order Builder finalizado: 0 work order(s) lista(s) para revisar
- **content-work-order-builder**: completado — Content Work Order Builder finalizado: 0 brief(s) listo(s)
- **cro-work-order-builder**: completado — CRO Work Order Builder finalizado: 0 propuesta(s) lista(s)
- **seo-change-pack-builder**: completado — SEO Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 1 bloqueado(s) por cluster gate
- **content-change-pack-builder**: completado — Content Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 8 bloqueado(s) por cluster gate
- **cro-change-pack-builder**: completado — CRO Change Pack Builder finalizado: 0 change pack(s) nuevo(s), 1 bloqueado(s) por cluster gate
- **ux-ui-landing-architect**: completado — UX/UI Landing Architect finalizado: 0 blueprint(s) nuevo(s), 73 en total.
- **wordpress-draft-agent**: completado — WordPress Draft Agent finalizado: 0 preview(s) nuevo(s), 0 borrador(es) real(es) nuevo(s)
- **visual-template-builder**: completado — Visual Template Builder Agent finalizado: 0 preview(s) visual(es) nuevo(s)
- **visual-asset-planner**: completado — Visual Asset Planner Agent finalizado: 0 peticion(es) nueva(s), n8n NO se ha ejecutado
- **staging-executor**: completado — Staging Executor Agent finalizado: 0 ejecucion(es) aplicada(s), 0 pendiente(s) de aprobacion
- **staging-qa-agent**: completado (2 warning(s)) — Staging QA Agent finalizado: 20/21 borrador(es) pasan (20 con warning)
- **approval-gateway**: completado — Approval Gateway Agent finalizado: 0 solicitud(es) nueva(s), 0 enviada(s) por Telegram
- **production-deployment-planner**: completado — Production Deployment Planner finalizado: 0 plan(es) nuevo(s), 22 en total. Produccion no tocada.
- **production-draft-executor**: completado — Production Draft Executor finalizado: 0 pendiente(s) nueva(s), 0 aplicada(s), canAttemptRealWrites=false.
- **growth-director**: iniciado (sin finalizar) — Growth Director Agent iniciado

## Autonomia (Fase O7) — que decidio el sistema solo hoy

Auto-procesadas: **0** · Auto-aprobadas para planificacion: **80** · Pendientes de aprobacion humana: **0** · Bloqueadas: **0**. Ver `docs/autonomy-policy.md` para el detalle completo de la politica y como cambiarla.

## Acciones auto-procesadas hoy (AUTO_INTERNAL) (0)

Mecanica interna del propio sistema (dedup, priorizacion, informes) — no son recomendaciones sobre las que decidir.

Ninguna.

## Acciones auto-aprobadas para planificacion hoy (AUTO_PLAN) (80)

SEO/contenido/CRO/SEM/Analytics/competencia de riesgo bajo o medio: el sistema ya las convirtio (o las convertira en el siguiente paso) en una work order, sin esperar aprobacion. Nunca implica ejecucion real.

- [medium] `75266f83-2018-4a07-8bc3-ffa4259618b9` SEO: "taquillas melamina" (https://zentrylockers.com/taquillas-melamina/) (visto 60 vez/veces)
- [medium] `04a095e8-a5b0-4096-846a-fab74bc2d63d` SEO: "taquillas colegios" (https://zentrylockers.com/taquillas-para-colegios/) (visto 60 vez/veces)
- [medium] `9491da85-a219-4b86-a8db-9108c896d4a9` SEO: "taquillas escolares" (https://zentrylockers.com/taquillas-para-colegios/) (visto 60 vez/veces)
- [medium] `41e8d447-cf3a-4a40-98be-3eec0a9dd3a3` SEO: "cerraduras electrónicas taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 60 vez/veces)
- [medium] `fadbf3e7-916a-44cc-84f4-e4b3fc1c7f47` SEO: "taquilla para el personal" (https://zentrylockers.com/taquillas-para-empresas/) (visto 60 vez/veces)
- [medium] `5441d99d-0e17-4640-a6a2-5e849e60ce8e` SEO: "cerraduras electronicas para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 60 vez/veces)
- [medium] `8eee7474-5f71-4a3c-ae59-83196fc35bac` SEO: "taquilla madera" (https://zentrylockers.com/taquillas-melamina/) (visto 60 vez/veces)
- [medium] `d0b89217-44c5-4c5a-8d6c-3b801e19961f` SEO: "taquillas fenólicas en palencia" (https://zentrylockers.com/taquillas-fenolicas/) (visto 60 vez/veces)
- [medium] `4b1ad7e9-cf02-4c60-84da-489c74544ff6` Competencia: keyword no cubierta "para vestuarios" (visto 60 vez/veces)
- [medium] `2da10a04-464f-4a42-8372-d5825fb90fda` Competencia: keyword no cubierta "comprar taquillas" (visto 60 vez/veces)
- [medium] `ff9ea9d2-f90b-475c-8aa3-98a3e177e5a2` Competencia: keyword no cubierta "soluciones de taquillas" (visto 60 vez/veces)
- [high] `ed5b4c93-0841-43bd-b881-c662e668f201` Competencia: keyword no cubierta "taquillas inteligentes" (visto 60 vez/veces)
- [medium] `0d89d4b1-e141-4f34-98e0-9d2d52a753b1` Competencia: keyword no cubierta "taquillas para vestuarios" (visto 59 vez/veces)
- [medium] `4fd6e6bb-5243-428f-a829-154565be8f9f` Competencia: keyword no cubierta "metalicas taquillas" (visto 60 vez/veces)
- [medium] `1fd88794-b1d7-42c1-a3e5-4ad3677a19ac` Competencia: keyword no cubierta "oficinas taquillas" (visto 60 vez/veces)
- [medium] `9bdd0716-5e95-47f5-a3eb-8fc74f107ac1` Competencia: keyword no cubierta "comprar taquillas para" (visto 60 vez/veces)
- [medium] `b3f82c48-e060-4167-b61d-092f10d27d71` Competencia: keyword no cubierta "fenolicas con perfil" (visto 60 vez/veces)
- [medium] `940555ca-7368-4a41-abb6-8d622f067659` Competencia: keyword no cubierta "cerradura para" (visto 60 vez/veces)
- [medium] `b8a4fc67-6fc3-4390-b26e-2d875bb47ec2` Competencia: keyword no cubierta "sistemas de cierre" (visto 60 vez/veces)
- [medium] `9d15b606-a42b-45bf-9e20-fb3668b37bcd` Competencia: keyword no cubierta "cerradura para cada" (visto 60 vez/veces)
- [medium] `71ebb202-0a9f-4b55-9f24-a584f4020f47` Competencia: gap de sector "industrial" (visto 60 vez/veces)
- [medium] `6e40cb1a-aceb-4483-94bf-655bee3f22ab` Competencia: gap de sector "oficina" (visto 60 vez/veces)
- [medium] `5a3149d4-3050-402d-97a6-bab1a8fa2650` Competencia: gap de sector "oficinas" (visto 60 vez/veces)
- [medium] `7ef14160-5f8a-42ce-8dd2-5f4a8c61e2df` Competencia: gap de material "fenolico" (visto 60 vez/veces)
- [medium] `a2eca05e-714d-4afb-91e7-a41f97f50db2` Competencia: gap de sector "colegio" (visto 60 vez/veces)
- [medium] `ef5aae83-810c-4e31-903b-58c7ccfcf8d2` Competencia: gap de sector "colegios" (visto 60 vez/veces)
- [medium] `a0780ee1-33d9-40b2-85e2-57d7925ef3ee` Competencia: gap de sector "universidad" (visto 60 vez/veces)
- [medium] `4562059a-2a8c-49b4-b701-35f8a3965802` Competencia: gap de sector "universidades" (visto 60 vez/veces)
- [medium] `8aaf46b7-ef48-493a-b445-184f7d1afc23` Competencia: gap de sector "hotel" (visto 60 vez/veces)
- [medium] `cd9913d2-f7b0-47eb-8bd5-b5efb077dc90` Competencia: gap de sector "hoteles" (visto 60 vez/veces)
- [medium] `68b5ddf0-15a9-4772-8716-fe8aaa035ed0` Landing/articulo dedicado: "taquillas melamina" (visto 60 vez/veces)
- [medium] `c389df9c-3478-4107-b8b9-3c4d21cbc71d` Mejorar title/meta de https://zentrylockers.com/taquillas-melamina/ (visto 60 vez/veces)
- [medium] `e521f791-4b70-46b6-8703-e5420f878a3a` Mejorar title/meta de https://zentrylockers.com/taquillas-melamina/ (visto 60 vez/veces)
- [medium] `d6796747-2e8c-401c-8962-297e2a2eb227` Mejorar title/meta de https://zentrylockers.com/taquillas-para-colegios/ (visto 60 vez/veces)
- [medium] `5d32477c-4ad7-4027-a85f-9e2469b352a3` Reforzar enlazado interno hacia https://zentrylockers.com/taquillas-para-colegios/ (visto 60 vez/veces)
- [medium] `a4e797bb-abef-4e71-a531-8dab56f304cd` Landing/articulo dedicado: "taquillas escolares" (visto 60 vez/veces)
- [medium] `8df633a7-a55d-478c-85b8-ad6cd6fbe72a` Mejorar title/meta de https://zentrylockers.com/taquillas-para-colegios/ (visto 60 vez/veces)
- [medium] `6efff995-c3b8-458c-8995-d95615c2d216` Landing/articulo dedicado: "cerraduras electrónicas taquillas" (visto 60 vez/veces)
- [medium] `53b95801-023c-45ab-8e01-dcd7b4786225` Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 60 vez/veces)
- [medium] `3c530afc-a229-457f-ba2f-413b512c1add` Landing/articulo dedicado: "taquilla para el personal" (visto 60 vez/veces)
- [medium] `09fea114-7af7-46d3-8109-4f7858f09de7` Mejorar title/meta de https://zentrylockers.com/taquillas-para-empresas/ (visto 60 vez/veces)
- [medium] `3e724f86-968d-41bd-9c57-1c0e23eb4a35` Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 60 vez/veces)
- [medium] `a868b0e1-1733-493f-876d-c7bd3ec103b5` Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 60 vez/veces)
- [medium] `bb9398b4-c11c-4e4d-8d44-88f7a469638e` Landing/articulo dedicado: "taquilla madera" (visto 60 vez/veces)
- [medium] `b0dec328-d93a-4edd-80f5-0f0eb292ac79` Mejorar title/meta de https://zentrylockers.com/taquillas-melamina/ (visto 60 vez/veces)
- [medium] `224b642e-8a06-408c-83fd-3bf85cac4178` Landing/articulo dedicado: "taquillas fenólicas en palencia" (visto 60 vez/veces)
- [medium] `e2b7d30b-c7aa-4b45-b927-0397ffeb996b` Mejorar title/meta de https://zentrylockers.com/taquillas-fenolicas/ (visto 60 vez/veces)
- [medium] `c1a47020-c2a4-4808-bb82-0fe4a7ab29c6` Contenido nuevo para "para vestuarios" (visto 60 vez/veces)
- [medium] `b01365b3-dd0a-410d-ad51-f3708af520c4` Contenido nuevo para "comprar taquillas" (visto 60 vez/veces)
- [medium] `5db5325b-ff40-492d-81fe-8a04c8c00459` Contenido nuevo para "soluciones de taquillas" (visto 60 vez/veces)
- [high] `b8632ce3-723c-4aca-b355-56beee9c10b5` Contenido nuevo para "taquillas inteligentes" (visto 60 vez/veces)
- [medium] `61601263-5fa6-4397-ae35-ec47818c3446` Contenido nuevo para "taquillas para vestuarios" (visto 59 vez/veces)
- [medium] `aecb4f40-370d-43bd-b496-bcfebe0b495a` Contenido nuevo para "metalicas taquillas" (visto 60 vez/veces)
- [medium] `5c6cfbd5-6be1-48bd-bf08-e9ff4d34cf62` Contenido nuevo para "oficinas taquillas" (visto 60 vez/veces)
- [medium] `592e8c17-d862-4c27-b6ff-9e737cd12fdf` Contenido nuevo para "comprar taquillas para" (visto 60 vez/veces)
- [medium] `b95f6db4-c426-4afc-ad18-c4d243c5db83` Contenido nuevo para "fenolicas con perfil" (visto 60 vez/veces)
- [medium] `7d9bcd0f-fc53-4e57-a92b-d28df8981df4` Contenido nuevo para "cerradura para" (visto 60 vez/veces)
- [medium] `6ae11774-0bab-4e5d-9f88-7a9d7e46ffa3` Contenido nuevo para "sistemas de cierre" (visto 60 vez/veces)
- [medium] `df416add-34e3-4813-91ba-e985ba37fcfa` Contenido nuevo para "cerradura para cada" (visto 60 vez/veces)
- [medium] `85bf25c7-3fdb-4559-a9bb-aed333933961` Landing para "industrial" (sector) (visto 60 vez/veces)
- [medium] `0bc4b333-be00-4034-a405-12dbe36bd0a1` Landing para "oficina" (sector) (visto 60 vez/veces)
- [medium] `61d79596-6493-40ed-b343-0d55a5693180` Landing para "oficinas" (sector) (visto 60 vez/veces)
- [medium] `6b1eeaa5-7002-4c73-8987-8cc0b19fc432` Landing para "fenolico" (material) (visto 60 vez/veces)
- [medium] `bbdedb4f-6caa-4a75-89f0-a1f8cb6ebf8c` Landing para "colegio" (sector) (visto 60 vez/veces)
- [medium] `98a02770-d7e9-4922-a86c-636b3e9afeea` Landing para "colegios" (sector) (visto 60 vez/veces)
- [medium] `bec6d2c1-749f-4b88-8a0d-d0b1095ad5df` Landing para "universidad" (sector) (visto 60 vez/veces)
- [medium] `3d13a3f7-c218-48bf-a8cf-880950666d04` Landing para "universidades" (sector) (visto 60 vez/veces)
- [medium] `2e42d9c8-b4ac-4761-989d-beb7edcef933` Landing para "hotel" (sector) (visto 60 vez/veces)
- [medium] `457b4768-f43b-4894-b69e-d80b3314bd91` Landing para "hoteles" (sector) (visto 60 vez/veces)
- [medium] `0c10dc58-4312-4ba2-9069-3f52bd71fd79` CRO: https://zentrylockers.com/taquillas-melamina/ (visto 60 vez/veces)
- [medium] `b8b60ac9-f51c-42f0-b66c-d32f85aa9a4b` CRO: https://zentrylockers.com/taquillas-para-empresas/ (visto 60 vez/veces)
- [medium] `c9e4e0fd-f890-4903-af7f-81cdc917131e` CRO: https://zentrylockers.com/taquillas-para-colegios/ (visto 60 vez/veces)
- [medium] `5155521f-6bdb-4a62-91bb-237985b0e856` CRO: https://zentrylockers.com/taquillas-fenolicas/ (visto 60 vez/veces)
- [medium] `500f6db9-b18d-4216-ba52-00c038aea317` SEO: "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina/) (visto 58 vez/veces)
- [medium] `c4cd6acb-6716-44a7-a74a-fa042119aba8` Reforzar enlazado interno hacia https://zentrylockers.com/taquillas-melamina/ (visto 58 vez/veces)
- [medium] `14933cf0-15c3-4a15-89c7-3be9837a784b` Revision final de la campana SEM antes de activacion (PAUSED) (visto 58 vez/veces)
- [medium] `fadfea45-84d8-49f1-a6bd-bb62020beb2c` Validar eventos clave de tracking en GA4 (visto 58 vez/veces)
- [medium] `9b8ff70f-c954-4262-afcd-947412dcb907` Mejorar title/meta de https://zentrylockers.com/taquillas-melamina/ (visto 24 vez/veces)
- [medium] `8ccbd1ac-2e9d-407a-9edf-8338b68f0e8b` SEO: "taquillas vestuarios de melamina" (https://zentrylockers.com/taquillas-melamina/) (visto 7 vez/veces)
- [medium] `04ebc892-7e3d-4092-8a82-49f2a7a962f9` Reforzar enlazado interno hacia https://zentrylockers.com/taquillas-melamina/ (visto 7 vez/veces)

## Pendientes de aprobacion humana (0)

Acciones que tocarian produccion real (WordPress, Ads, GA4, GTM...) si se ejecutaran. Hoy ningun agente genera este tipo, pero la politica ya esta lista para cuando exista.

Ninguna.

## Acciones bloqueadas (0)

Nivel FORBIDDEN de la politica de autonomia: nunca se auto-ejecutan ni se auto-preparan, necesitan una decision explicita fuera de este sistema.

Ninguna.

## Acciones nuevas detectadas hoy (0)

Primera vez que se detectan Y sin clasificacion de autonomia todavia (caso raro — casi siempre caeran en alguna de las categorias de arriba).

Ninguna.

## Acciones repetidas / recurrentes sin clasificar (0)

Ya se habian detectado en pasadas anteriores y siguen en 'open' sin que la politica las haya reclasificado todavia (caso raro tras la Fase O7).

Ninguna.

## Aprobadas por un humano pero todavia no ejecutadas (6)

Un humano acepto trabajarlas explicitamente (`status: approved`) — sigue sin haberse tocado produccion.

- [high] `19599263-9e05-4bca-8d6a-761cf54f3aad` SEO: "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 36 vez/veces)
- [high] `4bdbbe6e-743a-40df-822f-615935e57cfa` Mejorar title/meta de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 36 vez/veces)
- [high] `ef7a3825-b95f-4942-a4dc-46faed0d825e` Reforzar enlazado interno hacia https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 60 vez/veces)
- [high] `25d36c60-b32a-4fd0-8de5-b910cb886507` CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 36 vez/veces)
- [high] `1a0e540c-8785-482b-9be2-217c5d6fe818` SEO: "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) (visto 24 vez/veces)
- [high] `b764c03e-3b88-441f-aa88-117d45d97e21` CRO: https://zentrylockers.com/cerraduras-inteligentes-taquillas/ (visto 24 vez/veces)

## Descartadas (rechazadas o snoozed) (10)

- [high] `bd11d934-13ec-430b-9a1e-21bd47e65358` SEO: "cerraduras inteligentes para centros deportivos" (https://zentrylockers.com/cerraduras/) (visto 60 vez/veces)
- [medium] `1defbda1-17f0-4aff-a889-5ca05e8e4112` SEO: "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina/) (visto 2 vez/veces)
- [medium] `799c8cfc-0154-45d1-9be2-5b9bed19ec85` SEO: "taquillas melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) (visto 60 vez/veces)
- [medium] `e1e88dff-021f-4570-9598-52fa32d8e8fd` SEO: "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) (visto 60 vez/veces)
- [high] `1ca5c03b-b4f4-4a1c-a0fd-08f12f8be719` Landing/articulo dedicado: "cerraduras inteligentes para centros deportivos" (visto 60 vez/veces)
- [high] `fb468529-c5ca-4e2b-bdcb-3e8570707fa7` Mejorar title/meta de https://zentrylockers.com/cerraduras/ (visto 60 vez/veces)
- [medium] `5c7930bf-b28d-4f24-93d3-a5dbeb74e483` Landing/articulo dedicado: "taquillas de melamina" (visto 2 vez/veces)
- [high] `6eaea17e-d61c-4dde-b06c-fc4d355d4de8` CRO: https://zentrylockers.com/cerraduras/ (visto 60 vez/veces)
- [medium] `db8bc4e5-c1c5-4af3-9b43-2c3597d5edab` CRO: https://zentrylockers.com/taquillas-melamina-fenolico/ (visto 60 vez/veces)
- [medium] `63224654-72c0-42e4-8a89-573a3961e708` Landing/articulo dedicado: "taquillas de melamina" (visto 58 vez/veces)

## Work orders listas para revisar

Acciones planificables (`approved` + `auto_approved_for_planning`): **88**. Work orders nuevas hoy: **0**. Listas para revisar en total: **96** (de las cuales **95** `auto_prepared` y **1** `ready_for_review`).

**Por marca:** Zentry 49 · Tukandado 8 · Mixta 40.

**Por que requieren:**

| Requiere | Cantidad |
|---|---|
| cro | 8 |
| seo | 17 |
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

Total: **73** · nuevos hoy: **0** · listos para revisar (`ready_for_review`): **1**. Ninguno ejecuta nada — ni siquiera en `approved_to_execute`. Ver `docs/change-packs.md`.

**Por tipo de cambio:**

| Tipo | Cantidad |
|---|---|
| seo_on_page_update | 17 |
| content_update | 29 |
| new_content_page | 19 |
| cro_conversion_update | 8 |

**Top 5 change packs listos para revisar:**

- [medium] `ad9075d6-6ed7-4e30-8c13-635b402e16a3` taquillas melamina (seo_on_page_update, marca: zentry, status: ready_for_review)

## WordPress Draft Agent — previews y borradores

WORDPRESS_DRAFTS_ENABLED: **true**. WordPress configurado: **si**.

Previews locales totales: **73** (nuevos hoy: **0**). Borradores reales creados en WordPress (siempre `draft`, nunca publicados): **0**. Pendientes de aprobacion por Telegram para crear un borrador real: **0**. Ver `docs/wordpress-draft-agent.md`.

## Staging Executor / Staging QA (Fase O12)

STAGING_EXECUTION_ENABLED: **true**. Ejecuciones aplicadas de verdad en staging (total acumulado, siempre `draft`, nunca publicadas, nunca produccion): **21**. Fallidas: **0**. Pendientes de aprobacion por Telegram: **0**.
Staging QA (solo lectura): **21** borrador(es) verificado(s), **20** pasan, **1** fallan. Ver `docs/staging-execution.md` y `docs/staging-rollback.md`.

## Visual Template System / Asset Planning (Fase O12.4)

Previews visuales generados (total acumulado, sobre las 5 plantillas de `src/core/visual-templates.ts`): **22**. Peticiones de imagen propuestas (total acumulado, status `proposed`): **202**. N8N_ASSET_GENERATION_WEBHOOK_URL configurada: **si** — en cualquier caso, **n8n NO se ha ejecutado, ninguna imagen se ha generado ni subido a WordPress**. Ver `docs/visual-template-system.md`, `docs/asset-generation-workflow.md` y `docs/n8n-asset-webhook-contract.md`.

## Aprobaciones (Fase O8) — Notification & Approval Gateway

Telegram activo: **si**. Telegram configurado: **si**.

Solicitudes pendientes: **0** · enviadas por Telegram (total): **35** · aprobadas: **26** · rechazadas: **3** · pospuestas: **0**.

## Top 5 acciones recomendadas

### 1. [high] "cerraduras inteligentes para taquillas"

- **Pagina:** https://zentrylockers.com/cerraduras-inteligentes-taquillas/
- **Marca:** Zentry + cerradura — solucion completa de taquilla inteligente
- **Accion:** Optimizar on-page para "cerraduras inteligentes para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 20.9 a top 10.
- **Esfuerzo:** medium · **Impacto:** medium
- **Requiere WordPress:** si · **Requiere contenido nuevo:** no

### 2. [high] "cerraduras inteligentes para centros deportivos"

- **Pagina:** https://zentrylockers.com/cerraduras/
- **Marca:** Zentry + cerradura — solucion completa de taquilla inteligente
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras inteligentes para centros deportivos" (posicion actual 36.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para "cerraduras inteligentes para centros deportivos" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** medium
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

### 3. [medium] "taquillas melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 30.5, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

### 4. [medium] "taquillas de melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Optimizar on-page para "taquillas de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 29.0 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** medium · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** no

### 5. [medium] "taquillas melamina"

- **Pagina:** https://zentrylockers.com/taquillas-melamina-fenolico/
- **Marca:** Zentry principal — mobiliario/taquillas/lockers
- **Accion:** Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 42.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- **Esfuerzo:** high · **Impacto:** low
- **Requiere WordPress:** si · **Requiere contenido nuevo:** si

## Oportunidades Zentry (10)

- [medium] "taquillas melamina" (https://zentrylockers.com/taquillas-melamina/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 30.5, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina/) — Optimizar on-page para "taquillas de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 29.0 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas melamina" (posicion actual 42.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas de melamina" (https://zentrylockers.com/taquillas-melamina-fenolico/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas de melamina" (posicion actual 42.6, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina-fenolico/ para "taquillas de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquilla madera" (https://zentrylockers.com/taquillas-melamina/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquilla madera" (posicion actual 42.9, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquilla madera" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas colegios" (https://zentrylockers.com/taquillas-para-colegios/) — Optimizar on-page para "taquillas colegios" en https://zentrylockers.com/taquillas-para-colegios/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 25.1 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para "taquillas colegios" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas escolares" (https://zentrylockers.com/taquillas-para-colegios/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas escolares" (posicion actual 33.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-colegios/ para "taquillas escolares" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquilla para el personal" (https://zentrylockers.com/taquillas-para-empresas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquilla para el personal" (posicion actual 64.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-para-empresas/ para "taquilla para el personal" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas fenólicas en palencia" (https://zentrylockers.com/taquillas-fenolicas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "taquillas fenólicas en palencia" (posicion actual 73.9, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-fenolicas/ para "taquillas fenólicas en palencia" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "taquillas vestuarios de melamina" (https://zentrylockers.com/taquillas-melamina/) — Optimizar on-page para "taquillas vestuarios de melamina" en https://zentrylockers.com/taquillas-melamina/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 28.3 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/taquillas-melamina/ para "taquillas vestuarios de melamina" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.

## Oportunidades Tukandado (0)

Sin oportunidades en esta categoria.

## Oportunidades mixtas / cross-sell (4)

- [high] "cerraduras inteligentes para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Optimizar on-page para "cerraduras inteligentes para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 20.9 a top 10.
- [high] "cerraduras inteligentes para centros deportivos" (https://zentrylockers.com/cerraduras/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras inteligentes para centros deportivos" (posicion actual 36.8, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras/ para "cerraduras inteligentes para centros deportivos" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "cerraduras electrónicas taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "cerraduras electrónicas taquillas" (posicion actual 35.3, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para "cerraduras electrónicas taquillas" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.
- [medium] "cerraduras electronicas para taquillas" (https://zentrylockers.com/cerraduras-inteligentes-taquillas/) — Optimizar on-page para "cerraduras electronicas para taquillas" en https://zentrylockers.com/cerraduras-inteligentes-taquillas/: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion 24.2 a top 10. Ademas, Reescribir meta title y meta description de https://zentrylockers.com/cerraduras-inteligentes-taquillas/ para "cerraduras electronicas para taquillas" (CTR actual 0.00%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.

## Estado SEM

Conectado a Google Ads.
Ver informe completo en `/opt/zentry-ai-department/reports/sem/sem-2026-08-12.md`.

## Estado Analytics

Sin credenciales de GA4 ni GTM en este proyecto: Analytics Watcher solo documento los eventos clave esperados y propuso validaciones manuales.
Ver informe completo en `/opt/zentry-ai-department/reports/analytics/analytics-2026-08-12.md`.

## Warnings

- [analytics-watcher] Hay credenciales de GA4 pero la lectura real fallo: Lectura de GA4 fallo: invalid_grant.
- [analytics-watcher] Hay credenciales de GTM pero la lectura real fallo: Lectura de GTM fallo: invalid_grant.
- [staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas
- [staging-qa-agent] Staging QA detecto 1 borrador(es) con problemas

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

- **seo-watcher:** `/opt/zentry-ai-department/reports/seo/seo-watcher-2026-08-12.md`
- **seo-director:** `/opt/zentry-ai-department/reports/seo-director/seo-director-2026-08-12.md`
- **competitor-intelligence:** `/opt/zentry-ai-department/reports/competitor-intelligence/competitor-intelligence-2026-08-12.md`
- **content-planner:** `/opt/zentry-ai-department/reports/content-planner/content-planner-2026-08-12.md`
- **cro-landing-reviewer:** `/opt/zentry-ai-department/reports/cro/cro-2026-08-12.md`
- **sem-watcher:** `/opt/zentry-ai-department/reports/sem/sem-2026-08-12.md`
- **analytics-watcher:** `/opt/zentry-ai-department/reports/analytics/analytics-2026-08-12.md`
- **approval-queue:** `/opt/zentry-ai-department/reports/approval-queue/approval-queue-2026-08-12.md`
- **approved-action-planner:** `/opt/zentry-ai-department/reports/approved-action-planner/approved-action-planner-2026-08-12.md`
- **seo-work-order-builder:** `/opt/zentry-ai-department/reports/seo-work-orders/seo-work-orders-2026-08-12.md`
- **content-work-order-builder:** `/opt/zentry-ai-department/reports/content-work-orders/content-work-orders-2026-08-12.md`
- **cro-work-order-builder:** `/opt/zentry-ai-department/reports/cro-work-orders/cro-work-orders-2026-08-12.md`
- **seo-change-pack-builder:** `/opt/zentry-ai-department/reports/seo-change-packs/seo-change-packs-2026-08-12.md`
- **content-change-pack-builder:** `/opt/zentry-ai-department/reports/content-change-packs/content-change-packs-2026-08-12.md`
- **cro-change-pack-builder:** `/opt/zentry-ai-department/reports/cro-change-packs/cro-change-packs-2026-08-12.md`
- **wordpress-draft-agent:** `/opt/zentry-ai-department/reports/wordpress-drafts/wordpress-drafts-2026-08-12.md`
- **visual-template-builder:** `/opt/zentry-ai-department/reports/visual-templates/visual-templates-2026-08-12.md`
- **visual-asset-planner:** `/opt/zentry-ai-department/reports/visual-assets/visual-assets-2026-08-12.md`
- **staging-executor:** `/opt/zentry-ai-department/reports/staging-executions/staging-executions-2026-08-12.md`
- **staging-qa-agent:** `/opt/zentry-ai-department/reports/staging-qa/staging-qa-2026-08-12.md`
- **approval-gateway:** `/opt/zentry-ai-department/reports/approval-gateway/approval-gateway-2026-08-12.md`

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.
- No se ha ejecutado ningun cambio real; todo el departamento opera en modo lectura + propuesta.
- Los change packs tampoco ejecutan nada, ni siquiera en `approved_to_execute`.
- Ningun borrador de WordPress se ha publicado. Ninguna pagina publicada existente se ha modificado (salvo un borrador que el propio Staging Executor haya creado antes).
- Cualquier ejecucion real del Staging Executor solo pudo tocar STAGING, nunca produccion (bloqueo incondicional por WORDPRESS_ENV).
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.

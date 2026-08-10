# Production Draft Executor — 2026-08-05

- **departmentRunId:** `growth-department-2026-08-05T173624Z`
- **Generado:** 2026-08-05T17:37:18.525Z

- **PRODUCTION_EXECUTION_ENABLED:** false | **PRODUCTION_DRAFTS_ENABLED:** false | **PRODUCTION_BACKEND:** rest
- **canAttemptRealWrites (las 3 a la vez):** false
Escritura real BLOQUEADA (al menos una de las 3 condiciones no esta activa) -- ninguna ejecucion `approved` se aplica, pase lo que pase.

- Ejecuciones nuevas (pending_approval) esta pasada: **0**
- Nuevas solicitudes de aprobacion de EJECUCION: **0** (enviadas por Telegram: 0)
- Aprobadas esta pasada: 0 | Canceladas/rechazadas esta pasada: 0
- Aplicadas de verdad esta pasada: 0 | Fallidas: 0
- Pendientes de aprobacion de ejecucion (total): 0

## Todas las ejecuciones (1)

### [applied_to_production_draft] taquillas escolares (https://zentrylockers.com/taquillas-para-colegios/) — `prod-exec-453dd22a-2bc0-4b98-8695-40774bff38bc`

- deploymentPlanId: `prod-deploy-326ef325-d985-47ff-9836-bf556d2007a3`
- sourceDraftId (staging): `1959` — https://staging.zentrylockers.com/?page_id=1959
- targetPageId (produccion): 1960
- targetDraftUrl: https://zentrylockers.com/?page_id=1960
- media: 1962->1959
- approvalRequestId: 310db20b-9270-4139-b155-3f9a1e34e9a6
- attempts: 1

## Confirmacion de seguridad

- Escritura real SOLO si: ejecucion `approved` (segunda aprobacion, distinta de la de plan) + las 3 condiciones de entorno a la vez.
- Nunca publica -- toda pagina creada en produccion queda siempre en `status: draft`.
- Nunca actualiza una pagina publicada existente, nunca borra, nunca toca WooCommerce/formularios/precios/checkout.
- Snapshot del contenido exacto enviado guardado SIEMPRE antes de cualquier intento de escritura real.
- No usa Novamira, execute-php ni run-wp-cli en ningun punto.

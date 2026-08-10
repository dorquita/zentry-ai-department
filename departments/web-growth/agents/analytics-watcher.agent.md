# Analytics Watcher Agent

**Departamento:** Web & Growth
**Estado:** Fase O11 — **lectura real de GA4/GTM si hay credenciales**, si no cae a **placeholder seguro** (independiente por sistema)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Vigila que los eventos clave de conversion existan y funcionen en GA4, y
el estado del contenedor de GTM. Desde la Fase O11 se conecta a las APIs
reales (`src/adapters/ga4.ts`, `src/adapters/gtm.ts`) en modo **solo
lectura** cuando hay credenciales en `.env`; GA4 y GTM son
independientes entre si — puede haber lectura real de uno sin el otro.

## 2. Que lee cuando hay credenciales reales

Ver `docs/analytics-readonly.md` para el detalle completo. Resumen:

- **GA4:** trafico por canal, landing pages principales, eventos
  (cruzados contra los 4 eventos clave esperados, incluido
  `generate_lead_form_submit` como proxy de rendimiento de formularios),
  fuentes/medios — ultimos `GA4_LOOKBACK_DAYS` dias (28 por defecto).
- **GTM:** cuenta/contenedor/workspace, tags, triggers, variables, y la
  version actualmente publicada (live) — nunca publica una version
  nueva.

Sin credenciales de un sistema (o si su lectura falla), ese sistema cae
al placeholder documentado en `config/analytics-key-events.json` — mismo
comportamiento que antes de la Fase O11.

## 3. Reglas (no negociables)

- **Si no hay credenciales de GA4** (`GA4_PROPERTY_ID`,
  `GOOGLE_ANALYTICS_OAUTH_CLIENT_ID`,
  `GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET`,
  `GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN`) **ni de GTM**
  (`GTM_CONTAINER_ID`, `GTM_WORKSPACE_ID`, mismas 3 variables
  `GOOGLE_ANALYTICS_OAUTH_*`) en `.env`, se salta la lectura real de cada
  sistema por separado con un **warning claro**.
- **Si hay credenciales pero la lectura real de un sistema falla**, el
  error se captura, se sanitiza y se cae al placeholder de ESE sistema —
  nunca se propaga una excepcion que tumbe el pase diario, y un fallo en
  GA4 no afecta a GTM ni viceversa.
- **No modifica GA4 ni GTM**, en ningun caso: no crea key events, no
  publica contenedores, no toca tags/triggers/variables.
- **No toca WordPress, Google Ads, n8n ni qdrant.**
- **No maneja secretos.**
- Cuando no hay lectura real, solo propone **validaciones manuales** de
  tracking, nunca las ejecuta.

## 4. Formato de salida

`reports/analytics/analytics-<fecha>.md`: resumen ejecutivo, tablas
reales de GA4 (trafico/landing pages/eventos/fuentes) y GTM
(tags/triggers/variables/version live) cuando hay lectura real, o la
tabla de eventos clave esperados documentados cuando no la hay,
checklist de validaciones de tracking, warnings, confirmacion de
seguridad.

## 5. Eventos que emite

`agent_started`, `warning_detected` (uno por sistema sin credenciales o
con lectura fallida), `recommendation_created`, `agent_finished`
(payload incluye `ga4Connected`/`gtmConnected: boolean`, consumido por
Growth Director).

## 6. Como evoluciona

Hoy (Fase O11): lectura real cuando hay credenciales, solo lectura,
propone validaciones. Verificar en vivo si un evento clave se dispara
significa leer si aparecio en el periodo — no hay (ni esta planificado)
ningun modo que modifique GA4/GTM desde este agente.

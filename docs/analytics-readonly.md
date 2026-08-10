# GA4 + GTM — integracion de solo lectura (Fase O11)

## Por que existe este documento

`src/adapters/ga4.ts` y `src/adapters/gtm.ts` son los unicos puntos de
contacto de todo el proyecto con la GA4 Data API y la API de Tag
Manager. Este documento deja explicito por que ninguno de los dos puede
modificar nada, siguiendo la misma filosofia que
`docs/wordpress-safety-policy.md` y `docs/google-ads-readonly.md`.

## GA4 — lo que `src/adapters/ga4.ts` NUNCA hace

- **No crea ni modifica key events.** No importa `analyticsadmin`, solo
  `analyticsdata` (GA4 Data API). No existe ninguna funcion que llame a
  `keyEvents.create`/`update`/`delete`.
- **No modifica streams, propiedades ni ninguna configuracion de GA4.**
  El unico metodo llamado es `properties.runReport` (consulta de solo
  lectura). No hay ninguna importacion de un cliente de escritura.
- **No imprime secretos.** `GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET` y
  `GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN` nunca se loguean; los errores se
  sanitizan antes de mostrarse.

### Que lee

Con `GA4_PROPERTY_ID` + las 3 variables `GOOGLE_ANALYTICS_OAUTH_*`
configuradas, `getGa4Snapshot()` ejecuta 4 `runReport` de solo lectura en
paralelo sobre los ultimos `GA4_LOOKBACK_DAYS` dias (28 por defecto,
terminando ayer — mismo criterio que Search Console):

1. Trafico por canal (`sessionDefaultChannelGroup`): sesiones, usuarios
   activos, conversiones.
2. Landing pages principales: sesiones, conversiones, bounce rate.
3. Eventos (`eventName`): recuento y conversiones — se cruzan contra los
   4 eventos clave documentados en `config/analytics-key-events.json`
   (`generate_lead_form_submit`, `click_whatsapp`, `click_phone`,
   `click_request_quote`) para confirmar si cada uno se disparo o no en
   el periodo. Esto cubre tambien "rendimiento de formularios": el
   evento `generate_lead_form_submit` se reporta como cualquier otro,
   con su recuento real si existe.
4. Fuentes / medios (`sessionSource` + `sessionMedium`): sesiones y
   conversiones.

## GTM — lo que `src/adapters/gtm.ts` NUNCA hace

- **No publica ninguna version de contenedor.** No existe ninguna
  llamada a `accounts.containers.versions.publish` en todo el proyecto —
  el unico metodo de "version" que se llama es `.live()` (lectura de la
  version actualmente publicada, no una accion).
- **No crea, modifica ni borra tags, triggers ni variables.** Los unicos
  metodos llamados son `.list()` y `.get()` sobre cuentas, contenedores,
  workspaces, tags, triggers y variables — nunca `.create()`,
  `.update()` ni `.delete()`.
- **No imprime secretos.** Comparte credenciales OAuth con GA4
  (`GOOGLE_ANALYTICS_OAUTH_*`); mismo tratamiento de sanitizacion.

### Que lee

Con `GTM_CONTAINER_ID` + `GTM_WORKSPACE_ID` + las 3 variables
`GOOGLE_ANALYTICS_OAUTH_*`, `getGtmSnapshot()`:

1. Recorre las cuentas accesibles hasta encontrar la que contiene
   `GTM_CONTAINER_ID` (solo lectura, `accounts.list` +
   `accounts.containers.list`).
2. Lee el workspace indicado por `GTM_WORKSPACE_ID`.
3. Lista tags, triggers y variables del workspace (nombre, tipo, y si un
   tag esta pausado — hasta 30 de cada uno en el informe, con el
   recuento TOTAL siempre mostrado aunque se trunque la lista).
4. Lee la version live del contenedor (nombre e id) para saber que esta
   publicado ahora mismo — sin publicar nada nuevo.

## Como obtener el refresh token

`npm run auth:analytics` (`scripts/get-google-analytics-refresh-token.ts`,
Fase O11.2) — mismo patron que `npm run auth:gsc`/`npm run auth:google-ads`:
reutiliza `GOOGLE_ANALYTICS_OAUTH_CLIENT_ID/SECRET` si ya estan en `.env`,
genera UNA URL de consentimiento pidiendo los 2 scopes a la vez
(`analytics.readonly` + `tagmanager.readonly`), pide el authorization code
con entrada enmascarada, y antes de guardar hace un backup de `.env`
(permisos 600) y pide confirmacion explicita.

## Autenticacion compartida (GA4 + GTM)

`GOOGLE_ANALYTICS_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` son un UNICO
cliente OAuth2 que debe tener autorizados los dos scopes de solo lectura
a la vez:

- `https://www.googleapis.com/auth/analytics.readonly` (GA4)
- `https://www.googleapis.com/auth/tagmanager.readonly` (GTM)

Si el refresh token solo autorizo uno de los dos scopes, ese sistema
fallara con un error de permisos al leer — el otro sigue funcionando con
normalidad (son lecturas independientes, ver mas abajo).

## Si faltan credenciales o falla la lectura

`src/agents/analytics-watcher.ts` trata GA4 y GTM como dos sistemas
completamente independientes:

- Si faltan las variables de GA4, se salta solo GA4 (warning claro,
  `ga4Connected: false`) — GTM se intenta leer igualmente si sus
  variables estan presentes, y viceversa.
- Si hay credenciales pero la lectura de uno de los dos falla (red,
  token invalido, contenedor no encontrado...), el error se captura, se
  sanitiza, se registra como warning, y ESE sistema cae al placeholder —
  el otro sistema no se ve afectado.
- Nunca se lanza una excepcion que interrumpa el pase diario completo por
  un problema de GA4 o GTM.

## Informe

`reports/analytics/analytics-<fecha>.md` incluye, cuando hay lectura
real: trafico por canal, landing pages, tabla de eventos clave (esperado
vs. observado), fuentes/medios (GA4) y contenedor/workspace/tags/
triggers/variables/version live (GTM) — con el recordatorio explicito de
que ninguno de los dos adaptadores puede modificar nada.

## Ver tambien

- `docs/google-ads-readonly.md` — equivalente para Google Ads.
- `config/analytics-key-events.json` — eventos clave esperados,
  documentados a mano.
- `departments/web-growth/agents/analytics-watcher.agent.md` — spec del
  agente.

# Credenciales multi-cliente (Fase O16.2)

## Convencion

`<CLIENTID_EN_MAYUSCULAS>_<NOMBRE_EXACTO_DE_LA_VARIABLE_DE_HOY>`. Nunca
se abrevia ni se renombra la clave — anadir el prefijo es la UNICA
diferencia respecto al nombre que ya existia, para que mapear una
credencial nunca sea ambiguo.

Ejemplo para un cliente `acme`: `ACME_WORDPRESS_APP_PASSWORD`,
`ACME_GOOGLE_ADS_CUSTOMER_ID`, `ACME_SMTP_PASS`.

**Excepcion deliberada:** Telegram (`TELEGRAM_BOT_TOKEN`/
`TELEGRAM_CHAT_ID`/`TELEGRAM_APPROVALS_ENABLED`) y el destinatario del
email (`REPORT_EMAIL_TO`) NO usan este prefijo — ya tienen su propio
mecanismo desde la Fase O16.1 Lote 6 (`notificationSettings` en
`clients/<id>/client.config.json` define el NOMBRE completo de la
variable a usar, mas flexible que un prefijo fijo). Anadir tambien el
prefijo aqui crearia dos convenciones compitiendo sobre el mismo dato.

## Fallback (solo para "zentry")

Si `<CLIENTID>_<VAR>` no existe, el sistema cae a `<VAR>` sin prefijo
**unicamente si `clientId === "zentry"`** (el unico cliente con
historico real hoy) — asi el `.env` actual sigue funcionando sin tocar
ni una linea. Cualquier OTRO cliente no tiene este fallback: si le
falta una variable con su prefijo, el servicio correspondiente
simplemente se salta (ver mas abajo), nunca "hereda" por accidente la
credencial de otro cliente.

## Helpers (`src/core/client-config.ts`)

- `resolveClientEnvVarName(clientId, key)` — construye el nombre
  prefijado, ej. `"acme" + "GA4_PROPERTY_ID"` -> `"ACME_GA4_PROPERTY_ID"`.
- `resolveClientEnvVar(clientId, key)` — devuelve el valor (prefijado, o
  legacy si `clientId==="zentry"`), o `undefined` si no existe. Nunca lanza.
- `resolveClientSecret(clientId, key)` — igual, pero lanza un error
  claro (con el NOMBRE de la variable, nunca ningun valor) si falta.
- `resolveClientServiceCredentials(clientId, service)` — comprueba TODAS
  las variables que necesita un `service` a la vez (ver catalogo abajo)
  y devuelve `{ service, complete: boolean, missing: string[] }` —
  `missing` son nombres de variable, nunca valores.

## Catalogo de servicios (`CLIENT_SERVICE_CREDENTIAL_KEYS`)

| Servicio | Variables que necesita (con prefijo `<CLIENTID>_`) | Opcional / obligatorio |
|---|---|---|
| `wordpress_staging` | `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` | Opcional — sin ellas, WordPress Draft Agent/Staging Executor solo generan previews locales |
| `wordpress_production` | `WORDPRESS_PRODUCTION_USERNAME`, `WORDPRESS_PRODUCTION_APP_PASSWORD` | Opcional — sin ellas, Production Draft Executor nunca puede escribir (ademas de los 3 flags de entorno, sin cambios) |
| `search_console` | `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_OAUTH_REFRESH_TOKEN` | Obligatorio para SEO Watcher real (si faltan, usar `SEO_DATA_SOURCE=mock`) |
| `google_ads` | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Opcional — sin ellas, SEM Watcher se salta la lectura real (warning claro, sigue generando recomendaciones desde config local) |
| `ga4` | `GOOGLE_ANALYTICS_OAUTH_CLIENT_ID`, `GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET`, `GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN`, `GA4_PROPERTY_ID` | Opcional — sin ellas, Analytics Watcher se salta solo la parte GA4 |
| `gtm` | mismas 3 OAuth de arriba + `GTM_CONTAINER_ID`, `GTM_WORKSPACE_ID` | Opcional — independiente de GA4 (puede faltar uno y funcionar el otro) |
| `smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `REPORT_EMAIL_FROM` | Obligatorio para que `growth:daily` complete el paso final (envio de email) |

## Como se desactiva un servicio si faltan credenciales

Nunca rompe el resto del pase diario — cada agente ya comprobaba esto
antes de O16.2 (via `hasGoogleAdsCredentials()`/`hasGa4Credentials()`/
`hasGtmCredentials()`, ahora client-aware), y sigue exactamente igual:

- **SEM Watcher**: si `resolveClientServiceCredentials(clientId,
  "google_ads").complete` es `false`, genera un warning legible
  (`warning_detected` en el bus de eventos) y sigue con las
  recomendaciones basadas solo en `config/sem-campaign-state.json`.
- **Analytics Watcher**: igual, por separado para `ga4` y `gtm` (uno
  puede faltar y el otro funcionar).
- **WordPress**: sin `wordpress_staging`/`wordpress_production`
  completos, `getWordpressStatusForReport()`/
  `getProductionStatusForReport()` devuelven `configured: false` —
  el WordPress Draft Agent sigue generando previews locales con
  normalidad, nunca intenta la llamada real.
- **SMTP**: si falta cualquier variable, `resolveSmtpConfig()` lanza
  ANTES de intentar conectar — el pase diario falla en el ultimo paso
  con un error claro (nombra la variable, nunca un valor). Es el unico
  servicio "duro" porque el email final es el entregable del pase.

`isServiceAllowed(clientConfig, service)` (Fase O16, `allowedServices`
de `client.config.json`) sigue siendo una capa DISTINTA e independiente
de esto — decide que servicios tendria sentido activar para ese
cliente (documental hoy, no aplicado por ningun agente todavia); esto
de aqui decide si HAY credenciales suficientes para el servicio que ya
se sabe que esta permitido.

## Que variables necesita un cliente nuevo

Depende de que servicios quiera activar de verdad (ver tabla). Como
minimo, para que `growth:daily --client <id>` (sin `--dry-run`) llegue
al final: `search_console` + `smtp`. Sin `wordpress_staging`, sigue
funcionando en modo "solo previews". Sin `google_ads`/`ga4`/`gtm`,
SEM/Analytics Watcher generan warnings pero no rompen nada.

**Mientras un cliente no tenga sus credenciales reales, mantenerlo con
`isSandbox: true`** en `client.config.json` — el orquestador nunca
intenta un pase real para un cliente sandbox, pase lo que pase con las
variables de entorno.

## Que sigue igual (sin cambios en O16.2)

- Ningun secreto vive nunca en `clients/**/*.json` — `clients:validate`
  lo sigue comprobando.
- Los GATES de seguridad de escritura (`WORDPRESS_ENV`,
  `assertWordpressWriteAllowed()`, los 3 flags de produccion, Novamira
  Guard) no dependen de este esquema de credenciales — siguen siendo
  los mismos de las fases O10-O14, sin cambios.
- `.env` real de Zentry no se toco en ningun momento de esta fase.

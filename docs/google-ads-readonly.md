# Google Ads — integracion de solo lectura (Fase O11)

## Por que existe este documento

`src/adapters/google-ads.ts` es el primer y unico punto de contacto de
todo el proyecto con la API de Google Ads. Igual que
`docs/wordpress-safety-policy.md` documenta las garantias del unico
agente con permiso de escritura del sistema, este documento existe para
dejar explicito, en un sitio, por que este adaptador **no puede**
escribir nada en la cuenta aunque algun dia se le den credenciales con
mas permisos de los necesarios.

## Lo que este adaptador NUNCA hace (por diseno)

- **No activa ninguna campana.** No existe ninguna funcion que llame a
  `campaigns:mutate` ni que cambie `campaign.status`.
- **No cambia presupuestos.** No existe ninguna funcion que llame a
  `campaignBudgets:mutate`.
- **No crea keywords.** No existe ninguna funcion que llame a
  `adGroupCriteria:mutate` ni `campaignCriteria:mutate` con una operacion
  `create`/`update`/`remove`.
- **No crea anuncios.** No existe ninguna funcion que llame a
  `adGroupAds:mutate`.
- **No toca conversiones.** No existe ninguna funcion que llame a
  `conversionActions:mutate` ni a `conversionUploadService`.
- **No llama a ningun endpoint `:mutate` de ninguna clase.** El unico
  metodo de la API REST de Google Ads que este fichero conoce es
  `googleAds:search` (consulta GAQL de solo lectura). No hay ninguna
  importacion ni referencia a `:searchStream` con efectos secundarios ni
  a ningun endpoint de mutacion — buscar `mutate` en
  `src/adapters/google-ads.ts` no encuentra nada.
- **No imprime secretos.** `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_OAUTH_CLIENT_SECRET` y `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`
  nunca se loguean ni se imprimen; cualquier error de red/API se sanitiza
  antes de mostrarse (`sanitizeError()`, mismo patron que
  `search-console.ts` y `telegram-gateway.ts`).

## Que lee (SEM Watcher Agent)

Cuando las 6 variables de entorno de Google Ads estan configuradas
(`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`,
`GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`,
`GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`), `getGoogleAdsSnapshot()`
ejecuta 6 consultas GAQL de solo lectura en paralelo:

1. Campanas (id, nombre, estado, tipo, presupuesto diario).
2. Ad groups (id, nombre, estado, campana).
3. Keywords a nivel de ad group (`keyword_view`), separadas en
   positivas/negativas segun `ad_group_criterion.negative`.
4. Keywords negativas a nivel de campana (`campaign_criterion`).
5. Anuncios Responsive Search Ads (titulares, descripciones, estado).
6. Acciones de conversion (nombre, categoria, tipo, estado).
7. Metricas basicas de los ultimos 30 dias (impresiones, clics, coste,
   conversiones, CTR) — una consulta adicional sobre `campaign`.

## Como obtener el refresh token

`npm run auth:google-ads` (`scripts/get-google-ads-refresh-token.ts`, Fase
O11.2) — mismo patron y garantias que `npm run auth:gsc`: reutiliza
`GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET` si ya estan en `.env`, genera la URL
de consentimiento (scope `adwords`), pide el authorization code con
entrada enmascarada, y antes de guardar hace un backup de `.env`
(permisos 600) y pide confirmacion explicita. El refresh token nunca se
imprime completo (solo enmascarado) y el script no ejecuta ninguna
llamada a la API de Ads mas alla del intercambio OAuth2 estandar.

## Autenticacion

OAuth2 puro (igual filosofia que Search Console, Fase OAuth2): un
`google.auth.OAuth2` de `googleapis` renueva el access token a partir del
refresh token en cada ejecucion — no se guarda ningun access token en
disco. El scope requerido en el OAuth Client es
`https://www.googleapis.com/auth/adwords`.

`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (la MCC) se envia siempre en el header
`login-customer-id` de cada peticion — es obligatorio cuando la cuenta
cliente (`GOOGLE_ADS_CUSTOMER_ID`) esta gestionada a traves de una MCC;
sin el, la API responde `USER_PERMISSION_DENIED` aunque el resto de
credenciales sean correctas.

`GOOGLE_ADS_API_VERSION` es opcional (por defecto una version reciente
fijada en el codigo) — permite subir de version cuando Google deprecie la
actual sin tener que tocar `src/adapters/google-ads.ts`.

## Si faltan credenciales o falla la lectura

`src/agents/sem-watcher.ts` nunca deja que un problema de Google Ads
tumbe el pase diario:

- **Sin credenciales:** se salta la lectura real, emite un
  `warning_detected` con las variables que faltan, y usa el estado
  documentado a mano en `config/sem-campaign-state.json` como respaldo
  (igual que antes de la Fase O11).
- **Con credenciales pero la lectura falla** (red, token invalido,
  cuenta sin acceso...): captura el error, lo sanitiza, lo registra como
  warning, y cae al mismo respaldo — `connected` queda en `false` en el
  resultado del agente exactamente igual que si no hubiera credenciales.

## Informe

`reports/sem/sem-<fecha>.md` incluye, cuando hay lectura real: ad groups,
primeras 20 keywords positivas, recuento de negativas (por nivel),
anuncios RSA, acciones de conversion y metricas de 30 dias — siempre con
el recordatorio explicito de que este agente nunca modifica nada, y la
confirmacion de que la campana sigue en el estado leido (PAUSED, salvo
que el cliente la active manualmente fuera de este sistema).

## Ver tambien

- `docs/analytics-readonly.md` — equivalente para GA4/GTM.
- `config/sem-campaign-state.json` — estado de respaldo cuando no hay
  lectura real.
- `departments/web-growth/agents/sem-watcher.agent.md` — spec del agente.

# Arquitectura multi-cliente (Fase O16)

## Por que existe esta fase

El departamento Web & Growth funcionaba para un unico cliente/web
(Zentry Lockers / Tukandado), con toda su configuracion de negocio
mezclada entre `config/*.json`, variables de `.env` y, en algunos
sitios, literales sueltos en el codigo o en comentarios. Antes de poder
enchufar un segundo cliente sin rehacer el sistema, hacia falta separar
con claridad **que es del core de la plataforma** (logica compartida)
y **que es especifico de cada cliente** (marca, dominios, competidores,
cuentas de Ads/GA4/GTM, politicas...).

Esta fase construye esa separacion **sin migrar nada de forma
destructiva**: Zentry sigue funcionando exactamente igual que antes
(mismo `npm run growth:daily`, mismos ficheros `data/`, `reports/`,
`logs/` en la raiz del proyecto, mismo timer systemd, cero cambios en
`config/*.json` originales). Lo nuevo es una capa que convive al lado.

## Estructura

```
/opt/zentry-ai-department/
  src/core/
    client-config.ts   <- tipo ClientConfig, loader, validador
    client-paths.ts    <- resuelve data/reports/logs por cliente
  clients/
    zentry/
      client.config.json
      brand-positioning.json
      competitors.json
      wordpress.json
      seo.json
      analytics.json
      ads.json
      templates.json
      autonomy-policy.json
      notification-policy.json
      data/    (vacia -- zentry sigue usando data/ de la raiz)
      reports/ (vacia -- zentry sigue usando reports/ de la raiz)
      logs/    (vacia -- zentry sigue usando logs/ de la raiz)
    demo/
      ... (mismo esquema, con dominios .invalid y sin credenciales)
  config/              <- SIN CAMBIOS de contenido; varios modulos ahora
                          llegan aqui INDIRECTAMENTE via ClientConfig
                          (ver tabla de cableado) en vez de un path fijo
  data/ reports/ logs/ <- SIN CAMBIOS, historico real de zentry
```

## Estado de cableado por modulo (honesto, no aspiracional)

Actualizado tras la **Fase O16.1** (rewire progresivo en 7 lotes, todos
verificados con typecheck + `npm test` + `clients:validate` +
`growth:daily --client demo --dry-run` + `growth:daily --client zentry`
real tras cada lote — ver historial en la memoria del asistente).

| Modulo | Lee ClientConfig hoy | Notas |
|---|---|---|
| `scripts/run-daily-growth-department.ts` (orquestador) | **Si** | Resuelve `--client`/`CLIENT_ID`, decide pase real vs. dry-run |
| `scripts/list-clients.ts` / `scripts/validate-clients.ts` | **Si** | Consumidores completos desde O16 |
| **Paths (`data`/`reports`/`logs`)** — 45 ficheros de `src/core` y `src/agents` | **Si (Lote 1)** | Todos usan `resolveActiveClientPaths()` en vez de `path.join(__dirname, "..", "..", "data"/"reports"/"logs")` fijo. Para "zentry" resuelve exactamente a las mismas carpetas legacy de la raiz — cero cambio de comportamiento |
| Brand/Intent Router (`brand-intent-router.ts`) | **Si (Lote 2)** | Lee `configPaths.brandPositioning` (`clients/<id>/brand-positioning.json`) |
| Competitor Intelligence — `competitors.json` | **Si (Lote 2)** | Lee `configPaths.competitors`. `seo-target-keywords.json` (usado por el mismo agente) sigue en `config/` — pendiente, ver O16.2 |
| SEO Director / Content Planner / CRO Reviewer / UX-UI Landing Architect | **Si (transitivo, Lote 3)** | No tienen lectura de config propia — heredan el rewire de Brand/Intent Router y solo consumen datos ya generados (jobs/acciones/work orders). Nada que cambiar en estos ficheros |
| SEO Watcher — `thresholds.json`/`seo-target-keywords.json` | **Si (Lote 4)** | Lee `configPaths.seo` -> `thresholdsConfigPath`/`targetKeywordsConfigPath` (para "zentry" siguen apuntando a `config/`, es indireccion real pero mismo destino hoy) |
| Search Console adapter — `siteUrl` | **Si (Lote 4)** | Prefiere `seo.json` -> `searchConsoleSiteUrl`, cae a `GSC_SITE_URL` de `.env` si el cliente no define uno. Fechas/lookback siguen 100% en `.env` (logica ya estabilizada, no tocada) |
| Google Ads adapter — `customerId`/`loginCustomerId`/`apiVersion` | **Si (Lote 5)** | Prefiere `ads.json`, cae a `.env`. `hasGoogleAdsCredentials()` (el gate real de "hay credenciales") sigue comprobando SOLO `.env` a proposito — developer token/OAuth2 son secretos, nunca van en JSON |
| GA4 adapter — `propertyId`/`measurementId` | **Si (Lote 5)** | Mismo patron que Ads. `hasGa4Credentials()` sin cambios |
| GTM adapter — `containerId`/`workspaceId` | **Si (Lote 5)** | Mismo patron. `hasGtmCredentials()` sin cambios |
| Telegram Gateway | **Si (Lote 6)** | Los NOMBRES de `TELEGRAM_APPROVALS_ENABLED`/`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` vienen de `notificationSettings` (nunca los valores/secretos) |
| Mailer — destinatario del email diario | **Si (Lote 6)** | El NOMBRE de `REPORT_EMAIL_TO` viene de `notificationSettings.reportEmailToEnvVar`. Cuenta SMTP emisora (host/usuario/pass) sigue siendo infra compartida, no por cliente |
| WordPress adapters — `resolveWordpressTargetUrl()` | **Si (Lote 7)** | Prefiere `stagingUrl`/`productionUrl` del ClientConfig, cae a `.env`. Los GATES de seguridad (`resolveWordpressEnv()`, `assertWordpressWriteAllowed()`, los 3 flags de escritura) **NO se tocaron** — siguen siendo env-var puro, a proposito |
| WordPress adapters — credenciales (usuario/Application Password) | No, a proposito | Secretos reales, permanecen solo en `.env` |
| Production Deployment Planner / Production Draft Executor | No | Solo consumen `resolveWordpressTargetUrl()` (ya rewireado) y flags de entorno (sin cambios); no tienen config propia que migrar |
| Autonomy Policy / Notification Policy (`src/core/autonomy-policy.ts`/`notification-policy.ts`) | No | Siguen leyendo `config/autonomy-policy.json`/`config/notification-policy.json` directamente. Las copias en `clients/zentry/` siguen siendo snapshots documentales — pendiente para O16.2 |
| Novamira Guard / allowlist | No | `config/novamira-allowlist.json` sigue siendo config de plataforma compartida, no de cliente (decision correcta hoy: solo hay una conexion Novamira) |

**Por que quedaron pendientes exactamente esos 3 puntos (y no otros):**
Autonomy/Notification Policy y Novamira son los unicos casos donde
migrar el PUNTERO (que ya existe, `clients/zentry/autonomy-policy.json`
es un snapshot valido) implicaria ademas decidir si esas politicas deben
poder DIFERIR entre clientes o seguir siendo compartidas — una decision
de producto, no solo de arquitectura, que se dejo explicitamente para
que el cliente la tome (ver "Pendiente para la Fase O16.2" mas abajo).
`seo-target-keywords.json` en Competitor Intelligence se dejo igual por
ser compartido con SEO Watcher y no aportar riesgo/beneficio adicional
migrarlo a medias.

## Como funciona `growth:daily` con clientes

```
npm run growth:daily                              # == --client zentry, IDENTICO a antes de O16
npm run growth:daily -- --client zentry            # explicito, mismo resultado
npm run growth:daily -- --client demo --dry-run    # solo valida ClientConfig + estructura, CERO red
npm run growth:daily -- --dry-run                  # dry-run tambien para zentry (valvula de seguridad)
```

Reglas:
- `CLIENT_ID` (variable de entorno) o `--client <id>` seleccionan el
  cliente. Si ninguno esta definido, cae a `"zentry"` — el timer
  systemd actual no necesita ningun cambio para seguir funcionando
  igual.
- Si el `clientId` pedido no existe como carpeta en `clients/`, el
  sistema cae de forma segura a `"zentry"` con un aviso en consola (no
  rompe una ejecucion automatica por un typo).
- Si `isSandbox: true` en el `client.config.json` del cliente (como
  `demo`), o si se pasa `--dry-run` explicitamente, el orquestador
  **nunca invoca ningun agente real** — solo valida el `ClientConfig`,
  confirma/crea las carpetas `data/reports/logs` propias del cliente
  (nunca las de `zentry`, que son legacy y no se tocan) y escribe un
  marcador de texto. Cero llamadas de red, cero WordPress, cero email.
- Pedir el pase real (sin `--dry-run`) para cualquier cliente que no
  sea `zentry` da un error explicito hoy. Tras la Fase O16.1 varios
  modulos SI saben leer config por cliente (ver tabla de arriba), pero
  las CREDENCIALES (OAuth2, developer tokens, WordPress) siguen sin
  esquema multi-cliente en `.env` (una sola cuenta por variable) — por
  eso un cliente real nuevo sigue necesitando `isSandbox: true` hasta
  que O16.2 resuelva eso.

## Como anadir un cliente nuevo

1. Crear `clients/<id>/` copiando la estructura de `clients/demo/`
   (nunca la de `zentry`, que tiene notas y rutas especificas de ese
   cliente).
2. Rellenar `client.config.json`: `clientId`, `clientName`,
   `brandName`, `productionUrl`/`stagingUrl` reales, `isSandbox: false`
   cuando el cliente vaya en serio.
3. Rellenar `brand-positioning.json`, `competitors.json`,
   `wordpress.json`, `seo.json`, `analytics.json`, `ads.json`,
   `templates.json` con los datos reales del cliente (dominios,
   competidores, IDs de propiedad/cuenta — nunca credenciales).
4. **No tocar `allowedServices` a la ligera**: hoy es solo informativo
   (documenta que servicios tendria sentido activar), no bloquea nada
   por si mismo porque ningun agente llama todavia a `isServiceAllowed()`
   para decidir si ejecutarse (pendiente, ver O16.2).
5. `npm run clients:validate -- --client <id>` para comprobar schema,
   URLs, ficheros referenciados y ausencia de secretos en el JSON.
6. Mientras el cliente no tenga sus propias credenciales (esquema
   multi-cuenta en `.env`, pendiente de O16.2), dejarlo con
   `isSandbox: true` — asi `growth:daily --client <id>` sirve para
   validar estructura sin riesgo de que alguien lo ejecute "en serio"
   por error.

## Que credenciales van fuera del repo (siempre)

Ningun fichero bajo `clients/**/*.json` debe contener nunca:
- Tokens, refresh tokens, client secrets, app passwords, API keys.
- Usuario/contrasena de WordPress.
- Developer token de Google Ads.

Todo eso sigue viviendo **solo** en `.env` (permisos 600, con backup
antes/despues de cada edicion, nunca commiteado). `client.config.json`
solo referencia el **nombre** de la variable de entorno que la
contiene (ej. `"telegramBotTokenEnvVar": "TELEGRAM_BOT_TOKEN"`), nunca
el valor. `npm run clients:validate` escanea automaticamente cada JSON
de cliente en busca de valores con pinta de secreto bajo una clave
sensible (token/secret/pass/key/password) que no termine en `EnvVar`,
y falla la validacion si encuentra uno.

Identificadores de cuenta que **si** pueden vivir en el JSON del
repo porque no son credenciales por si solos (no dan acceso sin el
token/secret que los acompana, y varios ya son publicos por diseno —
el Measurement ID y el Container ID van embebidos en el HTML publico
del sitio): GA4 Property ID, GA4 Measurement ID, GTM Container/
Workspace ID, Google Ads Customer ID / Login Customer ID, Search
Console site URL (`sc-domain:...`).

## Que queda bloqueado por seguridad (sin cambios respecto a antes de O16)

Todos los guardrails existentes siguen intactos y no dependen de
`ClientConfig` para funcionar:
- `assertWordpressWriteAllowed()` sigue bloqueando incondicionalmente
  `WORDPRESS_ENV=production` para cualquier escritura.
- Los 3 flags de produccion (`PRODUCTION_EXECUTION_ENABLED`,
  `PRODUCTION_DRAFTS_ENABLED`, `PRODUCTION_BACKEND=rest`) + las 2
  aprobaciones de Telegram siguen siendo obligatorios para el unico
  camino de escritura en produccion.
- Novamira Guard (`src/core/novamira-guard.ts`, Fase O14) sigue siendo
  fail-closed independientemente del cliente.
- `isSandbox: true` es una capa **adicional**, no un reemplazo de
  ninguno de los guardrails anteriores.

## Servicios opcionales

`allowedServices` en `client.config.json` es una lista cerrada
(`KNOWN_SERVICES` en `src/core/client-config.ts`, 26 nombres — uno por
agente del pipeline mas el Telegram Gateway). Un cliente sin un
servicio en esa lista deberia considerarse "desactivado" para ese
cliente — hoy esto sigue siendo documental (lo valida `clients:validate`,
pero ningun agente lo consulta todavia para decidir si ejecutarse). En
O16.2, cada agente debera comprobar
`isServiceAllowed(clientConfig, "seo_watcher")` (ya exportada desde
`client-config.ts`) antes de ejecutarse.

## Comandos

```
npm run clients:list                              # lista todos los clientes y su resumen (sin secretos)
npm run clients:validate                          # valida TODOS los clientes
npm run clients:validate -- --client zentry        # valida solo uno
npm run growth:daily -- --client zentry            # pase real, identico a antes de O16
npm run growth:daily -- --client demo --dry-run     # pase seco, cero red
npm run growth:daily:all                          # TODOS los clientes de config/active-clients.json, ver Fase O16.3
```

## Fase O16.3 — bucle multi-cliente diario (completada)

`config/active-clients.json` (nuevo) lista los clientes que
`npm run growth:daily:all` ejecuta en una sola invocacion:

```json
{
  "clients": [
    { "clientId": "zentry", "enabled": true, "dryRun": false },
    { "clientId": "demo", "enabled": true, "dryRun": true }
  ]
}
```

`scripts/run-daily-growth-department-all.ts` ejecuta, para cada entrada
con `enabled !== false`, el MISMO `scripts/run-daily-growth-department.ts`
de siempre como un **proceso hijo aislado** (`child_process.execFileSync`)
— si un cliente falla, cuelga o lanza, no afecta a los demas ni al
proceso padre (se seguia con el siguiente, se marca `status: "failed"`
en el resumen, y el codigo de salida final es 1 solo si algun cliente
realmente fallo — un cliente `skipped_disabled`/`skipped_not_found`
nunca cuenta como fallo).

**Invariante de seguridad ABSOLUTA, sin override posible:** si
`clients/<id>/client.config.json` tiene `isSandbox: true`, ese cliente
SIEMPRE se ejecuta en `--dry-run`, sin excepcion — aunque
`active-clients.json` pida `dryRun: false` explicitamente, se IGNORA
(con un aviso explicito en consola y en el resumen). Verificado en vivo:
pedir `dryRun:false` para "demo" sigue produciendo un pase 100% dry-run,
cero llamadas de red.

Verificado tambien: un `clientId` inexistente en `active-clients.json`
se marca `skipped_not_found` con un mensaje claro (nunca crashea el
resto del bucle); una entrada `enabled: false` se marca
`skipped_disabled` sin ejecutarse.

## Fase O16.4 — resumen multi-cliente (completada)

Cada pasada de `growth:daily:all` escribe
`reports/multi-client/daily-summary-<fecha>.md` (nuevo namespace, no
interfiere con `reports/daily/` de Zentry) con, por cliente: estado,
sandbox, modo (real/dry-run), duracion, oportunidades SEO, propuestas
de contenido, gaps de competencia, propuestas preparadas para revision,
aprobaciones pendientes, conectividad Ads/GA4/GTM, si WordPress drafts
esta habilitado, salud de staging, si produccion se toco, y (best-effort,
heuristica deliberadamente estricta para no marcar como riesgo lineas
benignas tipo "fallan=0") lineas de riesgo/advertencia detectadas. Los
campos que un pase dry-run nunca genera (oportunidades, conectividad...)
se muestran como `n/d`, no como error.

**No se envia ningun email adicional "multi-cliente"**: cada cliente
sigue enviando (o no) su propio email exactamente igual que antes — el
resumen multi-cliente es solo un fichero.

**Desviacion deliberada del enunciado original, senalada explicitamente:**
el enunciado de O16.4 proponia, para clientes nuevos,
`reports/clients/<id>/`, `logs/clients/<id>/`, `data/clients/<id>/`
(anidando el cliente DENTRO de las carpetas compartidas). Se mantuvo en
su lugar la convencion ya construida y verificada en la Fase O16
(`clients/<id>/{data,reports,logs}/`, anidando data/reports/logs DENTRO
de la carpeta del cliente) — cambiar de convencion ahora habria
significado mantener dos esquemas de carpetas compitiendo, o migrar
infraestructura ya probada (`resolveClientPaths()`, 71 tests, el propio
flujo dry-run de "demo") sin ningun beneficio funcional. Si de verdad se
prefiere `reports/clients/<id>/`, es una migracion de una sola funcion
(`client-paths.ts`) a coordinar explicitamente antes de aplicarla.

## Fase O16.1 (completada) — que se rewireo de verdad

7 lotes, cada uno verificado con typecheck + `npm test` (64/64) +
`clients:validate` + `growth:daily --client demo --dry-run` +
`growth:daily --client zentry` real, sin caer nunca en fallback y sin
cambiar ni un numero de los que produce el pipeline:

1. **Paths** — 45 ficheros (`resolveActiveClientPaths()`).
2. **Brand positioning + competitors** (`resolveActiveClientConfigPath()`).
3. **SEO Director/Content Planner/CRO/UX-UI** — ya venian cableados
   transitivamente, sin cambios necesarios.
4. **SEO Watcher + Search Console** — `thresholds.json`/
   `seo-target-keywords.json`/`searchConsoleSiteUrl` via `seo.json`.
5. **Google Ads / GA4 / GTM** — `customerId`/`propertyId`/`containerId`/
   etc. via `ads.json`/`analytics.json`. Los checks de "hay
   credenciales" (`hasGoogleAdsCredentials`/`hasGa4Credentials`/
   `hasGtmCredentials`) siguen siendo 100% `.env` a proposito.
6. **Telegram Gateway + Mailer** — los NOMBRES de las variables de
   entorno (nunca los valores) vienen de `notificationSettings`.
7. **WordPress adapters** — `resolveWordpressTargetUrl()` via
   `stagingUrl`/`productionUrl` del ClientConfig. Los gates de
   seguridad (`resolveWordpressEnv`, `assertWordpressWriteAllowed`, los
   3 flags de escritura) **no se tocaron**.

Patron seguido en los 7 lotes: SIEMPRE "ClientConfig primero, `.env`/
`config/` legacy como fallback" — para "zentry" el valor configurado en
`clients/zentry/*.json` es identico al que habia en `.env`/`config/`,
asi que el resultado es byte-a-byte el mismo; el fallback solo se
ejercitaria si `clients/zentry/*.json` faltara un dato, cosa que
`clients:validate` detecta.

## Pendiente para la Fase O16.2

1. Soporte multi-credencial en `.env` (hoy las variables no llevan
   prefijo de cliente — `GA4_PROPERTY_ID` no `ZENTRY_GA4_PROPERTY_ID`;
   con un segundo cliente real hara falta decidir el esquema: prefijo
   por cliente, o un `.env` por cliente bajo `clients/<id>/.env`). Este
   es el bloqueador real para que un segundo cliente pueda dejar de ser
   `isSandbox: true`.
2. Bucle multi-cliente real en `growth:daily` (ejecutar el pipeline
   completo para varios clientes no-sandbox en una sola invocacion, con
   un email por cliente).
3. `isServiceAllowed()` consultado de verdad por cada agente antes de
   ejecutarse (hoy sigue siendo solo documental).
4. Copiar `novamira-allowlist.json` a un esquema por cliente (hoy es
   una config de plataforma compartida, no de cliente — cada cliente
   tendria su propia conexion Novamira/WordPress).
5. Decidir si `autonomy-policy.json`/`notification-policy.json` deben
   ser realmente por cliente o quedarse compartidas a nivel de
   plataforma (hoy las copias en `clients/zentry/` son solo un
   snapshot inerte, `src/core/autonomy-policy.ts`/`notification-policy.ts`
   siguen leyendo `config/` directamente).
6. `seo-target-keywords.json` de Competitor Intelligence — hoy sigue en
   `config/` (compartido con SEO Watcher, que ya lee la ruta via
   `seo.json`); valorar si conviene una `configPaths` propia o dejarlo
   como esta.

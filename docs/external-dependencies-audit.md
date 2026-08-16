# Auditoria de dependencias externas (Fase O50)

Fecha de la auditoria: **2026-08-16**. Rama: `claude/zentry-external-deps-audit-vp38id`.

Objetivo: determinar, con evidencia y no por deduccion, de donde salen hoy
los datos de cada integracion externa del departamento, si GitHub Actions
accede en vivo, y que sigue dependiendo del VPS legacy.

> **Conclusion en una linea:** antes de esta fase, **ninguna** de las
> cuatro integraciones Google se leia en vivo desde GitHub Actions. Los
> especialistas Claude que corren en Actions razonaban sobre snapshots
> generados por el **VPS legacy** y commiteados al repositorio — el
> ultimo, del **2026-08-14**. La pasada diaria de Actions del
> **2026-08-16** se completo con exito leyendo esos mismos datos de hace
> dos dias, sin una sola senal de que no eran de hoy.

---

## 1. El DAG real (reconstruido leyendo codigo, workflows e historial)

### Search Console → seo-specialist

```
Google Search Console API (searchanalytics.query)
  └─> src/adapters/search-console.ts          [determinista]
      └─> src/agents/seo-watcher.ts           [determinista]  npm run seo:watch
          ├─> data/jobs.jsonl                 (snapshot, COMMITEADO)
          ├─> reports/seo/seo-watcher-<fecha>.md
          └─> data/department-events.jsonl    (evento agent_finished)
                  ▲
                  │  ANTES: este tramo lo ejecutaba SOLO el VPS
                  │  (systemd `zentry-seo-watcher.timer`, 08:00 UTC,
                  │   `npm run growth:daily` en /opt/zentry-ai-department)
                  │  y llegaba a GitHub por commit.
                  │
              [git commit desde el VPS]
                  │
                  ▼
      src/employees/seo-specialist/context.ts [determinista, lee ficheros]
          └─> scripts/run-seo-specialist.ts   → prompt.md
              └─> subagente Claude `seo-specialist`   [razonamiento]
```

### GA4 + GTM → analytics-specialist

```
GA4 Data API (properties.runReport)  +  Tag Manager API v2 (list/get/live)
  └─> src/adapters/ga4.ts  /  src/adapters/gtm.ts     [deterministas]
      └─> src/agents/analytics-watcher.ts             npm run analytics:watch
          ├─> reports/analytics/analytics-<fecha>.md  (snapshot, COMMITEADO)
          └─> data/department-events.jsonl            (agent_finished con
                                                       ga4Connected/gtmConnected
                                                       + reportPath)
                  ▲
                  │  ANTES: solo el VPS. El payload del evento guarda la ruta
                  │  ABSOLUTA del VPS ("/opt/zentry-ai-department/reports/...").
                  │
              [git commit desde el VPS]
                  │
                  ▼
      src/employees/analytics-specialist/context.ts   [lee evento + parsea el .md]
          └─> scripts/run-analytics-specialist.ts     → prompt.md
              └─> subagente Claude `analytics-specialist`   [razonamiento]
```

Detalle importante: el snapshot completo de GA4/GTM **nunca se serializa
en el evento**. El evento solo lleva dos booleanos y una ruta; las cifras
reales se recuperan **parseando el Markdown** de `reports/analytics/*.md`.
Es decir, el especialista de analitica depende de un fichero Markdown
commiteado por el VPS.

### Google Ads → sem-specialist (en fase desde 2026-08-16)

```
Google Ads API (googleAds:search, GAQL solo lectura)
  └─> src/adapters/google-ads.ts        [determinista]
      └─> src/agents/sem-watcher.ts     npm run sem:watch
          └─> data/department-events.jsonl (agent_finished con el snapshot
                                            SEM COMPLETO en el payload)
                  │  (MISMA pasada, MISMO departmentRunId -- ya no hay
                  │   commit del VPS de por medio)
                  ▼
      src/employees/sem-specialist/sem-specialist-context.ts
          └─> scripts/run-sem-specialist.ts → subagente `sem-specialist`
              └─> src/department/specialist-inputs.ts (evidencia dept-sem-*)
                  └─> growth-director-v2 + Daily Brief
```

SEM ya **no esta fuera de fase**. El watcher lee la cuenta en vivo y el
especialista razona sobre ESA lectura dentro de la misma pasada, con el
mismo `departmentRunId` (`freshness=live_this_run`), y su salida llega a
Growth Director como la de cualquier otro especialista.

Lo que estaba roto hasta 2026-08-16 (y por que el probe pasaba mientras
el departamento SEM no funcionaba):

1. `sem-specialist.yml` no ejecutaba el watcher: leia el ultimo evento
   `sem-watcher` **commiteado**, siempre stale y anterior a la Fase O51.
2. El auditor de afirmaciones cuantitativas rechazaba frases legitimas
   (la duracion de la ventana, "30 dias", se leia como una cifra de
   conversiones inventada) -- 8 ejecuciones seguidas en rojo.
3. `sem-specialist` estaba cableado a `not_available` en la fase `init`
   de la pasada coordinada, asi que Ads se leia en vivo cada dia y no
   llegaba ni a Growth ni al brief.

### Que NO estaba en el DAG

- **GitHub Actions no ejecutaba ningun watcher.** Ni `seo:watch`, ni
  `analytics:watch`, ni `sem:watch`, ni `growth:daily`. Verificado sobre
  los 15 workflows: hasta esta fase **ningun** workflow inyectaba una
  sola variable `GSC_*`, `GA4_*`, `GTM_*` ni `GOOGLE_*`.
- **Ningun especialista Claude tiene acceso a una API externa.** Eso es
  correcto por diseno y se mantiene: los subagentes no tienen
  herramientas. Pero por eso mismo, *que un especialista produzca output
  no demuestra absolutamente nada sobre acceso live* — que era justo la
  hipotesis a comprobar.

---

## 2. Estado por integracion

| Integracion | Estado ANTES | Estado DESPUES de esta fase |
|---|---|---|
| Search Console | `LIVE_VPS_DEPENDENT` + `STALE_RISK` | `LIVE_GITHUB` (en cuanto existan los 3 secretos GSC) |
| GA4 | `LIVE_VPS_DEPENDENT` + `STALE_RISK` | `LIVE_GITHUB` (en cuanto existan los 3 secretos GOOGLE_ANALYTICS) |
| GTM | `LIVE_VPS_DEPENDENT` + `STALE_RISK` | `LIVE_GITHUB` (comparte los secretos de GA4) |
| Google Ads | `SNAPSHOT_ONLY` (fuera de fase) | `SNAPSHOT_ONLY` — probe disponible, recoleccion NO migrada a propostio |
| WordPress staging / produccion | `LIVE_GITHUB` (ya lo estaba) | sin cambios (fuera de alcance) |
| Novamira MCP | `LIVE_GITHUB` (ya lo estaba) | sin cambios (fuera de alcance) |
| SMTP (email del Daily Brief) | `LIVE_GITHUB` (ya lo estaba) | sin cambios |
| Telegram / Cloudflare / D1 | `NOT_CONNECTED` en la pasada diaria | sin cambios (no tocar) |

`STALE_RISK` era real y silencioso: nada en el codigo comprobaba la
antigüedad del snapshot antes de dárselo a un especialista.

---

## 3. Variables de entorno por servicio (solo NOMBRES)

Derivadas del catalogo unico `CLIENT_SERVICE_CREDENTIAL_KEYS` en
`src/core/client-config.ts` y de los adaptadores. **No se ha leido ni se
lee el `.env` del VPS**: esta sesion no tiene acceso a esa maquina, asi
que los nombres salen del codigo que los consume.

### Sensibilidad y destino recomendado

| Variable | Servicio que la consume | Sensibilidad | Destino en GitHub |
|---|---|---|---|
| `GSC_OAUTH_CLIENT_ID` | Search Console | secreto | Actions **secret** |
| `GSC_OAUTH_CLIENT_SECRET` | Search Console | secreto | Actions **secret** |
| `GSC_OAUTH_REFRESH_TOKEN` | Search Console | secreto | Actions **secret** |
| `GOOGLE_ANALYTICS_OAUTH_CLIENT_ID` | GA4 **y** GTM | secreto | Actions **secret** |
| `GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET` | GA4 **y** GTM | secreto | Actions **secret** |
| `GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN` | GA4 **y** GTM | secreto | Actions **secret** |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads | secreto | Actions **secret** |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` | Google Ads | secreto | Actions **secret** |
| `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | Google Ads | secreto | Actions **secret** |
| `GOOGLE_ADS_OAUTH_REFRESH_TOKEN` | Google Ads | secreto | Actions **secret** |
| `GSC_SITE_URL` | Search Console | no sensible | **nada que migrar** — ya en `clients/zentry/seo.json` |
| `GA4_PROPERTY_ID` | GA4 | no sensible | **nada que migrar** — ya en `clients/zentry/analytics.json` |
| `GA4_MEASUREMENT_ID` | GA4 | no sensible | idem |
| `GTM_CONTAINER_ID` | GTM | no sensible | idem |
| `GTM_WORKSPACE_ID` | GTM | no sensible | idem |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads | no sensible | **nada que migrar** — ya en `clients/zentry/ads.json` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Google Ads | no sensible | idem |
| `GOOGLE_ADS_API_VERSION` | Google Ads | no sensible | idem |

**Solo hay 10 secretos que migrar. Cero repository variables.** Todos los
identificadores no sensibles ya estan commiteados en `clients/zentry/`, y
los adaptadores los prefieren desde la Fase O16.1.

### Nombres recomendados en GitHub

**Los mismos, sin renombrar.** `resolveClientEnvVar()` acepta la forma
`ZENTRY_<VARIABLE>` y, para el cliente por defecto, tambien la forma sin
prefijo — que es exactamente la que ya tiene el `.env` del VPS. Copiar
valor a valor sin tocar el nombre elimina el riesgo de mapear mal una
credencial, que en Google Ads (donde conviven developer token, client id,
client secret, refresh token, customer id y login customer id) es un
riesgo real.

### Otras variables relacionadas, ya presentes en Actions

`WORDPRESS_*`, `WP_API_*`, `SMTP_*`, `REPORT_EMAIL_*`,
`DAILY_BRIEF_EMAIL_TO`, `CLAUDE_CODE_OAUTH_TOKEN`, `APPROVALS_API_*`,
`TELEGRAM_*`. No se duplica ninguna.

### Lo que NO se ha podido verificar

- **El contenido real del `.env` del VPS.** No hay acceso SSH desde esta
  sesion, y `.env`/`.env.*` estan en `.gitignore` (no hay ni un
  `.env.example` commiteado). Los nombres de arriba son los que el codigo
  **espera**; si el VPS tiene ademas variables que ningun adaptador lee,
  no aparecen aqui.
- **Que secretos existen hoy en GitHub Actions.** La API de GitHub no
  expone la lista de secretos a esta sesion. Para eso esta el workflow
  `google-live-probe.yml`: al ejecutarlo, cada servicio queda en `live` o
  en `missing_credentials` con los nombres exactos que faltan — sin
  imprimir un solo valor. **Ese workflow es la unica forma honesta de
  responder a la pregunta, y hay que ejecutarlo para saberlo.**
- **El modelo de auth de Google Ads no esta confirmado contra la cuenta
  real**, solo contra el codigo (ver seccion 5).

---

## 4. Frescura de los datos (medida, no estimada)

| Snapshot | Lo genera | Ultima generacion | Cadence | ¿Lo genera Actions? |
|---|---|---|---|---|
| `data/jobs.jsonl` (Search Console) | `seo-watcher` en el **VPS** | `2026-08-14T11:12:48Z` | diaria, 08:00 UTC (systemd) | **antes NO**, solo lo consumia |
| `reports/analytics/*.md` (GA4/GTM) | `analytics-watcher` en el **VPS** | `2026-08-14T11:13:33Z` | diaria, misma pasada | **antes NO** |
| `data/department-events.jsonl` (SEM) | `sem-watcher` en el **VPS** | `2026-08-14T11:13:30Z` | diaria, misma pasada | **antes NO** |
| `reports/daily/*.md` | `growth-director` (v1) en el **VPS** | `2026-08-14T11:14:58Z` | diaria | NO |

Al cierre de esta auditoria (2026-08-16), el snapshot SEO tenia **50,7
horas**. Medido, no estimado — es lo que imprime ahora el propio runner:

```
Procedencia del snapshot SEO: stale, fuente=search_console
  (leido el 2026-08-14T11:12:48.024Z, hace 50.7 h).
```

Antes de esta fase, ese mismo dato entraba en el prompt del especialista
sin ninguna etiqueta.

Dato adicional encontrado en `data/credential-health.jsonl`: entre el
2026-08-14T06:33Z y el 09:52Z, GA4 encadeno **4 fallos consecutivos** y
GTM 1, y ambos se recuperaron a las 10:17Z. Los refresh tokens OAuth de
estas cuentas ya han caducado antes (ver la nota de la Fase O49 sobre
apps OAuth en modo *Testing*, cuyos refresh tokens caducan a los 7 dias).
**Es probable que haya que renovarlos antes de migrarlos.**

---

## 5. Modelo de autenticacion real por servicio

Leido del codigo, sin suponer nada:

| Servicio | Modelo | Detalle |
|---|---|---|
| Search Console | **OAuth2 client + refresh token** | `src/adapters/search-console.ts` soporta *tambien* service account (`GSC_SERVICE_ACCOUNT_JSON_PATH`), pero `resolveAuthMethod()` autodetecta OAuth2 cuando existen las tres variables OAuth. La rama service account **no se usa hoy** y no se migra: un fichero de clave en un runner efimero es peor opcion que un refresh token. Scope: `webmasters.readonly`. |
| GA4 | **OAuth2 client + refresh token** | Scope `analytics.readonly`. Sin service account en el codigo. |
| GTM | **OAuth2 client + refresh token — el MISMO cliente que GA4** | `gtm.ts` lee literalmente las variables `GOOGLE_ANALYTICS_OAUTH_*`. Un unico cliente OAuth debe tener los dos scopes (`analytics.readonly` **y** `tagmanager.readonly`). Si el refresh token se genero solo con el scope de GA4, GTM fallara con permisos aunque las credenciales sean "correctas". |
| Google Ads | **developer token + OAuth2 client + refresh token + login-customer-id** | Los cuatro son piezas distintas y no intercambiables. |

### Google Ads, pieza por pieza (como pediste, separadas)

| Pieza | Variable | ¿Es credencial? | De donde sale hoy |
|---|---|---|---|
| Developer token | `GOOGLE_ADS_DEVELOPER_TOKEN` | **si**, secreto | `.env` (cabecera HTTP `developer-token`) |
| Client ID | `GOOGLE_ADS_OAUTH_CLIENT_ID` | si | `.env` |
| Client secret | `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | si | `.env` |
| Refresh token | `GOOGLE_ADS_OAUTH_REFRESH_TOKEN` | si | `.env` (scope `adwords`) |
| Login customer ID (MCC) | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | no | `clients/zentry/ads.json` → `loginCustomerId` (cabecera `login-customer-id`) |
| Customer ID (cuenta) | `GOOGLE_ADS_CUSTOMER_ID` | no | `clients/zentry/ads.json` → `customerId` (va en la URL) |
| Version de API | `GOOGLE_ADS_API_VERSION` | no | `clients/zentry/ads.json` → `apiVersion` |

El client OAuth de Ads es **independiente** del de GA4/GTM y del de
Search Console: son tres clientes distintos con tres refresh tokens
distintos. No se pueden reutilizar entre si.

---

## 6. Que cambia en esta fase

### Migrado

1. **La recoleccion Google entra en GitHub Actions.** Nueva `FASE 0.5 —
   FUENTES LIVE` en `zentry-ai-department-daily.yml`: `seo:watch` y
   `analytics:watch` corren dentro de la pasada, con los secretos
   inyectados y con **el mismo `departmentRunId`**, de forma que el
   snapshot que leen despues los especialistas es demostrablemente de esa
   pasada. El flujo queda como pediste:
   `GitHub Actions → Google API → snapshot actual → Claude`.

2. **La separacion se mantiene intacta.** La recoleccion sigue siendo
   codigo determinista (adaptadores + watchers); el razonamiento sigue
   siendo el agente Claude sin herramientas. Ningun especialista recibe
   credenciales de Google, ni directa ni indirectamente.

3. **Google Ads NO se migra la recoleccion** — sigue fuera de fase. Solo
   se deja el probe disponible para cuando se retome.

### Guards anti-dato-viejo (`src/core/snapshot-freshness.ts`)

- Se separan `generatedAt` (cuando se construyo el contexto — siempre
  "ahora") y **`sourceGeneratedAt`** (cuando se hablo con la API). Que
  fueran lo mismo era el mecanismo exacto por el que un snapshot de hace
  dias se presentaba como lectura de hoy.
- Cuatro estados: `live_this_run`, `fresh`, `stale`, `unknown`. Una marca
  de tiempo ausente o ilegible da `unknown`, **nunca** "reciente por
  defecto".
- La procedencia va **la primera** en el prompt del especialista, antes
  de cualquier cifra, con una instruccion explicita de no presentar datos
  viejos como actuales.
- `SNAPSHOT_MAX_AGE_HOURS` (por defecto 26 h) y `REQUIRE_LIVE_SOURCES`
  (fail-closed opcional: sin lectura de esta pasada, la etapa falla con
  un error que dice que falta y como arreglarlo).
- `seo-specialist` recibe ademas `sourceKind`: si los jobs vienen del
  adaptador placeholder (`SEO_DATA_SOURCE=mock`), el prompt lo dice en
  mayusculas. Antes, unos jobs de ejemplo eran indistinguibles de los
  reales a simple vista.

### Incoherencia corregida en el gate de credenciales

`resolveClientServiceCredentials()` exigia `GA4_PROPERTY_ID`,
`GTM_CONTAINER_ID`, `GTM_WORKSPACE_ID`, `GOOGLE_ADS_CUSTOMER_ID` y
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` como variables de entorno, cuando los
adaptadores ya los resuelven desde `clients/<id>/*.json` desde la Fase
O16.1. Resultado: `hasGa4Credentials()` podia decir "falta
GA4_PROPERTY_ID" y hacer que el watcher se saltara GA4 **por una variable
que no necesitaba**. Ahora el gate reconoce lo que aporta la
configuracion del cliente — y **solo** para identificadores no secretos:
ni un client secret, refresh token o developer token puede resolverse por
esa via (hay un test que lo fija).

### Probe live READ-ONLY

`npm run probe:google` y el workflow `google-live-probe.yml`. Por
servicio: `sites.list` (GSC), `runReport` con una metrica (GA4),
`accounts.list` (GTM), `SELECT ... FROM customer LIMIT 1` (Ads). Cero
escrituras, cero valores impresos, y un guardia final que aborta antes de
imprimir si detectara el valor de un secreto en su propia salida.

---

## 7. Si apagamos el VPS hoy

| Pieza | Que le pasa |
|---|---|
| Pasada diaria en Actions (`zentry-ai-department-daily.yml`) | **Sigue funcionando.** |
| `seo-specialist` | Con los 3 secretos GSC: **datos live de esa pasada**. Sin ellos: usa el ultimo snapshot, **etiquetado `stale`** con su antigüedad exacta. |
| `analytics-specialist` | Igual, con los 3 secretos `GOOGLE_ANALYTICS_*`. |
| `content-strategist`, `qa-reviewer`, `web-engineer`, `growth-director-v2` | Sin cambios: ya operaban sobre artefactos de la propia pasada. |
| `sem-specialist` | Desde 2026-08-16 corre en la pasada diaria sobre la lectura live de Google Ads de esa misma pasada (`live_this_run`). Ya no depende de ningun snapshot commiteado. |
| `growth-director` **v1** (informes `reports/daily/*.md`) | **Se pierde.** Solo lo ejecuta el VPS (`npm run growth:daily`); ningun workflow lo lanza. No se ha migrado en esta fase. |
| Email del Daily Brief | Sigue funcionando (SMTP ya esta en Actions). |
| Timer systemd, cron legacy, servicios del VPS | Se paran. No se ha apagado nada. |

Lo que ya **no** puede pasar: que un especialista presente datos viejos
como si fueran de hoy. O son de la pasada, o llevan la etiqueta.

---

## 8. Siguiente paso minimo para poder llamar independiente al departamento

1. Renovar (probablemente hara falta, ver seccion 4) y cargar en GitHub
   Actions Secrets los **6 secretos** de Search Console + GA4/GTM, con
   los mismos nombres.
2. Ejecutar `google-live-probe.yml` y comprobar que GSC/GA4/GTM quedan en
   `live`.
3. Lanzar la pasada diaria y verificar que los especialistas reportan
   `live_this_run`.
4. Solo entonces: poner `REQUIRE_LIVE_SOURCES=true` para que una fuente
   critica ausente falle de forma explicita en vez de degradar a snapshot.
5. Migrar `growth-director` v1 a Actions, o aceptar explicitamente que
   los informes `reports/daily/*.md` desaparecen al apagar el VPS.

Hasta el paso 3, el departamento **no es independiente del VPS** para los
datos de SEO y analitica: funcionaria, pero sobre el ultimo snapshot que
dejo el VPS.

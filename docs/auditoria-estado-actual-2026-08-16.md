# ESTADO ACTUAL — ZENTRY AI DEPARTMENT

Auditoría de solo lectura. Fecha: **2026-08-16**. Commit auditado: **`88f3b75`** (= `origin/main` = `HEAD`).
No se ha modificado ningún componente del sistema. Las únicas ejecuciones realizadas han sido locales e inocuas
(`npm ci`, `npm run test`) y lecturas de la API de GitHub.

---

## 1. Resumen ejecutivo

El departamento **sí ejecuta Claude de verdad**: 6 invocaciones reales de `claude-sonnet-5` por pasada,
con salida validada contra JSON Schema, coste medido ($3.16 en la pasada del run `31969938538`).
Eso ya no es "scripts con nombre de agente": son seis sesiones LLM independientes encadenadas.
Pero por debajo sigue corriendo un pipeline **determinista de 26 agentes sin IA** que genera la mayor
parte del estado, y los seis empleados Claude tienen **cero herramientas** (`allowedTools: []`): no leen,
no navegan, no actúan. Solo razonan sobre un prompt que les prepara código determinista.

Hoy hay **tres bloqueos duros**. (1) `main` está **rojo**: su última pasada (run `31955370754`) murió en
la puerta final porque `growth-director-v2` no dejó salida — fallo intermitente del runtime. (2) La
**persistencia no funciona**: la rama `department-state` tiene **un único commit** y los 3 runs
posteriores fallaron la verificación de estado, tirando a la basura todo su trabajo. (3) **Valor de
negocio entregado = 0**: en la única pasada persistida, QA bloqueó las 7 recomendaciones; en la última,
las 7 acciones quedaron en `requires_manual_staging_implementation`. Nada se aplica solo.

Las fuentes LIVE (Search Console, GA4, GTM, Google Ads) **sí leen en vivo y fail-closed**, verificado
en la misma pasada. La escritura reversible en staging vía `execute-php` está probada E2E. Producción
lleva sin recibir una escritura del departamento desde el 2026-08-05.

**No es todavía un departamento autónomo. Es un analista multiagente muy bien instrumentado que
produce un informe diario y se apaga.**

---

## 2. Estado de arquitectura (la REAL, no la pretendida)

```
                       cron 07:00 UTC (0 7 * * *)  ── único disparador automático real
                                 │
                 ┌───────────────┴────────────────┐
                 ▼                                ▼
  zentry-ai-department-daily.yml     ux-ui-landing-architect-v2.yml
  (1 job, 69 pasos SECUENCIALES)     (1 empleado Claude, salida → artifact
                 │                     que NADIE consume; ver §10)
                 │
   ┌─────────────┴─────────────────────────────────────────────┐
   │ JOB 1  "Pasada coordinada"  permissions: contents: read    │
   └────────────────────────────────────────────────────────────┘
     │
     ├─ [STATE] restore   git checkout FETCH_HEAD(department-state) -- data reports
     ├─ [STATE] snapshot-before   (state:snapshot)
     ├─ [COORD] init      → departmentRunId = dept-<ts>Z
     │
     ├─ [LIVE] seo:watch        --require-live  → Search Console     (DETERMINISTA)
     ├─ [LIVE] analytics:watch  --require-live  → GA4 + GTM          (DETERMINISTA)
     ├─ [LIVE] sem:watch        --require-live  → Google Ads         (DETERMINISTA)
     │
     ├─ [GROWTH-V1] growth:daily --skip-watchers --no-email
     │      └─ 26 agentes DETERMINISTAS (0 llamadas a LLM)
     │         seo-director, competitor-intelligence, content-planner,
     │         cro-landing-reviewer, approval-queue, approved-action-planner,
     │         *-work-order-builder, *-change-pack-builder,
     │         ux-ui-landing-architect(v1), wordpress-draft-agent,
     │         visual-*, staging-executor, staging-qa-agent,
     │         approval-gateway, production-deployment-planner,
     │         production-draft-executor, growth-director(v1)
     │         → reports/daily/executive-<fecha>.md + technical-<fecha>.md
     │
     ├─ SEO        prep(TS) → 🧠 CLAUDE seo-specialist       → validate(TS) → register
     ├─ CONTENT    prep(TS) → 🧠 CLAUDE content-strategist   → validate(TS) → register
     ├─ ANALYTICS  prep(TS) → 🧠 CLAUDE analytics-specialist → validate(TS) → register
     ├─ GROWTH     prep(TS) → 🧠 CLAUDE growth-director-v2   → validate(TS)      ← "coordinador"
     ├─ QA         prep(TS) → 🧠 CLAUDE qa-reviewer          → PUERTA promotion.json
     ├─ [STAGING]  lectura real del inventario WordPress (solo lectura)
     ├─ WEB-ENG    prep(TS) → 🧠 CLAUDE web-engineer         → validate(TS)
     │                        (SKIPPED si QA bloquea todo)
     ├─ [APPLY]    plan del contrato de apply — 0 escrituras
     ├─ [COORD]    Daily Brief JSON + MD
     ├─ [EMAIL]    envío SMTP del Daily Brief
     ├─ [STATE] verify  ──FAIL-CLOSED──▶ si detecta pérdida: NO se empaqueta nada
     └─ [COORD] gate    ──si alguna etapa "failed": exit 1 (run ROJO)

   ┌────────────────────────────────────────────────────────────┐
   │ JOB 2  "persist-state"  needs: JOB 1 (sin if: always)      │
   │ permissions: contents: write  ← ÚNICO punto de escritura   │
   │ commit a la rama huérfana `department-state`               │
   └────────────────────────────────────────────────────────────┘

   ─── FUERA DEL BUCLE AUTOMÁTICO (solo workflow_dispatch manual) ───
   department-approval-session.yml  → aplica lo aprobado en STAGING
   department-production-apply.yml  → publica en PRODUCCIÓN
   execute-php-staging-e2e.yml      → escritura reversible vía Novamira MCP
   google-live-probe.yml / novamira-mcp-probe.yml → sondas
   8 workflows "empleado individual"  → banco de pruebas por agente

   ─── LEGACY / DORMIDO ───
   infrastructure/systemd/*.timer (VPS 08:00 UTC) · infra/cloudflare/ (Worker+D1)
   src/worker/* · telegram-* · ~200 scripts one-off o21–o45
```

Puntos clave de la forma real:

- **Un único job secuencial.** No hay ejecución paralela de especialistas, aunque SEO/Content/Analytics
  son independientes entre sí. Es una decisión explícita (compartir `$GITHUB_WORKSPACE`), no un fallo.
- **Los handoffs son ficheros JSON en rutas deterministas**, no mensajes entre agentes.
  `reports/department/<runId>/stages/<empleado>/output.json`.
- **Ningún agente Claude habla con otro.** El coordinador (`growth-director-v2`) recibe un resumen
  determinista construido por TypeScript a partir de los outputs de los tres especialistas.

---

## 3. Matriz de componentes

| Componente | Estado | Evidencia | Problema | Acción necesaria |
|---|---|---|---|---|
| Workflow diario (cron 07:00 UTC) | 🟠 PARCIAL | `on.schedule: 0 7 * * *` en `main`; run **31933731823** `schedule` SUCCESS 2026-08-16T07:22:56Z | Última pasada en `main` (**31955370754**) ROJA | Arreglar la intermitencia de growth-v2 |
| Runtime común Claude | 🟢 OPERATIVO | Run **31969938538**: 6 invocaciones, 100% éxito 1er intento, $3.158, 16m12s, 16 turnos | Intermitencia observada en otros runs | Instrumentar reintento |
| `seo-specialist` (Claude) | 🟢 OPERATIVO | `claude-execution.json` 2026-08-16T20:21:54Z, sonnet-5, $0.9934, 3 turnos | — | — |
| `content-strategist` (Claude) | 🟢 OPERATIVO | 2026-08-16T20:23:26Z, $0.2099, 3 turnos | — | — |
| `analytics-specialist` (Claude) | 🟢 OPERATIVO | 2026-08-16T20:25:37Z, $0.2632, 2 turnos | — | — |
| `growth-director-v2` (coordinador Claude) | 🟠 PARCIAL | OK 20:28:16Z ($0.5394); **FALLÓ en run 31955370754** (paso duró 5 s) | *"no dejo ninguna salida en …/growth-director-v2/output.json"* | **P0** — causa el rojo de `main` |
| `qa-reviewer` (auditor Claude) | 🟢 OPERATIVO | 2026-08-16T20:31:53Z, $0.6932; `reviewStatus=pass_with_warnings`, 6 hallazgos | — | — |
| `web-engineer` (Claude) | 🟡 NO VALIDADO E2E | Ejecutado 2026-08-16T20:35:00Z ($0.4589, 7 cambios); **SKIPPED** en runs 31955370754 y 31965244763 | Solo corre si QA aprueba algo | — |
| `sem-specialist` (Claude) | 🔴 NO EN PRODUCCIÓN | `manifest.json` → `status: not_available` por decisión explícita | Fuera de la pasada coordinada | Reintegrar cuando toque |
| `ux-ui-landing-architect-v2` | 🟠 DEGRADADO | Tiene `schedule: 0 7 * * *`; salida solo a artifact | **Nadie consume su salida** | Ver §8-P1 |
| Pipeline determinista 26 agentes | 🟢 OPERATIVO | Paso `[GROWTH-V1]` SUCCESS en 31969938538 (18:52→18:53) y en 31955370754 | Sin IA — no razona | — |
| Search Console LIVE | 🟢 OPERATIVO | Paso 9 SUCCESS, 2026-08-16T20:14:13→20:14:22Z, `--require-live` | Token OAuth caduca (§5) | Publicar app OAuth |
| GA4 + GTM LIVE | 🟢 OPERATIVO | Paso 10 SUCCESS, 20:14:22→20:14:32Z | `invalid_grant` histórico 2026-08-14 | Idem |
| Google Ads LIVE | 🟢 OPERATIVO | Paso 11 SUCCESS, 20:14:32→20:14:42Z, 0 mutaciones | Solo lectura | — |
| WordPress staging (lectura) | 🟢 OPERATIVO | Paso `[STAGING]` SUCCESS 41 s, 20:31:59→20:32:40Z | — | — |
| WordPress staging (escritura) | 🟡 NO VALIDADO EN EL BUCLE | E2E runs **31942175626** y **31945963268**: `identicalToStart: true`, 2 escrituras, 0 en prod | Solo por dispatch manual | — |
| WordPress producción (escritura) | 🟠 PARCIAL | Última `production-executions.jsonl`: 2026-08-05T08:04:30Z, backend `local_preview` | Sin escritura real reciente | — |
| Novamira MCP | 🟡 NO VALIDADO HOY | Workflow existe; E2E de execute-php lo ejerció el 2026-08-16 | Sin sonda reciente registrada | Lanzar `novamira-mcp-probe` |
| `department-state` (persistencia) | 🔴 ROTO | 1 commit: `fe017ed` 2026-08-16T19:12:57Z; 3 runs posteriores fallaron el verify | **P0** — el trabajo se pierde | Ver §7 |
| Memoria entre pasadas | 🟠 PARCIAL | `loadPreviousHumanFeedback()` alimenta solo growth-v2 y web-engineer | Especialistas sin memoria | — |
| Puerta QA / promotion | 🟢 OPERATIVO | `promotion.json`; en dept-…185140Z bloqueó 7/7 | Bloquea todo demasiado a menudo | Revisar criterios |
| Email Daily Brief | 🟢 OPERATIVO | Paso `[EMAIL]` SUCCESS; `daily-brief-email.json` `builtAt: 2026-08-16T19:12:24.344Z` | — | — |
| Aprobación manual (sesión) | 🟡 NO VALIDADO | `reports/approval-sessions/dept-2026-08-15T175321Z` (1 sesión) | Solo manual | — |
| Aprobaciones serverless (Telegram/CF/D1) | 🔴 NO ACTIVO | `SERVERLESS_APPROVALS_ENABLED != true` por defecto | Código vivo, infra sin desplegar | Decidir: activar o archivar |
| Rollback staging | 🟢 OPERATIVO | E2E 31945963268: reversión `applied`/`passed`, read-back idéntico | — | — |
| Rollback producción | 🟡 NO VALIDADO | `docs/production-rollback.md`; sin ejecución reciente | — | — |
| Suite de tests | 🟢 OPERATIVO | Local, 2026-08-16: **1069 passed, 0 failed** | — | — |
| CI | 🟢 OPERATIVO | 9/9 runs `CI` SUCCESS en la ventana reciente | — | — |
| VPS legacy | 🟠 PARCIAL | `infrastructure/systemd/*.timer` (08:00 UTC) sigue descrito; auditoría dice "ambos activos" | Doble scheduler | Apagar el timer |

---

## 4. Agentes reales

**Agentes con LLM real (8 definidos, 6 en la pasada coordinada):**

| Agente | LLM real | Modelo | Trigger | Herramientas | Persistencia | Estado |
|---|---|---|---|---|---|---|
| `seo-specialist` | **SÍ** | `claude-sonnet-5` | Paso 18 de la pasada + workflow propio | **NINGUNA** (`allowedTools: []`) | `stages/seo-specialist/output.json` (solo si la pasada persiste) | 🟢 |
| `content-strategist` | **SÍ** | `claude-sonnet-5` | Paso 25 | **NINGUNA** | idem | 🟢 |
| `analytics-specialist` | **SÍ** | `claude-sonnet-5` | Paso 32 | **NINGUNA** | idem | 🟢 |
| `growth-director-v2` | **SÍ** | `claude-sonnet-5` | Paso 40 | **NINGUNA** | idem | 🟠 intermitente |
| `qa-reviewer` | **SÍ** | `claude-sonnet-5` | Paso 48 | **NINGUNA** (`tools: []`) | idem | 🟢 |
| `web-engineer` | **SÍ** | `claude-sonnet-5` | Paso 58 | **NINGUNA** | idem | 🟡 |
| `sem-specialist` | SÍ (fuera del bucle) | `claude-sonnet-5` | Solo `sem-specialist.yml` manual | **NINGUNA** | artifact | 🔴 |
| `ux-ui-landing-architect-v2` | SÍ | `claude-sonnet-5` | cron propio 07:00 UTC | **NINGUNA** | artifact, nunca commiteado | 🟠 |

**"Agentes" que NO son IA — son código TypeScript determinista** (`src/agents/*.ts`, 29 ficheros).
Verificado: el repositorio **no tiene ninguna dependencia de SDK de LLM** (`dependencies` = cheerio,
dotenv, googleapis, nodemailer, sharp). Toda ejecución de Claude ocurre exclusivamente dentro de
`anthropics/claude-code-action` en GitHub Actions.

| "Agente" | LLM real | Qué es realmente |
|---|---|---|
| `seo-watcher`, `analytics-watcher`, `sem-watcher` | **NO** | Clientes de API de Google |
| `seo-director`, `content-planner`, `cro-landing-reviewer` | **NO** | Reglas y agregaciones |
| `competitor-intelligence` | **NO** | Crawler con cheerio |
| `*-work-order-builder`, `*-change-pack-builder` | **NO** | Transformadores de datos |
| `approval-queue`, `approval-gateway`, `approved-action-planner` | **NO** | Máquina de estados |
| `ux-ui-landing-architect` (v1) | **NO** | Plantillas |
| `wordpress-draft-agent`, `staging-executor`, `production-draft-executor` | **NO** | Clientes REST fail-closed |
| `staging-qa-agent` | **NO** | Comprobaciones deterministas |
| `growth-director` (v1) | **NO** | Generador de los 2 informes diarios |
| `visual-template-builder`, `visual-asset-planner` | **NO** | Plantillas / planificación |
| `telegram-approval-receiver` | **NO** | Parser de webhook (apagado) |

**Respuesta directa a la pregunta 5 del encargo: en una pasada completa del departamento hoy ocurren
exactamente 6 ejecuciones reales de LLM.** Sus outputs se guardan en
`reports/department/<runId>/stages/<empleado>/output.json` y los consume, en cadena:
especialistas → `src/department/growth-input.ts` → growth-v2 → `qa-input.json` → qa-reviewer →
`promotion.json` → `src/department/web-engineer-input.ts` → web-engineer → Daily Brief → email a una persona.

---

## 5. Integraciones

| Integración | LIVE | Última prueba | Datos reales | Problemas |
|---|---|---|---|---|
| **Search Console** | **SÍ** | Run `31969938538` paso 9, **2026-08-16T20:14:13→20:14:22Z** | `seo-specialist` cita: *"datos LIVE de Search Console leidos en esta misma pasada (2026-08-16T20:14:22Z, 35 jobs, 18 actionItems agregados)"* | Refresh token OAuth con riesgo de caducidad a 7 días |
| **GA4** | **SÍ** | paso 10, **20:14:22→20:14:32Z** | `analytics-specialist.runSummary.reportGeneratedAt = 2026-08-16T20:14:32.129Z`, mismo `departmentRunId` | `invalid_grant` registrado el 2026-08-14T09:52:05Z |
| **GTM** | **SÍ** | paso 10 (mismo cliente OAuth que GA4) | 8 tags (7 `gaawe` + 1 `googtag`), 7 triggers, `variableCount = 0` | Idem GA4; la versión "live" tiene nombre ambiguo → no se puede confirmar si está publicado |
| **Google Ads** | **SÍ** | paso 11, **20:14:32→20:14:42Z**, `--require-live` | Snapshot persistido en `department-events.jsonl` | El agente `sem-specialist` NO lo consume en la pasada |
| **WordPress / staging (lectura)** | **SÍ** | paso `[STAGING]`, **20:31:59→20:32:40Z** | `staging-inventory.json` de la pasada | — |
| **WordPress / Novamira (escritura)** | **SÍ, reversible** | E2E runs `31942175626` y `31945963268`, 2026-08-16 | página 2077 y página 1867, `identicalToStart: true` | Censo: **0 bloques `novamira/*`** en las 50 páginas de staging → la ability nativa no sirve, solo el fallback `execute-php` |
| **WordPress producción** | 🟠 | `production-executions.jsonl` último: **2026-08-05T08:04:30.096Z**, `backend: local_preview` | `status: applied_to_production_draft` | Sin escritura real de producción en 11 días |
| **SMTP / email** | **SÍ** | `daily-brief-email.json`, `builtAt: 2026-08-16T19:12:24.344Z` | Asunto *"Zentry AI Department — Daily Brief — 2026-08-16"* | — |
| **Novamira MCP (sonda)** | 🟡 | Workflow presente, sin run reciente localizado | — | Lanzar la sonda |
| **Telegram / Cloudflare / D1** | **NO** | — | — | Desactivado por flag |

### ¿Riesgo de falso positivo / snapshot stale?

**Bajo, y está mitigado por diseño.** Los tres pasos LIVE corren con `--require-live`, que **aborta
antes de leer nada** si la variable de fuente no dice explícitamente `search_console` (evita caer a
`mock`). Los tres reciben el `departmentRunId` de la pasada, así que el snapshot que leen los
especialistas es el de **esa misma ejecución**, no uno heredado. Si una fuente falla, el paso es
`continue-on-error: true` y el especialista recibe el último snapshot conocido **etiquetado con su
antigüedad real** (`src/core/snapshot-freshness.ts`), nunca presentado como dato de hoy.

**Un falso positivo detectado:** el `analytics-specialist` afirma como FACT que *"ninguno de los 8 tags
aparece marcado como pausado"* y a la vez declara como incógnita que no puede confirmar si el contenedor
GTM está publicado. La lectura de GTM es real, pero **no distingue configuración guardada de
configuración publicada** — cualquier conclusión de negocio apoyada en esos tags puede ser incorrecta.
El propio sistema lo ha marcado como prioridad alta, lo cual es buena señal.

**El riesgo real no es el caché: es la caducidad de credenciales.** `data/credential-health.jsonl`
registra `ga4`/`gtm` en `failing` con `invalid_grant` el 2026-08-14T09:52:05Z, con esta nota del propio
sistema: *"si vuelve a fallar pasados ~7 días tras cada re-autenticación, es probable que la app OAuth
de Google Cloud Console siga en modo Testing (los refresh tokens de apps en Testing caducan a los 7
días)"*. Recuperado a las 10:17:45Z **manualmente**. Eso da una **vida útil de ~7 días** a las lecturas
LIVE sin intervención humana.

---

## 6. GitHub Actions / automatizaciones

**16 workflows. Solo 2 tienen `schedule`.**

| Workflow | Trigger | Función | Estado |
|---|---|---|---|
| `zentry-ai-department-daily.yml` | **cron `0 7 * * *`** + dispatch | La pasada completa: LIVE → 26 deterministas → 6 Claude → QA → Daily Brief → email → persistencia | 🟠 **rojo en `main`** |
| `ux-ui-landing-architect-v2.yml` | **cron `0 7 * * *`** + dispatch | 1 empleado Claude sobre 1 change pack; salida solo a artifact | 🟠 **zombi** (§10) |
| `ci.yml` | PR + push | tsc, tests, actionlint/shellcheck | 🟢 9/9 SUCCESS |
| `seo-specialist.yml` | dispatch | Banco de pruebas del empleado | 🟢 3/3 SUCCESS |
| `content-strategist.yml` | dispatch | idem | 🟢 4/4 SUCCESS |
| `analytics-specialist.yml` | dispatch | idem | 🟡 sin runs recientes |
| `growth-director-v2.yml` | dispatch | idem | 🟢 3/3 SUCCESS |
| `qa-reviewer.yml` | dispatch | idem | 🟡 sin runs recientes |
| `web-engineer.yml` | dispatch | idem (`# SIN schedule: por diseño`) | 🟡 |
| `sem-specialist.yml` | dispatch | idem (`# SIN schedule`) | 🟠 2 SUCCESS / 2 FAILURE |
| `department-approval-session.yml` | dispatch | 2ª mitad del día: aplica lo aprobado en **staging**, dry-run por defecto | 🟡 1 sesión registrada (2026-08-15) |
| `department-production-apply.yml` | dispatch + `repository_dispatch` | Publica una aprobación en **producción** | 🟡 sin uso reciente |
| `department-decision-report-email.yml` | dispatch | Envía el informe de decisión | 🟡 |
| `execute-php-staging-e2e.yml` | dispatch | E2E reversible en staging vía Novamira | 🟢 probado 2026-08-16 |
| `google-live-probe.yml` | dispatch | Sonda read-only de las 4 fuentes Google | 🟢 3/3 SUCCESS, último `31955333717` 15:20:07Z |
| `novamira-mcp-probe.yml` | dispatch | Sonda read-only del MCP | 🟡 |

**Workflows muertos / legacy:** ninguno estrictamente muerto, pero **8 workflows "empleado individual"
duplican** lo que ya hace la pasada coordinada. Son bancos de pruebas, no producción, y hoy no está
documentado cuál es la fuente de verdad cuando ambos divergen.

**Doble scheduler:** el timer systemd del VPS (`infrastructure/systemd/zentry-seo-watcher.timer`,
08:00 UTC) sigue descrito como activo en `docs/vps-retirement-audit.md`, en paralelo al cron de Actions
de las 07:00 UTC.

---

## 7. Persistencia — cómo funciona `department-state` de verdad

**Mecanismo:**

1. `[STATE] Restaurar` — `git fetch --depth=1 origin department-state` + `git checkout FETCH_HEAD -- data reports`.
   Si la rama no existe: arranque en frío desde lo commiteado en `main`.
2. `[STATE] Manifiesto ANTES` — `npm run state:snapshot` mide **cada fichero** bajo `data/` y `reports/`:
   bytes siempre, y líneas no vacías si es `.jsonl` (`src/core/state-persistence.ts`).
3. …la pasada corre y modifica ficheros…
4. `[STATE] Verificar` — vuelve a medir y compara. **Fail-closed**: cualquier fichero desaparecido,
   `.jsonl` con menos líneas, o **cualquier fichero con menos bytes** ⇒ `exit 1`.
5. `[STATE] Empaquetar` — solo si el verify pasó, sube `data/` + `reports/` como artifact (7 días).
6. **JOB 2 `persist-state`** — único con `contents: write`. Descarga el artifact, borra el working tree,
   commitea a la rama huérfana `department-state` y hace `git push --force-with-lease`.
   `needs: department-run` **sin** `if: always()` ⇒ si la pasada falló, **no se persiste nada**.

**Propiedades reales:**

- ✅ **Append-only demostrado.** Test `state-persistence`: *"ningún módulo que escribe estado reescribe
  un `.jsonl`, todos hacen append"* (8 módulos escritores).
- ✅ **Un único escritor**, serializado por `concurrency: zentry-ai-department-daily`.
- ✅ **Crecimiento verificado por mí**, comparando `origin/main` vs `department-state`:
  `jobs.jsonl` 1965 → **2000** líneas · `department-events.jsonl` 13517 → **13741** ·
  `action-backlog.jsonl` 6271 → **6372**. Ningún fichero de la rama de estado es menor que el de `main`.
- ✅ Historial: la rama es huérfana, cada pasada = 1 commit con su `departmentRunId` y su URL de run.

**Y sin embargo, está ROTO. Evidencia:**

- La rama `department-state` tiene **exactamente 1 commit**: `fe017ed`, 2026-08-16 19:12:57Z,
  *"Estado del departamento tras la pasada dept-2026-08-16T185140Z"*, run `31965244763`.
- Los **3 runs posteriores** fallaron el paso 65 `[STATE] Verificar que la pasada no ha perdido estado`
  ⇒ `[STATE] Empaquetar` **skipped** ⇒ job `persist-state` **skipped**:
  `31967015273` (19:15), `31967138507` (19:17), **`31969938538` (20:13)**.
- El run `31969938538` gastó **$3.16** en 6 sesiones de Claude, generó el Daily Brief completo y la
  especificación técnica de `web-engineer` con 7 cambios… y **no persistió absolutamente nada**.
- `reports/department/` está **vacío en `main`** (0 directorios). Los entregables de las pasadas
  coordinadas viven solo en artifacts (30 días) y en el único commit de la rama de estado.

**Causa raíz demostrada (mecanismo), con una salvedad honesta:** el verificador prohíbe que
**cualquier** fichero no-`.jsonl` pierda bytes, pero bajo `reports/` hay ficheros de **ruta fija que se
sobrescriben en cada pasada** con contenido de longitud variable. He localizado estos:

- `reports/claude-runtime-health/<empleado>/claude-runtime-health.json` — 5 ficheros de ~1.5 KB con
  `promptBytes`, `sdkMessageTypes`, `attempts[]`… Cualquier pasada con menos mensajes o un `note` más
  corto produce un fichero más pequeño ⇒ `bytes_lost`.
- `reports/content-strategist/<changePackId>/{brief,prompt,output}.{md,json}` — si el runner vuelve a
  elegir el mismo change pack y el brief sale más corto, encoge.
- Los ~25 `reports/<agente>/<agente>-<fecha>.md`, si hay **más de una pasada el mismo día**.

**Salvedad:** no he podido leer la línea exacta del log que nombra el fichero regresado — el host que
sirve los logs crudos de Actions (`results-receiver.actions.githubusercontent.com`) está bloqueado por
el proxy de este entorno (`CONNECT tunnel failed, 403`). Lo anterior es el mecanismo que sí puedo
demostrar desde el código y desde los artefactos de la rama de estado, no una cita literal del log.
**Confirmarlo cuesta un run.**

**Riesgo adicional detectado:** la rama de estado es compartida entre ramas de código. El único commit
lo escribió un run de la rama `claude/claude-runtime-intermittent-2sd0ug`, no de `main`. Ramas distintas
producen conjuntos de ficheros distintos sobre el mismo estado compartido.

**Memoria entre pasadas — lo que un agente nuevo puede recuperar:** muy poco.
Solo `loadPreviousHumanFeedback()` (`data/department-human-decisions.jsonl`, 7 entradas, todas del
2026-08-16T09:32:20.630Z) y solo para **2 de los 8 agentes**: `growth-director-v2` y `web-engineer`.
Se inyecta **literal**, máximo 5 entradas por recomendación, y explícitamente *"no hay entrenamiento"*.
`seo-specialist`, `content-strategist`, `analytics-specialist` y `qa-reviewer` **empiezan de cero cada
día**: no saben qué propusieron ayer ni qué se rechazó.

---

## 8. Problemas actuales

### P0 — bloqueantes

**P0.1 — `main` está rojo: `growth-director-v2` falla de forma intermitente y tumba toda la pasada.**
Run `31955370754` (rama `main`, commit `88f3b75` = el que ejecutará el cron), 2026-08-16T15:37→15:53Z.
El paso `[RUNTIME] Ejecutar growth-director-v2` duró **5 segundos** (15:49:10→15:49:15) frente a los
~2 min normales. Resultado del gate:
> `Etapas con fallo real: growth-director-v2=failed. El Daily Brief se ha generado igualmente con el estado real de cada etapa, pero la pasada se marca en rojo.` → `status: "degraded"` → `exit code 1`

Consecuencia en cascada: `web-engineer` **skipped**, `persist-state` **skipped**. La pasada anterior en
`main` (`31953081703`, 14:34) también falló. Es decir: **las dos últimas ejecuciones del código que
correrá mañana a las 07:00 han fallado.**

**P0.2 — La persistencia de estado no sobrevive: se pierde el trabajo de las pasadas.**
Ver §7. 1 commit en la rama, 3 fallos consecutivos del verify después. Mientras esto siga así, el
departamento **no acumula**: cada día recalcula desde el mismo punto.

**P0.3 — La puerta de QA bloquea el 100% del trabajo y no hay bucle de corrección.**
En la única pasada persistida (`dept-2026-08-16T185140Z`): `reviewStatus=fail`, 8 hallazgos,
**7 de 7 recomendaciones BLOCKED**, `web-engineer` bloqueado. En `dept-2026-08-16T201412Z`: 4 de las 8
decisiones son *"DESCARTAR o CORREGIR"*, y las 7 acciones del contrato de apply quedaron en
`requires_manual_staging_implementation` o `blocked` — **capacidad de apply: `ninguna` en las 7**.
No existe un ciclo "QA bloquea → el especialista corrige → se revalúa". El bloqueo va directo a un
humano y ahí muere.

### P1 — importantes

**P1.1 — Credenciales OAuth de Google con vida útil de ~7 días.** `credential-health.jsonl` documenta
`invalid_grant` en ga4/gtm el 2026-08-14 y la hipótesis del propio sistema: app OAuth en modo Testing.
Es exactamente el horizonte de la pregunta 12.

**P1.2 — `ux-ui-landing-architect-v2` es un zombi caro.** Corre con `cron 0 7 * * *`, gasta una
invocación de Claude al día, y su salida va a un artifact que **nada del departamento consume** y que
nunca se commitea. A los 30 días desaparece.

**P1.3 — `sem-specialist` está fuera del bucle mientras Google Ads sí se lee en vivo.** El watcher
recoge el snapshot cada pasada (paso 11 SUCCESS) y nadie lo razona. `growth-director-v2` declara la
incógnita en cada informe: *"no se puede evaluar el desempeño del canal de pago"*.

**P1.4 — Cero ejecución paralela.** SEO, Content y Analytics son independientes y corren en serie:
~9 min de los ~21 de la pasada. Es una decisión consciente (compartir workspace) pero es coste puro.

**P1.5 — Los seis empleados tienen `allowedTools: []`.** No pueden leer un fichero, comprobar una URL,
ni buscar nada. Todo su contexto lo construye código determinista. Eso los hace **seguros y auditables**,
y a la vez **incapaces de investigar**. Es el techo duro de la autonomía actual.

**P1.6 — Doble scheduler VPS + Actions.** Timer systemd 08:00 UTC y cron Actions 07:00 UTC descritos
ambos como activos.

**P1.7 — `growth-director-v2` cita evidencias que no resuelve.** QA lo detectó: *"growth.output.evidence
solo contiene UNA entrada … pero usa decenas de evidenceRefs distintos"*. El coordinador inventa
referencias que no existen en su propio array de evidencia.

### P2 — mejoras

- **~200 scripts one-off `o21`–`o45`** en `scripts/` (`.js`, `.ts`, y `.bak-o212f`, `.bak-o212g`).
- **`departments/web-growth/agents/*.agent.md`**: definiciones markdown de los agentes DETERMINISTAS,
  con el mismo aspecto que los subagentes Claude reales de `.claude/agents/`. Colisión de nomenclatura peligrosa.
- **Carril serverless completo sin desplegar**: `infra/cloudflare/` (wrangler, schema D1), `src/worker/*`
  (7 ficheros), `src/agents/telegram-approval-receiver.ts`, `scripts/telegram-approvals-service.ts`,
  `deploy/zentry-telegram-approvals.service`. Con tests que pasan. Decidir: activar o archivar.
- **Duplicidad v1/v2**: `growth-director` (determinista) vs `growth-director-v2` (Claude);
  `ux-ui-landing-architect` (determinista) vs `-v2` (Claude). Conviven a propósito, sin fecha de corte.
- **Backups en `data/`**: 40+ `o21c-…json`, `o22j-…json`, etc. mezclados con el estado real; entran en el
  manifiesto de estado y en cada commit de la rama.
- **`services/3d-model-factory/`** y **`clients/demo/`**: ajenos al bucle actual.
- **`data/action-backlog.jsonl` = 20 MB, `change-packs.jsonl` = 16 MB, `work-orders.jsonl` = 14 MB.**
  Se commitean enteros en cada pasada. La rama de estado crecerá sin techo.
- **Node 20 deprecado** en `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`.

---

## 9. Lo que YA tenemos (capacidades realmente operativas, con evidencia)

1. **Un scheduler real en la nube que dispara solo.** Run `31933731823`, evento `schedule`, SUCCESS,
   2026-08-16T07:22:56Z. El VPS ya no es necesario para disparar.
2. **Recolección LIVE fail-closed de las 4 fuentes Google en la misma pasada**, con el mismo
   `departmentRunId` (pasos 9–11 de `31969938538`, 20:14:13→20:14:42Z).
3. **Seis empleados Claude reales, encadenados, con salida validada contra JSON Schema versionado.**
   Run `31969938538`: 100% de éxito al primer intento, $3.158, 16 min de razonamiento, modelo registrado
   por invocación en `claude-execution.json`.
4. **Un auditor independiente que de verdad bloquea.** `qa-reviewer` marcó 7/7 recomendaciones como
   BLOCKED en `dept-2026-08-16T185140Z` y el sistema lo respetó: `web-engineer` no llegó a ejecutarse.
5. **Trazabilidad de coste y fiabilidad por empleado.** Modelo, coste, turnos, duración y origen de
   salida (`structured_output` vs fallback) en cada pasada.
6. **Escritura reversible y verificada en staging.** E2E `31945963268`: aplicar → releer → revertir →
   releer, `identicalToStart: true`, 2 escrituras en staging, **0 en producción**. Y el fallo previo
   (`31941898596`) demostró que el sistema **no se cree** un "ok" ajeno: releyó, vio que no había
   cambiado nada y revirtió.
7. **Separación estricta recolección/razonamiento.** Ningún agente Claude recibe credenciales de nada.
   `allowedTools: []` en los 8, con doble capa (frontmatter + `config/subagent-tool-allowlist.json`
   fail-closed).
8. **Daily Brief numerado por email**, con las decisiones que requieren un humano explicitadas.
9. **Feedback humano literal reinyectado** en los prompts de growth-v2 y web-engineer, sin
   reinterpretación.
10. **1069 tests pasando** y CI verde.

---

## 10. Lo que TODAVÍA NO tenemos (sección crítica)

1. **No tenemos persistencia funcionando.** Un commit, y tres pasadas seguidas tirando su trabajo a la
   basura. Hoy el departamento **no acumula nada**.
2. **No tenemos ejecución.** En la pasada del 2026-08-16T20:14Z el propio informe lo dice:
   *"Escrituras externas realizadas en esta pasada: **ninguna**"*, y las 7 acciones tienen
   `Capacidad: ninguna`. La capacidad de escribir existe (`execute-php`, `approval-session`,
   `production-apply`) pero **está fuera del bucle automático**, solo por dispatch manual.
3. **No tenemos agentes que investiguen.** Cero herramientas. No pueden abrir una URL, mirar una página,
   comprobar un dato ni consultar nada que el código no les haya puesto delante.
4. **No tenemos memoria de trabajo.** 4 de 6 empleados de la pasada empiezan de cero cada día.
   No hay "esto lo intentamos el martes y no funcionó".
5. **No tenemos bucle de corrección.** QA bloquea → fin. El especialista nunca ve la crítica ni reintenta.
6. **No tenemos paralelismo.** Todo en serie en un job.
7. **No tenemos delegación real.** El "coordinador" (`growth-director-v2`) **no reparte tareas**: recibe
   tres outputs ya producidos y los prioriza. No decide quién trabaja, ni en qué, ni cuándo. El orden lo
   fija el YAML.
8. **No tenemos medición de resultado.** Nadie comprueba si una acción aplicada movió leads, posiciones
   o CTR. No existe el bucle hipótesis → acción → medición → aprendizaje.
9. **No tenemos alerta de fallo.** `main` lleva dos pasadas rojas seguidas y el único canal es el email
   del Daily Brief, que **se envía igual** cuando la pasada está degradada.
10. **No tenemos autorrecuperación de credenciales.** Cuando el OAuth de Google caduque, el sistema lo
    detecta y lo registra… y espera a que alguien ejecute `npm run auth:analytics` a mano.
11. **No tenemos backlog vivo con estado.** Hay 20 MB de `action-backlog.jsonl`, 102 acciones vivas y
    110 work orders "listas para revisar" — un almacén, no una cola de trabajo que alguien consuma.
12. **No tenemos producción autónoma.** Última escritura registrada: 2026-08-05, y con
    `backend: local_preview`.

---

## 11. Autonomía

| Dimensión | Nota | Por qué |
|---|---|---|
| Recopilación de datos | **8/10** | 4 fuentes Google LIVE fail-closed + WordPress en la misma pasada. −2 por la caducidad OAuth a 7 días y por depender de un solo cliente OAuth para GA4+GTM. |
| Análisis | **7/10** | 6 LLM reales, schema-validado, con auditorías de dominio deterministas encima. −3 porque analizan solo lo que se les inyecta. |
| Generación de hipótesis | **6/10** | `opportunities`, `experiments`, `risks` reales y específicos (enrutado /cerraduras/, CTR 0% en 17/18 items). −4: sin herramientas, no pueden verificar ninguna hipótesis. |
| Priorización | **6/10** | `growth-director-v2` produce 7 prioridades con impacto/confianza/esfuerzo, y QA las filtra. −4 porque las prioridades no persisten como backlog con estado. |
| Planificación | **5/10** | `web-engineer` produce 7 cambios con criterios de aceptación, validación y rollback. −5 porque solo corre si QA aprueba algo, y en 2 de las 3 pasadas auditadas fue **skipped**. |
| Ejecución | **1/10** | 0 escrituras en la pasada, por diseño. El punto no es que sea inseguro: es que **no está conectado**. |
| Validación | **4/10** | JSON Schema + auditorías de dominio + `qa-reviewer` + read-back en `execute-php`. −6: nada valida el **resultado de negocio**. |
| Rollback | **5/10** | Probado y reversible en staging (`identicalToStart: true`). −5: producción documentada pero nunca ejercitada de forma autónoma. |
| Aprendizaje / memoria | **2/10** | Solo motivos de rechazo humanos, literales, máx. 5, para 2 de 8 agentes. Y la persistencia está rota. |
| Recuperación de errores | **3/10** | `continue-on-error` por paso, `credential-health`, fallback de salida del runtime. −7: la pasada muere roja y **nada se autorrepara**; sin alerta. |

### Puntuación global: **3.5 / 10**

Se recopila y se razona muy por encima de la media. No se ejecuta, no se aprende y no se sobrevive a
un fallo. La media aritmética (4.7) sería engañosa: **ejecución 1 y memoria 2 son multiplicadores, no
sumandos** — sin ellas, todo lo demás produce informes, no resultados.

---

## 12. ¿Es actualmente un verdadero departamento multiagente?

# PARCIALMENTE

**Lo que SÍ cumple (y no es poco):**

- **Múltiples agentes LLM reales**, no funciones con nombre de agente. 6 invocaciones de
  `claude-sonnet-5` por pasada, cada una con su propia sesión, su propio prompt y su propio coste
  medido. Evidencia: run `31969938538`, `claude-execution.json` por empleado.
- **Contexto independiente por agente.** Cada uno recibe un paquete distinto construido por su propio
  runner. Ninguno ve el prompt de otro.
- **Especialización real.** Los outputs no son intercambiables: SEO habla de clusters y canibalización,
  Analytics de tags y eventos, Content de intención de búsqueda.
- **Handoffs materializados.** SEO+Content+Analytics → growth-v2 → qa-reviewer → web-engineer,
  con ficheros JSON en rutas deterministas.
- **Revisión cruzada con autoridad.** `qa-reviewer` bloqueó las 7 recomendaciones de la pasada
  `dept-2026-08-16T185140Z` y `web-engineer` no se ejecutó. Un auditor que no puede bloquear es
  decorativo; este bloquea.
- **Contratos versionados** (`claude-execution-record/v1`, `department-run/v1`, `department-apply/v2`)
  y validación por JSON Schema fuera del control del modelo.

**Lo que NO cumple:**

- **No hay coordinador.** `growth-director-v2` es un **sintetizador**, no un orquestador. No decide quién
  trabaja, no crea tareas, no las reparte, no espera resultados. El orquestador real es
  `zentry-ai-department-daily.yml`: un YAML con 69 pasos fijos. Si mañana quisieras que solo corriera
  Analytics, ningún agente puede decidirlo.
- **No hay agencia.** `allowedTools: []` en los 8. Un agente sin herramientas no es un agente: es una
  función de texto a texto muy buena. No puede observar, no puede actuar, no puede iterar.
- **No hay paralelismo.** Todo secuencial.
- **No hay delegación ni negociación.** Ningún agente puede pedir algo a otro.
- **No hay memoria compartida.** El único canal entre pasadas es el feedback humano literal, para 2 de 8.
- **No hay cierre del bucle.** Ningún agente vuelve a mirar si lo que propuso funcionó.

**Veredicto técnico:** hoy es un **pipeline multiagente** — varios LLM reales, especializados,
encadenados, con puerta de calidad — dentro de un **orquestador determinista**. Le falta lo que
convierte un pipeline en un departamento: **agencia** (herramientas), **dirección** (un coordinador que
reparta), y **continuidad** (memoria que sobreviva).

---

## 13. Camino hasta el objetivo final

### FASE A — Estabilizar el latido (bloquea todo lo demás)
- **Objetivo:** que la pasada diaria termine en verde y persista, 7 días seguidos, sin tocarla.
- **Qué resuelve:** P0.1 (growth-v2 intermitente), P0.2 (verify de estado), P1.1 (OAuth de 7 días), y la
  ausencia de alerta cuando algo falla.
- **Dependencias:** ninguna. Es la base.
- **Criterio objetivo de finalización:** 7 commits consecutivos en `department-state`, uno por día,
  todos desde runs `schedule` sobre `main` en verde; `credential-health.jsonl` sin ningún `failing` en
  la ventana; y un canal de alerta que avisa cuando el gate devuelve `degraded`.

### FASE B — Cerrar el bucle de calidad
- **Objetivo:** que un bloqueo de QA vuelva al especialista y se reevalúe **dentro de la misma pasada**.
- **Qué resuelve:** P0.3 — hoy QA bloquea el 100% y ahí muere. Convierte al auditor en parte del bucle
  en vez de un muro.
- **Dependencias:** Fase A (sin persistencia no se puede medir si mejora).
- **Criterio:** en 5 pasadas consecutivas, ≥1 recomendación por pasada sale con QA `pass` **tras** una
  corrección automática, con la traza (bloqueo → corrección → aprobación) en `promotion.json`.

### FASE C — Memoria de trabajo real
- **Objetivo:** que los 6 empleados reciban qué se propuso, qué se aprobó, qué se aplicó y qué resultó.
- **Qué resuelve:** el 2/10 de aprendizaje y el "cada día empieza de cero". Habilita no repetir
  propuestas ya rechazadas y hacer seguimiento de las aplicadas.
- **Dependencias:** Fase A.
- **Criterio:** ninguna pasada propone una recomendación ya rechazada sin citar explícitamente el rechazo
  previo y por qué la replantea; verificable en 10 pasadas consecutivas.

### FASE D — Conectar la ejecución al bucle
- **Objetivo:** que lo aprobado se aplique **en staging** automáticamente, con snapshot, validación y
  rollback, sin dispatch manual.
- **Qué resuelve:** el 1/10 de ejecución. La capacidad ya existe y está probada (`execute-php`,
  `approval-session`); lo que falta es el cable, con la aprobación humana como puerta explícita.
- **Dependencias:** Fases A + B (no conectes escritura a un bucle que falla o que bloquea todo).
- **Criterio:** ≥5 cambios aplicados a staging por el bucle automático, cada uno con read-back verificado
  y rollback probado, y **0 escrituras en producción** no aprobadas explícitamente.

### FASE E — Dar herramientas a los agentes
- **Objetivo:** pasar de `allowedTools: []` a un conjunto **mínimo y auditado** de lectura
  (`Read`, `Grep`, `WebFetch` contra dominios en allowlist) para los especialistas.
- **Qué resuelve:** P1.5 y el paso 2 del test crítico. Es lo que convierte "razonar sobre lo que le dan"
  en "investigar". Requiere extender el `subagent-tool-allowlist.json`, que ya está diseñado para esto.
- **Dependencias:** Fase A. Idealmente después de D, para no ampliar superficie sobre un bucle inestable.
- **Criterio:** ≥3 hallazgos por pasada que el agente obtuvo **por sí mismo** y que no estaban en su
  contexto inyectado; 0 llamadas fuera del allowlist en 20 pasadas.

### FASE F — Objetivos y medición
- **Objetivo:** que el departamento acepte una meta de negocio, la descomponga y **mida** si se acerca.
- **Qué resuelve:** los pasos 1, 8, 9 y 10 del test crítico. Es lo que hace que la frase *"aumenta los
  leads orgánicos sin empeorar la calidad del tráfico"* signifique algo.
- **Dependencias:** C (memoria) + D (ejecución) + E (investigación).
- **Criterio:** dado un objetivo, el sistema produce baseline, hipótesis, tareas, ejecución y **un
  informe de resultado a 14 días** que compara contra el baseline con datos LIVE.

### FASE G — Coordinador real y paralelismo
- **Objetivo:** que un agente decida qué especialistas corren, con qué prioridad y en paralelo,
  en vez de un YAML de 69 pasos fijos.
- **Qué resuelve:** el "PARCIALMENTE" del §12: delegación, paralelismo, dirección.
- **Dependencias:** todas las anteriores. Es la última porque un orquestador dinámico sobre un bucle
  inestable es imposible de depurar.
- **Criterio:** ≥2 pasadas consecutivas con un plan de ejecución distinto **decidido por el coordinador**
  y justificado, con especialistas independientes corriendo en paralelo y tiempo de pasada reducido ≥30%.

### Limpieza (transversal, no es una fase)
Todo lo de §8-P2 se puede retirar en cualquier momento sin bloquear nada. **No lo he tocado**, tal como
pediste. El único con coste diario real es `ux-ui-landing-architect-v2`: o se conecta su salida a algo,
o se le quita el `schedule`.

---

## 14. PRÓXIMA ACCIÓN

> **La siguiente cosa que deberíamos hacer es: la FASE A — estabilizar el latido diario: arreglar la
> intermitencia de `growth-director-v2` que tumba la pasada en `main`, arreglar el verificador de estado
> para que no descarte una pasada entera porque un informe regenerado ocupa menos bytes, publicar la app
> OAuth de Google Cloud para que los tokens dejen de caducar a los 7 días, y añadir una alerta cuando el
> gate devuelva `degraded` — hasta conseguir 7 commits consecutivos en `department-state` desde runs
> programados en verde.**

Por qué esta y no otra: hoy el departamento **piensa bien y no recuerda nada**. Mientras la persistencia
esté rota y `main` esté rojo, cualquier cosa que construyamos encima —memoria, ejecución, herramientas,
objetivos— se evalúa sobre un sistema que tira su propio trabajo a la basura cada noche. No podríamos
saber si la mejora funciona. Estabilizar el latido no añade ninguna capacidad nueva; es lo único que
hace medibles todas las siguientes.

---

## Anexo A — Prueba crítica: *"aumenta los leads orgánicos de Zentry Lockers sin empeorar la calidad del tráfico"*

Si le das ese objetivo ahora mismo, **no hay dónde escribirlo**. No existe input de objetivo:
el sistema no acepta metas, solo se dispara a las 07:00 y hace siempre lo mismo. Suponiendo que se lo
inyectaras a mano en el contexto de `growth-director-v2`, esto es hasta dónde llega la cadena:

| # | Paso | ¿Llega? | Evidencia |
|---|---|---|---|
| 1 | Analizar la situación | ✅ **SÍ** | GSC/GA4/GTM/Ads live + backlog; `seo-specialist` detectó 6 quick wins en posiciones 17–29 y CTR 0% en 17/18 items |
| 2 | Investigar | ❌ **NO** | `allowedTools: []`. No puede abrir una SERP, ver una página ni consultar un volumen de búsqueda. Solo re-lee lo inyectado. Lo declara él mismo: *"no hay datos de búsqueda validados (volumen, keywords secundarias)"* |
| 3 | Crear hipótesis | ✅ **SÍ** | 7 prioridades con impacto/confianza/esfuerzo + `experiments[]` en la salida de growth-v2 |
| 4 | Priorizarlas | ✅ **SÍ** | `recommendedPriorities` ordenado; QA filtra |
| 5 | Crear tareas | 🟠 **A MEDIAS** | `web-engineer` produce 7 cambios con criterios y rollback — pero solo si QA aprueba, y **fue skipped en 2 de las 3 pasadas auditadas** |
| 6 | Repartirlas entre agentes | ❌ **NO** | El reparto está fijado en el YAML. Ningún agente asigna trabajo |
| 7 | Ejecutarlas | ❌ **NO** | *"Escrituras externas realizadas en esta pasada: ninguna"*. Las 7 acciones: `Capacidad: ninguna` |
| 8 | Validar resultados | ❌ **NO** | No hay resultados que validar. Y no existe medición post-cambio |
| 9 | Aprender | ❌ **NO** | Solo motivos de rechazo humanos, literales, para 2 de 8 agentes |
| 10 | Iterar | ❌ **NO** | Cada pasada empieza de cero. Con la persistencia rota, literalmente |

**Llegamos hasta el paso 4 con solidez, y hasta el 5 de forma intermitente.**
De 10, hoy son **4.5**. Y lo que produce el paso 5 termina en un email.

---

## Anexo B — ¿Qué ocurriría si no intervienes durante 7 días?

**Día 1 (mañana, 07:00 UTC).** Se disparan los dos crons. `zentry-ai-department-daily` corre sobre
`88f3b75` — exactamente el commit cuyas dos últimas ejecuciones fallaron. Si `growth-director-v2` vuelve
a caer (2 de las últimas 3 en `main`), el gate devuelve `degraded`, `web-engineer` se salta,
`persist-state` se salta y **la pasada no deja rastro salvo el email y un artifact de 30 días**.
`ux-ui-landing-architect-v2` gasta otra invocación de Claude cuyo artifact nadie leerá.

**Qué se ejecutaría solo:** exactamente 2 workflows al día. Nada más. Los 14 restantes necesitan que
alguien pulse "Run workflow".

**Qué agentes trabajarían:** los 6 de la pasada + `ux-ui-landing-architect-v2`. `sem-specialist` no.

**Qué decisiones tomarían:** ninguna con efecto. Producirían entre 5 y 8 propuestas numeradas al día,
que van a un email.

**Qué modificaciones podrían realizar:** **ninguna**, en ningún sistema. `contents: read` en el job que
ejecuta Claude, `allowedTools: []` en los agentes, agentes de escritura fail-closed sin sus variables.
El único punto con `contents: write` es `persist-state`, que solo commitea `data/` y `reports/` a una
rama de datos. **Esto es seguridad real, no una suposición.**

**Qué quedaría bloqueado:** todo lo aprobable. Los ~7 items diarios se acumulan sin que nadie los
apruebe. `department-approval-session` y `department-production-apply` no se disparan solos.
Las páginas de staging de metálicas y universidades seguirán esperando indefinidamente.

**Qué errores se acumularían:**

1. **~Día 2–3: caducan los refresh tokens de Google.** La app OAuth está probablemente en modo Testing
   (7 días de vida). Los pasos LIVE son `continue-on-error: true`, así que la pasada **no se cae**:
   sigue corriendo con snapshots **etiquetados como stale**, cada día más viejos. El día 7 los
   especialistas estarán razonando sobre datos de hace una semana — correctamente etiquetados, pero
   inútiles.
2. **Si caduca `CLAUDE_CODE_OAUTH_TOKEN`**: el runtime entra en `BLOCKED_BY_AUTH` y **no cae a
   `ANTHROPIC_API_KEY` a propósito**. Cero razonamiento, cero coste inesperado. Diseño correcto.
3. **Fallos del verify de estado**: cada uno tira una pasada entera a la basura, en silencio para ti
   (el email se manda igual).
4. **Los artifacts de estado caducan a los 7 días.** Justo el horizonte de la pregunta.
5. **Ninguna alerta.** El único canal es el Daily Brief, que llega igual de bonito cuando la pasada
   está degradada.

**Qué información se conservaría:** en el mejor caso (todas las pasadas verdes), 7 commits en
`department-state`. En el caso realista dado lo observado, **entre 0 y 2**, más los 7 emails y los
artifacts que aún no hayan caducado. **El estado del repositorio en `main` no cambiaría en absoluto.**

**Resumen honesto de los 7 días:** el sistema no rompe nada, no gasta de más y no miente sobre la
antigüedad de sus datos. Tampoco progresa. Te encontrarías 7 emails con propuestas cada vez más
parecidas, calculadas sobre datos cada vez más viejos, y un backlog que no se ha movido.
Coste aproximado: ~$3.2/día × 7 ≈ **$22** más las invocaciones del zombi de landing.

---

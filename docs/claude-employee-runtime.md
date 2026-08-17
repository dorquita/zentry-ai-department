# Claude Employee Runtime

Runtime **común y reutilizable** para ejecutar cualquier "empleado
Claude" -- un subagente real (`.claude/agents/*.md`) invocado como
**sesión principal** de `claude-code-action` vía `--agent`, nunca vía
`Agent`/`Task` anidado -- de principio a fin en GitHub Actions, sin
portátil encendido, sin VPS, sin Claude Routines.

Este documento describe la arquitectura que deja lista **PR #6**. El
primer empleado (`ux-ui-landing-architect-v2`) ya la usa -- ver
`docs/ux-ui-landing-architect-v2-experiment.md` para su historia
completa (incluida la primera validación end-to-end real, run
`31851396385`). PR #6 **no crea** ningún empleado nuevo: prepara la
fábrica común para que los siguientes 7 (ver más abajo) puedan
construirse en paralelo, cada uno en su propio Git worktree, sin pisarse.

## Arquitectura

```
Claude employee (.claude/agents/<agent>.md, tools: [])
      ↓
domain prepare
  (seleccion de trabajo, contexto, prompt.md -- especifico de CADA empleado)
      ↓
┌─────────────────────────────────────────────────────────┐
│ COMMON RUNTIME                                           │
│ .github/actions/claude-employee-runtime/action.yml        │
│ src/core/claude-employee-runtime.ts                       │
│                                                            │
│   auth            -- CLAUDE_CODE_OAUTH_TOKEN y NADA MAS           │
│                       (solo-suscripcion, sin fallback a API key), │
│                       si falta o caduca: BLOCKED_BY_AUTH          │
│   preflight: tool guard -- assertSubagentIsToolless() ANTES de    │
│                       invocar a Claude (subagent-tool-guard.ts)   │
│   preflight: schema guard -- assertJsonSchemaLiteSupported()      │
│                       ANTES de invocar a Claude (json-schema-lite.ts)│
│   Claude Action    -- anthropics/claude-code-action, SHA fijado,  │
│                       --agent <agent-name>, --json-schema,        │
│                       timeout-minutes: 10 en el step caller       │
│   structured output / fallback                                    │
│                    -- caso A (structured_output) / caso B         │
│                       (recuperar execution_file.result) / caso C  │
│                       (fail)                                      │
│   schema validation -- SIEMPRE contra el JSON Schema versionado   │
│                        del empleado (json-schema-lite.ts),        │
│                        en A y en B por igual                      │
│   safety           -- tools:[] verificado en runtime (no solo en  │
│                       tests), --disallowedTools "mcp__*",         │
│                       contents: read, sin id-token: write,        │
│                       sin bypassPermissions                       │
└─────────────────────────────────────────────────────────┘
      ↓  (JSON ya validado contra el schema -- todavia `unknown`,
      ↓   sin tipar, sin auditar por logica de dominio)
domain validation/audit
  (forma exacta del tipo TypeScript del empleado, auditorias de negocio
   -- especifico de CADA empleado)
      ↓
artifact
  (nombre/contenido especifico de CADA empleado, subido con
   actions/upload-artifact)
```

**La frontera es deliberada y estricta:** el runtime común no sabe qué es
un `hero`, una `keyword`, un `changePackId`, un `fabricationWarning`, ni
ningún otro concepto de negocio de ningún empleado, presente o futuro.
Solo sabe hablar JSON Schema genérico y el protocolo de
`claude-code-action`.

### Qué es genérico (runtime común) y qué es específico (dominio)

| Genérico (runtime común) | Específico de cada empleado (dominio) |
|---|---|
| Autenticación Claude (`CLAUDE_CODE_OAUTH_TOKEN`, solo-suscripción), `BLOCKED_BY_AUTH` | Selección de trabajo (p.ej. change packs) |
| Preflight: tool guard determinista (`assertSubagentIsToolless()`, autoridad única para todos los empleados) | Preparación de contexto/prompt |
| Preflight: schema guard determinista (`assertJsonSchemaLiteSupported()`, autoridad única para todos los empleados) | Forma exacta del tipo TypeScript de salida (`validateXOutput`) |
| `claude-code-action` pinneada a un SHA concreto | Auditoría de dominio (p.ej. fabrication audit, comparación V1/V2) |
| `--agent`, `--disallowedTools`, `--max-turns` | Nombre/rutas de sus artifacts |
| `--json-schema` / lectura de `structured_output` | Contenido del GitHub Step Summary |
| Recuperación desde `execution_file` (caso B) | `schedule`/`workflow_dispatch`/`concurrency` propios |
| Validación contra el JSON Schema versionado (`json-schema-lite.ts`) | — |
| Decisión caso A/B/C + fail-closed | — |
| Timeout de 10 min en el step caller (backstop práctico) + 20 min de job | — |
| `contents: read`, sin MCP, sin `bypassPermissions` | — |

## Frontera técnica elegida (y por qué)

Se auditó la implementación real de `ux-ui-landing-architect-v2` tal
como quedó tras PR #5 (`.github/workflows/ux-ui-landing-architect-v2.yml`,
`src/core/execution-file-result-extractor.ts` -- el modulo que este PR
generaliza y sustituye por `src/core/claude-employee-runtime.ts`,
`src/core/landing-architect-comparison.ts`) para separar ambas capas.

**Decisión: composite action local (`.github/actions/claude-employee-runtime/`)
+ un módulo TOOL puro (`src/core/claude-employee-runtime.ts`) + un
script de CLI genérico (`scripts/resolve-claude-employee-output-for-ci.ts`).**

Se descartó un **reusable workflow** (`workflow_call`) porque:

- Un reusable workflow es otro **job** (o varios), no un step dentro del
  job del empleado -- forzaría a mover TODA la preparación de dominio
  (paso 1 del runner, lectura del prompt) a otro job separado, con paso
  de datos entre jobs vía `outputs`/artifacts en vez de simplemente
  variables de step dentro del mismo job. Esto complica innecesariamente
  el paso de ficheros (el prompt completo, el `execution_file`) entre
  jobs, justo lo que la instrucción de esta iteración pedía evitar.
- Una composite action, en cambio, se ejecuta como **steps dentro del
  mismo job** del empleado -- puede leer/escribir los mismos ficheros en
  el mismo `$GITHUB_WORKSPACE`/`$RUNNER_TEMP` sin artifacts intermedios,
  exactamente como ya hacía el workflow original.

Se descartó "un framework grande" porque:

- El runtime real cabe en ~150 líneas de TypeScript
  (`src/core/claude-employee-runtime.ts`) más ~150 líneas de YAML de
  composite action -- no hace falta metaprogramación, ni un registry de
  clases, ni un DSL propio.

**Verificado (no asumido) contra el JSON Schema oficial de metadata de
GitHub Actions:** los steps de una composite action (`using: composite`)
**no soportan `timeout-minutes` propio** (ese campo solo existe para
steps de job) -- ver la sección "Timeouts" más abajo para cómo se
recupera este backstop de forma práctica desde el workflow caller.

**Verificado (no asumido) con `actionlint`:** una composite action local
referenciada con `uses: ./.github/actions/<nombre>` SÍ se valida
estáticamente -- `actionlint` conoce sus `inputs:` declarados y rechaza
en CI cualquier workflow de empleado que pase un input inexistente o le
falte uno requerido. Esto es una defensa real contra que un worktree
rompa el contrato del runtime por error de tipeo.

## Autenticación: solo suscripción, sin fallback a API key

El runtime acepta **una sola** credencial: `CLAUDE_CODE_OAUTH_TOKEN`, el
token de larga duración que emite `claude setup-token` contra una
suscripción Claude (Pro/Max/Team/Enterprise). Si falta, está vacío o ha
caducado, el runtime corta en `BLOCKED_BY_AUTH` y el job termina en
rojo. **No cae a `ANTHROPIC_API_KEY`**, ni siquiera si ese secret existe
en el repositorio.

### Por qué (no es una simplificación, es una decisión de facturación)

Los dos métodos no cuestan lo mismo:

| Credencial | Qué consume | Coste real |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | La cuota de la suscripción ya pagada | 0 € adicionales mientras se esté dentro de los límites del plan |
| `ANTHROPIC_API_KEY` | Consumo de API | Facturable, por token |

Documentación oficial de Claude Code GitHub Actions, literal: *"If you
authenticate with an OAuth token, runs use your Claude subscription
instead of API billing."*

El fallback automático que existía antes (OAuth → API key) convertía un
fallo de credencial —un token caducado, un secret borrado por error— en
un **cambio silencioso de modelo de facturación**: los seis empleados de
la pasada diaria habrían seguido ejecutándose, en verde, cobrando por
API, sin más rastro que una línea de log. Fallar ruidosamente cuesta una
pasada; seguir en verde cuesta dinero indefinidamente.

### Qué NO implica

- **El secret `ANTHROPIC_API_KEY` puede seguir existiendo** en el
  repositorio y servir para otras cosas. Lo que se garantiza es que
  *este* runtime no lo recibe: no hay input para él, ningún workflow se
  lo pasa, y el step de invocación manda `anthropic_api_key: ""`
  explícitamente (vacío y literal, para que quede evidencia auditable en
  el log de cada run: GitHub enmascara como `***` cualquier secret con
  valor, así que un campo vacío en el log demuestra que no viajó
  ninguna key).
- **Las métricas de coste no cambian.** Se sigue registrando
  `total_cost_usd` por empleado (input `execution-record-path`). Ojo con
  qué es ese número: una **estimación** que Claude Code calcula en local
  a tarifa de lista, no una factura. Con autenticación por suscripción no
  se corresponde con ningún cargo; sirve para conocer el consumo
  equivalente y detectar pasadas anormalmente caras.

### Guard automático

`test/claude-employee-auth-guard.test.ts` (suite
`claude-employee-auth-guard`, corre en CI con `npm test`) falla si:

- el runtime vuelve a declarar un input `anthropic-api-key`,
- aparece una rama de autenticación distinta de `oauth`/`none`,
- `anthropic_api_key` deja de ser literal-vacío o pasa a interpolar algo,
- cualquier workflow de empleado pasa una API key al runtime,
- algún workflow invoca `anthropics/claude-code-action` por su cuenta
  esquivando el runtime (y por tanto el guard),
- o desaparece el registro de métricas de coste.

## Timeouts

Tres capas, cada una con una limitación o alcance distinto:

1. **Steps internos de la composite action** (`.github/actions/claude-employee-runtime/action.yml`,
   incluido el step que invoca `claude-code-action`) -- **sin
   `timeout-minutes` individual.** No es un campo válido en
   `runs.steps` para `using: composite` (verificado contra el JSON
   Schema oficial de metadata de GitHub Actions, no asumido). Esto no
   cambia con este PR y no tiene solución dentro de la composite action
   misma.
2. **Step del workflow CALLER que invoca la composite action**
   (`uses: ./.github/actions/claude-employee-runtime`) -- **SÍ admite
   `timeout-minutes` porque es un step normal de `jobs.<job>.steps` del
   workflow del empleado**, no un step interno de la composite action.
   `ux-ui-landing-architect-v2` declara `timeout-minutes: 10` en ese
   step (ver `.github/workflows/ux-ui-landing-architect-v2.yml`, step
   `[RUNTIME] Ejecutar...`). Esto limita TODA la composite action (auth
   + los dos preflights + `claude-code-action` + resolución de salida) a
   10 minutos, recuperando de forma práctica el mismo backstop que tenía
   antes de PR #6 el step de Claude en solitario.
3. **Timeout del JOB completo** -- `timeout-minutes: 20` a nivel de
   `jobs.<job>`, sin cambios respecto a antes de PR #6. Cubre también los
   pasos `[DOMINIO]` (preparación de contexto, validación/auditoría,
   subida de artifact) que corren fuera de la composite action.

**Todo empleado nuevo debe copiar `timeout-minutes: 10` en el step que
invoca `./.github/actions/claude-employee-runtime`**, salvo necesidad
explícitamente justificada en su propio PR (p.ej. un dominio cuyo
prompt/contexto sea consistentemente más pesado). No hay backstop
automático si un empleado nuevo olvida este `timeout-minutes` -- solo
quedaría cubierto por el timeout del job completo (menos granular).

## El contrato: qué implementa cada empleado

Seis piezas. Las tres primeras (1, 3, 5 en parte) tienen una convención
de ruta fija; las otras tres (2, 4, 6) son enteramente responsabilidad
de cada empleado, con la forma que tenga sentido para su dominio.

1. **Agent definition** -- `.claude/agents/<agent-name>.md`. `tools: []`
   explícito en el frontmatter, verificado por
   `config/subagent-tool-allowlist.json` + `src/core/subagent-tool-guard.ts`.
   Debe añadir su propia entrada en `config/subagent-tool-allowlist.json`
   (fichero compartido, ver "Puntos de conflicto" más abajo). **A partir
   de este PR, este chequeo no vive solo en tests:** el runtime común lo
   ejecuta como preflight determinista (`assertSubagentIsToolless()`,
   vía `scripts/assert-claude-employee-safety-for-ci.ts`) justo antes de
   invocar a Claude, para CUALQUIER empleado -- si el agente no está en
   el allowlist, tiene `allowedTools`/`externalWriteToolsGranted` no
   vacíos, o hay drift entre el `.md` y el allowlist, el job falla ANTES
   de gastar ninguna invocación de Claude. Ningún empleado nuevo debe
   duplicar este chequeo en su propio workflow.
2. **Input/context preparation** -- responsabilidad exclusiva del
   empleado: cómo elige su unidad de trabajo, cómo construye su
   `LandingArchitectContext`-equivalente, cómo arma el texto final del
   prompt (agente + skills + contexto). Debe producir un fichero de
   prompt en texto plano/Markdown y dejar su ruta disponible para el
   workflow (mismo patrón que `v2-prompt.md` de Landing Architect, pero
   el nombre/formato exacto lo decide el empleado).
3. **Output schema** -- `config/<agent-name>-output.schema.json`. JSON
   Schema **draft-07** (el Claude Agent SDK rechaza drafts más nuevos),
   con `additionalProperties: false` en todos los objetos, usando **solo**
   las keywords que `src/core/json-schema-lite.ts` implementa (`type`,
   `properties`, `required`, `items`, `enum`, `additionalProperties: false`,
   `$ref`/`definitions` internos, más las de anotación pura `$schema`,
   `$id`, `title`, `description`). **El runtime común lo verifica por ti,
   como preflight, antes de invocar a Claude** (`assertJsonSchemaLiteSupported()`,
   vía `scripts/assert-json-schema-lite-compatible-for-ci.ts`): si el
   schema usa una keyword no soportada (p.ej. `minLength`, `pattern`,
   `oneOf`, `format`), el job falla explícitamente ANTES de gastar
   inferencia, en vez de dejar que caso A (`--json-schema`, validado por
   el SDK) y caso B (fallback) acaben validando con criterios distintos.
   Si de verdad necesitas una keyword no soportada, hay que implementarla
   en `json-schema-lite.ts` (y sus tests) en el mismo commit, para todos
   los empleados que usan el runtime -- no es una decisión que un
   worktree individual pueda tomar solo para su propio schema. **El
   fichero tampoco debe contener el carácter apóstrofe en ningún sitio**
   -- se embebe tal cual entre comillas simples de shell en
   `--json-schema` dentro de la composite action.
4. **Domain validator/auditor** -- una función `validate<Agent>Output(raw: unknown): <AgentOutput>`
   (fail-closed, sin librerías externas, mismo patrón que
   `validateV2Output()` en `src/core/landing-architect-comparison.ts`) y,
   si aplica, una auditoría de negocio adicional (equivalente a
   `auditV2OutputForFabrication()`). Recibe el `unknown` ya validado
   contra el schema por el runtime común -- nunca al revés.
5. **Runtime/workflow configuration** -- `.github/workflows/<agent-name>.yml`
   propio, con:
   - `on: workflow_dispatch` (+ `schedule` cuando el empleado esté
     validado end-to-end -- ver el caso de `ux-ui-landing-architect-v2`).
   - `concurrency: { group: <agent-name>, cancel-in-progress: false }`.
   - `permissions: contents: read` (nunca más, salvo necesidad técnica
     real justificada explícitamente).
   - Un step `uses: ./.github/actions/claude-employee-runtime` con sus
     propios `agent-name`, `prompt`, `output-schema-path`,
     `expected-output-path`, y **el único secret de autenticación**
     pasado tal cual (`claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
     -- una composite action NO tiene acceso al contexto `secrets` del
     caller, solo a lo que se le pase explícitamente). **Ese mismo step
     debe llevar `timeout-minutes: 10`** (ver sección "Timeouts" más
     arriba) salvo necesidad explícitamente justificada.
     **No añadas `anthropic-api-key`**: ese input ya no existe, y
     `test/claude-employee-auth-guard.test.ts` falla si un workflow lo
     reintroduce (ver "Autenticación: solo suscripción" más abajo).
6. **Artifact/summary definition** -- qué ficheros sube
   (`actions/upload-artifact@v4`, nombre propio) y qué campos muestra en
   `$GITHUB_STEP_SUMMARY`. El runtime común expone dos outputs para
   reutilizar en el summary del empleado: `claude-outcome` (resultado
   real del step de Claude, sin enmascarar por `continue-on-error`) y
   `output-source` (`structured_output` o `execution_file_fallback`).

## Cómo añadir un nuevo empleado

1. Crea `.claude/agents/<agent-name>.md` con `tools: []` explícito.
   Añade su entrada en `config/subagent-tool-allowlist.json`
   (`allowedTools: []`, `externalWriteToolsGranted: []`).
2. Crea `config/<agent-name>-output.schema.json` (draft-07, sin
   apóstrofes, `additionalProperties: false`, solo keywords soportadas
   por `json-schema-lite.ts`). Puedes verificarlo localmente antes de
   abrir el PR: `npm run claude-employee:assert-schema-supported-for-ci -- config/<agent-name>-output.schema.json`.
3. Escribe la preparación de dominio: selección de trabajo + contexto +
   prompt. Convención sugerida (no obligatoria salvo para empleado
   nuevos, ver nota sobre `ux-ui-landing-architect-v2` más abajo):
   - `src/employees/<agent-name>/` para el TypeScript de dominio
     (context builder, validador, auditor).
   - `scripts/<agent-name>/` o un script `scripts/run-<agent-name>.ts`
     para el runner de dos pasos (preparar / validar), siguiendo el
     mismo patrón de `RUNNER_RESULT_JSON=...` en stdout que ya usa
     `scripts/run-landing-architect-comparison.ts` (machine-readable,
     forma fija, fail-closed con código de salida 1 en salida inválida)
     -- **no es un contrato TypeScript compartido**, cada empleado define
     los campos que tengan sentido para su dominio.
4. Escribe el validador/auditor de dominio (`validate<Agent>Output()`,
   y auditorías adicionales si aplica).
5. Crea `.github/workflows/<agent-name>.yml` (ver la sección "Runtime/workflow
   configuration" de arriba). Usa
   `.github/workflows/ux-ui-landing-architect-v2.yml` como plantilla --
   solo cambian los pasos marcados `[DOMINIO]`; el step `[RUNTIME]` se
   copia casi literal, cambiando `agent-name`, `output-schema-path`,
   `expected-output-path`, y conservando `timeout-minutes: 10`.
6. Prueba primero con `workflow_dispatch` únicamente. Activa `schedule`
   solo después de una validación end-to-end real (mismo criterio que
   `ux-ui-landing-architect-v2>`, ver
   `docs/ux-ui-landing-architect-v2-experiment.md`).
7. Ejecuta `npm run typecheck && npm test && actionlint .github/workflows/*.yml`
   antes de abrir el PR.

**Nota sobre `ux-ui-landing-architect-v2` (empleado #1):** sus ficheros
de dominio siguen viviendo en sus ubicaciones históricas
(`src/core/landing-architect-*.ts`, `scripts/run-landing-architect-comparison.ts`,
`config/landing-architect-v2-output.schema.json`) en vez de
`src/employees/ux-ui-landing-architect-v2/` -- son anteriores a esta
convención y migrarlos no era necesario para el objetivo de este PR
(mantener su comportamiento observable idéntico, con el mínimo de riesgo
posible). Los 7 empleados nuevos deben usar la convención `src/employees/<agent-name>/`
descrita arriba.

## Desarrollo paralelo mediante worktrees

Tras el merge de PR #6, los siguientes 7 empleados se desarrollarán
**simultáneamente**, cada uno en su propio Git worktree:

- `seo-specialist`
- `content-strategist`
- `sem-specialist`
- `analytics-specialist`
- `growth-director`
- `qa-reviewer`
- `web-engineer`

Cada uno:

- parte del mismo `main` ya actualizado (con este PR mergeado),
- vive en su propio Git worktree (`git worktree add ../<agent-name> -b claude/<agent-name> origin/main`),
- en su propia rama,
- con su propio PR,
- **sin modificar el runtime común** (`.github/actions/claude-employee-runtime/`,
  `src/core/claude-employee-runtime.ts`,
  `scripts/resolve-claude-employee-output-for-ci.ts`) salvo que
  descubra un problema real de infraestructura -- en ese caso, ese
  cambio debe ir en su propio PR pequeño, revisado antes de que el resto
  de worktrees lo asuman, no mezclado silenciosamente con el trabajo de
  dominio de un empleado concreto.

### Qué ficheros toca normalmente cada worktree (aislado, sin conflicto)

- `.claude/agents/<agent-name>.md` -- nuevo, cero conflicto.
- `config/<agent-name>-output.schema.json` -- nuevo, cero conflicto.
- `src/employees/<agent-name>/**` -- nuevo directorio, cero conflicto.
- `scripts/<agent-name>/**` (o `scripts/run-<agent-name>.ts`) -- nuevo,
  cero conflicto.
- `.github/workflows/<agent-name>.yml` -- nuevo, cero conflicto.
- `test/<agent-name>-*.test.ts` -- nuevo, cero conflicto.

### Puntos de conflicto posibles (y cómo se minimizaron)

Ningún fichero compartido queda con lógica de dominio dentro -- pero
existen tres ficheros **pequeños, declarativos y de solo-añadir** que
los 7 worktrees tocarán en algún momento:

1. **`config/subagent-tool-allowlist.json`** -- cada empleado añade UNA
   entrada nueva bajo su propia clave (`agents.<agent-name>`). Es un
   objeto JSON plano; añadir una clave nueva en una zona distinta del
   fichero rara vez genera un conflicto de merge real (a diferencia de
   modificar una entrada existente). Ya era así antes de este PR -- no
   se ha tocado su diseño.
2. **`package.json` (bloque `scripts`)** -- cada empleado añade sus
   propios scripts npm (p.ej. `seo-specialist:compare`). Mismo
   razonamiento: inserciones en líneas distintas, riesgo bajo pero no
   cero si dos worktrees insertan exactamente en el mismo punto
   alfabético.
3. **`scripts/run-tests.ts`** -- cada empleado añade un `import` y una
   entrada en el array `suites`. Mismo patrón de "solo añadir".

Ninguno de los tres contiene lógica de negocio ni necesita coordinación
entre worktrees para decidir SU contenido -- solo pueden pisarse en el
sentido de "todos tocan el mismo fichero", nunca en el sentido de
"todos necesitan saber qué hicieron los demás". Un `git merge`/`rebase`
tras cada PR individual resuelve esto de forma trivial en la práctica
(inserciones en puntos distintos del fichero).

**El runtime común (`.github/actions/claude-employee-runtime/`,
`src/core/claude-employee-runtime.ts`,
`scripts/resolve-claude-employee-output-for-ci.ts`) es el único bloque
verdaderamente compartido con lógica -- y por diseño, ninguno de los 7
empleados debería necesitar modificarlo para existir.**

## Seguridad (sin capacidades nuevas en este PR)

El runtime común, tal como lo deja PR #6, no concede ninguna capacidad
que no tuviera ya `ux-ui-landing-architect-v2`:

- `contents: read` únicamente (cada workflow de empleado lo declara).
- Sin `id-token: write` (el `github-token` se pasa explícito, evitando
  que `claude-code-action` pida su propio token OIDC con permisos de
  escritura por defecto).
- Sin MCP: `--disallowedTools "mcp__*"` por defecto, más `tools: []` en
  el propio agente, más el preflight determinista del runtime
  (`assertSubagentIsToolless()`) que verifica AMBAS cosas (allowlist +
  frontmatter) antes de invocar a Claude -- tres capas independientes,
  la tercera ejecutada por el runtime mismo, no solo por tests.
- Sin `bypassPermissions` en ningún punto.
- Sin escritura a WordPress/staging/producción/Ads/GA4/GTM/Search
  Console/n8n/VPS -- el runtime común no tiene ninguna integración con
  ninguno de esos sistemas, ni la tendrá salvo que se añada
  explícitamente en un PR futuro, revisado.
- Sin automatización de PRs/comentarios en GitHub (el `github-token`
  pasado solo tiene el permiso `contents: read` del workflow caller).

Los 7 empleados futuros podrán, en sus propios PRs, declarar políticas
de permisos distintas si su dominio lo requiere de verdad (ninguno lo
necesita para lo que se ha pedido hasta ahora) -- **este PR no concede
ninguna** de antemano.

## Limitaciones conocidas

- **Sin `timeout-minutes` por step INDIVIDUAL dentro de la composite
  action** (mitigado, no eliminado). Verificado contra el JSON Schema
  oficial de metadata de GitHub Actions (`runs-composite.steps` no
  incluye ese campo): el step que invoca `claude-code-action` dentro de
  `claude-employee-runtime` no puede tener su propio límite de 10
  minutos como antes de este PR. Pero el step del workflow CALLER que
  invoca la composite action entera SÍ lleva `timeout-minutes: 10` (ver
  sección "Timeouts" más arriba), así que en la práctica el backstop de
  10 minutos sigue existiendo -- solo que ahora cubre auth + los dos
  preflights + Claude + resolución de salida como bloque único, en vez
  de solo el step de Claude en solitario. Si, por ejemplo, los
  preflights fueran anormalmente lentos, comerían presupuesto del mismo
  timeout de 10 min en vez de tener uno propio.
- **`assertJsonSchemaLiteSupported()` no amplía lo que `json-schema-lite.ts`
  sabe validar** -- solo impide que un schema use una keyword no
  soportada SIN que nadie se entere. El subconjunto de JSON Schema
  disponible para cualquier empleado sigue siendo el mismo de antes de
  este PR (`type`, `properties`, `required`, `items`, `enum`,
  `additionalProperties: false`, `$ref`/`definitions`, más anotaciones
  puras). Si un empleado futuro necesita `pattern`/`minLength`/`oneOf`/etc.,
  sigue siendo trabajo pendiente implementarlas en `json-schema-lite.ts`.
- **`structured_output` (caso A) llegaba SIEMPRE vacío, y ya se sabe por
  qué** (incidente P0 de fiabilidad de `seo-specialist`, resuelto -- ver
  la sección "Structured output: por qué `--json-schema` estaba inerte"
  más abajo). Causa: el frontmatter `tools: []` literal impedía que
  Claude Code expusiera al subagente la herramienta `StructuredOutput`,
  que es el ÚNICO canal por el que el Agent SDK entrega la salida de
  `--json-schema`. Sin esa herramienta el modelo no puede entregar salida
  estructurada, responde texto libre, y `claude-code-action` falla con
  *"--json-schema was provided but Claude did not return
  structured_output"*. Todo el contrato pasaba entonces a depender del
  fallback (caso B), o sea de que el modelo acertase el JSON a mano.
  `seo-specialist` ya tiene `StructuredOutput` concedido y resuelve por
  caso A; los demás empleados siguen en caso B (mismo comportamiento que
  antes, sin regresión) hasta que se generalice.
- **`config/subagent-tool-allowlist.json`, `package.json` y
  `scripts/run-tests.ts` siguen siendo ficheros compartidos** que cada
  uno de los 7 empleados debe tocar (ver "Puntos de conflicto" arriba) --
  de bajo riesgo, pero no cero.
- **No existe todavía descubrimiento automático de tests/agentes.**
  Añadir un empleado requiere una línea de `import` + registro manual en
  `scripts/run-tests.ts`. Automatizar esto (p.ej. autodescubrir
  `test/*.test.ts`) es una mejora razonable para una iteración futura,
  fuera del alcance de PR #6.


## Structured output: por qué `--json-schema` estaba inerte

Esta sección documenta la causa raíz del incidente P0 de fiabilidad
intermitente de `seo-specialist` y el mecanismo que lo arregla. Aplica al
runtime común, no solo a ese empleado.

### El mecanismo

`--json-schema` NO es un filtro de texto: el Agent SDK lo implementa
exponiendo una herramienta, `StructuredOutput`, y validando contra el
schema lo que el modelo pasa por ella (re-preguntando al modelo cuando no
encaja, hasta su propio límite de reintentos). Si esa herramienta no está
disponible para el agente, no hay canal por el que entregar la salida: el
modelo responde texto libre y el resultado termina con
`subtype: "success"`, `is_error: false`, `num_turns: 1` y
`structured_output` ausente.

### La evidencia

Reproducido con el CLI `claude` 2.1.233 -- exactamente la versión que
instala el commit fijado de `claude-code-action`:

| Invocación | `num_turns` | `stop_reason` | `structured_output` |
| --- | --- | --- | --- |
| `--json-schema` sin `--agent` | 2 | `tool_use` | **presente** |
| `--json-schema --agent seo-specialist` (`tools: []`) | 1 | `end_turn` | ausente |
| `--json-schema --agent seo-specialist --allowedTools StructuredOutput` | 1 | `end_turn` | ausente |
| `--json-schema --agent <copia con `tools: StructuredOutput`>` | 2 | `tool_use` | **presente** |

Dos consecuencias prácticas:

1. `--allowedTools` en la línea de comando **no** rescata la situación: el
   `tools:` del frontmatter del agente es el que manda. La concesión tiene
   que estar en el `.md` del agente (y, por el guard, también en
   `config/subagent-tool-allowlist.json`).
2. Con `StructuredOutput` concedido, el número de turnos sube de 1 a 3-4
   (medido con el prompt real de `seo-specialist`), porque el SDK
   re-pregunta cuando la salida no cumple el schema. Por eso `--max-turns`
   pasó de 8 a 12 y los `timeout-minutes` del step caller de 10 a 20.

### Por qué esto no relaja la seguridad

`StructuredOutput` no es una capacidad: no lee ficheros, no escribe nada,
no sale a la red y no invoca ningún sistema. Es un formato de respuesta.
`src/core/subagent-tool-guard.ts` lo modela explícitamente
(`SIDE_EFFECT_FREE_SDK_TOOLS`, categoría `sdk_output` del allowlist) y
sigue denegando fail-closed cualquier otra herramienta, incluidas las de
solo lectura. El guard además pasó a exigir **igualdad de conjuntos**
entre el `tools:` del `.md` y el `allowedTools` del allowlist, en los dos
sentidos -- antes solo detectaba drift cuando el drift añadía
herramientas, que es justo por lo que esta divergencia podía existir sin
que nadie se enterara.

### Reintento clasificado

Con `StructuredOutput` operativo la validación de schema la hace el SDK,
pero su límite de reintentos es finito y una ejecución puede terminar sin
entregar salida. Para ese resto, el runtime común hace **un** reintento,
y solo si el fallo se ha podido CLASIFICAR como variabilidad del
modelo/servicio (`src/core/claude-employee-retry.ts`). Nunca se reintenta
un fallo de autenticación, de configuración, de schema no soportado, un
`execution_file` corrupto ni nada que no se sepa clasificar (fail-closed).

Dos defensas independientes impiden mezclar intentos: el `execution_file`
del intento 1 se aparta de la ruta compartida antes del intento 2, y el
resolutor descarta cualquier `execution_file` cuyo `mtime` sea anterior al
inicio del intento que lo está leyendo
(`isExecutionFileStale()`). Que hubo reintento queda registrado
explícitamente en los outputs `attempts` / `retried` /
`first-attempt-failure-class` y en el coste por intento
(`claude-execution.attempt-1.json` junto a `claude-execution.json`).

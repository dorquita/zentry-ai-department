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
│   auth            -- CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY, │
│                       sin fallback silencioso, BLOCKED_BY_AUTH    │
│   Claude Action    -- anthropics/claude-code-action, SHA fijado,  │
│                       --agent <agent-name>, --json-schema         │
│   structured output / fallback                                    │
│                    -- caso A (structured_output) / caso B         │
│                       (recuperar execution_file.result) / caso C  │
│                       (fail)                                      │
│   schema validation -- SIEMPRE contra el JSON Schema versionado   │
│                        del empleado (json-schema-lite.ts),        │
│                        en A y en B por igual                      │
│   safety           -- tools:[], --disallowedTools "mcp__*",       │
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
| Autenticación Claude (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`), `BLOCKED_BY_AUTH` | Selección de trabajo (p.ej. change packs) |
| `claude-code-action` pinneada a un SHA concreto | Preparación de contexto/prompt |
| `--agent`, `--disallowedTools`, `--max-turns` | Forma exacta del tipo TypeScript de salida (`validateXOutput`) |
| `--json-schema` / lectura de `structured_output` | Auditoría de dominio (p.ej. fabrication audit, comparación V1/V2) |
| Recuperación desde `execution_file` (caso B) | Nombre/rutas de sus artifacts |
| Validación contra el JSON Schema versionado (`json-schema-lite.ts`) | Contenido del GitHub Step Summary |
| Decisión caso A/B/C + fail-closed | `schedule`/`workflow_dispatch`/`concurrency` propios |
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
steps de job). Ver "Limitaciones conocidas" más abajo.

**Verificado (no asumido) con `actionlint`:** una composite action local
referenciada con `uses: ./.github/actions/<nombre>` SÍ se valida
estáticamente -- `actionlint` conoce sus `inputs:` declarados y rechaza
en CI cualquier workflow de empleado que pase un input inexistente o le
falte uno requerido. Esto es una defensa real contra que un worktree
rompa el contrato del runtime por error de tipeo.

## El contrato: qué implementa cada empleado

Seis piezas. Las tres primeras (1, 3, 5 en parte) tienen una convención
de ruta fija; las otras tres (2, 4, 6) son enteramente responsabilidad
de cada empleado, con la forma que tenga sentido para su dominio.

1. **Agent definition** -- `.claude/agents/<agent-name>.md`. `tools: []`
   explícito en el frontmatter (verificado además por
   `config/subagent-tool-allowlist.json` +
   `src/core/subagent-tool-guard.ts`, sin cambios en este PR). Debe
   añadir su propia entrada en `config/subagent-tool-allowlist.json`
   (fichero compartido, ver "Puntos de conflicto" más abajo).
2. **Input/context preparation** -- responsabilidad exclusiva del
   empleado: cómo elige su unidad de trabajo, cómo construye su
   `LandingArchitectContext`-equivalente, cómo arma el texto final del
   prompt (agente + skills + contexto). Debe producir un fichero de
   prompt en texto plano/Markdown y dejar su ruta disponible para el
   workflow (mismo patrón que `v2-prompt.md` de Landing Architect, pero
   el nombre/formato exacto lo decide el empleado).
3. **Output schema** -- `config/<agent-name>-output.schema.json`. JSON
   Schema **draft-07** (el Claude Agent SDK rechaza drafts más nuevos),
   con `additionalProperties: false` en todos los objetos, usando solo
   las features soportadas documentadas en
   `https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations`
   (`type`, `properties`, `required`, `items`, `enum`,
   `additionalProperties: false`, `$ref`/`definitions` internos). **El
   fichero no debe contener el carácter apóstrofe en ningún sitio** --
   se embebe tal cual entre comillas simples de shell en `--json-schema`
   dentro de la composite action.
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
     `expected-output-path`, y los dos secrets de autenticación pasados
     tal cual (`${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` /
     `${{ secrets.ANTHROPIC_API_KEY }}` -- una composite action NO tiene
     acceso al contexto `secrets` del caller, solo a lo que se le pase
     explícitamente).
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
   apóstrofes, `additionalProperties: false`).
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
   copia casi literal, cambiando `agent-name`, `output-schema-path` y
   `expected-output-path`.
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
  el propio agente (dos capas independientes).
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

- **Sin `timeout-minutes` por step dentro de la composite action.**
  Verificado contra el JSON Schema oficial de metadata de GitHub Actions
  (`runs-composite.steps` no incluye ese campo): el step que invoca
  `claude-code-action` dentro de `claude-employee-runtime` ya no tiene su
  propio límite de 10 minutos (como sí lo tenía en el workflow original
  de `ux-ui-landing-architect-v2` antes de este PR). El único backstop
  de tiempo ahora es el `timeout-minutes` del JOB completo del workflow
  del empleado (20 minutos para `ux-ui-landing-architect-v2`, sin
  cambios). Sigue siendo fail-closed (el job se mata igual), solo con
  menos granularidad que antes.
- **Validación de `structured_output` (caso A) contra el schema no tiene
  todavía evidencia empírica de un run real con contenido.** Las tres
  ejecuciones reales de `ux-ui-landing-architect-v2` hasta ahora (dos en
  PR #3, una en PR #5) siempre han terminado en el caso B (fallback) --
  `structured_output` nunca ha llegado poblado en un run real. La
  validación de schema añadida al caso A en este PR usa la misma lógica
  ya probada (`json-schema-lite.ts`) contra el mismo schema, pero no se
  ha podido demostrar contra un caso A real todavía.
- **`config/subagent-tool-allowlist.json`, `package.json` y
  `scripts/run-tests.ts` siguen siendo ficheros compartidos** que cada
  uno de los 7 empleados debe tocar (ver "Puntos de conflicto" arriba) --
  de bajo riesgo, pero no cero.
- **No existe todavía descubrimiento automático de tests/agentes.**
  Añadir un empleado requiere una línea de `import` + registro manual en
  `scripts/run-tests.ts`. Automatizar esto (p.ej. autodescubrir
  `test/*.test.ts`) es una mejora razonable para una iteración futura,
  fuera del alcance de PR #6.

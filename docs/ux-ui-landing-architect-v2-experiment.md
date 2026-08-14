# Experimento: `ux-ui-landing-architect-v2` (estado actual)

Este documento describe COMO FUNCIONA HOY este experimento, no una
cronologia de fases. Si algo de lo descrito aqui cambia, actualiza este
documento en el mismo commit que cambie el codigo.

## Que es esto y que NO es

`ux-ui-landing-architect-v2` es un **subagente real de Claude** (un
`.claude/agents/*.md`, ejecutado por el propio modelo, no logica
TypeScript determinista) que hace el mismo trabajo que el agente v1
existente (`src/agents/ux-ui-landing-architect.ts`): convertir un change
pack en una propuesta de estructura de landing (hero, CTAs, bloques de
beneficios, cards, secciones, FAQ, jerarquia visual).

- **Convive en paralelo con v1.** No lo sustituye, no se ejecuta como
  parte de `npm run growth:daily`, no toca `data/landing-blueprints.jsonl`
  (el registro que usa V1 en produccion). Es un experimento aislado.
- **No escribe en ningun sistema**, ni interno (no toca los ficheros
  `.jsonl` del departamento) ni externo (WordPress, staging, produccion,
  Google Ads, GA4/GTM, Search Console). Su unica salida es un JSON de
  propuesta que un runner guarda como fichero de reporte local.
- **No decide cual version es mejor.** Ni V2 se autoevalua, ni el runner
  calcula un "ganador" automatico. El artefacto de comparacion incluye
  una checklist de criterios que rellena un humano.

## Arquitectura: CLAUDE / TOOLS / SKILLS / GUARDS

| Capa | Donde vive | Que hace |
|---|---|---|
| **CLAUDE** (razonamiento) | `.claude/agents/ux-ui-landing-architect-v2.md` | Recibe un contexto ya estructurado (JSON) y decide copy, jerarquia visual, CTAs, FAQ, tabla comparativa. Cero herramientas (`tools: []`) -- no lee el repositorio, no navega nada por su cuenta. |
| **TOOLS** (funciones deterministas) | `src/core/landing-architect-v2-context.ts`, `src/core/landing-architect-comparison.ts`, `scripts/run-landing-architect-comparison.ts` | Extraen del change pack lo mismo que ya extrae v1 (headings, FAQs existentes, enlaces internos reales, sector/material detectados por texto), arman el prompt completo, validan la forma de la respuesta de Claude, auditan si aparecen cifras/plazos/garantias no presentes en el input, calculan el diff estructural V1 vs V2. |
| **SKILLS** (conocimiento reutilizable) | `.claude/skills/zentry-brand/SKILL.md` | Voz de marca de Zentry/Tukandado, catalogo real de materiales y metodos de apertura, y la regla central: nunca fabricar cifras/plazos/garantias que no vengan en el input. El runner inyecta este fichero completo dentro del prompt que arma para V2 -- el subagente no lo "va a buscar" el mismo. |
| **GUARDS** (permisos/seguridad) | `config/subagent-tool-allowlist.json` + `src/core/subagent-tool-guard.ts` | Modelo fail-closed: cualquier subagente no listado, o cualquier herramienta no concedida explicitamente, se deniega. Es una segunda capa independiente del `tools:` del propio `.md` (si alguien edita el frontmatter por error, el guard y sus tests siguen detectando la desviacion). |

### Que logica sigue siendo TOOL (no ha pasado al modelo)

Deliberadamente NO se le pide a Claude que "lea" ni "detecte" nada -- eso
sigue siendo codigo determinista, igual que en v1:

- Extraccion de headings/FAQs/enlaces internos del `proposedChanges` del
  change pack (`extractPreviewFields`, reutilizado de v1).
- Deteccion de sector/material por coincidencia de texto (`detectTerm`,
  `SECTOR_TERMS`, `MATERIAL_TERMS`, reutilizado de v1).
- Deteccion de si el change pack es un tema de control de acceso
  (`isSmartLockTopic`) y si aplica bloque secundario Tukandado
  (`smartLocksBlockApplies`).
- Seleccion de la plantilla visual sugerida (`selectVisualTemplate`) --
  se pasa a V2 como **pista**, no como orden: V2 puede razonar su propia
  estructura.
- Validacion de forma de la respuesta de V2 (`validateV2Output`) y
  auditoria textual de datos que parezcan fabricados
  (`auditV2OutputForFabrication`) -- red de seguridad determinista sobre
  una salida de modelo, nunca al reves.

### Que logica pasa al modelo (razonamiento real, no reglas)

- Redaccion del headline/subheadline del hero, copy de cada seccion,
  preguntas y respuestas de FAQ, labels de CTA -- en v1 esto sale de
  plantillas con placeholders (`fillPattern`) y un switch de patrones de
  heading (`buildSectionBody`); en V2 lo decide el modelo a partir del
  contexto y de la skill de marca.
- Decisiones de jerarquia visual y de estructura (que va en cards vs.
  bloques de beneficios, si hace falta CTA secundario, orden de
  secciones) con **justificacion explicita** (`reasoningNotes`), algo que
  v1 no produce porque no "decide", solo aplica reglas fijas.

## Guardas de seguridad activas

1. **`tools: []`** en el frontmatter del subagente -- Claude Code no le
   concede ninguna herramienta, ni de lectura ni de escritura.
2. **`config/subagent-tool-allowlist.json`** -- fail-closed: el propio
   agente aparece con `allowedTools: []` y `externalWriteToolsGranted:
   []`. Un agente que NO aparezca en este fichero se trata como
   **denegado**, nunca como "confirmado sin herramientas" -- la ausencia
   de registro es tratada como riesgo, no como garantia de seguridad
   (bug real corregido tras revision: `hasNoExternalWriteTools()` llego a
   devolver `true` para un agente inexistente; hoy devuelve `false`, ver
   test de regresion en el punto 4).
3. **`src/core/subagent-tool-guard.ts`** -- capa de codigo que lee ese
   JSON. Expone `isSubagentToolAllowed()` (permiso puntual
   agente+herramienta), `hasNoExternalWriteTools()` (ninguna herramienta
   concedida se clasifica como `external_write` NI como `unknown` --
   una herramienta no reconocida en ninguna categoria NUNCA se trata
   implicitamente como segura) y `checkSubagentIsToolless()`/
   `assertSubagentIsToolless()` (chequeo estricto de las 4 condiciones:
   agente presente en el allowlist, `allowedTools` vacio,
   `externalWriteToolsGranted` vacio, frontmatter `tools:` vacio y
   declarado explicitamente). El runner llama a
   `assertSubagentIsToolless()` antes de preparar nada, como defensa en
   profundidad (aunque el runner nunca invoca al subagente por si mismo,
   ver mas abajo) -- cualquier inconsistencia entre estas 4 condiciones
   aborta con el motivo exacto.
4. **`test/subagent-tool-guard.test.ts`** -- verifica, entre otras cosas:
   (a) un agente/herramienta no listados se deniegan (fail-closed), (b)
   `hasNoExternalWriteTools()` devuelve `false` (no `true`) para un
   agente desconocido, (c) una herramienta no categorizada en ningun
   `toolCategories` se clasifica como riesgo, nunca como segura por
   omision, (d) `ux-ui-landing-architect-v2` cumple las 4 condiciones de
   `checkSubagentIsToolless()`, (e) usando un fixture deliberadamente
   inconsistente (`test/fixtures/fake-agent-with-tools.md`), que el
   guard SI detecta un frontmatter `tools:` no vacio aunque el JSON diga
   `allowedTools: []` (drift entre ambos ficheros).
5. **Auditoria de afirmaciones sensibles no respaldadas**
   (`auditV2OutputForFabrication`, `src/core/landing-architect-comparison.ts`)
   -- por categoria (garantia, precio, plazo de entrega, "fabricante
   directo/sin intermediarios", funcionalidad de producto), busca
   afirmaciones en la salida de V2 y las contrasta contra el input: si
   el input no la respalda, o la marca explicitamente como "pendiente de
   confirmar", se reporta como warning para revision humana. Cubre tanto
   cifras concretas ("garantia de 5 años") como afirmaciones cualitativas
   sin numero ("cuentan con garantia de fabricante") -- esta segunda
   categoria se añadio tras un falso negativo real detectado en revision
   (ver `test/landing-architect-comparison.test.ts`, primer test,
   marcado `REGRESION`).
6. **`src/core/internal-url-guard.ts`** -- un enlace del change pack solo
   se trata como "interno real" si es un path relativo autentico (nunca
   uno protocol-relative tipo `//host/algo`, que un navegador resuelve
   contra un host externo) o si su host coincide EXACTAMENTE con
   `productionUrl`/`stagingUrl` del cliente activo (nunca por
   subcadena/`includes`, que permitiria un host tipo
   `zentrylockers.com.evil.com`). Antes de esta correccion, cualquier
   `https://` se aceptaba como interno. Ver `test/internal-url-guard.test.ts`.

## Como se ejecuta hoy (dos comandos deterministas + una llamada real al subagente)

El runner (`scripts/run-landing-architect-comparison.ts`) **no llama a
la API de Anthropic por su cuenta** -- este repositorio no tiene ninguna
dependencia ni credencial para eso (mismo principio que el resto del
proyecto: nada se ejecuta solo). La invocacion real del subagente la
hace SIEMPRE una sesion de Claude Code usando la herramienta `Agent` --
nunca el propio proceso Node. **Esto esta VERIFICADO end-to-end cuando
quien orquesta es una sesion interactiva** (ver "Estado real de la
automatizacion en Claude Cloud" mas abajo para el detalle exacto de que
esta probado y que no).

```bash
# Paso 1: preparar. Calcula V1 de verdad, construye el contexto de V2
# y escribe un prompt listo para pegarselo al subagente.
npm run landing-architect:compare -- --changePackId <id>

# (la sesion de Claude Code que orquesta esto invoca ahora la herramienta
#  Agent con subagent_type "ux-ui-landing-architect-v2", pasando como
#  prompt el contenido de reports/ux-ui-landing-comparison/<id>/v2-prompt.md
#  tal cual -- y escribe la respuesta del subagente, tal cual, en
#  reports/ux-ui-landing-comparison/<id>/v2-output.json)

# Paso 2: completar. Valida esa respuesta, audita fabricacion de datos,
# y regenera el artefacto de comparacion con los dos resultados.
npm run landing-architect:compare -- --changePackId <id> --v2-output reports/ux-ui-landing-comparison/<id>/v2-output.json
```

Sin `--changePackId`, elige UN change pack elegible **al azar**
(`ready_for_review` / `approved_to_execute`, ver
`src/core/landing-architect-change-pack-selection.ts`) -- evita un
sesgo sistematico hacia el primer elemento del listado en ejecuciones
repetidas. **Esto no es una garantia de no-repeticion**: es un sorteo
simple (`Math.random()` por defecto) sin memoria de que change pack se
proceso en ejecuciones anteriores, asi que dos ejecuciones distintas
pueden perfectamente elegir el mismo change pack.

Cada ejecucion termina con una linea `RUNNER_RESULT_JSON={...}` en
stdout, con una forma FIJA e IDENTICA en los 3 estados posibles (ver
`RunnerResultSummary` / `buildRunnerResultSummary()` en
`src/core/landing-architect-comparison.ts`, testeado en
`test/landing-architect-comparison.test.ts`):

```json
{
  "changePackId": "...",
  "keyword": "...",
  "v2Status": "pending_execution | executed | invalid_output",
  "promptFilePath": "reports/ux-ui-landing-comparison/<id>/v2-prompt.md",
  "expectedV2OutputPath": "reports/ux-ui-landing-comparison/<id>/v2-output.json",
  "comparisonJsonPath": "reports/ux-ui-landing-comparison/<id>/comparison.json",
  "comparisonMdPath": "reports/ux-ui-landing-comparison/<id>/comparison.md",
  "fabricationWarningCount": null
}
```

`promptFilePath`/`expectedV2OutputPath` son rutas DETERMINISTAS (siempre
las mismas para un `changePackId` dado) -- se incluyen siempre, exista o
no ya el fichero en disco en el momento concreto de esa llamada.
`fabricationWarningCount` solo es un numero cuando `v2Status` es
`"executed"`; en los otros dos estados es `null`. Pensada para que quien
orquesta esto no tenga que parsear texto libre ni ramificar su logica
segun el estado para saber donde esta cada fichero. Si `v2Status` queda
en `"invalid_output"`, el proceso termina ademas con **codigo de salida
1** (fail-closed, detectable por automatizacion) aunque el artefacto se
guarde igualmente para inspeccion.

La respuesta cruda del subagente puede venir envuelta en un fence
` ```json ... ``` ` aunque sus instrucciones pidan no incluirlo (caso
real, ver mas abajo) -- `extractJsonFromModelResponse()` lo tolera antes
de intentar `JSON.parse`; si el contenido no es JSON valido de todas
formas, sigue fallando fail-closed.

### Que se guarda

Bajo `reports/ux-ui-landing-comparison/<changePackId>/`:

- `v2-prompt.md` -- el prompt completo preparado para V2 (instrucciones
  del subagente + skill zentry-brand + contexto JSON). Se regenera en
  cada ejecucion sin `--v2-output`.
- `comparison.json` / `comparison.md` -- el artefacto de comparacion:
  input, output V1, output V2 (o su estado si aun no se ha ejecutado),
  diferencias estructurales, criterios de evaluacion sin rellenar.
- `v2-output-raw-invalid.json` -- solo si `--v2-output` apuntaba a una
  respuesta que no paso la validacion de forma (`validateV2Output`), para
  poder inspeccionarla.

**`reports/ux-ui-landing-comparison/` esta en `.gitignore`.** Es salida
generada localmente (prompts + propuestas sobre change packs reales del
negocio) -- no se versiona. Para ver el FORMATO exacto del artefacto sin
ejecutar nada, usa el fixture sanitizado
`test/fixtures/landing-architect-comparison-example.json` (datos de
ejemplo, ningun changePackId/keyword/URL real), verificado por
`test/landing-architect-comparison.test.ts` (se renderiza sin lanzar y
sus warnings de fabricacion se recalculan contra la logica real de
auditoria, para que el fixture no quede desincronizado del codigo).

## Como leer un artefacto de comparacion

`comparison.md` tiene siempre 5 secciones: input, output V1, output V2,
diferencias estructurales (tabla V1/V2/¿igual?) y una checklist de
criterios de evaluacion con dos columnas vacias ("V1 cumple" / "V2
cumple") para que una persona las marque. Ningun campo de ese documento
contiene una conclusion de "cual es mejor" -- eso es intencional.

## Estado real de la automatizacion en Claude Cloud

**Resumen en una frase: hoy NO existe un empleado autonomo 24/7
funcionando.** El flujo completo funciona de verdad cuando lo orquesta
una sesion interactiva de Claude Code; disparado por un Routine
(`create_new_session_on_fire`, sin nadie mirando) NO ha completado de
forma fiable en ninguno de los intentos probados. Esta seccion describe
el resultado real de las pruebas, no la arquitectura que nos gustaria
tener.

### Que esta VERIFICADO y que NO

| Escenario | Estado |
|---|---|
| Sesion interactiva de Claude Code -> `Agent` (`ux-ui-landing-architect-v2`) -> runner (`--v2-output`) -> comparacion | **VERIFICADO.** Ejecucion real documentada: el subagente devolvio el JSON de propuesta esperado y termino con **`tool_uses: 0`** (evidencia empirica de que `tools: []` se respeta en ejecucion real, no solo en la comprobacion estatica de `src/core/subagent-tool-guard.ts`). |
| Routine -> sesion nueva -> comandos Bash basicos (`pwd`/`git`/`ls`), sin runner ni Agent | **VERIFICADO.** La sesion arranca, tiene el repositorio disponible, ejecuta comandos, y termina limpiamente (`IDLE`/`REVIEW_READY`). |
| Routine -> sesion nueva -> `npm install` + runner (solo `prepare`, sin Agent) | **VERIFICADO.** Termino limpiamente, sin bloquearse. |
| Routine -> sesion nueva -> runner + `Agent`(`ux-ui-landing-architect-v2`) + runner (`--v2-output`) -> comparacion | **NO FIABLE. Falla de forma reproducible.** Dos intentos completos con esta arquitectura, ambos terminaron con la sesion congelada (`stop_reason=tool_use` sin resolver nunca) hasta interrumpirla manualmente. |
| Routine -> sesion nueva que asume el rol de `ux-ui-landing-architect-v2` ELLA MISMA (sin invocar `Agent`/`Task` en ningun punto) -> runner (`--v2-output`) -> comparacion | **NO FIABLE. Falla igual.** Un intento completo, misma firma de fallo (`stop_reason=tool_use` sin resolver) tras ~21 minutos, pese a no usar `Agent`/`Task` en absoluto. |

Diagnostico exacto (reproducido 3 veces en total, con y sin `Agent`):
`status_category: "failed"`, `status_detail: "[ede_diagnostic]
result_type=user last_content_type=n/a stop_reason=tool_use"` -- una
tool call se emite y nunca vuelve con resultado. **No es un fallo del
subagente ni de su logica**: fallo tanto con `Agent` como sin el, asi
que la causa NO se puede atribuir a `ux-ui-landing-architect-v2` ni a la
herramienta `Agent` especificamente. **La causa raiz exacta es
DESCONOCIDA** -- no existe hoy una herramienta para leer el transcript
interno de una sesion disparada por Routine, asi que no se puede
identificar con certeza que tool call concreta queda pendiente. Lo unico
verificable desde fuera es la marca de tiempo congelada y el
`stop_reason=tool_use` del diagnostico de plataforma.

### Mecanismo de ejecucion (el que SI existe, capacidades nativas, sin API/SDK)

Este repositorio **no usa la API de Anthropic ni el Agent SDK**, y no se
ha introducido ninguna API key, worker propio, cola de mensajes ni
infraestructura adicional -- la parte no automatica de esto sigue
funcionando con capacidades nativas:

1. **Herramienta `Agent`** (nativa de Claude Code) -- `.claude/agents/*.md`
   se descubren automaticamente como `subagent_type` invocables desde
   una sesion interactiva que tiene el repositorio abierto. Funciona
   (ver tabla de arriba).
2. **MCP `Claude_Code_Remote`** (Routines/triggers, sesiones cloud) --
   `create_trigger` programa una ejecucion periodica que dispara un
   prompt hacia una sesion NUEVA (`create_new_session_on_fire: true`) o
   hacia una sesion persistente. Es el mecanismo real de "trigger/
   routine/scheduled session" de Claude Cloud -- no una construccion de
   este proyecto. `update_trigger` NO permite cambiar el modo de
   destino de un trigger ya creado (ni a `persistent_session_id` ni a
   `create_new_session_on_fire`) -- verificado leyendo su esquema real,
   no asumido.

### Procedimiento (el que se ha intentado automatizar, sin exito fiable todavia)

1. `npm run landing-architect:compare -- ` (sin `--changePackId`: elige
   uno al azar). Leer la linea `RUNNER_RESULT_JSON`.
2. Leer el fichero `v2-prompt.md` que indica esa linea.
3. Razonar como `ux-ui-landing-architect-v2` sobre ese contenido
   (invocando `Agent` con `subagent_type: "ux-ui-landing-architect-v2"`,
   o asumiendo el rol directamente sin `Agent` -- las dos variantes se
   probaron, ver tabla de arriba) y producir el JSON de salida.
4. Escribir esa respuesta, **tal cual, sin reinterpretarla**, en el
   `expectedV2OutputPath` que indico el paso 1.
5. `npm run landing-architect:compare -- --changePackId <id> --v2-output
   <ese fichero>`. Leer la segunda linea `RUNNER_RESULT_JSON`.
6. Reportar changePack usado, `v2Status`, numero de
   `fabricationWarnings` (listados tal cual, nunca descartados ni
   reinterpretados) y las diferencias estructurales principales
   (`comparison.json` -> `structuralDiff`). Nunca declarar cual version
   es "mejor".

Los pasos 1, 4 y 5 son deterministas (TOOL). El paso 3 es la unica parte
que requiere razonamiento real de Claude. **Este procedimiento esta
VERIFICADO cuando lo ejecuta una sesion interactiva** (paso a paso, con
alguien -- en la practica, otra sesion de Claude Code -- observando cada
tool call). **NO esta verificado cuando lo ejecuta, de principio a fin y
sin intervencion, una sesion disparada por Routine** (ver tabla de
arriba).

### Routine experimental (resultado real, no la arquitectura deseada)

`ux-ui-landing-architect-v2 — comparacion diaria`
(`trig_018AUUSdDFghtM28WJL9Jnb4`), cron diario, `create_new_session_on_fire:
true`. **Estado actual: DESACTIVADO** (`enabled: false`) -- se dejo asi
deliberadamente tras las pruebas fallidas, para no fallar en silencio en
un disparo programado sin supervision. Su prompt actual en la plataforma
es el de la ULTIMA prueba realizada (el intento sin `Agent`/`Task`); no
representa una automatizacion lista para producción.

**No reactivar este Routine hasta que la causa raiz del bloqueo se
entienda** (o se decida asumir el riesgo de que falle silenciosamente
hasta el timeout de plataforma correspondiente, algo que hoy no se
conoce con precision).

### Limite real de esta iteracion (honesto, no asumido)

Incluso si la sesion orquestadora completara de forma fiable: la
herramienta `Agent` restringe con garantia verificada las herramientas
del **subagente** invocado (`tools: []`, confirmado con `tool_uses: 0`
en la ejecucion interactiva). La sesion ORQUESTADORA en si misma (la que
llamaria a `Agent`, o asumiria el rol directamente) sigue teniendo las
capacidades normales de cualquier sesion de Claude Code -- no existe hoy
un mecanismo de plataforma que la confine a "solo lectura" de forma
dura. Su comportamiento de "no tocar WordPress/staging/produccion/Ads/
GA4/GTM/Search Console/n8n/VPS, no hacer commit, no publicar" dependeria
de que el prompt del Routine lo instruya explicitamente y de que la
sesion lo respete -- exactamente el mismo modelo de confianza
(instrucciones + guards de codigo, no sandboxing de plataforma) que ya
usa el resto de este proyecto para sus agentes deterministas (ver
`docs/risk-policy.md`), no una garantia nueva ni mas debil.

## GitHub Actions + claude-code-action (mecanismo actual, sustituye al Routine)

La tabla de arriba documenta por que el mecanismo basado en Routine
(`create_new_session_on_fire`) **no es fiable**: la sesion disparada se
congela con `stop_reason=tool_use` sin resolver, con o sin `Agent`. En
vez de seguir intentando diagnosticar esa causa raiz (desconocida, sin
herramienta para leer el transcript interno de una sesion de Routine),
`.github/workflows/ux-ui-landing-architect-v2.yml` sustituye el mecanismo
de disparo completo: GitHub Actions (`workflow_dispatch` /
`schedule`, este ultimo comentado por ahora) en vez de un Routine de
Claude Cloud, y `anthropics/claude-code-action@v1` con `--agent
ux-ui-landing-architect-v2` en vez de una sesion generica que invoca
`Agent`/`Task`.

Diferencia clave con el mecanismo anterior: **la sesion orquestadora y el
empleado son la MISMA sesion.** No hay una sesion "por fuera" que decida
invocar `Agent(subagent_type: "ux-ui-landing-architect-v2")` -- el flag
`--agent` de `claude_args` hace que la sesion principal de Claude Code
Action arranque YA como `ux-ui-landing-architect-v2` (verificado leyendo
el codigo fuente real de `@anthropic-ai/claude-agent-sdk@0.3.233`, la
version que pinza `claude-code-action@v1`: `agent` es una opcion de
Options de primer nivel, "equivalent to the `--agent` CLI flag"). Todo lo
que antes hacia la sesion orquestadora (preparar el change pack, invocar
al subagente, escribir su respuesta, ejecutar el segundo paso del
runner) lo hace ahora GitHub Actions + TypeScript determinista alrededor
de esa unica sesion Claude -- nunca la propia sesion Claude, que sigue
sin herramientas (`tools: []`, mas `--disallowedTools "mcp__*"` como
defensa adicional).

### Estado real de ESTE mecanismo (honesto, no aspiracional)

| Verificado | Como |
|---|---|
| `--agent` es un mecanismo real y documentado del Claude Agent SDK (no un flag inventado) | Leido en `package/sdk.d.ts` de `@anthropic-ai/claude-agent-sdk@0.3.233` (la version exacta que instala `claude-code-action@v1`), descargado y extraido para esta verificacion. |
| `--json-schema` / `structured_output` es el mecanismo oficial de salida estructurada | `docs/usage.md` y `.github/workflows/test-structured-output.yml` del propio repositorio `anthropics/claude-code-action`, mas la documentacion publica en `code.claude.com/docs/en/agent-sdk/structured-outputs`. |
| En este workflow (`workflow_dispatch`/`schedule`, sin evento de PR/issue) no se instala ningun servidor MCP propio de la Action | Leido `src/mcp/install-mcp-server.ts` del repo de la Action: los servidores `github_comment`/`github_ci`/`github_inline_comment`/`github` solo se instalan si se piden herramientas `mcp__*` explicitas o si hay contexto de PR -- ninguna de las dos condiciones aplica aqui. |
| Pasar `github_token` explicito evita que la Action pida su propio token con permisos de escritura por defecto | Leido `base-action/src/github/token.ts`: sin `github_token` de entrada, la Action pide un token OIDC contra el GitHub App oficial de Claude con `DEFAULT_PERMISSIONS = {contents: write, pull_requests: write, issues: write}`, sin importar el `permissions:` del workflow -- y requiere `id-token: write`. |
| Todo el pipeline determinista (paso 1 del runner -> parseo de `RUNNER_RESULT_JSON` -> lectura del prompt -> escritura simulada de una respuesta V2 -> paso 2 del runner -> parseo final) funciona de extremo a extremo | Simulado localmente con una respuesta V2 ficticia (sin invocar a Claude de verdad): `v2Status` termino en `"executed"` con `fabricationWarningCount: 0`, exactamente el contrato que espera el workflow. |
| La invocacion REAL de `anthropics/claude-code-action@v1` dentro de GitHub Actions (con Claude de verdad, `--agent` de verdad) | **NO VERIFICADO TODAVIA.** Ver bloqueo abajo. |

### Bloqueo real para la prueba end-to-end (PR #3, sin merge)

Se intento disparar `workflow_dispatch` del workflow nuevo via la API de
GitHub (`POST /repos/.../actions/workflows/ux-ui-landing-architect-v2.yml/dispatches`)
apuntando a la rama del PR. Resultado: **`404 Not Found`.**
`GET /repos/.../actions/workflows` confirma la causa: solo aparece `CI`
(`.github/workflows/ci.yml`, ya en `main`) -- GitHub solo registra un
workflow como "dispatchable" (via API o UI) despues de que su fichero
exista en la rama por defecto del repositorio al menos una vez, aunque
luego SI se pueda elegir ejecutarlo contra cualquier rama con el
parametro `ref`. Con el workflow viviendo solo en
`claude/automate-landing-architect-v2-fege7j` (PR #3, sin mergear a
proposito, ver instrucciones de esa iteracion), no hay ninguna forma de
dispararlo -- ni por API ni por la UI de GitHub -- hasta que llegue a
`main`.

Esto significa que, a dia de hoy, la invocacion real de Claude dentro de
GitHub Actions (con `--agent`/`--json-schema` de verdad, autenticacion de
verdad) **sigue sin probarse end-to-end**, no por un fallo del mecanismo
disenado, sino por esta restriccion de plataforma que solo se resuelve
mergeando el workflow a `main`. La primera ejecucion real de
`workflow_dispatch` tras el merge debe documentarse aqui (reemplazando
esta fila) con el resultado exacto: `run_id`, `changePackId` procesado,
`v2Status`, numero de `fabricationWarnings`, y si la autenticacion
(`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`) estaba configurada.

## Que falta para que esto deje de ser un experimento

No es el objetivo de este documento proponerlo (evitar otra cronologia de
fases), pero para que quede explicito el alcance actual: hoy no existe
ningun mecanismo que tome la salida de V2 y la aplique a
`data/landing-blueprints.jsonl`, ni que la conecte con
`wordpress-draft-agent.ts`. V2 sigue siendo, a dia de hoy, un generador
de propuestas locales para comparacion. El flujo esta verificado de
principio a fin cuando lo orquesta una sesion interactiva de Claude Code;
el mecanismo de Routine documentado arriba no es fiable; y el mecanismo
de GitHub Actions + `claude-code-action` (este PR) tiene todo el pipeline
determinista verificado pero **la invocacion real de Claude dentro de
Actions sigue sin probarse end-to-end**, bloqueada por la restriccion de
plataforma descrita arriba hasta que el workflow llegue a `main`. En
cualquier caso, sin ningun camino hacia aplicar nada a WordPress/staging/
produccion.

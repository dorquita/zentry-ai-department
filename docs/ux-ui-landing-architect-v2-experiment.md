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
hace SIEMPRE una sesion de Claude Code (interactiva o automatica, ver
"Ejecucion autonoma en Claude Cloud" mas abajo) usando la herramienta
`Agent` -- nunca el propio proceso Node.

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
`src/core/landing-architect-change-pack-selection.ts`) -- a proposito
no siempre "el primero", para que una ejecucion recurrente (ver mas
abajo) no compare siempre el mismo change pack.

Cada ejecucion termina con una linea `RUNNER_RESULT_JSON={...}` en
stdout (changePackId, keyword, `v2Status`, numero de
`fabricationWarnings`, rutas de los artefactos) -- pensada para que
quien orquesta esto (una sesion de Claude Code) no tenga que parsear
texto libre para decidir el siguiente paso. Si `v2Status` queda en
`"invalid_output"`, el proceso termina con **codigo de salida 1**
(fail-closed, detectable por automatizacion) aunque el artefacto se
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

## Ejecucion autonoma en Claude Cloud

El flujo completo (preparar -> invocar el subagente -> validar -> auditar
-> comparar -> reportar) puede correr **sin que una persona copie/pegue
nada entre pasos**, siempre que quien orquesta sea una sesion de Claude
Code (interactiva o disparada por un Routine) -- no hay ningun mecanismo
en este repositorio que lo haga desde un proceso Node sin un modelo de
por medio.

### Mecanismo de ejecucion real (verificado, no asumido)

Este repositorio **no usa la API de Anthropic ni el Agent SDK**. La
ejecucion real del subagente usa exclusivamente capacidades nativas ya
disponibles en una sesion de Claude Code / Claude Cloud:

1. **Herramienta `Agent`** (nativa de Claude Code) -- `.claude/agents/*.md`
   se descubren automaticamente como `subagent_type` invocables desde la
   sesion que tiene el repositorio abierto. Se verifico invocando de
   verdad `ux-ui-landing-architect-v2` con el prompt EXACTO generado por
   `npm run landing-architect:compare` (sin editarlo): el subagente
   devolvio el JSON de propuesta esperado y termino con **`tool_uses: 0`**
   -- evidencia empirica (no solo declarativa) de que `tools: []` se
   respeto en la ejecucion real, ademas de las comprobaciones estaticas
   de `src/core/subagent-tool-guard.ts`.
2. **MCP `Claude_Code_Remote`** (Routines/triggers, sesiones cloud) --
   `create_trigger` programa una ejecucion periodica que dispara un
   prompt hacia una sesion NUEVA (`create_new_session_on_fire: true`) o
   hacia una sesion persistente. Es el mecanismo real de "trigger/
   routine/scheduled session" de Claude Cloud -- no una construccion de
   este proyecto.

No se ha introducido ninguna API key de Anthropic, Agent SDK, worker
propio, cola de mensajes ni infraestructura adicional -- exactamente la
prioridad pedida (capacidades nativas primero).

### Procedimiento que ejecuta la sesion orquestadora

Tanto en una sesion interactiva como en una disparada por Routine, el
procedimiento es el mismo (documentado aqui para que no viva solo dentro
del prompt del Routine):

1. `npm run landing-architect:compare -- ` (sin `--changePackId`: elige
   uno al azar). Leer la linea `RUNNER_RESULT_JSON`.
2. Leer el fichero `v2-prompt.md` que indica esa linea.
3. Invocar la herramienta `Agent` con `subagent_type:
   "ux-ui-landing-architect-v2"` y ese contenido como `prompt`, sin
   modificarlo.
4. Escribir la respuesta del subagente, **tal cual, sin reinterpretarla**,
   en el `v2-output.json` que indico el paso 1.
5. `npm run landing-architect:compare -- --changePackId <id> --v2-output
   <v2-output.json>`. Leer la segunda linea `RUNNER_RESULT_JSON`.
6. Reportar cambio pack usado, `v2Status`, numero de
   `fabricationWarnings` (listados tal cual, nunca descartados ni
   reinterpretados) y las diferencias estructurales principales
   (`comparison.json` -> `structuralDiff`). Nunca declarar cual version
   es "mejor".

Los pasos 1, 4 (la escritura del fichero) y 5 son deterministas (TOOL);
el paso 3 es la unica parte que requiere razonamiento real de Claude, y
es exactamente el subagente v2, no la sesion orquestadora, quien redacta
la propuesta.

### Routine creado (Fase 4)

`ux-ui-landing-architect-v2 — comparacion diaria`, cron diario (ver
`mcp__Claude_Code_Remote__list_triggers` para el estado actual),
`create_new_session_on_fire: true` (cada disparo arranca una sesion
nueva y desechable, nunca reutiliza el estado de una anterior). El
prompt del Routine instruye exactamente el procedimiento de arriba, mas
las restricciones de la Fase 3 (cero escritura externa, cero
publicacion, no forzar el guard si aborta). Un unico Routine, una vez al
dia, maximo un change pack por ejecucion -- tal como se pidio.

### Limite real de esta iteracion (honesto, no asumido)

La herramienta `Agent` restringe con garantia verificada las
herramientas del **subagente** invocado (`tools: []`, confirmado con
`tool_uses: 0` en una ejecucion real). La sesion ORQUESTADORA en si
misma (la que llama a `Agent`, sea interactiva o disparada por Routine)
sigue teniendo las capacidades normales de cualquier sesion de Claude
Code -- no existe hoy un mecanismo de plataforma que la confine a "solo
lectura" de forma dura. Su comportamiento de "no tocar WordPress/
staging/produccion/Ads/GA4/GTM/Search Console/n8n/VPS, no hacer commit,
no publicar" depende de que el prompt del Routine lo instruya
explicitamente y de que la sesion lo respete -- exactamente el mismo
modelo de confianza (instrucciones + guards de codigo, no sandboxing de
plataforma) que ya usa el resto de este proyecto para sus agentes
deterministas (ver `docs/risk-policy.md`), no una garantia nueva ni mas
debil introducida aqui.

## Que falta para que esto deje de ser un experimento

No es el objetivo de este documento proponerlo (evitar otra cronologia de
fases), pero para que quede explicito el alcance actual: hoy no existe
ningun mecanismo que tome la salida de V2 y la aplique a
`data/landing-blueprints.jsonl`, ni que la conecte con
`wordpress-draft-agent.ts`. V2 sigue siendo, a dia de hoy, un generador
de propuestas locales para comparacion -- ahora ejecutable de principio a
fin por una sesion de Claude Cloud sin intervencion humana intermedia,
pero sin ningun camino hacia aplicar nada.

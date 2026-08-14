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

## Como se ejecuta hoy (dos pasos, manuales)

El runner (`scripts/run-landing-architect-comparison.ts`) **no llama a
la API de Anthropic ni invoca el subagente por su cuenta** -- este
repositorio no tiene ninguna dependencia ni credencial para eso (mismo
principio que el resto del proyecto: nada se ejecuta solo). En su lugar:

```bash
# Paso 1: preparar. Calcula V1 de verdad, construye el contexto de V2
# y escribe un prompt listo para pegarselo al subagente.
npm run landing-architect:compare -- --changePackId <id>

# (fuera de este runner: se ejecuta el subagente ux-ui-landing-architect-v2
#  -- p.ej. desde una sesion de Claude Code con la herramienta Agent --
#  usando como prompt el fichero reports/ux-ui-landing-comparison/<id>/v2-prompt.md,
#  y se guarda su respuesta JSON en un fichero)

# Paso 2: completar. Valida esa respuesta, audita fabricacion de datos,
# y regenera el artefacto de comparacion con los dos resultados.
npm run landing-architect:compare -- --changePackId <id> --v2-output respuesta-v2.json
```

Sin `--changePackId`, toma el primer change pack elegible
(`ready_for_review` / `approved_to_execute`) que encuentre.

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

## Que falta para que esto deje de ser un experimento

No es el objetivo de este documento proponerlo (evitar otra cronologia de
fases), pero para que quede explicito el alcance actual: hoy no existe
ningun mecanismo que tome la salida de V2 y la aplique a
`data/landing-blueprints.jsonl`, ni que la conecte con
`wordpress-draft-agent.ts`. V2 es, a dia de hoy, un generador de
propuestas locales para comparacion manual -- nada mas.

# Coordinacion real del departamento (pasada coordinada)

Fase en la que los empleados Claude que ya funcionaban **por separado**
pasan a trabajar como un **departamento**: una unica ejecucion, un unico
`departmentRunId`, y la salida real de cada etapa disponible para la
siguiente.

```
SEO ──────────┐
Content ───────┼──> Growth Director ──> QA Reviewer ──> Web Engineer ──> DAILY BRIEF
Analytics ─────┘
```

**Alcance del analisis: READ / ANALYZE / PROPOSE.** Los seis empleados
Claude no escriben en ningun sistema externo, y `sem-specialist` queda
explicitamente fuera (pendiente).

> **Actualizacion — fase EMAIL + SCHEDULE + APPLY.** Sobre esta misma
> arquitectura (sin reescribirla) se han anadido tres cosas:
>
> - **Email**: el Daily Brief se envia por SMTP al terminar la pasada
>   — ver `docs/department-daily-brief-email.md`.
> - **Schedule**: una unica ejecucion diaria a las 07:00 UTC, mas el
>   `workflow_dispatch` de siempre y la misma `concurrency`.
> - **APPLY**: contrato estructurado por recomendacion, con aprobacion
>   HUMANA explicita (reutilizando el registro de aprobaciones que ya
>   existia), executor determinista y reversible, snapshot, validacion y
>   rollback — ver `docs/department-apply.md`. El workflow diario **solo
>   planifica**; la fase que escribe no se invoca desde CI.

## Que NO cambia

Esta capa **orquesta lo que ya funciona**; no lo reescribe:

- El **runtime comun** (`.github/actions/claude-employee-runtime/`,
  `src/core/claude-employee-runtime.ts`,
  `scripts/resolve-claude-employee-output-for-ci.ts`) se usa **sin
  modificar**. Ningun fichero suyo se ha tocado en esta fase.
- Los **runners de dominio** de `seo-specialist`, `content-strategist`,
  `analytics-specialist` y `qa-reviewer` se ejecutan tal cual, con sus
  propios `npm run <empleado>:run`, sus propios contextos y sus propias
  auditorias.
- Los **validadores y auditores de dominio** de `growth-director-v2` y
  `web-engineer` (`validateGrowthDirectorV2Output`,
  `auditGrowthDirectorV2Output`, `validateWebEngineerOutput`,
  `auditWebEngineerOutputForUnconfirmedCapabilities`) se reutilizan sin
  cambios: la capa de coordinacion solo construye su contexto/prompt y
  registra el resultado.
- Los **JSON Schemas versionados** de cada empleado
  (`config/<agente>-output.schema.json`) son los mismos.
- Los **guards de seguridad** siguen intactos: `tools: []` en los 6
  agentes, `assertSubagentIsToolless()` como preflight del runtime,
  `--disallowedTools "mcp__*"`, `contents: read`, sin `id-token: write`,
  sin `bypassPermissions`.

Las dos definiciones de agente que reciben un contexto nuevo
(`growth-director-v2`, `web-engineer`) ganan **una seccion adicional**
("Modo COORDINADO") que describe ese contexto. No se ha quitado ni
alterado nada de su comportamiento anterior.

## Piezas nuevas

| Fichero | Que hace |
|---|---|
| `src/department/types.ts` | Contratos versionados: `DEPARTMENT_RUN_CONTRACT_VERSION`, estados de etapa, `departmentRunId` de coordinacion. |
| `src/department/run-store.ts` | Rutas deterministas del run + manifiesto (`manifest.json`) + registro de etapas. |
| `src/department/specialist-inputs.ts` | FASE 1 -> 2: carga/valida las salidas reales de los especialistas y genera el catalogo de evidencia `dept-*`. |
| `src/department/growth-input.ts` | FASE 2: `GrowthDirectorV2Context` + `specialistInputs[]` + reglas de coordinacion. |
| `src/department/qa-input.ts` | FASE 3: bundle autocontenido (especialistas + sintesis de Growth) que revisa `qa-reviewer`. |
| `src/department/promotion.ts` | FASE 3 -> 4: **la puerta**. Decide de forma determinista que recomendaciones sobreviven. |
| `src/department/web-engineer-input.ts` | FASE 4: contexto con SOLO lo aprobado (y lo bloqueado, marcado como no-trabajo). |
| `src/department/daily-brief.ts` | FASE 5: ensamblado determinista del Daily Brief (JSON + Markdown + resumen). |
| `src/department/runner-result.ts` | Contrato `RUNNER_RESULT_JSON` de la capa de coordinacion. |
| `scripts/run-department-coordination.ts` | CLI por fases (`--phase`). No invoca a Claude: prepara y valida. |
| `scripts/parse-department-runner-result-for-ci.ts` | Wrapper de CI (`$GITHUB_OUTPUT`). |
| `.github/workflows/zentry-ai-department-daily.yml` | El workflow (solo `workflow_dispatch`). |

## Como pasa la informacion entre etapas

**Por ficheros JSON en rutas deterministas**, nunca por scraping de logs
ni buscando "el ultimo artifact" de una ejecucion historica:

```
reports/department/<departmentRunId>/
  manifest.json                                  <- estado de TODAS las etapas
  <departmentRunId>-qa-input.json                <- lo que revisa qa-reviewer
  promotion.json                                 <- veredicto de la puerta QA
  department-daily-brief.json / .md              <- el informe final
  step-summary.md                                <- version breve para GitHub
  stages/<empleado>/context.json | prompt.md | output.json | artifact.json
```

La linea `RUNNER_RESULT_JSON=...` que imprime cada fase transporta
**rutas y estado** al workflow (exactamente igual que ya hacian todos
los empleados individuales), nunca el contenido del trabajo.

### Dos `departmentRunId` distintos, a proposito

- **`dept-<fecha>T<hora>Z`** -- el id de ESTA pasada coordinada
  (`buildDepartmentCoordinationRunId()`, `src/department/types.ts`).
- **`growth-department-<fecha>T<hora>Z`** -- el id del bus de eventos
  determinista (`src/core/department-run-id.ts`), que es el que usa
  `analytics-specialist` para saber de que snapshot de GA4/GTM viene su
  dato.

Se registran por separado (`sourceRunId` en cada etapa) precisamente
para que no puedan confundirse.

## Estados de etapa y degradacion

Cinco estados explicitos (`DepartmentStageStatus`):

| Estado | Significado | Tumba la pasada? |
|---|---|---|
| `executed` | Corrio y su salida paso la validacion de su propio dominio. | No |
| `not_available` | No habia insumos reales en esta pasada. | No |
| `blocked` | No debia correr porque una etapa anterior lo impide (p.ej. QA bloqueo todo). | No |
| `invalid_output` | Corrio pero su salida NO cumple su contrato. Descartada, nunca reinterpretada. | Si |
| `failed` | Fallo tecnico real (step muerto, timeout, auth). | Si |

Un especialista `not_available` o `failed` **no impide** que Growth
siga: recibe su ausencia declarada de forma explicita y tiene prohibido
rellenarla. Lo que si es fail-closed en la direccion contraria:

- **Sin Growth valido** -> no se promueve nada a ingenieria.
- **Sin QA valida** -> no se promueve nada. "QA no se pronuncio" nunca
  equivale a "aprobado".
- **QA BLOCKED** -> no se promueve nada.

## La puerta de QA (`promotion.ts`)

`qa-reviewer` emite `pass` / `pass_with_warnings` / `fail`. El
departamento lo traduce a `PASS` / `PASS_WITH_WARNINGS` / `BLOCKED` /
`NOT_AVAILABLE`, reutilizando `summarizeQaReviewerOutput()` del propio
empleado: cualquier hallazgo `critical` o cualquier `safetyConcern`
cuenta como `BLOCKED` aunque el `reviewStatus` diga `pass`.

Con el conjunto aprobado, la puerta sigue evaluando **recomendacion a
recomendacion**: una recomendacion queda bloqueada si su titulo aparece
citado en un hallazgo `critical`, un `safetyConcern`, una
`requiredCorrection`, una `contradiction` o un `unsupportedClaim`. Un
hallazgo `warning` que la cite no la bloquea: la promueve marcada con
ese aviso.

**Limitacion conocida y deliberada:** la atribucion se hace por
coincidencia literal del titulo normalizado (minusculas, sin
diacriticos, sin puntuacion), por eso las instrucciones que recibe QA le
piden citar el titulo EXACTO. Una senal bloqueante que no coincida con
ningun titulo **no se descarta**: queda en
`unattributedBlockingSignals[]` y aparece en la seccion BLOCKED /
UNKNOWN del brief para lectura humana.

## El Daily Brief

Ensamblado **determinista**, sin ninguna llamada extra a un modelo y sin
ninguna metrica inventada (todo numero del informe es un conteo de
elementos realmente producidos en la pasada). Diez secciones:

1. Resumen ejecutivo (que hemos descubierto / que merece atencion / que
   ha cambiado)
2. Top priorities -- con accion, motivo, impacto, confianza, esfuerzo,
   evidencia, agente de origen, QA status y "necesita aprobacion"
3. SEO - 4. Content - 5. Analytics - 6. SEM / Google Ads -
   7. Growth Director - 8. QA - 9. Web Engineering
10. BLOCKED / UNKNOWN (cualquier etapa sin salida utilizable, con su
    estado real)
11. Approvals needed

**Trazabilidad:** cada prioridad lleva sus `evidenceRefs` ya resueltas a
la descripcion real y al empleado del que salen
(`attributeEvidenceRefToEmployees`). Si Growth cita una ref que no
existe en el catalogo, el brief la marca como NO verificada en vez de
ocultarla.

**"Que ha cambiado"** compara con la pasada coordinada anterior del
checkout si existe; si no existe, lo dice explicitamente en vez de
inventar una comparativa.

## Ejecutar

Solo `workflow_dispatch`:

```
Actions -> "Zentry AI Department -- Daily Brief (coordinacion real)" -> Run workflow
```

En local (sin Claude, util para inspeccionar contextos y prompts):

```bash
npm run department:run -- --phase init
npm run department:run -- --phase record-stage --departmentRunId <id> --stage seo-specialist --status executed --output <fichero.json>
npm run department:run -- --phase prepare-growth --departmentRunId <id>
# ...completar con la salida real del empleado...
npm run department:run -- --phase brief --departmentRunId <id>
npm run department:run -- --phase gate --departmentRunId <id>
```

## Pendiente (fuera de esta fase, por decision explicita)

- El puente entre la especificacion de `web-engineer` y el registro de
  capacidades del APPLY: hoy el agente no recibe el catalogo de paginas
  de staging ni se le pide el bloque `TITLE:`/`META:`, asi que sus
  propuestas salen como `requires_manual_implementation` salvo que la
  especificacion cite la pagina y los valores a mano. Ver
  `docs/department-apply.md`.
- Executors para cualquier tipo de cambio que no sea title/meta de un
  borrador de staging ya existente.

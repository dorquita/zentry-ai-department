# Evidencia de estabilidad — runtime común de empleados Claude

Acompaña a `docs/claude-runtime-reliability-incident.md`. Todo lo de aquí
son runs reales en GitHub Actions sobre la rama
`claude/claude-runtime-intermittent-2sd0ug`. No se reutiliza la salida de
ninguna pasada anterior ni se maquilla ningún run rojo.

---

## 1. Reconstrucción de los runs ANTES del fix

Forensia extraída de los logs reales de cada invocación.

| Campo | `growth-director-v2` | `seo-specialist` | `seo-specialist` |
|---|---|---|---|
| run ID | `31884787140` | `31949966340` | `31950906860` |
| job ID | `95012396166` | `95171825604` | `95174688707` |
| commit | `4e21ab71` | `0ec11512` | `f46986ac` |
| resultado del run | **failure** | **failure** | **success** |
| model | `claude-sonnet-5` | `claude-sonnet-5` | `claude-sonnet-5` |
| duration (SDK) | 110.485 ms | 257.935 ms | ~284.000 ms |
| num_turns | **1** | **1** | **1** |
| Claude action conclusion | **failure** | **failure** | **failure** |
| action exit code | 1 | 1 | 1 |
| SDK final message presente | **YES** | **YES** | **YES** |
| final subtype | `success` | `success` | `success` |
| is_error | `false` | `false` | `false` |
| **structured_output presente** | **NO** | **NO** | **NO** |
| execution_file output presente | YES | YES | YES |
| execution_file path | `$RUNNER_TEMP/claude-execution-output.json` | ídem | ídem |
| fichero existe | YES | YES | YES |
| result string presente | YES | YES | YES |
| parse JSON | **FALLA** (`Expected ',' or '}' ... position 1407`) | OK | OK |
| schema validation | no se alcanza | **FALLA** (`$.technicalIssues[1]` sin `page`) | OK |
| origen de salida final | `none` | `none` | `execution_file_fallback` |
| failureKind (taxonomía nueva) | `result_not_json` | `schema_validation_failed` | — |

**El dato que cierra el diagnóstico:** el run **verde** (`31950906860`)
tiene *exactamente* el mismo perfil de runtime que los rojos —
`CLAUDE_OUTCOME: failure`, `structured_output` ausente, salida recuperada
por fallback. La única diferencia es que esa vez el JSON escrito a mano
salió bien. **En 8 de 8 invocaciones medidas, `structured_output` nunca
llegó.**

## 2. Experimento controlado, mismo input congelado

`seo-specialist`, prompt real de 52.265 bytes (hash `6fe1b8a001217e7e`),
schema real de 6.606 bytes (hash `4b529fe7c1414c23`), Claude Code 2.1.233
(el mismo que instala la Action fijada).

| Arm | `tools:` del agente | n | `structured_output` | `num_turns` | `stop_reason` | coste (USD) |
|---|---|---|---|---|---|---|
| A | `[]` | 2 | **0 / 2** | 1 | `end_turn` | 0,638 / 0,494 |
| B | `[StructuredOutput]` | 2 | **2 / 2** | 3 | `tool_use` | 1,032 / 0,660 |

Aislamiento del mecanismo (prompt trivial, mismo schema):

| Configuración | `structured_output` | Conclusión |
|---|---|---|
| `--json-schema` solo | ✅ | el flag funciona |
| `--json-schema` + `--agent` (agente sin `tools:`) | ✅ | **no es `--agent`** |
| `--json-schema` + `--agent` (agente con `tools: []`) | ❌ | **es `tools: []`** |
| `--json-schema` + `--tools ""` | ✅ | sesión con **solo** `StructuredOutput` |
| `--json-schema` + `--disallowedTools "*"` | ❌ | el comodín deniega también el carrier |
| `--json-schema` + `--agent` (agente con `tools: [StructuredOutput]`) | ✅ | **el fix** |

## 3. Verificación en producción del cambio de comportamiento

Primer run real después del fix — `content-strategist`, run
`31964378704`, job `95207163418`:

```
CLAUDE_OUTCOME: success
OUTPUT_SOURCE: structured_output directo (caso A)
STATUS_STEP2: executed
[runtime] Metricas de fiabilidad (1 invocacion/es): invocaciones=1
  exito_1er_intento=1 recuperadas_por_reintento=0 fallos_deterministas=0
  fallos_transitorios_no_recuperados=0 success_rate=100%
  coste_estimado_total=0.249951
```

Dos cosas que **nunca** habían pasado en este proyecto:

1. el step de Claude termina en `success` (antes: `failure` en el 100% de
   las invocaciones, incluidas las verdes);
2. la salida viene del **caso A** (`structured_output`). La documentación
   previa registraba explícitamente que el caso A no se había alcanzado
   jamás en un run real.

## 4. Estabilidad aislada del runtime (§15)

**10 invocaciones consecutivas del runtime comun, todas verdes**, sobre el
commit `b501f90`, repartidas entre los tres empleados pedidos:

| # | Empleado | run ID | run # | Resultado |
|---|---|---|---|---|
| 1 | `content-strategist` | `31964378704` | 2 | success |
| 2 | `growth-director-v2` | `31964377289` | 3 | success |
| 3 | `seo-specialist` | `31964372158` | 6 | success |
| 4 | `content-strategist` | `31964521150` | 3 | success |
| 5 | `growth-director-v2` | `31964547319` | 4 | success |
| 6 | `seo-specialist` | `31964882533` | 7 | success |
| 7 | `growth-director-v2` | `31964883469` | 5 | success |
| 8 | `content-strategist` | `31964884479` | 4 | success |
| 9 | `seo-specialist` | `31965242318` | 8 | success |
| 10 | `content-strategist` | `31965243499` | 5 | success |

- `no_output_at_all`: **0**
- `execution_file_missing`: **0**
- fallos de runtime sin explicar: **0**
- reintentos necesarios: **0** (10/10 al primer intento)

## 5. Estabilidad del departamento (§16)

### Pasada A (`31965244763`) — ROJA, y por que NO cuenta como fallo de runtime

Se reporta tal cual, sin maquillar. La pasada del departamento
(`Pasada coordinada del departamento`) termino **success**: las seis
invocaciones del runtime comun salieron verdes y el estado se persistio
correctamente en la rama `department-state`.

Lo que puso el run en rojo fue un **error mio de fontaneria del workflow**,
no del runtime: el step nuevo de metricas se anadio al final del fichero y
quedo dentro del segundo job (`persist-state`), que borra el working tree
entero — `package.json` incluido — antes de commitear el estado. `npm run`
murio con `ENOENT` (exit 254) DESPUES de que el estado ya se hubiera
persistido.

| Invocacion del runtime en la pasada A | Resultado |
|---|---|
| `seo-specialist` | success (5m 09s) |
| `content-strategist` | success (1m 44s) |
| `analytics-specialist` | success (2m 22s) |
| `growth-director-v2` | success |
| `qa-reviewer` | success |
| `web-engineer` | success |

Corregido en `51563d9` (step movido al job `department-run`) mas un guard
de regresion en `test/department-coordination-safety.test.ts` que falla si
vuelve a colarse en el job de persistencia.

### Pasadas 1-3 sobre el commit corregido

**PENDIENTE.** La pasada `31967138507` (commit `51563d9`) lleva mas de 35
minutos en estado `pending` de GitHub, sin asignacion de runner. Las
pasadas anteriores del mismo dia arrancaron tras ~12 min de cola, asi que
esto apunta a disponibilidad de runners o a cuota de Actions de la cuenta,
no a nada del runtime.

**Este criterio de cierre (§16) NO esta cumplido todavia.** No se declara
estable hasta que existan tres pasadas coordinadas consecutivas verdes
sobre el commit corregido.

## 6. Métricas de fiabilidad

Ejemplo real, `content-strategist` run `31964378704`:

```
invocaciones=1 exito_1er_intento=1 recuperadas_por_reintento=0
fallos_deterministas=0 fallos_transitorios_no_recuperados=0
success_rate=100% coste_estimado_total=0.249951
```

Acumulado de las 10 invocaciones aisladas:

| Metrica | Valor |
|---|---|
| runtime invocations | 10 |
| successes first attempt | 10 |
| recovered by retry | 0 |
| deterministic failures | 0 |
| transient failures | 0 |
| unrecovered runtime failures | 0 |
| **success rate** | **100% (10/10)** |
| reintentos ejecutados | 0 |

Antes del fix, sobre las invocaciones reconstruidas del apartado 1: 1 de 3
aceptada (33%), y el 100% con el step de Claude en `failure`.

**Coste.** El structured output real anade el turno del carrier: de
`num_turns` 1 a 3, y de ~0,49-0,64 USD a ~0,66-1,03 USD por invocacion de
`seo-specialist` (estimacion a tarifa de lista, no una factura: con
suscripcion no corresponde a ningun cargo). Coste adicional de reintentos
en esta evidencia: **0 USD** — no hizo falta ninguno.

## 7. CI

`CI` run `31964370831` sobre la rama: **success** (typecheck + 1.105 tests
+ actionlint).

Tras el fix del workflow (`51563d9`), en local: `npm run typecheck` limpio,
`npm test` 1.105/1.105, `actionlint` sin hallazgos.

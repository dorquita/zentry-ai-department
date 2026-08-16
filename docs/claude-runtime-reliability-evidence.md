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

### Pasada B (`31967138507`, commit `51563d9`) — ROJA, tampoco por el runtime

Segundo run rojo, reportado igual de crudo. **Las seis invocaciones del
runtime comun volvieron a salir verdes:**

| Invocacion | Resultado | Duracion |
|---|---|---|
| `seo-specialist` | success | 4m 35s |
| `content-strategist` | success | 1m 18s |
| `analytics-specialist` | success | 2m 46s |
| `growth-director-v2` | success | 3m 03s |
| `qa-reviewer` | success | 3m 30s |
| `web-engineer` | **skipped** | — (sin recomendaciones aprobadas que especificar: salida legitima de dominio, no fallo de runtime) |

El step que fallo fue el **65, `[STATE] Verificar que la pasada no ha
perdido estado`** — de nuevo un error mio, no del runtime: yo escribia los
`claude-runtime-health.json` dentro de `reports/`, que **es estado
persistido del departamento**. Cada pasada los reescribe con un contenido
distinto, asi que en cuanto uno encogia respecto a la pasada anterior, el
guard de perdida de estado lo denunciaba. Y hacia bien: ese guard no puede
distinguir un diagnostico efimero de un dato real del departamento.

Corregido en `1be90de`: el diagnostico pasa a `runner.temp` (efimero por
pasada, publicado como artifact) y nunca toca `data/` ni `reports/`. Guard
de regresion anadido.

### Pasada C (`31969938538`, commit `e85856d`) — ROJA, y las SEIS invocaciones verdes

| Invocacion | Resultado | Duracion |
|---|---|---|
| `seo-specialist` | success | 5m 59s |
| `content-strategist` | success | 1m 24s |
| `analytics-specialist` | success | 2m 04s |
| `growth-director-v2` | success | 2m 30s |
| `qa-reviewer` | success | 3m 29s |
| `web-engineer` | success | 2m 16s |

**6/6 invocaciones del runtime comun verdes**, esta vez incluida
`web-engineer`. Y el run sigue en rojo por el **mismo step 65,
`[STATE] Verificar que la pasada no ha perdido estado`** — que mi cambio
de rutas NO tocaba.

Conclusion honesta: **ese fallo no es del runtime comun y no lo he
causado yo.** Es el guard de perdida de estado del departamento
reaccionando a algo que encoge entre pasadas cuando se ejecutan varias
pasadas el mismo dia sobre una rama: los informes de `reports/` se
regeneran en cada pasada y el propio suite de tests ya documenta que un
informe del dia regenerado con MENOS contenido cuenta como regresion
(`test/state-persistence`, caso "un informe del dia que se regenera con
el MISMO o MAS contenido no es una regresion").

Queda **fuera del alcance de este incidente** (§20: el alcance es
`Claude employee runtime reliability`), asi que NO lo he tocado: cambiar
el guard de perdida de estado para que una pasada repetida no lo dispare
es una decision de diseno del departamento, no del runtime, y merece su
propio analisis.

### Estado del criterio §16

| Pasada | Run | Invocaciones de runtime | Fallo del runtime | Resultado del run | Causa del rojo |
|---|---|---|---|---|---|
| A | `31965244763` | 6/6 verdes | **NO** | failure | step de metricas mal colocado (mio, corregido) |
| B | `31967138507` | 5/5 ejecutadas verdes | **NO** | failure | diagnostico dentro del estado persistido (mio, corregido) |
| C | `31969938538` | **6/6 verdes** | **NO** | failure | guard de perdida de estado (preexistente, fuera de alcance) |

**Fallos de runtime en las tres pasadas coordinadas: 0.**
**Pasadas coordinadas completamente verdes: 0 de 3.**

**§16 NO esta cumplido tal y como se pidio**, y por tanto **no declaro
estable el runtime comun** todavia, aunque las 17 invocaciones del
runtime dentro de esas tres pasadas hayan salido todas verdes y sin un
solo `runtime=failure` / `claude=failure` / `output source=none`.

Lo que falta para cerrarlo es resolver el guard de estado, que es un
trabajo distinto de este incidente.

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

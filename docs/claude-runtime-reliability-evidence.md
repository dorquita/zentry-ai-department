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

<!-- TABLA_ESTABILIDAD_AISLADA -->

## 5. Estabilidad del departamento (§16)

<!-- TABLA_ESTABILIDAD_DEPARTAMENTO -->

## 6. Métricas de fiabilidad

<!-- TABLA_METRICAS -->

## 7. CI

<!-- CI -->

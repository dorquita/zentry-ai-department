# Incidente P0 — fiabilidad del runtime común de empleados Claude

**Estado:** causa raíz identificada y corregida; pendiente de la evidencia
de estabilidad (ver "Evidencia de estabilidad" al final).

**Alcance:** `Claude employee runtime reliability` únicamente. No se ha
tocado Web Engineer, ChangePlan, escrituras Novamira, política
execute-php, SEM, Telegram, Cloudflare, D1, WordPress de producción ni el
VPS legacy.

---

## 1. Qué se observaba

Empleados Claude (`seo-specialist`, `growth-director-v2`, y en potencia
cualquiera que use `.github/actions/claude-employee-runtime`) terminaban
en `failed` de forma intermitente:

- Claude se invocaba y respondía;
- el mismo input podía funcionar en otra pasada;
- el runtime terminaba sin salida utilizable;
- el empleado quedaba `failed` y la pasada del departamento se degradaba.

Se había tratado como fallos individuales de cada empleado (se retocaban
sus instrucciones para que escribiera "mejor JSON"). No lo eran.

## 2. Causa raíz

**`tools: []` en el frontmatter de cada `.claude/agents/<empleado>.md`
quitaba TODAS las herramientas de la sesión — incluida `StructuredOutput`,
la herramienta interna de fin-de-turno que el Claude Agent SDK usa para
entregar `structured_output` cuando se pasa `--json-schema`.**

Sin ese *carrier*, el SDK no puede instalarlo; el modelo no tiene por
dónde emitir la salida estructurada, así que termina el turno con texto
libre (`stop_reason: end_turn`, `num_turns: 1`) y **`structured_output`
nunca llega**.

La consecuencia es en cadena:

1. `--json-schema` queda **INERTE**. No restringe la generación. El
   schema deja de ser un contrato que el modelo debe cumplir y pasa a ser
   solo una comprobación *a posteriori* que hace nuestro
   `json-schema-lite`.
2. Se pierde la red de seguridad del SDK: con structured output real, el
   SDK **valida contra el schema y vuelve a preguntar al modelo** si no
   encaja, hasta agotar reintentos (`error_max_structured_output_retries`).
   Sin él, no hay reintento ni reparación de ningún tipo.
3. `claude-code-action` (SHA fijado) lanza siempre
   `--json-schema was provided but Claude did not return structured_output`
   y hace `process.exit(1)`, así que **el step de Claude terminaba en
   `failure` en el 100% de las invocaciones — también en las verdes.**
4. El resultado real de cada empleado venía SIEMPRE del
   `execution_file_fallback`: JSON escrito a mano por el modelo, sin
   validación en generación. Que una pasada saliera verde o roja dependía
   de si ese JSON manual salía bien esa vez.

### Los dos fallos observados no eran del runtime

| Run | Empleado | Fallo | Capa real |
|---|---|---|---|
| `31884787140` | `growth-director-v2` | `SyntaxError: Expected ',' or '}' ... position 1407` | comilla doble sin escapar en el JSON escrito a mano |
| `31949966340` | `seo-specialist` | `$.technicalIssues[1]: falta la propiedad requerida "page"` | campo requerido ausente en el JSON escrito a mano |

Ambos son exactamente lo que el structured output del SDK habría
detectado y re-preguntado antes de devolver nada.

## 3. Respuesta exacta a "runtime=failure, claude=failure, output source=none"

De las hipótesis A–L planteadas, **ninguna describe lo que pasaba**, y la
distinción importa:

- **NO** era A (la llamada nunca arrancó): arrancaba siempre.
- **NO** era B/K (SDK/red): `subtype: success`, `is_error: false`.
- **NO** era C/D/E/F (el `execution_file` se perdía, desaparecía o quedaba
  incompleto): se escribía **antes** de la comprobación de
  `structured_output` (`run-claude-sdk.ts:192`), y su ruta **sí** se
  publicaba incluso al fallar, vía `setExecutionFileOutputIfPresent()` en
  el `catch` de `run.ts:315`. Verificado en los logs reales: el step
  `resolve` recibía `EXECUTION_FILE_PATH=/home/runner/work/_temp/claude-execution-output.json`.
- **NO** era G/H (GitHub mató el proceso / timeout).
- **NO** era I (el output no se propagó al composite action).
- **NO** era J (race entre escritura y resolución).

**Lo que ocurría es una categoría que no estaba en la lista: el contrato
de salida estaba silenciosamente desactivado.** La capa que fallaba era
la **configuración del agente** (`tools: []`), que deshabilitaba el
mecanismo de validación en generación del SDK. `output source=none` no
significaba "se perdió la salida", significaba "la salida existía pero no
cumplía el contrato, y nadie se lo había hecho cumplir al modelo mientras
lo escribía".

**Culpable:** nuestro runtime (la configuración del agente), **no** Claude,
**no** el proveedor, **no** la Action, **no** GitHub.

## 4. Experimento controlado (mismo input, repetido)

Prompt real congelado de `seo-specialist` (52.265 bytes, hash
`6fe1b8a001217e7e`) + schema real (6.606 bytes, hash `4b529fe7c1414c23`),
mismo agente, mismo modelo, mismo CLI (Claude Code 2.1.233, el mismo que
instala la Action fijada):

| Arm | `tools:` del agente | n | `structured_output` | `num_turns` | `stop_reason` |
|---|---|---|---|---|---|
| A (producción) | `[]` | 2 local + 6 en Actions = **8** | **0 / 8** | 1 | `end_turn` |
| B (corregido) | `[StructuredOutput]` | **2** | **2 / 2** | 3 | `tool_use` |

Aislamiento adicional del mecanismo (mismo prompt trivial):

| Configuración | `structured_output` |
|---|---|
| `--json-schema` solo | ✅ |
| `--json-schema` + `--agent` (agente **sin** `tools:`) | ✅ |
| `--json-schema` + `--agent` (agente con `tools: []`) | ❌ |
| `--json-schema` + `--tools ""` | ✅ (sesión con **solo** `StructuredOutput`) |
| `--json-schema` + `--disallowedTools "*"` | ❌ (el comodín también deniega el carrier) |
| `--json-schema` + `--agent` (agente con `tools: [StructuredOutput]`) | ✅ |

Es decir: **no era `--agent`. Era `tools: []`.**

## 5. Versión de claude-code-action auditada

`anthropics/claude-code-action@9d7150bc8a3dae8149739a88019d192b579ad90c`
(v1.0.193, "chore: bump Claude Code to 2.1.233 and Agent SDK to 0.3.233").
Se leyó el código fuente real de ESE commit:

- `base-action/src/execution-file.ts` — el `execution_file` se escribe en
  `$RUNNER_TEMP/claude-execution-output.json` (ruta **absoluta y fija**,
  la misma para todas las invocaciones del job) con un único
  `await writeFile(...)`, así que no hay escritura parcial en condiciones
  normales.
- `base-action/src/run-claude-sdk.ts:192` — se escribe **antes** de
  cualquier comprobación de `structured_output`, y también dentro del
  `catch` del stream (línea 184). El resultado recuperable no se pierde.
- `base-action/src/run-claude-sdk.ts:239-247` — si `hasJsonSchema` y no
  hay `structured_output`: `core.setFailed(...)` + `throw`.
- `src/entrypoints/run.ts:303-311` — los `setOutput` viven **después** de
  que `runClaude()` retorne, así que ese `throw` se los salta...
- `src/entrypoints/run.ts:315` — ...pero el `catch` llama a
  `setExecutionFileOutputIfPresent()`, que republica la ruta si el fichero
  existe. **Por eso el fallback seguía funcionando.**

**No es un bug de la Action.** Se comporta exactamente como está escrito:
si pides `--json-schema` y no llega `structured_output`, falla. El
problema era que nosotros hacíamos imposible que llegara.

**No se ha actualizado la Action.** No hay motivo: la ruta relevante no
está rota. Cambiar de versión habría sido ruido sobre un diagnóstico ya
cerrado.

## 6. Bug adicional encontrado (contaminación cruzada, latente)

El `execution_file` vive en una ruta **fija y compartida**
(`$RUNNER_TEMP/claude-execution-output.json`). La pasada coordinada del
departamento ejecuta **seis empleados en un único job**, uno detrás de
otro, y `setExecutionFileOutputIfPresent()` publica el fichero que
encuentre **sin comprobar quién lo escribió**.

Es decir: si la invocación del empleado *N* moría antes de escribir su
fichero, el runtime habría leído, validado y aceptado **la salida del
empleado _N-1_ como si fuera la suya**. Contra el mismo schema no habría
saltado ninguna alarma en varios casos.

No hay evidencia de que llegara a ocurrir, pero era alcanzable. Corregido:

1. `prepare` **purga** el fichero compartido antes de cada invocación.
2. `capture` compara además el `mtime` del fichero contra el momento de la
   purga; si es anterior, se clasifica `execution_file_stale` y **jamás**
   se acepta como salida propia.

## 7. Taxonomía de fallos y política de reintento

`src/core/claude-runtime-failure-taxonomy.ts`. Cada clase lleva
`retriable`, `reason`, `evidence` y `attempt`.

| Clase | Retriable | Por qué |
|---|---|---|
| `network_failure` | **SÍ** | No depende del input |
| `provider_transient_failure` | **SÍ** | 429/5xx/overload/corte de stream |
| `action_internal_failure` | **SÍ** | La Action murió por dentro sin dejar salida |
| `no_output_at_all` | **SÍ** | Ni `structured_output` ni ruta de fichero |
| `execution_file_missing` | **SÍ** | La Action no llegó a escribir |
| `execution_file_stale` | **SÍ** | Residuo de otra invocación; esta no produjo nada |
| `result_missing` | **SÍ** | El stream murió antes del mensaje final |
| `auth_failure` | NO | Credencial ausente/caducada: hay que renovarla a mano |
| `timeout` | NO | Un reintento no cabe en el mismo presupuesto de tiempo |
| `execution_file_invalid` | NO | Fichero truncado/corrupto: no se repara contenido |
| `result_not_json` | NO | El SDK ya reintenta por dentro; llegar aquí es contrato roto |
| `schema_validation_failed` | NO | Ídem — incluye `error_max_structured_output_retries` |
| `domain_validation_failed` | NO | Problema de contenido, no de infraestructura |
| `tool_policy_failed` | NO | Configuración del repositorio |
| `unknown_runtime_failure` | NO | **No se reintenta lo que no se sabe explicar** |

**Política:** máximo **1 reintento**, solo para clases transitorias, con
backoff de 20 s. Si el segundo intento falla, el empleado queda `failed`
con el incidente registrado. No hay bucles.

Nota importante sobre `schema_validation_failed`: **antes de este fix,
marcarlo como no-retriable habría sido un error**, porque el JSON lo
escribía el modelo a mano y un segundo intento tenía una probabilidad real
de salir bien. Ahora que el SDK valida y re-pregunta en generación, un
`schema_validation_failed` que llega hasta nuestro runtime ya ha
sobrevivido a los reintentos internos del SDK: repetirlo desde fuera sería
repetir un bucle ya agotado.

### Idempotencia

El reintento recibe **exactamente** los mismos inputs (prompt, schema,
agente, modelo, `max-turns`, `departmentRunId`). Los empleados de
razonamiento no escriben en ningún sistema externo, así que repetir la
invocación no tiene efectos observables fuera del runtime.

Cada intento persiste su evidencia y su salida en **su propia ruta**
(`attempt-1/`, `attempt-2/`), y `finalize` elige **UN único intento
ganador**. Nunca se fusionan dos salidas.

## 8. Protección del resultado recuperable

- El `execution_file` se copia a una ruta propia del intento **en cuanto
  existe**, no al final de la cadena.
- Si Claude respondió de verdad, el resultado se recupera aunque
  `structured_output` falte y aunque el step haya terminado en no-cero.
- La validación sigue siendo estricta y **idéntica** por los dos caminos:
  `parse` → `schema` → (auditoría de dominio del empleado, después).
  Nunca se marca `executed` solo porque exista texto.
- `finalize` es **fail-closed**: si ningún intento produjo salida válida,
  sale != 0 y **no escribe** el fichero de salida (nunca vacío ni parcial).

## 9. `continue-on-error`

No se ha añadido ninguno nuevo. Sigue existiendo únicamente en los dos
steps que invocan `claude-code-action` (intento y reintento), justificado
igual que antes: permite recuperar la salida antes de que nuestro
fail-closed decida. La autoridad final sigue siendo `finalize`.

## 10. Seguridad: qué cambia y qué no

Se concede `StructuredOutput` a los 8 empleados. **No es una capacidad
nueva:** es el carrier interno de fin-de-turno del SDK. No lee ficheros,
no ejecuta comandos, no sale a la red y no escribe en ningún sistema —
transporta exactamente el mismo JSON que el modelo ya imprimía como texto
libre.

El Subagent Tool Guard pasa de "cero herramientas" a **"cero herramientas
de capacidad"**, y sigue siendo fail-closed:

- cualquier herramienta que no sea exactamente `StructuredOutput` hace
  fallar el preflight, sea de lectura o de escritura, conocida o no;
- se detecta **drift en ambos sentidos** entre `config/subagent-tool-allowlist.json`
  y el frontmatter del `.md`.

La superficie de capacidad real del empleado sigue siendo **cero**.

## 11. Observabilidad

- **Por invocación:** `claude-runtime-health.json` — empleado, intentos,
  método de auth, duración, resultado de la Action, `failureKind`,
  `retried`, `recovered`, origen de la salida, estado de validación,
  modelo, turnos, coste estimado, y forensia completa por intento
  (tipos de mensaje SDK, último mensaje, subtype, `is_error`, longitud del
  result, existencia/bytes del fichero).
- **Agregado:** métricas de fiabilidad (invocaciones, éxitos al primer
  intento, recuperadas por reintento, fallos deterministas, fallos
  transitorios, no recuperados, **success rate**, reintentos ejecutados,
  reintentos evitados por clasificación, y coste separado de intento y
  reintento).
- **Secretos:** del prompt y del schema se guardan **solo tamaño y hash**.
  Nunca su contenido, nunca la respuesta del modelo, nunca una credencial.

## 12. Timeouts

El `timeout-minutes` del step caller sube de **10 a 22 min**. Con
structured output activo se han medido invocaciones de hasta **5,5 min**
(y el turno extra del carrier las alarga respecto a antes), así que dos
intentos + backoff ya no caben en 10: un reintento legítimo habría muerto
por timeout a mitad. El timeout del job sube en consecuencia (20 → 35 en
los workflows de empleado; 120 → 180 en la pasada coordinada).

## 13. Coste

El structured output real cuesta más que el texto libre, porque añade el
turno del carrier (y, cuando hace falta, la re-pregunta del SDK):

| | `num_turns` | coste estimado (USD) |
|---|---|---|
| Antes (`tools: []`) | 1 | 0,494 – 0,638 |
| Después (`tools: [StructuredOutput]`) | 3 | 0,660 – 1,032 |

Es el precio de que el contrato se valide **mientras** se genera, en vez
de descubrir el incumplimiento después y perder la pasada entera. Una
pasada perdida cuesta el 100% de la invocación más el retraso del
departamento.

El coste de los reintentos se mide por separado
(`cost.firstAttemptUsd` / `cost.retryUsd`), igual que el coste **evitado**
por no reintentar fallos deterministas
(`cost.estimatedUsdAvoidedByClassification`). Las cifras son estimaciones
a tarifa de lista: con autenticación por suscripción no corresponden a
ningún cargo.

## 14. Limitaciones externas conocidas

- **El mensaje de error de `claude-code-action` no es accesible como
  output.** La clasificación por firma (`auth` / `red` / `proveedor` /
  `timeout`) solo puede aplicarse cuando el motivo llega por el
  `execution_file` (subtype del mensaje final). En la práctica el hueco
  está cubierto: `auth` ya se corta antes de invocar (`BLOCKED_BY_AUTH`),
  y el resto cae en clases conservadoras.
- **Los steps internos de una composite action no admiten
  `timeout-minutes` propio.** Sigue siendo cierto; el backstop es el
  `timeout-minutes` del step caller.
- **El `execution_file` sigue teniendo una ruta fija compartida** dentro
  de la Action fijada. No se puede cambiar desde fuera; se mitiga con
  purga + comprobación de `mtime`.
- **No se puede prometer 0% de fallo.** El sistema está diseñado para
  detectar → clasificar → recuperar → y, si no puede recuperar, explicar
  exactamente por qué.

## 15. Evidencia de estabilidad

Ver `docs/claude-runtime-reliability-evidence.md`.

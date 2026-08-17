# SEO-SPECIALIST RELIABILITY INCIDENT (P0) -- cerrado

## Causa raiz

`--json-schema` estaba INERTE porque el frontmatter `tools: []` impide que
Claude Code exponga al subagente la herramienta `StructuredOutput`, unico
canal por el que el Agent SDK entrega la salida estructurada.

## Capa exacta

`Agent definition` -> `model invocation`. Ni el runner de GitHub, ni el
workflow, ni `claude-code-action`, ni el resolver: el flag llegaba bien al
CLI (verificado leyendo `base-action/src/parse-sdk-options.ts` del commit
fijado, que lo pasa por `extraArgs`), pero el agente no tenia el canal
para responderlo.

## Evidencia

Reproducido con el CLI `claude` 2.1.233, el mismo que instala la Action:

| Invocacion | num_turns | stop_reason | structured_output |
| --- | --- | --- | --- |
| `--json-schema` sin `--agent` | 2 | `tool_use` | **presente** |
| `--json-schema --agent seo-specialist` (`tools: []`) | 1 | `end_turn` | ausente |
| idem + `--allowedTools StructuredOutput` | 1 | `end_turn` | ausente |
| `--agent` con `tools: StructuredOutput` | 2 | `tool_use` | **presente** |

`--allowedTools` en linea de comando NO rescata la situacion: manda el
`tools:` del frontmatter.

Con el prompt REAL de seo-specialist, sin el fix: 1 de 2 pasadas fallo con
el error EXACTO del run 31949966340 en produccion
(`$.technicalIssues[1]: falta la propiedad requerida "page"`). La otra
paso. Eso es la intermitencia.

Firma en produccion, identica a la reportada
(run 32040810091, pasada coordinada 33):
`paso1=success, runtime=failure, claude=failure, origen de salida=ninguno`.

## Diferencia que lo provocaba

Con `--json-schema` inerte, TODOS los empleados dependian de que el modelo
acertase el JSON a mano. `seo-specialist` es el mas exigente de los seis en
los dos ejes que importan:

| empleado | prompt bytes | campos required | nodos schema |
| --- | --- | --- | --- |
| **seo-specialist** | **52.265** | **49** | **102** |
| growth-director-v2 | 29.577 | 33 | 74 |
| content-strategist | 21.966 | 26 | 53 |
| analytics-specialist | 18.979 | 26 | 59 |
| qa-reviewer | 18.029 | 20 | 44 |
| web-engineer | 16.638 | 20 | 44 |

Prompt 1,77x el siguiente y campos obligatorios 1,48x el siguiente. No era
"SEO esta roto": era "SEO es el que primero cae cuando la validacion de
contrato no existe".

## Cambio realizado

- `.claude/agents/seo-specialist.md` + `config/subagent-tool-allowlist.json`:
  se concede EXACTAMENTE `StructuredOutput` (categoria nueva `sdk_output`).
  No es una capacidad: no lee, no escribe, no sale a la red.
- `src/core/subagent-tool-guard.ts`: el guard pasa de "allowedTools vacio" a
  "sin herramientas de capacidad", y exige igualdad de conjuntos entre el
  `.md` y el allowlist EN LOS DOS SENTIDOS. Antes solo detectaba drift al
  anadir herramientas -- por eso esta divergencia pudo existir sin que
  saltara nada.
- `src/core/claude-employee-retry.ts` (nuevo) + runtime comun: clasificacion
  de fallos y UN reintento, solo para clases de variabilidad del
  modelo/servicio.
- `--max-turns` 8 -> 12 y timeout del step 10 -> 20 min: con el SDK
  validando y re-preguntando, una invocacion pasa de 1 turno a 3-4.

## Retry / fallback

El fallback via `execution_file` SIGUE existiendo y sigue validando contra
el MISMO schema -- no se ha relajado nada. Lo que cambia es que ya no es el
camino principal: `seo-specialist` resuelve por `structured_output`.

El reintento se dispara SOLO si la resolucion del intento 1 falla con una
clase clasificada como transitoria. NUNCA con auth, configuracion, schema no
soportado, `execution_file` corrupto, ni con nada no clasificable
(fail-closed). Dos defensas independientes impiden mezclar intentos: se
aparta el `execution_file` del intento 1 de la ruta compartida, y el
resolutor descarta cualquier `execution_file` anterior al inicio del intento.

**En las 13 ejecuciones reales de certificacion el reintento no se disparo
ni una vez.** Existe como red, no como muleta.

## Ejecuciones aisladas (10/10)

Commit `eb5f027`; tras el rebase, `8c7473c` deja el camino SEO
byte-identico (solo cambia codigo de MongoDB/estado, ajeno a la invocacion).

| # | run | resultado | intentos | output source |
| - | --- | --------- | -------- | ------------- |
| 1 | 32048895217 | SUCCESS | 1 | structured_output |
| 2 | 32048962809 | SUCCESS | 1 | structured_output |
| 3 | 32049697799 | SUCCESS | 1 | structured_output |
| 4 | 32050551998 | SUCCESS | 1 | structured_output |
| 5 | 32051349535 | SUCCESS | 1 | structured_output |
| 6 | 32051360657 | SUCCESS | 1 | structured_output |
| 7 | 32052309898 | SUCCESS | 1 | structured_output |
| 8 | 32052316538 | SUCCESS | 1 | structured_output |
| 9 | 32053343640 | SUCCESS | 1 | structured_output |
| 10 | 32053351709 | SUCCESS | 1 | structured_output |

## Pasadas coordinadas (3/3 con SEO SUCCESS)

| Run | seo-specialist | Runtime | Output | Departamento |
| --- | --- | --- | --- | --- |
| 32060162770 | **executed** | success | structured_output | rojo (growth-director-v2) |
| 32062687334 | **executed** | success | structured_output | rojo (growth-director-v2) |
| 32064967187 | **executed** | success | structured_output | **VERDE** |

## Impacto en otros empleados

Los otros cinco quedan SIN TOCAR (`tools: []`) y se comportan exactamente
igual que antes. 1212/1212 tests en verde, sin relajar ninguno.

Pero las pasadas coordinadas dejaron evidencia directa de que la MISMA causa
raiz sigue viva en ellos: `growth-director-v2` fallo en las pasadas 1 y 2
con la firma identica (`claude=failure, origen de salida=`), y en la 3
acerto el JSON a mano por suerte (`numTurns: 1`,
`outputSource: execution_file_fallback`). Siguen a cara o cruz.

## Coste antes / despues (seo-specialist, por invocacion)

| | turnos | duracion | coste |
| --- | --- | --- | --- |
| Antes (fallback) | 1 | ~226-299 s | ~0,44-0,73 USD |
| Despues (structured_output) | 2-4 | ~294-458 s | ~0,56-1,23 USD |

Aproximadamente +60% de coste y +50% de duracion por invocacion. Es el
precio de que el SDK valide y re-pregunte. Coste base y coste de reintento
se registran por separado (`claude-execution.attempt-1.json` junto a
`claude-execution.json`); el de reintento fue 0 en toda la certificacion.

## Limitaciones reales

- Una de las cuatro pasadas coordinadas previas (run 32042184347) fallo con
  una firma DISTINTA: `claude=n/a` y 50 s de duracion, o sea la composite
  action murio antes de que el step de Claude registrara resultado. Los logs
  retenidos (GitHub devuelve solo las ultimas ~5.000 lineas) ya no permiten
  atribuir esa a una capa concreta. No se afirma que fuera la misma causa.
  El runtime nuevo la cubre igualmente: sin `structured_output` ni
  `execution_file` cae en `no_output_delivered`, que es reintentable.
- La validacion de `structured_output` contra el schema (caso A) ya tiene
  evidencia empirica real -- 13 ejecuciones -- pero ningun caso A ha
  FALLADO todavia, asi que la rama de error del caso A sigue cubierta solo
  por tests.
- El reintento no se ha ejercitado en produccion (0 disparos). Su
  comportamiento esta cubierto por tests, no por un run real.

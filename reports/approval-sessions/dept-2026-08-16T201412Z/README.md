# Sesion de aprobacion — Daily Brief `dept-2026-08-16T201412Z`

Decision humana de Pau sobre las **7 propuestas numeradas** del Daily
Brief del 2026-08-16 (el ultimo enviado), mas la decision sobre la
especificacion tecnica de `web-engineer`. Ver
[`docs/manual-approval-flow.md`](../../../docs/manual-approval-flow.md).

Instruccion literal de esta pasada:

> ACEPTO TODAS LAS PROPUESTAS DEL DEPARTAMENTO Y AUTORIZO QUE PASEN A
> IMPLEMENTACION EN STAGING, RESPETANDO QA, VALIDACION Y ROLLBACK.

## De donde sale esta pasada (procedencia exacta)

| Dato | Valor |
|---|---|
| `departmentRunId` | `dept-2026-08-16T201412Z` |
| Run que genero el brief | [31969938538](https://github.com/dorquita/zentry-ai-department/actions/runs/31969938538) (`zentry-ai-department-daily.yml`, rama `claude/claude-runtime-intermittent-2sd0ug`, commit `e85856d`) |
| Email enviado | 2026-08-16 20:35 UTC |
| Contrato de apply | `department-apply/v2` |
| Propuestas numeradas | 7 (`#rec-1` … `#rec-7`) + la especificacion de `web-engineer` |
| QA del departamento | `PASS_WITH_WARNINGS` (0 critical, 4 warning, 2 unsupportedClaims, 4 requiredCorrections) |

**Es la ultima pasada valida, no la ultima pasada persistida — y no son
la misma.** El run 31969938538 completo las 7 etapas, planifico el
contrato de apply, genero el Daily Brief y envio el email, pero fallo
despues en `[STATE] Verificar` (7 regresiones, todas por informes del
mismo dia regenerados mas cortos). Por eso la rama `department-state`
sigue en la pasada anterior, `dept-2026-08-16T185140Z`, mientras que el
brief que Pau tiene en el correo — y por tanto los numeros que se han
decidido aqui — son los de `dept-2026-08-16T201412Z`. Detalle en
`new-recommendations.json`.

`reports/department/` esta en `.gitignore` y la descarga directa del
artifact esta bloqueada por la politica de egress de esta sesion (403 del
proxy sobre `productionresultssa*.blob.core.windows.net`), asi que los
dos snapshots de aqui se extrajeron del propio log del run, del step
`[COORD] Volcar manifiesto, Daily Brief y diagnostico de Claude al log`,
que hace `cat` literal de `apply-summary.json` y del Daily Brief. Unico
valor tocado: GitHub enmascara en sus logs cualquier cadena que coincida
con un secreto, y el literal `true` de
`webEngineerSpecification.approvalRequired` sale como `***`; se ha
restituido a `true`, que es lo que el propio contrato obliga a que sea.

**Esa reconstruccion no se ha usado como fuente de verdad para decidir.**
La decision se ejecuto ademas en GitHub Actions
(`department-approval-session.yml`), que descarga el artifact REAL de la
pasada, y la interpretacion salio identica caracter a caracter a la
local. Los dos runs:

| Run | Modo | Resultado |
|---|---|---|
| [31973949611](https://github.com/dorquita/zentry-ai-department/actions/runs/31973949611) | dry-run sobre el artifact real | interpretacion identica a la local |
| [31973993161](https://github.com/dorquita/zentry-ai-department/actions/runs/31973993161) | `execute: true`, entorno STAGING | 0 escrituras; segundo email enviado |

## La decision, numero a numero

El numero es para la persona; el id es para el sistema. Nada se resuelve
solo por numero (`src/approvals/manual/decision.ts`).

| # | `recommendationId` | Titulo | QA | Decision | Resultado real |
|---|---|---|---|---|---|
| 1 | `…#rec-1` | Corregir enrutado y canibalizacion SEO antes de invertir mas esfuerzo | `PASS_WITH_WARNINGS` | **APROBADA** (staging) | `not_executed` — sin executor |
| 2 | `…#rec-2` | Ejecutar los 6 quick wins SEO en posiciones 17-29 | **`BLOCKED`** | **CORREGIR** (`defer`) | `deferred` — no descartada |
| 3 | `…#rec-3` | Validar el evento `click_phone` y confirmar la publicacion real del contenedor GTM | `PASS_WITH_WARNINGS` | **APROBADA** (staging) | `not_executed` — sin executor |
| 4 | `…#rec-4` | Auditar y reescribir meta titles/descriptions ante el patron sistemico de CTR 0% | **`BLOCKED`** | **CORREGIR** (`defer`) | `deferred` — no descartada |
| 5 | `…#rec-5` | No publicar aun a produccion las paginas de staging de metalicas y universidades sin resolver la iteracion visual | `PASS_WITH_WARNINGS` | **APROBADA** (staging) | `not_executed` — sin executor |
| 6 | `…#rec-6` | Investigar cobertura de keywords sin cluster: taquillas para gimnasios y lockers inteligentes | `PASS_WITH_WARNINGS` | **APROBADA** (staging) | `not_executed` — sin executor |
| 7 | `…#rec-7` | Evaluar el brief de contenido mixto sobre fenolicas con perfil antes de producirlo | `PASS_WITH_WARNINGS` | **APROBADA** (staging) | `not_executed` — sin executor |
| — | (sin id de propuesta) | Pasar la especificacion tecnica de `web-engineer` a fase de implementacion | `PASS_WITH_WARNINGS` | **APROBADA** | Sin executor: es luz verde para ingenieria, no una escritura |

`changeId` es `null` en las 7: esta pasada no llego a crear ningun cambio
en el registro persistente, porque ninguna tenia executor determinista
(`applyCapability.supported = false`), asi que el id real de cada una es
su `recommendationId`.

### Por que #2 y #4 NO se han aprobado

Porque la instruccion decia explicitamente **no saltarse el QA**, y
aprobar una recomendacion `BLOCKED` es exactamente eso. La decision
registrada es `defer` — que en este sistema significa "queda pendiente,
no se toca nada", es decir **corregir y volver a proponer**, no
descartar. La aprobacion llega cuando QA las deje pasar, no antes.

La correccion exigida por QA era, literal:

> [requiredCorrection] Anadir explicitamente en las recomendaciones
> 'Ejecutar los 6 quick wins SEO en posiciones 17-29' y 'Auditar y
> reescribir meta titles/descriptions ante el patron sistemico de CTR 0%'
> que su ejecucion sobre paginas de produccion requiere pasar por el
> pipeline de change-pack/aprobacion humana existente.

Y ya esta aplicada **en el origen**, que es donde sirve de algo: no
reescribiendo el texto de un informe ya emitido, sino en quien produce
esas recomendaciones.

1. `.claude/agents/growth-director-v2.md` — nueva seccion *"Toda
   prioridad que EDITA algo declara su puerta de aprobacion"*: si la
   ejecucion real de una prioridad implica tocar una pagina, su
   `dependsOn` debe nombrar el pipeline de change-pack / aprobacion
   humana explicita. En esa misma pasada, la prioridad #5 SI lo
   declaraba y no fue bloqueada: la diferencia entre bloquear y no
   bloquear era una frase.
2. `src/employees/growth-director-v2/domain.ts` —
   `auditGrowthDirectorV2Output()` emite ahora un aviso determinista
   cuando una prioridad suena a escritura (verbo de escritura + objeto
   web) y no declara esa puerta ni en `dependsOn` ni en `rationale`.
   Conservadora en las dos direcciones: "investigar" o "validar" no
   disparan nada, y no exige ninguna formula literal. Con tests
   (`test/growth-director-v2-domain.test.ts`).
3. Las otras tres `requiredCorrections` de QA (que no bloqueaban ninguna
   recomendacion concreta: `evidence[]` incompleto, cifras de backlog sin
   trazabilidad, decision humana citada sin fuente) tienen tambien su
   regla en el contrato del agente — seccion *"Cifras y decisiones
   humanas: cita siempre de donde salen"*.

**Lo que NO se ha podido hacer aqui: volver a pasar QA sobre esta misma
pasada.** El re-QA necesita el artifact de la pasada (el bundle que
revisa `qa-reviewer`), y su descarga esta bloqueada por egress en esta
sesion. Reconstruirlo de memoria seria inventarse el artifact revisado,
que es justo lo que este sistema no hace. La reevaluacion ocurre en la
siguiente pasada coordinada, ya con la correccion en el origen.

## Resultado real de la sesion

| Concepto | Valor |
|---|---|
| Aprobadas | **6** (#1, #3, #5, #6, #7 + la especificacion de `web-engineer`) |
| A corregir (`defer`) | **2** (#2, #4) |
| Rechazadas | **0** |
| Sin decidir | **0** |
| Ejecutadas de verdad | **0** |
| Escrituras en STAGING | **0** |
| Escrituras en PRODUCCION | **0** |
| Guards desactivados | **ninguno** |
| Segundo email | enviado desde el run 31973993161 — asunto `Zentry AI Department — Ejecucion — 2026-08-16 — 0 ejecutada(s), 5 aprobada(s) sin ejecutar, 0 rechazada(s), 0 pendiente(s)` |

Las 0 escrituras no son un fallo de la aprobacion ni un guard cerrandose:
son **ausencia de capacidad**. Ninguna de las 7 propuestas trae
`executableChangePlan`, y la unica capacidad determinista que existe hoy
(`staging_published_meta_update`) necesita un `page_id` de staging que la
especificacion de esta pasada no llego a declarar. La sesion corrio en
Actions con las credenciales de staging puestas y los interruptores en
`true`: aun asi no habia nada que ejecutar. Aprobar no fabrica una
capacidad.

Produccion no se ha tocado, y no por olvido: el job de la sesion no
recibe ninguna variable de produccion, ni siquiera apagada, y la maquina
de estados no tiene ninguna arista de `staging_applied` a produccion.

## Ficheros

| Fichero | Que es |
|---|---|
| `apply-summary.snapshot.json` | Contrato de apply de la pasada, tal cual lo escribio el run. |
| `department-daily-brief.snapshot.md` | Daily Brief en markdown, tal cual lo escribio el run. |
| `proposals.json` | Las 7 propuestas numeradas, generadas con `buildNumberedProposals()` sobre el snapshot. |
| `decisions.json` | La decision humana, en el formato de `HumanInstruction[]`. |
| `session-result.json` | Resultado real de ejecutar la sesion (`approval-session.json`). |
| `new-recommendations.json` | Que hace falta para que lo aprobado llegue a ejecutarse, y que bloqueos quedan. |

## Siguiente paso

Por orden, y ninguno es "dar mas permisos":

1. **`page_id` en la especificacion.** Hasta que `web-engineer` cite la
   pagina de staging de forma inequivoca, las 6 aprobaciones vigentes
   siguen sin poder convertirse en escritura.
2. **Persistencia de la decision.** Estas 7 decisiones estan commiteadas
   en la rama de trabajo, pero la pasada diaria restaura `data/` desde la
   rama `department-state`: si no se resuelve, la proxima pasada las pisa
   (ver `new-recommendations.json`).
3. **Re-QA de #2 y #4** en la siguiente pasada coordinada, ya con la
   correccion aplicada en el origen.

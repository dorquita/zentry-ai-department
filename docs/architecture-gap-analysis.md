# ZENTRY AI DEPARTMENT — ARCHITECTURE GAP ANALYSIS

> Auditoría arquitectónica del código REAL (rama `main`, commit `88f3b75`).
> Todo lo que se afirma aquí está verificado leyendo código y ejecutando
> lecturas sobre `data/*.jsonl`. No se ha usado documentación aspiracional
> como fuente. No se ha cambiado ninguna arquitectura.

---

## 0. Correcciones de premisa antes de empezar

Dos supuestos del encargo no se sostienen contra el código. Conviene
resolverlos antes de leer el resto, porque cambian el diagnóstico:

**(a) NO hay MongoDB en este repositorio.** Cero ocurrencias de
`mongo`/`Mongo`/`MONGO` en todo el árbol (`src`, `scripts`, `.github`,
`config`, `docs`, `package.json`). No es una dependencia, no hay driver,
no hay conexión, no hay colecciones. Existe una rama remota sin fusionar
`claude/department-state-mongodb-6h23ib`, pero nada de eso está en `main`.

La persistencia REAL hoy es:

```
data/*.jsonl   (ficheros append-only, una línea = una instantánea)
      ↓  al final de la pasada diaria
artifact  →  job `persist-state`  →  git push --force-with-lease
      ↓
rama huérfana `department-state`   (un único escritor, 1 vez al día)
```

Es un diseño coherente y bien defendido (`src/core/state-persistence.ts`
verifica que ningún `.jsonl` pierde líneas antes de commitear), pero es
un **log, no una base de datos**: sin índices, sin consultas, sin
transacciones, sin locks, sin actualización parcial. `action-backlog.jsonl`
son 20 MB y `work-orders.jsonl` 14 MB, y cada agente los lee ENTEROS en
memoria para reconstruir el estado actual.

Consecuencia para el objetivo: el "SOURCE OF TRUTH" existe y es fiable,
pero no soporta lo que un orquestador necesita (leer tareas accionables,
tomar un lock, marcar `in_progress`, reintentar). Eso es una decisión a
tomar, no un hecho ya resuelto.

**(b) El objetivo del encargo describe un departamento orientado a
tareas. Hoy no existe ninguna entidad Task.** Existen siete entidades
parcialmente solapadas y una máquina de estados de 14 estados que es
**derivada y de solo lectura**. Detalle en §3 y §11.

---

## 1. Qué queremos construir

Un departamento de IA que observe el estado real del negocio, detecte
trabajo útil, lo convierta en TAREAS persistentes con dueño y estado, las
priorice, las reparta entre especialistas que trabajan en paralelo cuando
no hay dependencias, las someta a QA con un bucle real de corrección, las
ejecute en staging con validación y rollback, las cierre midiendo el
resultado, recuerde lo ocurrido y busque el siguiente trabajo —
repitiendo hasta que no quede nada que justifique una intervención, y
entonces pasando solo a monitorización. El humano interviene por
excepción: producción según riesgo, decisiones comerciales, cambios
irreversibles, ambigüedad real y bloqueos. El email es una consecuencia
del estado del departamento, no su producto final.

---

## 2. Qué tenemos realmente

### 2.1 Arquitectura actual real

```
                    ┌──────────────────────────────────────┐
                    │   GitHub Actions — cron "0 7 * * *"  │
                    │   (UN único disparador programado    │
                    │    en todo el sistema)               │
                    └───────────────────┬──────────────────┘
                                        │
                        zentry-ai-department-daily.yml
                        1 job · 1190 líneas · ~60 steps
                        concurrency: 1 · permissions: read
                                        │
   ┌────────────────────────────────────┼────────────────────────────────────┐
   │                                    │                                    │
[STATE] restore                   FASE 0.5 LIVE                     [STATE] verify
git checkout rama              GSC / GA4+GTM / Ads                  no-pérdida
department-state                  (solo lectura)                          │
   │                                    │                                  ▼
   │                                    │                        job persist-state
   │                                    │                        (contents: write)
   │                                    │                        push a rama estado
   ▼                                    ▼
┌────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ CARRIL A  —  v1 DETERMINISTA│   │ CARRIL B  —  v2 EMPLEADOS CLAUDE             │
│ run-daily-growth-department │   │ run-department-coordination.ts + YAML         │
│                            │   │                                              │
│ 26 pasos `await` en cadena │   │  [SEO]      runner→prompt→Claude→validar      │
│ fija, hardcoded:           │   │      ↓ (orden fijo del YAML)                 │
│  1 seo-watcher             │   │  [CONTENT]  runner→prompt→Claude→validar      │
│  2 seo-director            │   │      ↓                                        │
│  3 competitor-intel        │   │  [ANALYTICS]runner→prompt→Claude→validar      │
│  4 content-planner         │   │      ↓                                        │
│  5 cro-landing-reviewer    │   │  [GROWTH v2] sintetiza y prioriza             │
│  6 sem-watcher             │   │      ↓                                        │
│  7 analytics-watcher       │   │  [QA]       revisa el artifact de Growth      │
│  8 approval-queue          │   │      ↓                                        │
│  9 approved-action-planner │   │  promotion.ts — PUERTA determinista           │
│ 10-12 work-order-builders  │   │   (match por TÍTULO literal normalizado)      │
│ 13-15 change-pack-builders │   │      ↓ solo lo promovido                      │
│ 16 wordpress-draft-agent   │   │  [WEB ENGINEER] → ChangePlan                  │
│ 17 visual-template-builder │   │      ↓                                        │
│ 18 visual-asset-planner    │   │  [APPLY --phase plan]  ← SOLO PLANIFICA       │
│ 19 staging-executor        │   │      ↓                                        │
│ 20 staging-qa-agent        │   │  Daily Brief (JSON+MD) → EMAIL  ← FIN         │
│ 21 approval-gateway        │   │                                              │
│ 22 production-deploy-planner│  │  Escribe SOLO en                             │
│ 23 production-draft-executor│  │  reports/department/<runId>/                 │
│ 24 growth-director v1      │   │  → CERO escrituras en data/*.jsonl           │
│ 25/26 informes + email     │   └──────────────────────────────────────────────┘
│                            │                     ▲
│ Escribe data/*.jsonl       │─────────────────────┘
│ (única fuente de estado)   │   Carril B LEE el estado de A (growth context)
└────────────────────────────┘   pero nunca le devuelve nada

        ═══════════════ ORFANATO ═══════════════
   Código de ejecución REAL, completo y testeado,
   que NINGÚN workflow programado invoca:

   department:apply:stage      ← existe en package.json, 0 llamadas
   department:apply:notify     ← existe en package.json, 0 llamadas
   src/department/apply/state-machine.ts  (17 estados, fail-closed)
   staging-executor / production-executor / rollback
   Novamira MCP / execute-php / read-back
   Telegram approvals / Cloudflare Worker / D1

   Alcanzables solo por workflow_dispatch manual:
   department-approval-session.yml, department-production-apply.yml,
   execute-php-staging-e2e.yml, y los 8 workflows por-empleado.
```

### 2.2 Los hechos que sostienen ese dibujo

| # | Hecho verificado | Evidencia |
|---|---|---|
| 1 | Un solo `schedule` en todo el sistema | `zentry-ai-department-daily.yml:63` — los otros 15 workflows son `workflow_dispatch` |
| 2 | El carril B no persiste nada de lo que decide | 0 llamadas a `upsertAction`/`upsertWorkOrder`/`upsertChangePack`/`emitEvent` en todo `src/department/` y `scripts/run-department-coordination.ts` |
| 3 | Los 8 empleados Claude no tienen NINGUNA herramienta | `config/subagent-tool-allowlist.json`: `allowedTools: []` en los 8; `assertSubagentIsToolless()` lanza excepción si alguno gana una |
| 4 | La identidad de una tarea entre Growth→QA→Web Engineer es **una cadena de texto** | `src/department/promotion.ts:signalMentionsTitle()` — match literal del título normalizado, mínimo 8 caracteres |
| 5 | El apply real nunca se ejecuta en la pasada autónoma | El YAML solo llama `--phase plan` (línea 908). `--phase stage` no aparece en ningún workflow |
| 6 | Solo existe UNA capability ejecutable | `resolveApplyCapability()` → `staging_published_meta_update` (title + meta description de una página de staging ya publicada) |
| 7 | Cero paralelismo en la lógica de departamento | 3 `Promise.all` en todo el repo, los 3 dentro de adaptadores HTTP (GA4/GTM/Ads). Ningún `matrix:` en ningún YAML |
| 8 | El bus de eventos es telemetría, no cola | `department-events.ts` expone `emitEvent`/`readAllEvents`/`readEventsForRun`. No hay cursor, ack, pending ni consumidor. Los 19 agentes que lo "leen" solo comprueban que no esté vacío |
| 9 | La calidad de las piezas es alta | 1069 tests pasando, 77 ficheros de test, guards fail-closed en todas las escrituras |

### 2.3 Estado empírico del backlog (lectura real, hoy)

Ejecutado contra `data/*.jsonl` con `deriveOpportunityState()`:

```
OPPORTUNITY STATE (105 acciones vivas)
  detected                   71     ← 68% nunca ha avanzado
  qa_passed                  18     ← pasó QA de staging y ahí se quedó
  rejected                    6
  postponed                   4
  drafted_local               4
  waiting_approval            1
  qa_failed                   1     ← nadie la ha vuelto a tocar jamás
  ────────────────────────────
  done / deployed_production  0     ← CERO tareas cerradas
```

- Edad: máx **15 días**, mediana **15 días**. Nada envejece hacia el cierre.
- La acción más re-detectada lleva **69 detecciones** en 69 pasadas
  distintas: se vuelve a descubrir cada día, se vuelve a escribir en el
  log cada día, y no avanza ni un estado.
- Amplificación del log: **6.271 instantáneas para 105 acciones** (≈60×),
  4.185 para 77 change packs, **13.517 eventos**, 88 pasadas registradas.
- 39 de 77 change packs están en `superseded`: se regeneran una y otra vez
  porque nada recuerda que ya se intentó.

Este es el dato más importante del informe. **El sistema arranca 88 veces
y termina 88 veces sin cerrar nada.** Produce 5.450
`recommendation_created` y 0 `task_completed` — porque `task_completed`
ni siquiera existe como tipo de evento.

---

## 3. Por qué no cumple todavía la expectativa

Ordenado por impacto.

1. **No existe una entidad de trabajo persistente.** Nada tiene
   `taskId + owner + status + attempts + qaStatus + executionStatus`.
   Existen artefactos del trabajo (acción, work order, change pack,
   informe), nunca el trabajo en sí.
2. **El carril inteligente no escribe estado.** Todo lo que Growth, QA y
   Web Engineer deciden vive en `reports/department/<runId>/` y muere
   como dato accionable al terminar la pasada. Mañana se vuelve a
   razonar desde cero.
3. **El orden del trabajo está codificado, no decidido.** 26 `await`
   secuenciales en TypeScript + ~60 steps con `if:` en YAML. Cambiar
   quién trabaja antes que quién es editar ficheros, no un dato.
4. **Los agentes no son trabajadores.** `allowedTools: []` en los 8. No
   detectan, no consultan, no crean tareas, no ejecutan, no cierran. Son
   funciones puras `prompt → JSON validado`. Su razonamiento es real; su
   autonomía es cero por construcción.
5. **El loop de QA no existe.** `requiredCorrections` solo sirve para
   BLOQUEAR la promoción (`promotion.ts`). No hay estado
   `needs_correction`, no se reconvoca al autor, no hay contador de
   intentos. QA FAIL → fin de la pasada. Prueba: la única acción en
   `qa_failed` sigue ahí, intacta.
6. **La ejecución está desconectada de la autonomía.** Todo el carril de
   apply (staging → validación → rollback → Telegram → producción) está
   escrito, testeado y es de calidad — y ningún workflow programado lo
   invoca. `--phase stage` es código huérfano.
7. **La identidad de la tarea entre etapas es un `string` de título.** Si
   QA parafrasea el título, la señal bloqueante queda huérfana
   (`unattributedBlockingSignals`). Es el síntoma exacto de la ausencia
   de identidad persistente.
8. **Cero paralelismo.** Aunque SEO, Content y Analytics no dependen
   entre sí, corren en serie dentro del mismo job.
9. **Un solo despertar al día.** No hay forma de que el departamento
   siga trabajando tras terminar una tarea, ni de reaccionar a un evento.
10. **Nadie mide el resultado.** Se mide el coste por empleado y el
    estado de la pasada. No hay ninguna medición "este cambio se aplicó
    el día D, ¿qué pasó con la métrica objetivo el día D+14?".

---

## 4. Causa raíz arquitectónica

> **La razón principal por la que hoy no tenemos un verdadero
> departamento autónomo es que el sistema persiste los ARTEFACTOS del
> trabajo pero nunca el TRABAJO EN SÍ como entidad con estado, dueño e
> intentos — y como "qué hacer ahora" no puede vivir en los datos, tiene
> que vivir en el orden fijo de un YAML y de una cadena de 26 `await`.**

Todo lo demás (falta de loop de QA, falta de paralelismo, ejecución
huérfana, un solo cron) son consecuencias mecánicas de esa ausencia: sin
una Task no hay nada que asignar, nada que reintentar, nada que ejecutar
en paralelo y nada que despierte al sistema.

---

## 5. Quién orquesta realmente hoy

**Respuesta inequívoca: GitHub Actions YAML, y en segundo lugar una
cadena de `await` en TypeScript. No orquesta ni Claude, ni MongoDB, ni
Growth Director, ni ningún coordinador.**

| Decisión | Quién la toma HOY | Dónde |
|---|---|---|
| Qué agente trabaja | El orden de los steps | `zentry-ai-department-daily.yml` |
| Cuándo trabaja | `cron: "0 7 * * *"` | idem, línea 63 |
| Qué "tarea" recibe | Lo que el runner de su fase le prepara; el agente no elige | `scripts/run-*.ts` |
| Qué ocurre después | El siguiente step del YAML, condicionado por `if: steps.X.outcome` | idem |
| Cuándo se repite | Mañana a las 07:00. No hay otra repetición | idem |
| Cuándo termina | Cuando se envía el email | step `[EMAIL]` |
| Qué se promueve a ingeniería | `resolvePromotion()` — determinista, por match de título | `src/department/promotion.ts` |
| Qué se ejecuta de verdad | Nada, en la pasada autónoma | `--phase plan` |

Growth Director v2 **no orquesta**: no crea tareas, no asigna, no elige
especialista, no reconvoca, no espera dependencias, no cancela, no
paraleliza. Su tipo de salida (`GrowthDirectorV2Output`) no tiene ni
`taskId` ni `owner` — es un documento: `growthSummary`, `currentSignals`,
`bottlenecks`, `opportunities`, `experiments`, `recommendedPriorities[]`,
`dependencies`, `risks`, `evidence`, `unknowns`. **Es un analista senior
que escribe un informe, no un director.** No debe llamarse orquestador.

---

## 6. Lifecycle actual de una tarea

Seguimiento real de una acción SEO desde su nacimiento (`FOLLOW THE TASK`),
usando la acción `9491da85… "SEO: taquillas escolares"` y sus 70 hermanas:

```
Search Console (lectura real)
   ↓ seo-watcher                       ── crea SeoJob + evento opportunity_detected
seo-director agrupa                    ── evento recommendation_created
   ↓ approval-queue                    ── dedup + política de autonomía
BacklogAction  status=auto_approved_for_planning
   ↓ approved-action-planner
WorkOrder      status=auto_prepared
   ↓ seo-change-pack-builder
ChangePack     status=ready_for_review
   ↓
   ├── (si STAGING_EXECUTION_ENABLED=true — NO lo está en Actions)
   │      StagingExecution → StagingQaResult → ApprovalRequest → Telegram
   │
   └── (en la pasada real de hoy)
          ✗  el flag no está → el executor se registra como "no habilitado"
          ✗  nada se aplica
          ↓
     MAÑANA 07:00: seo-watcher vuelve a detectar la MISMA oportunidad
          ↓  seenCount += 1   (récord actual: 69)
          ↓  se escribe otra instantánea idéntica en action-backlog.jsonl
          ↓
          ⟲  BUCLE INFINITO SIN PROGRESO

En paralelo, el carril B razona sobre ella:
   seo-specialist la analiza → growth-director-v2 la prioriza →
   qa-reviewer la valida → web-engineer escribe una spec →
   apply --phase plan dice si sería ejecutable →
   Daily Brief la lista → EMAIL
          ↓
   ✗  NADA de eso se escribe en la acción. La acción no sabe que
      existe un carril B. Mañana el carril B empieza de cero.
```

**Punto exacto donde deja de comportarse como tarea autónoma:** en el
momento del nacimiento. Nunca llega a ser una tarea. Es una *observación
recurrente* que se re-observa cada día. El primer estado
(`detected`/`auto_approved_for_planning`) es también, para 71 de 105
casos, el último.

Y hay un segundo punto de muerte, para las que sí avanzaron: **18
acciones en `qa_passed`**. Pasaron QA de staging, están correctas, y
esperan a que un humano pulse un botón que la pasada diaria nunca le
pide. No están bloqueadas por riesgo: están bloqueadas porque el sistema
no tiene ningún mecanismo para continuar solo.

---

## 7. Lifecycle que necesitamos

Derivado de los estados que el sistema YA usa (`OpportunityState` de 14
estados + `DepartmentChangeStatus` de 17), no inventado:

```
                         DETECTED
                            │ (dedup + política de autonomía — ya existe)
                            ▼
                         TRIAGED ──────────► DISCARDED
                            │                (no justifica intervención)
                            ▼
                          READY ◄──────────────────────┐
                            │                          │
                            ▼                          │
                       IN_PROGRESS ──► BLOCKED ────────┤ (dependencia resuelta)
                        (owner=agente,                 │
                         lease + attempts)             │
                            ▼                          │
                        IN_REVIEW  (QA)                │
                       ╱     │      ╲                  │
              approved╱   warnings   ╲fail             │
                     ▼                ▼                │
                 APPROVED       NEEDS_CORRECTION ───────┘
                     │           (attempts++ ; máx N;
                     │            si N agotado → WAITING_HUMAN)
                     ▼
                 EXECUTING  (capability determinista + snapshot)
                     │
                     ▼
                 VALIDATING (read-back)
                  ╱      ╲
            ok   ╱        ╲  fail
                ▼          ▼
           COMPLETED   ROLLED_BACK ──► NEEDS_CORRECTION | FAILED
                │
                ▼
             MEASURED   (D+14: ¿movió la métrica objetivo?)

  Transversales, alcanzables desde casi cualquier punto:
     WAITING_HUMAN   (producción, decisión comercial, irreversible,
                      ambigüedad real, N intentos agotados)
     WAITING_DATA    (esperando GSC/GA4/ventana temporal → `wakeAt`)
     FAILED          (terminal técnico)
```

Reglas duras que ya están implementadas y deben conservarse tal cual:
producción solo desde `APPROVED` con decisión humana explícita; estados
terminales no se reabren; fail-closed en toda transición no declarada
(`src/department/apply/state-machine.ts`).

---

## 8. Arquitectura objetivo

```
                        OBJECTIVES  (config, pocos, versionados)
                    "SEO + rendimiento comercial de Zentry Lockers"
                                     │
                                     ▼
      ┌──────────────────── TASK ORCHESTRATOR ─────────────────────┐
      │  DETERMINISTA · TypeScript · sin LLM                       │
      │  loop:                                                     │
      │    tasks = nextActionableTasks(limit, now)                 │
      │    if tasks.empty → MAINTENANCE MODE, salir                │
      │    for each (hasta K en paralelo):                         │
      │       lease(task, ttl)  → assign(worker)                   │
      │       result = worker.run(task)                            │
      │       persist(result); transition(task); enqueueNext()     │
      └────────────────────────────┬───────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  TASK STATE  (fuente única)  │
                    │  tasks · task_events         │
                    │  leases · objectives         │
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
   DETECTORES      WORKERS LLM (toolless, tal cual hoy)   WORKERS
   deterministas   seo · content · analytics · sem       DETERMINISTAS
   seo-watcher     growth (asesor, no jefe)              change-pack-builder
   analytics-w.         │                                staging-executor
   sem-watcher          │                                validator · rollback
   competitor-int       │                                     │
        │               ▼                                     │
        │          QA REVIEWER  (LLM, toolless)                │
        │           ╱        ╲                                 │
        │    approved      needs_correction                    │
        │        │              │                              │
        │        │              └──► vuelve al MISMO worker    │
        │        │                   con requiredCorrections   │
        │        │                   adjuntas (attempts++)     │
        │        ▼                                             │
        │   WEB ENGINEER (LLM) ──► ChangePlan ejecutable ──────►┤
        │                                                      ▼
        │                                          CAPABILITY RESOLVER
        │                                          (fail-closed, ya existe)
        │                                                      │
        │                            ┌─────────────────────────┴────┐
        │                            ▼                              ▼
        │                    ejecutable                    no ejecutable
        │                            │                              │
        │                    Novamira / execute-php          WAITING_HUMAN
        │                            ▼                       (spec manual)
        │                    STAGING + snapshot
        │                            ▼
        │                    VALIDATOR (read-back)
        │                      ╱          ╲
        │                    ok            fail → ROLLBACK
        │                     ▼                      ▼
        │                 COMPLETED           NEEDS_CORRECTION
        │                     │
        │                     ├──► producción? → WAITING_HUMAN → Telegram/email
        │                     │                       ▼
        │                     │                 production-executor (ya existe)
        │                     ▼
        └───────────────► MEASUREMENT (D+14, cierra el ciclo con GSC/GA4)
                                     │
                                     ▼
                    EMAIL  ← consecuencia del estado, no del pipeline
                    "hice X, conseguí Y, sigo con Z, necesito W de ti"
```

**Despertadores (§14):** cron diario (barrido) · `repository_dispatch`
tras completar una tarea si queda trabajo · `wakeAt` para tareas
`WAITING_DATA` · webhook de la aprobación humana.

---

## 9. Qué reutilizamos

| Pieza | Estado hoy | Rol en la arquitectura objetivo |
|---|---|---|
| `claude-employee-runtime` (action.yml) | Sólido, auth, `--json-schema`, fallback, métricas | **Sin cambios.** Es el "cómo se invoca a un trabajador LLM" |
| Los 8 agentes `.claude/agents/*.md` | Toolless, con schemas versionados y validadores | **Sin cambios en el prompt/schema.** Cambia QUIÉN los invoca y con qué contexto |
| `config/*-output.schema.json` + validadores + auditores de fabricación | 1069 tests pasando | **Sin cambios.** Es la garantía de que la salida del LLM es datos, no prosa |
| `src/department/apply/state-machine.ts` | 17 estados, fail-closed, testeado | **Base directa** de la máquina de estados de Task. Se generaliza, no se reescribe |
| `resolveApplyCapability()` + executors + snapshot + rollback | Completo y testeado | **Sin cambios.** Se le llama desde el orquestador en vez de a mano |
| Novamira MCP / execute-php / read-back / guards | Completo, allowlist fail-closed | **Sin cambios** |
| `autonomy-policy.json` + `staging-autonomy-policy.json` | Clasifica riesgo por tipo de acción | **Núcleo de la puerta humana.** Decide `WAITING_HUMAN` vs. autónomo |
| Watchers LIVE (GSC, GA4, GTM, Ads) | Lectura real verificada | **Sin cambios.** Pasan a ser DETECTORES que crean Tasks |
| `state-persistence.ts` + rama `department-state` | Verificación de no-pérdida | **Conservar como respaldo/histórico** aunque el estado vivo migre |
| `promotion.ts` (puerta fail-closed) | Determinista, correcta en su intención | **Adaptar:** la lógica de "QA no se pronuncia ⇒ no se promueve" se conserva; el match por título se sustituye por `taskId` |
| Telegram / Cloudflare Worker / D1 | Escrito, desactivado | **Reactivar** como canal de la puerta humana, no como aprobación de rutina |
| Mailer + `brief-email` | Funciona | **Adaptar:** pasa a informar del estado, no a ser el final del pipeline |
| Suite de tests (77 ficheros) | 1069 verdes | **Sin cambios.** Es lo que permite migrar sin big bang |

---

## 10. Qué cambiamos

| Componente | Hoy | Debe pasar a ser |
|---|---|---|
| `zentry-ai-department-daily.yml` | ~60 steps que codifican el orden del trabajo | ~6 steps: restore → detectores → **invocar orquestador N veces** → brief → persist |
| `run-daily-growth-department.ts` | 26 `await` fijos | Sus 26 funciones se registran como **workers/detectores** invocables por nombre; desaparece la cadena |
| `run-department-coordination.ts` | Fases `init/record-stage/prepare-*/complete-*` acopladas al YAML | Adaptador: cada `prepare/complete` se convierte en el `run()` de un worker |
| `growth-director-v2` | "Director" que no dirige | **Asesor de priorización**: se le pregunta *cuándo hay ambigüedad real*, no en cada pasada. Renombrar a `growth-advisor` para que el nombre no mienta |
| `promotion.ts` | Match por título literal | Resolución por `taskId`; `unattributedBlockingSignals` deja de existir |
| QA | Emite `requiredCorrections` → bloquea → fin | Emite `requiredCorrections` → **transición a `NEEDS_CORRECTION` sobre la task** → reencolada al mismo worker |
| `department:apply --phase plan` | Único invocado; nunca escribe | El orquestador llama `plan`+`stage` en secuencia cuando la task está `APPROVED` y la capability existe |
| `department-events.jsonl` | Telemetría sin consumidor | `task_events` = **historia de la task** (append-only, misma disciplina), consultable por el worker que la retoma |
| Persistencia | JSONL de 20 MB releídos enteros | Store con lectura por índice, actualización parcial y lease atómico (§12) |
| Email | Producto final del pipeline | Reporte del estado del departamento |

---

## 11. Qué retiramos

| Concepto | Veredicto | Motivo |
|---|---|---|
| `WorkOrder` | **RETIRAR (fusionar en Task)** | 104 work orders para 105 acciones: es 1:1. No aporta identidad ni información nueva, solo otro enum de estado que hay que mantener sincronizado |
| `ApprovalRequest` como entidad separada | **RETIRAR (fusionar en Task)** | Es un estado de la task (`WAITING_HUMAN`) + un canal de notificación, no una entidad. 29 de 59 acabaron `cancelled` |
| `DepartmentRecommendation` (efímera) | **RETIRAR** | Es una Task del carril B que no se persiste. Al existir Task, sobra |
| `DepartmentApplyItem` | **RETIRAR** | Proyección de la task en estado `EXECUTING` |
| `BacklogAction` | **CONSERVAR renombrada → Task** | Es la que más se parece; ya tiene dedup, `canonicalKey`, `seenCount`, política de autonomía |
| `ChangePack` | **CONSERVAR** | Es el *contenido propuesto*, distinto del trabajo. Un cambio real con `proposedChanges`, `risks`, `rollbackNotes` |
| `ExecutePhpChangePlan` / `ResolvedChangePlan` | **CONSERVAR** | Es el artefacto ejecutable. Distinto de la task y del change pack |
| `StagingExecution` / `ProductionExecution` / `StagingQaResult` / `ProductionDeploymentPlan` | **CONSERVAR** | Registros de ejecución con snapshot y rollback. Son el histórico auditable |
| `SeoJob` + `DepartmentEvent` | **CONSERVAR degradados a telemetría** | Útiles para depurar. Dejan de fingir ser estado |
| `WordpressDraft` | **LEGACY TEMPORAL** | Camino previo al carril de staging publicado. Mantener hasta que el nuevo carril cubra sus casos |
| Los ~200 scripts `oNN-*.js/ts` en `scripts/` | **LEGACY TEMPORAL / archivar** | Son operaciones manuales puntuales ya ejecutadas (o21…o49). Ruido: 345 ficheros en `scripts/` hacen imposible distinguir qué es sistema y qué fue una intervención de un día |

**Resumen del solapamiento real:** hoy el mismo trabajo se representa
como `SeoJob → DepartmentEvent → BacklogAction → WorkOrder → ChangePack →
ApprovalRequest → StagingExecution → StagingQaResult →
ProductionDeploymentPlan → ProductionExecution`, más su gemelo efímero en
el carril B (`GrowthPriority → DepartmentRecommendation → ChangePlan →
DepartmentApplyItem`). Son **14 representaciones** de una sola cosa. La
propuesta las reduce a **4 conceptos con fronteras claras**: `Task` (el
trabajo), `ChangePack` (el contenido propuesto), `ChangePlan` (el
artefacto ejecutable) y `Execution` (lo que pasó al aplicarlo).

---

## 12. Task Orchestrator — especificación mínima

**Responsabilidades (todas deterministas):**

1. `nextActionableTasks(now, limit)` — tareas cuyo estado admite trabajo,
   sin dependencias abiertas, sin lease vivo, `wakeAt <= now`, ordenadas
   por prioridad y antigüedad.
2. `resolveDependencies(task)` — bloquea/desbloquea contra `dependsOn[]`
   por `taskId` (no por texto).
3. `assign(task)` — `state → worker` por tabla explícita, no por LLM.
4. `lease(task, ttl)` — evita doble trabajo; un lease caducado devuelve la
   task a `READY` e incrementa `attempts`.
5. `run(worker, task)` — invoca el runtime existente.
6. `transition(task, result)` — valida contra `ALLOWED_TRANSITIONS`
   (fail-closed, ya implementado) y persiste.
7. `enqueueNext(task)` — crea la transición/subtarea siguiente.
8. `drain()` — repite hasta que no queden tareas accionables o se agote el
   presupuesto de la pasada (tiempo, tokens, número de escrituras).

**Estados:** los de §7.

**Triggers:** cron diario · `repository_dispatch` tras cerrar una task si
`nextActionableTasks()` no está vacío · `wakeAt` de `WAITING_DATA` ·
webhook de aprobación humana · `workflow_dispatch` manual.

**Workers:**

| Worker | Tipo | Estados que atiende |
|---|---|---|
| `seo-watcher`, `analytics-watcher`, `sem-watcher`, `competitor-intelligence` | determinista | crea tasks `DETECTED` |
| `triage` | determinista (`autonomy-policy.json`) | `DETECTED → TRIAGED/READY/DISCARDED` |
| `seo-specialist`, `content-strategist`, `analytics-specialist`, `sem-specialist` | LLM toolless | `READY → IN_REVIEW` |
| `growth-advisor` | LLM toolless | priorización cuando hay empate/ambigüedad |
| `qa-reviewer` | LLM toolless | `IN_REVIEW → APPROVED / NEEDS_CORRECTION` |
| `web-engineer` | LLM toolless | `APPROVED → ChangePlan` |
| `capability-resolver`, `staging-executor`, `validator`, `rollback` | determinista | `EXECUTING → VALIDATING → COMPLETED/ROLLED_BACK` |
| `measurement` | determinista | `COMPLETED → MEASURED` en `wakeAt = D+14` |

**Colecciones (nombres si se adopta Mongo; equivalen a `data/*.jsonl` si
no):**

| Colección | Contenido | Índices necesarios |
|---|---|---|
| `tasks` | estado vivo, un documento por task | `{status, priority, wakeAt}`, `{canonicalKey}` único, `{owner, leaseUntil}` |
| `task_events` | append-only, historia completa | `{taskId, createdAt}` |
| `objectives` | pocos, versionados | — |
| `change_packs`, `change_plans`, `executions` | tal cual hoy | `{taskId}` |

**Concurrency:** `K` workers en paralelo por pasada (empezar en 3, tope
por presupuesto). Aislamiento por lease atómico. Serialización obligatoria
en un solo eje: **una escritura externa a la vez por página objetivo**.

**Retries:** `attempts` por task. `maxAttempts` por tipo de transición
(sugerido: 2 para `NEEDS_CORRECTION`, 3 para fallo técnico). Agotado →
`WAITING_HUMAN` con el histórico adjunto, nunca descarte silencioso.

**Human gates** (y solo estos):
- cualquier escritura en **producción**;
- cambio **irreversible** o sin `rollbackNotes` verificables;
- decisión **comercial** (precio, oferta, posicionamiento, presupuesto de Ads);
- `attempts` agotados;
- capability no soportada (requiere implementación manual);
- riesgo `high`/`critical` según `autonomy-policy.json`.

Todo lo demás en staging, reversible y con read-back: **autónomo**.

---

## 13. ¿Necesitamos realmente un coordinador LLM?

**PARCIALMENTE — y menos de lo que parece.**

El orquestador debe ser **determinista**. Ninguna de sus
responsabilidades mejora con un modelo, y todas empeoran: leer estado,
resolver dependencias por id, tomar locks, contar intentos, aplicar
permisos, decidir concurrencia y programar despertares son operaciones
donde la corrección es binaria y la reproducibilidad es un requisito.
Meter un LLM ahí introduce no-determinismo, coste y una superficie de
fallo nueva a cambio de nada.

**Debe seguir siendo determinista:** estados y transiciones · locks y
leases · reintentos y límites · política de autonomía y puertas humanas ·
scheduling y `wakeAt` · resolución de capability · snapshot, validación y
rollback · deduplicación y `canonicalKey` · el "¿queda trabajo?" del modo
mantenimiento.

**Debe ser IA:** investigación e interpretación de datos (SEO, Analytics,
SEM) · generación de contenido y specs · revisión crítica de QA ·
corrección tras un QA fallido · redacción de la explicación para el humano
· y **una sola decisión de coordinación**: cuando dos o más tareas tienen
prioridad empatada y criterios incomparables (p.ej. "arreglar
canibalización de melamina" vs. "crear landing de cerraduras para
gimnasios"), preguntar al `growth-advisor` cuál primero y por qué. Eso es
ambigüedad real, es donde el juicio aporta, y es barato porque ocurre
pocas veces por pasada.

Regla de diseño: **el LLM propone contenido y prioridad; el código decide
qué se ejecuta, cuándo y con qué permisos.**

---

## 14. Funcionamiento 24/7

24/7 significa *disponible*, no *ejecutando*. El modelo correcto es
event/queue con despertares, y encaja con GitHub Actions sin coste extra
relevante:

```
DESPERTADORES (ninguno mantiene un LLM vivo)

1. cron diario 07:00           barrido completo: detectores + drenaje
2. repository_dispatch         al cerrar una task, si nextActionableTasks()
                               no está vacío Y queda presupuesto de la
                               pasada → el propio workflow se re-dispara.
                               Así el departamento "sigue trabajando
                               después de terminar una tarea" sin
                               proceso permanente.
3. wakeAt                      tasks en WAITING_DATA / MEASURED programan
                               fecha; un cron ligero cada 6 h solo mira
                               si hay alguna vencida (consulta barata,
                               sin LLM: si no hay, el job dura segundos)
4. webhook aprobación          el humano aprueba en Telegram/email →
                               Cloudflare Worker → repository_dispatch →
                               la task sigue sola desde WAITING_HUMAN

DORMIR es un resultado válido y explícito:
   nextActionableTasks() == []  →  el brief dice
   "No existe actualmente ninguna tarea que justifique una intervención"
   y el sistema no vuelve a despertar hasta el siguiente cron o evento.
```

Coste: hoy son ~6 invocaciones de Claude al día en una pasada fija.
Después serían *N invocaciones por tarea real trabajada* — más caro los
primeros días (drenaje del backlog: 71 tareas esperando) y **más barato
en régimen**, porque en mantenimiento la mayoría de despertares terminan
en "no hay trabajo" sin invocar ningún modelo.

Salvaguardas obligatorias: presupuesto máximo por pasada (nº de
invocaciones, nº de escrituras externas, minutos), tope de re-dispatch
encadenados, y `concurrency` group para que nunca corran dos drenajes
simultáneos sobre el mismo estado.

---

## 15. Backlog finito → mantenimiento

El cambio de modo no necesita ninguna lógica nueva: **es el resultado
natural de `nextActionableTasks()`**, siempre que el triage sepa decir que
no.

```
MODO BACKLOG                        MODO MANTENIMIENTO
─────────────                       ──────────────────
nextActionableTasks() > 0           nextActionableTasks() == 0
drenar hasta agotar presupuesto     detectores corren igual
re-dispatch encadenado              sin re-dispatch
email: "cerré 4, sigo con 3"        email: "sin trabajo que justifique
                                     intervención; vigilando X, Y, Z"

Transición: automática, sin flag. Se cruza en los dos sentidos el mismo
día si un detector encuentra algo.

El triage necesita UN umbral explícito por canal para poder decir "no":
   WEB       cambio propuesto sin impacto estimable → DISCARDED
   SEO       delta de posición < umbral, o impresiones < mínimo → DISCARDED
   SEM       variación dentro del ruido estadístico → DISCARDED
   ANALYTICS anomalía dentro de la banda esperada → DISCARDED

Sin ese umbral el sistema NUNCA entra en mantenimiento: seguirá
inventando trabajo para mantenerse ocupado. Hoy no existe ese umbral, y
por eso hay 71 acciones "detectadas" que nadie considera descartables.
```

Esto es un requisito de primer orden, no un detalle: **la capacidad de
decir "hoy no hay nada que hacer" es tan importante como la de trabajar.**

---

## 16. Plan de transición (4 fases, sin big bang)

Cada fase entrega valor por sí sola y no rompe lo que ya funciona.

### FASE 1 — Task como espejo (1 semana)
Crear la entidad `Task` y su store, y **proyectar** en ella el estado que
ya existe (reutilizando `deriveOpportunityState()`, que ya sabe hacer
exactamente esa unión). Nada cambia de comportamiento: los dos carriles
siguen corriendo igual. El Daily Brief pasa a leer de `tasks`.

*Valor entregado:* por primera vez se ve el backlog real en una tabla —
qué hay, desde cuándo, en qué estado, qué está atascado. Hoy eso solo se
puede calcular a mano, como se ha hecho para este informe.
*Riesgo:* nulo (solo lectura).

### FASE 2 — Task como identidad del carril B + loop de QA (1–2 semanas)
La pasada coordinada crea/actualiza tasks reales. `taskId` sustituye al
match por título en `promotion.ts`. QA fallido escribe
`NEEDS_CORRECTION` + `requiredCorrections` **en la task**, y el runner
del especialista, al preparar su contexto, incluye las correcciones
pendientes de tareas propias.

*Valor entregado:* el loop de QA existe. La vuelta tarda un día (una
pasada), pero se cierra. Y el trabajo del carril B deja de evaporarse.
*Riesgo:* bajo. Sigue sin escribir en ningún sistema externo.

### FASE 3 — Task Orchestrator + paralelismo + drenaje (2–3 semanas)
Sustituir el orden fijo por `nextActionableTasks → assign → run →
transition`, con leases, `attempts` y `K` workers en paralelo. El YAML se
reduce a invocar el orquestador. El loop de QA pasa de un día a minutos.
Añadir los umbrales de descarte del §15.

*Valor entregado:* el departamento trabaja hasta agotar trabajo útil
dentro de una misma pasada, en paralelo, y sabe decir que no hay nada.
*Riesgo:* medio. Mitigación: presupuesto por pasada y `concurrency: 1`.

### FASE 4 — Ejecución cerrada y despertar por eventos (2–3 semanas)
Conectar `--phase stage` al orquestador para tasks `APPROVED` con
capability soportada. Staging autónomo con snapshot, read-back y
rollback (todo ya escrito). `repository_dispatch` al cerrar una task.
Reactivar la puerta humana solo para producción y riesgo alto.
Añadir el worker de `MEASUREMENT` a D+14.

*Valor entregado:* tareas que llegan a `COMPLETED` sin intervención, y un
ciclo que se mide.
*Riesgo:* el más alto del plan — es la primera escritura externa
autónoma. Mitigación: empezar con **una sola capability**
(`staging_published_meta_update`), una sola página, y tope de N
escrituras por día.

*(Una eventual Fase 5 —migrar el store de JSONL a Mongo— es ortogonal:
puede hacerse en cualquier momento después de la Fase 1 si el volumen lo
exige, porque la Fase 1 ya introduce la interfaz del store. No es
bloqueante para nada de lo anterior.)*

---

## 17. Primer E2E

**No** "hemos creado el Task Orchestrator". El hito verificable es:

> Una tarea SEO detectada por el propio departamento (optimización de
> `title` + `meta description` de una página de staging ya publicada y
> propiedad del sistema) entra en el nuevo sistema como `Task`, se asigna
> sola a `seo-specialist`, produce una propuesta, pasa por `qa-reviewer`,
> **falla a propósito la primera vez**, vuelve a `NEEDS_CORRECTION`, se
> corrige, aprueba, el `web-engineer` emite un `ChangePlan` ejecutable,
> se aplica en staging con snapshot, el read-back confirma el cambio, y
> la tarea termina en `COMPLETED` — **sin que ninguna persona toque
> nada**. Catorce días después, el worker de medición la mueve a
> `MEASURED` con el delta real de Search Console.

Por qué esta y no otra: es la única capability ejecutable que hoy existe
(`staging_published_meta_update`), es reversible, es visible desde el
móvil, no toca producción, y hay 18 tareas reales en `qa_passed`
esperando exactamente eso. Demuestra las cinco propiedades que faltan
—tarea persistente, asignación, loop de QA, ejecución, cierre— en el
carril de menor riesgo del sistema.

**Criterio de aceptación:** la task pasa por ≥7 estados, con ≥2 pasadas
del orquestador, `attempts >= 2`, cero intervención humana, y el diff en
staging es verificable y reversible.

---

## 18. Qué NO debemos seguir parcheando

1. **No añadir más etapas al pipeline de 26 pasos.** Cada etapa nueva
   consolida el problema: hace que el orden del trabajo esté aún más
   codificado y más caro de cambiar.
2. **No añadir más entidades con su propio enum de estado.** Ya hay 14
   representaciones del mismo trabajo. Una más no aclara nada.
3. **No añadir empleados Claude nuevos hasta que existan tasks.** Un
   empleado más sin Task es un `if:` más en el YAML y un artefacto más
   que muere al terminar la pasada.
4. **No seguir refinando el match por título de `promotion.ts`.** El
   problema no es la heurística: es que no debería haber heurística. Con
   `taskId` desaparece.
5. **No seguir mejorando el Daily Brief como producto final.** Cuanto
   mejor sea el informe, más fácil es no notar que el departamento no
   cierra nada.
6. **No activar `DEPARTMENT_STAGING_APPLY_ENABLED` en el pipeline actual.**
   Ejecutar de verdad sin identidad de tarea, sin `attempts` y sin loop
   de corrección convierte un problema de inercia en un problema de daño.
7. **No crecer el backlog.** Los detectores funcionan demasiado bien: 71
   tareas detectadas y ninguna cerrada. Añadir más detección antes que
   capacidad de cierre empeora la señal.
8. **No dejar `scripts/` creciendo.** 345 ficheros, ~200 de ellos
   operaciones puntuales ya ejecutadas. Archivarlos es barato y devuelve
   legibilidad al sistema.

---

## 19. Puntuación actual

| Dimensión | Nota | Justificación (código, no impresión) |
|---|---:|---|
| Inteligencia | **7** | Razonamiento Claude real, schemas versionados, validadores de dominio, auditorías anti-fabricación. Limitado por contexto pre-masticado y `tools: []` |
| Persistencia | **5** | Append-only real, verificación de no-pérdida, un solo escritor. Pero es un log de 20 MB releído entero, sin índices ni actualización parcial — y el carril inteligente no escribe en él |
| Autonomía | **2** | Ninguna decisión se toma con datos; ninguna acción se ejecuta en la pasada programada |
| Orquestación | **2** | YAML + cadena de 26 `await`. No hay despachador |
| Task management | **2** | Sin entidad Task; 14 representaciones solapadas; identidad entre etapas = un `string` |
| Ejecución | **2** | Una sola capability; `--phase stage` no lo invoca ningún workflow. El código existe y es bueno; está desconectado |
| QA loop | **1** | QA existe y es riguroso. El loop no existe: FAIL → bloquear → fin |
| Memoria | **4** | Todo queda trazado y es auditable, pero nadie lo consulta para decidir. La misma acción se re-detecta 69 veces |
| Paralelismo | **0** | Cero. Ni en código ni en YAML |
| Scheduling | **2** | Un cron al día. Los otros 15 workflows son manuales |
| Recuperación | **3** | Snapshot y rollback reales y testeados. Sin reintentos ni reencolado a nivel de trabajo |
| Medición | **3** | Coste por empleado y estado de pasada. Cero medición del resultado de un cambio aplicado |

### **Puntuación global como departamento autónomo: 3 / 10**

Con una matización importante y justa: **como pipeline multiagente de
análisis y reporting, este sistema vale 7–8/10.** Las piezas son de
calidad alta (1069 tests, guards fail-closed en todas las escrituras,
máquinas de estado explícitas, política de autonomía versionada,
persistencia con verificación de no-pérdida). El 3/10 no mide la calidad
del código: mide la distancia entre lo construido y el objetivo
declarado. Están bien construidas casi todas las piezas de un
departamento — y no está construido el departamento.

---

## 20. Puntuación esperada tras la consolidación

| Dimensión | Hoy | Tras Fase 4 |
|---|---:|---:|
| Inteligencia | 7 | 8 |
| Persistencia | 5 | 8 |
| Autonomía | 2 | 8 |
| Orquestación | 2 | 8 |
| Task management | 2 | 9 |
| Ejecución | 2 | 7 |
| QA loop | 1 | 8 |
| Memoria | 4 | 8 |
| Paralelismo | 0 | 7 |
| Scheduling | 2 | 8 |
| Recuperación | 3 | 8 |
| Medición | 3 | 6 |

### **Global esperado: 8 / 10**

No 10, y a propósito: la medición de resultado real (¿el cambio movió la
métrica?) tiene un ciclo de semanas y depende de datos externos ruidosos;
y la cobertura de capabilities ejecutables crecerá despacio porque cada
una debe ser reversible y verificable antes de ser autónoma. Ambas cosas
son correctas así.

---

## 21. Caso de prueba del departamento final

> **Objetivo: "Mejora el SEO y rendimiento comercial de Zentry Lockers."**

```
OBJECTIVE registrado (una vez, versionado)
   │
   ▼ ciclo 1 — detección (deterministas, en paralelo)
   seo-watcher     → GSC: 3 keywords perdiendo posición, 2 sin landing
   analytics-watcher → GA4: caída de conversión en /taquillas-fenolicas
   sem-watcher     → Ads: 1 grupo con CPA fuera de banda
   competitor-int  → 2 keywords nuevas del competidor
   │
   ▼ triage determinista (autonomy-policy + umbrales del §15)
   12 señales → 7 tasks READY · 5 DISCARDED ("dentro del ruido")
   │
   ▼ ciclo 2 — trabajo en paralelo (K=3, sin dependencias entre sí)
   ┌────────────────┬────────────────────┬──────────────────────┐
   │ TASK-01 SEO    │ TASK-02 ANALYTICS  │ TASK-03 CONTENT      │
   │ canibalización │ caída conversión   │ landing gimnasios    │
   │ melamina       │ /fenolicas         │ (cerraduras)         │
   │ → seo-spec.    │ → analytics-spec.  │ → content-strategist │
   └────────────────┴────────────────────┴──────────────────────┘
   TASK-04 SEM queda BLOCKED: dependsOn TASK-02 (necesita saber si la
   caída es de tracking antes de tocar pujas)  ← dependencia por taskId
   │
   ▼ QA
   TASK-01 → APPROVED
   TASK-02 → APPROVED, y genera SUBTASK-02a "verificar evento GTM"
   TASK-03 → NEEDS_CORRECTION ("afirma plazo de entrega no confirmado"
             — regla real de la skill zentry-brand)
   │
   ▼ corrección automática (attempts 1→2)
   TASK-03 vuelve a content-strategist con las requiredCorrections
   adjuntas → reescribe sin la afirmación → QA → APPROVED
   │
   ▼ TASK-02 desbloquea TASK-04 → sem-specialist propone ajuste de pujas
     → riesgo comercial → WAITING_HUMAN (correcto: es dinero)
   │
   ▼ ejecución
   TASK-01 → web-engineer → ChangePlan (TITLE/META, page_id resuelto)
           → capability soportada → snapshot → staging → read-back OK
           → COMPLETED  ✓ sin intervención
   TASK-03 → capability NO soportada (crear landing nueva)
           → WAITING_HUMAN con la spec lista para implementar
   │
   ▼ el orquestador vuelve a preguntar: ¿queda trabajo?
   Sí → 3 tasks READY del ciclo 1 → repository_dispatch → sigue solo
   │
   ▼ ... N ciclos después
   nextActionableTasks() == []
   │
   ▼ EMAIL (consecuencia del estado, no producto del pipeline)
   ─────────────────────────────────────────────────────────────
   Hice:        3 tareas completadas (2 en staging, 1 análisis)
   Conseguí:    canibalización de melamina resuelta; evento GTM
                corregido; 1 landing especificada
   Sigo con:    2 tareas en curso, 1 esperando datos (D+14)
   Necesito:    · aprobar ajuste de pujas de TASK-04 (impacto ~180 €/mes)
                · implementar la landing de TASK-03 (spec adjunta)
   ─────────────────────────────────────────────────────────────
   │
   ▼ semanas después, agotado el backlog
   "No quedan tareas de backlog suficientemente valiosas.
    Entramos en monitorización."
   → los detectores siguen corriendo; el 90% de los despertares
     terminan sin invocar ningún modelo.
```

---

## 22. VEREDICTO

### ¿Tenemos IA real?
**SÍ.** Ocho agentes Claude con razonamiento genuino, salida estructurada
validada contra JSON Schema versionado, auditores anti-fabricación y
guards toolless verificados. No es IA decorativa.

### ¿Tenemos múltiples agentes?
**SÍ.** 8 empleados Claude + 26 agentes deterministas.

### ¿Tenemos un pipeline multiagente?
**SÍ.** Y bien construido: coordinado, con puerta de QA fail-closed,
trazabilidad completa y coste por empleado.

### ¿Tenemos hoy un departamento autónomo?
**NO.** 105 tareas vivas, 0 cerradas, 71 re-detectadas hasta 69 veces sin
avanzar, 18 esperando un botón que nadie pulsa, y la única capability
ejecutable no la invoca ningún workflow programado. El sistema produce
recomendaciones excelentes y no ejecuta ninguna por su cuenta.

### ¿La arquitectura actual puede convertirse en uno sin reescribirlo todo?
**SÍ, y con bastante margen.** Lo que falta es una capa de coordinación,
no las capacidades. Ya existen —probados— la máquina de estados
fail-closed, el ciclo de vida de 14 estados (como función derivada), los
executors con snapshot y rollback, la política de autonomía versionada,
la persistencia con verificación de no-pérdida, el runtime de empleados y
1069 tests. Casi nada de eso hay que tirarlo: hay que **conectarlo a una
entidad de trabajo que sobreviva a la pasada**.

---

## SIGUIENTE PASO

Una sola acción arquitectónica, y es la de la Fase 1 — porque es la única
que desbloquea todas las demás y no rompe nada: definir la entidad `Task`
con su store y su máquina de estados (derivada de `OpportunityState` +
`DepartmentChangeStatus`, que ya existen y ya están probadas), y
**proyectar** en ella el estado actual sin cambiar todavía ningún
comportamiento. A partir de ese momento existe algo sobre lo que un
orquestador puede decidir, algo que QA puede devolver, algo que un
executor puede cerrar y algo que un email puede reportar.

> **La siguiente cosa que debemos construir es: la entidad TASK
> persistente —con `taskId`, `status`, `owner`, `attempts`,
> `dependsOn[]`, `wakeAt` y su máquina de estados fail-closed— y su
> store, poblada por proyección desde el estado que ya tenemos.**

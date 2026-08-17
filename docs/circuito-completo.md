# El circuito completo del departamento

> Este documento describe el circuito que cierra la puesta en marcha:
> **recibir datos -> encontrar trabajo util -> hacerlo -> comprobarlo ->
> corregirse -> recordar -> informar.**
>
> No sustituye a los documentos de cada pieza
> ([department-coordination.md](department-coordination.md),
> [execute-php-fallback.md](execute-php-fallback.md),
> [telegram-approval-system.md](telegram-approval-system.md)): explica
> como encajan, y sobre todo **donde estaban los cortes** que impedian
> que el circuito se cerrara.

## El circuito

```text
DATOS LIVE  (Search Console, GA4, GTM, Google Ads, inventario de staging)
     |
     v
ESPECIALISTAS      seo-specialist / content-strategist / analytics-specialist
     |
     v
GROWTH DIRECTOR    sintetiza y prioriza
     |
     v
QA (recomendaciones)   <- puerta: que se promueve a ingenieria
     |
     v
WEB ENGINEER       especificacion tecnica + changePlans[] (intencion)
     |
     v
RESOLUCION DETERMINISTA   pageId, BEFORE real y ancla de version, del
     |                    inventario REAL -- nunca del modelo
     v
QA DEL PLAN        <- lo ultimo antes de escribir
     |
     +--- FAIL ---> requiredCorrections[] dirigidas
     |                    |
     |                    v
     |              web-engineer CORRIGE (con su propuesta anterior integra)
     |                    |
     |                    v
     |              re-QA sobre el OUTPUT NUEVO ---+
     |                    |                        |
     |              (max 2 rondas)                 |
     |                    |                        |
     |              NEEDS_HUMAN_REVIEW <-----------+
     |                    |
     |                    v
     |              nada se aplica; se explica el motivo
     |
    PASS
     |
     v
APPLY EN STAGING   snapshot -> ancla -> apply -> READ-BACK por otra via
     |             -> validacion de scope -> rollback verificado si falla
     v
PERSISTENCIA       MongoDB (estado autoritativo)
     |
     v
EMAIL              resumen humano de 150-250 palabras
     |
     v
PRODUCCION         inalcanzable sin aprobacion humana explicita
```

## Los cuatro cortes que impedian cerrarlo

Ninguno era una funcionalidad que faltara. Los cuatro estaban en el mismo
sitio: entre **"el sistema sabe hacerlo"** y **"el sistema lo hace"**.

### 1. El ChangePlan llegaba al executor y se caia por el camino

`buildApplyPlan()` ascendia a `proposed` una recomendacion con
`executableChangePlan`, a proposito. Y la fase `stage` la descartaba
inmediatamente despues:

```ts
if (item.applyStatus !== "proposed" || !item.applyCapability.supported) continue;
```

`applyCapability` es el camino **legacy**: interpreta la PROSA de
web-engineer buscando `page_id=N` y lineas `TITLE:` / `META:`. Un
ChangePlan estructurado -- resuelto contra el inventario real, con el
BEFORE leido y su ancla de version -- no satisface ese predicado.

Resultado observable: el departamento producia planes ejecutables y
terminaba diciendo `requires_manual_staging_implementation`, con la
capacidad de ejecutarlos ya construida y certificada al lado.

**Corregido** en `src/department/apply/changeplan-staging-runner.ts`: el
ChangePlan es ahora el camino PREFERENTE sobre el legacy. Cuando existen
los dos, ejecutar el legacy seria preferir la adivinanza al dato.

### 2. El apply en staging exigia infraestructura que no tiene que ver con staging

La fase `stage` empezaba exigiendo el carril serverless entero (Worker de
Cloudflare, D1, webhook de Telegram, `APPROVALS_API_*`). Ese carril esta
implementado y probado, pero **no desplegado**. Para escribir en staging
hacia falta infraestructura ajena a escribir en staging.

**Corregido** con `MongoStagingChangeStore`: el registro del cambio va al
estado autoritativo que ya existe. Ese store **rechaza por construccion**
cualquier transicion al carril de produccion -- la atomicidad que exige
el contrato de transicion no la da este puerto, y el unico sitio donde
esa atomicidad importa de verdad es la reclamacion de produccion.

### 3. Nadie revisaba el plan

QA revisaba a los especialistas y a Growth. Despues web-engineer producia
la especificacion y los ChangePlans, y eso no lo revisaba nadie:

```text
especialistas -> Growth -> QA -> web-engineer -> APPLY
                                            ^
                                nada revisa esto
```

Lo unico que de verdad se escribe en staging era justo lo unico que no
pasaba por QA.

**Corregido** con la QA del plan (`src/department/plan-qa-input.ts`).

### 4. Un FAIL de QA terminaba la pasada

```text
empleado -> QA -> FAIL -> FIN
```

Nadie corregia nada. La unica "recuperacion" era que al dia siguiente la
pasada volviera a generar la misma propuesta desde cero, sin ninguna
memoria de que QA la habia bloqueado ni de por que.

**Corregido** con el bucle de `src/department/qa-correction.ts`.

## El bucle de correccion, en detalle

### Que recibe quien corrige

No una frase suelta. El encargo lleva:

- su **propuesta anterior integra** (no un resumen: sin ella, "corregir"
  seria "proponer desde cero" y no habria forma de saber si atendio lo
  que se le pidio);
- las correcciones **estructuradas**: `field`, `problem`,
  `expectedCriterion`, `evidence`, `targetRecommendationId`, `blocking`;
- los ChangePlans con el **BEFORE real** leido del sitio;
- el contexto original: recomendaciones aprobadas e inventario.

### Las dos reglas que no se negocian

**Un FAIL no se maquilla.** La unica forma de salir del bucle en verde es
que una revision POSTERIOR, sobre el output NUEVO, lo diga. Agotar las
rondas no degrada el veredicto, y `NEEDS_HUMAN_REVIEW` bloquea **todos**
los elementos del contrato de apply. Sin esa puerta habria un agujero
real: `change-plans.json` es la ruta canonica y siempre lleva la ULTIMA
version producida -- incluida una que QA acaba de rechazar.

**El bucle termina.** Maximo 2 rondas automaticas
(`MAX_AUTOMATIC_CORRECTION_ROUNDS`). Y el limite esta ademas desplegado
estaticamente en el workflow, asi que una tercera ronda es imposible por
construccion, no solo por politica.

Un tercer caso, menos obvio: **QA que bloquea sin decir que corregir NO
dispara correccion.** Reinvocar al responsable sin decirle que arreglar
es tirar una invocacion y, peor, invitarle a cambiar cosas al azar hasta
que pase. Eso va directo a `NEEDS_HUMAN_REVIEW`.

### Trazabilidad

Cada ronda tiene su propio directorio (`stages/<etapa>/rounds/<n>/`) y su
propia invocacion registrada. Con una sola ruta por etapa, la ronda 2
sobrescribiria a la 1 y *"PASS en la ronda 2"* seria indistinguible de
*"PASS sobre el artifact viejo"*. El registro completo esta en
`qa-loop.json`, con `revision` y `qaAttempt` por ronda.

## La pasada fresca

`DEPARTMENT_FRESH_BACKLOG=true` (input `freshBacklog` del workflow) vacia
el backlog **operativo** del contexto de Growth.

```text
HISTORICO                      -> se conserva, intacto
BACKLOG OPERATIVO DE LA PASADA -> empieza vacio
```

El trabajo pendiente acumulado entraba por **dos** vias, no una: los
resumenes (`topOpenActions`, `topPending`) y las entradas citables del
`evidenceCatalog` (`actions-live`, `actions-top`, `workorders-ready`,
`changepacks-ready`, `approvals-pending`). Vaciar solo la primera seria
un aislamiento aparente.

Lo que **no** se aisla, y por que:

| Se conserva | Motivo |
|---|---|
| Decisiones humanas previas | Son restricciones PERMANENTES. Aislarlas haria que el departamento volviera a proponer justo lo que una persona ya rechazo. |
| `jobsSummary` | No es trabajo pendiente: es la senal de si los watchers han corrido. Sin ella no se distingue "no hay nada que hacer" de "hoy no se ha medido". |
| Salidas de los especialistas de HOY | No son historico. Son el trabajo de la pasada. |

Y no se vacia en silencio: un contexto con los contadores a cero y sin
explicacion es indistinguible de un fallo de lectura, y el agente
razonaria sobre *"no hay nada"* en vez de sobre *"hoy no miramos esto"*.
El aviso va el primero de los `warnings` y dice explicitamente que
concluir que no hay nada que hacer **es una respuesta valida**.

## Que sigue protegido

| Barrera | Donde |
|---|---|
| Produccion inalcanzable por entorno | `decideChangePlanExecution()` -- rechaza si `wordpressEnv != staging` |
| Produccion bloqueada en el adaptador | `assertWordpressWriteAllowed()`, incondicional |
| Produccion imposible en el store | `MongoStagingChangeStore` rechaza toda transicion `production_*` |
| Sin credenciales de produccion | El step de staging no las recibe |
| Catalogo cerrado de operaciones | `EXECUTE_PHP_OPERATIONS`, con allowlist de `metaKey` |
| Un solo destino por cambio | El plan se ancla a UN `targetId` con su hash |
| Nada fuera de scope | La validacion post-apply relee y compara la huella de lo que NO debia cambiar |
| Escritura sin registro | Sin estado autoritativo disponible, no se aplica nada |

## El email

Lo que llega al correo es el **resumen humano**: 150-250 palabras, sin
ids internos, sin ChangePlans, sin JSON ni nombres de fichero. Tres
variantes:

- **normal**: que se detecto, que se hizo, que resultado, que necesita de
  ti;
- **sin trabajo**: *"No hemos detectado ningun cambio que justifique
  intervenir"* -- que es mejor que inventar cinco recomendaciones;
- **alerta**: cuando la pasada falla tecnicamente, con un motivo humano y
  sin parecerse a un brief normal.

El email tecnico completo (~3000 palabras) se sigue construyendo y se
guarda junto al que se envia: *"el email no lo cuenta todo"* no puede
significar *"eso no esta escrito en ningun sitio"*.

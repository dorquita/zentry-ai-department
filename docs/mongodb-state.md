# Estado del departamento en MongoDB

Fase O56. Este documento es lo que necesita otra persona para entender,
operar y recuperar la persistencia del departamento.

---

## 1. El problema que resuelve

El departamento razonaba, generaba recomendaciones, recibía decisiones
humanas y producía trabajo — pero **el estado entre pasadas no persistía
de forma fiable**. Las causas concretas, todas verificadas sobre el
código:

1. **Las decisiones humanas se perdían siempre.**
   `department-approval-session.yml` corre con `contents: read`, no
   restaura la rama `department-state` y no commitea nada.
   `appendHumanDecision()` escribía `data/department-human-decisions.jsonl`
   en un runner efímero y el runner moría. El artifact de respaldo, además,
   apuntaba a una ruta que no existe (`data/human-decisions.jsonl`) con
   `if-no-files-found: warn`, así que el fallo era **silencioso**.

2. **El restore fallaba en silencio.**
   `git checkout FETCH_HEAD -- data reports 2>/dev/null || true`: si el
   checkout falla, la pasada continúa con el `data/` de `main`, el
   manifiesto baseline se toma *después*, el verify compara main contra
   main y no detecta nada, y el job de persistencia reemplaza la rama de
   estado por un árbol derivado de `main`.

3. **Un artefacto regenerable tiraba el estado real.**
   El guard legacy mete `data/` y `reports/` en el mismo saco. Un informe
   diario que se regenera más corto es un `bytes_lost`, el verify falla, y
   se descarta **toda** la pasada, incluidas las líneas nuevas y legítimas
   de `data/`.

4. **`decisionId` no era idempotente.** Lleva el instante con
   milisegundos dentro, así que reejecutar la sesión de aprobación
   duplicaba la decisión con otro id.

5. **La rama `department-state` hacía tres trabajos a la vez**:
   almacenamiento, histórico y transporte. Eso no escala a un
   departamento multiagente.

---

## 2. Arquitectura

### Antes

```text
runner efimero
   │  data/*.jsonl  (append-only, en disco local)
   ▼
git checkout FETCH_HEAD -- data reports   ← falla en silencio
   │
   ▼
rama department-state = almacen + historico + transporte
   │
   ▼  (el workflow de aprobacion NO participa)
decision humana ────────────────────────────► se pierde
```

### Ahora (fase de transición)

```text
                    MongoDB
                       ▲   estado autoritativo (destino)
                       │
   ┌───────────────────┴───────────────────┐
   │        capa de persistencia           │
   │  DepartmentStateRepository            │
   │   ├── runs        RunRepository       │
   │   ├── entities    EntityRepository    │
   │   ├── events      EventRepository     │
   │   ├── decisions   DecisionRepository  │
   │   └── migrations  MigrationLog…       │
   └───────────────────▲───────────────────┘
                       │  puerto: insertIfAbsent / upsertIfNewer
   ┌───────────────────┴───────────────────┐
   │ orquestador / scripts / workflows     │
   └───────────────────────────────────────┘

   data/*.jsonl  ──►  fuente de la migracion y, HOY TODAVIA, estado legacy
   reports/      ──►  artifacts. Nunca fuente de verdad.
```

La dirección de autoridad es **una sola**: cuando termine la transición,
MongoDB manda y los ficheros son proyecciones. Hoy estamos en **shadow
mode**: el fichero sigue siendo autoritativo y MongoDB recibe todo en
paralelo para poder compararlos.

---

## 3. Colecciones

| Colección | Propósito | Índice único | Writer | Readers |
| --- | --- | --- | --- | --- |
| `department_runs` | Una pasada del departamento y su ciclo de vida | `departmentRunId` | `state:sync-mongodb` | guard de invariantes, `findPreviousRun` |
| `department_entities` | Estado ACTUAL de cada entidad del pipeline | `(kind, entityId)` | migración y sync | agentes, guard, verificación |
| `department_events` | Histórico inmutable (eventos, auditorías, jobs) | `(kind, eventId)` | migración y sync | guard, auditoría |
| `human_decisions` | Decisiones humanas. Irreemplazable | `decisionKey` | `state:sync-mongodb --decisions-only` | pasadas siguientes, guard |
| `state_migrations` | Bitácora de la migración. No es estado | `migrationRunId` | herramienta de migración | operador |

### Por qué cinco y no veintinueve

El inventario encontró 29 ficheros en `data/`, pero **no 29
comportamientos**. Hay cuatro: la pasada, la entidad con estado actual, el
evento inmutable y la decisión humana. Todas las entidades de clase A
comparten literalmente la misma semántica (JSONL append-only, la última
línea con ese id es el estado vigente, `createdAt`/`updatedAt`, `status`).
Esa identidad de comportamiento es la razón arquitectónica para unificarlas
bajo un discriminante `kind`: **un** camino de escritura idempotente y
**un** índice único, en vez de veinte copias del mismo código que se
desincronizan.

`human_decisions` tiene colección propia a propósito: es el dato cuya
pérdida motiva esta fase, el único que no se puede reconstruir, y el que
consultan los agentes. Mezclarlo con 13.700 eventos de rutina sería
enterrarlo.

### Índices secundarios

- `department_entities`: `(kind, status)`, `departmentRunId`
- `department_events`: `(departmentRunId, occurredAt)`
- `human_decisions`: `recommendationId`, `subjectKey`, `departmentRunId`
- `department_runs`: `startedAt`

Todos están declarados en `src/persistence/collections.ts`, cada uno con
el motivo por el que existe. Un test comprueba que **toda** colección
declara al menos un índice único y que ningún índice existe sin
explicación.

---

## 4. Identidad e idempotencia

### Los ids que ya tenían significado se conservan

`actionId`, `workOrderId`, `changePackId`, `approvalRequestId`,
`executionId`, `deploymentPlanId`, `eventId`, `recommendationId`… se migran
tal cual. La migración nunca genera ids nuevos.

### Los que no tenían id propio

Cuatro stores no tienen campo id. Su identidad se construye concatenando
sus claves naturales con `#`, lo cual es determinista y por tanto
idempotente:

| Store | Identidad |
| --- | --- |
| `opportunity-state-log.jsonl` | `actionId#date` |
| `credential-health.jsonl` | `service#recordedAt` |
| `staging-qa-results.jsonl` | `executionId#checkedAt` |
| `existing-page-audit.jsonl` | `wordpressPageId#checkedAt` |

Un registro al que le falte alguno de esos campos **no se migra**: se
cuenta y se reporta. Inventarle un id crearía un duplicado en la siguiente
ejecución.

### `decisionKey` — el arreglo de la idempotencia de decisiones

`buildDecisionId()` incluye el instante con milisegundos. Reejecutar la
sesión generaba otro id y duplicaba la decisión.

`buildDecisionKey()` (`src/persistence/decision-identity.ts`) es
determinista sobre el **contenido**: pasada + recomendación + acción +
motivo literal + destino + autor + overrides. Sin ningún reloj. Es el
índice único de la colección, así que el reintento choca y no duplica. El
`decisionId` original se conserva como campo para poder trazar contra el
fichero histórico.

### `subjectKey` — el problema de continuidad que queda abierto

`recommendationId` es `${departmentRunId}#rec-${rank}`, así que **nunca se
repite entre pasadas**. Consecuencia: buscar el historial de una
recomendación por su id siempre devuelve vacío, la versión del `changeId`
se queda clavada en v1 y el linaje "esto es la segunda versión de lo que
rechazaste" no existe.

`subjectKey` (título normalizado: sin acentos, minúsculas, sin puntuación)
sí es estable entre pasadas. Se **persiste e indexa**, y
`decisions.listForSubject()` permite la consulta.

**Alcance:** en esta fase ningún lector legacy cambia de comportamiento por
su causa. Es el habilitador de la continuidad, no un cambio de la lógica de
prompts — eso queda fuera del alcance de la migración.

---

## 5. El puerto de persistencia

Dos primitivas de escritura, ni una más
(`src/persistence/collection-port.ts`):

| Primitiva | Para qué | Traducción a MongoDB |
| --- | --- | --- |
| `insertIfAbsent` | Lo inmutable: eventos, decisiones humanas | `updateOne({clave}, {$setOnInsert: doc}, {upsert:true})` |
| `upsertIfNewer` | Estado actual: la última versión gana | `updateOne({clave, frescura:{$lte:x}}, {$set: doc}, {upsert:true})` |

Las dos son **atómicas a nivel de documento e idempotentes**. Con eso
sobran los locks globales.

Resultados posibles:

- `inserted` — no existía, se ha creado.
- `updated` — existía y era más viejo, se ha actualizado.
- `duplicate_prevented` — ya existía idéntico. **Es éxito.** Es la señal
  que demuestra que reejecutar una operación es un no-op.
- `stale_ignored` — el entrante era más viejo que lo almacenado. **El
  estado nuevo no se revierte nunca.**

No se expone `delete` ni `deleteMany`. Nada de esta fase borra estado.

### Cómo `upsertIfNewer` resuelve una carrera

Si lo almacenado es más nuevo, el filtro no casa, el upsert intenta
insertar y choca contra el índice único. Ese `E11000` significa "he llegado
tarde" y se traduce a `stale_ignored`. Si el choque fue por una carrera
real (otro escritor insertó entre nuestro filtro y nuestro insert), se
reintenta una vez sin upsert.

---

## 6. Variables de entorno

| Variable | Dónde | Obligatoria | Qué es |
| --- | --- | --- | --- |
| `MONGODB_URI` | secret de GitHub | sí, para todo lo que toque Mongo | cadena de conexión |
| `MONGODB_DB_NAME` | variable de repo | no | nombre de base de datos. Manda sobre la que venga en la URI. Por defecto `zentry_department` |
| `DEPARTMENT_PERSISTENCE_MODE` | variable de repo | no | `legacy` \| `shadow` \| `mongo` |

**La URI no sale nunca de `src/persistence/mongo-config.ts`.** No se
imprime, no se serializa, no entra en un report ni en un prompt. Lo único
que se expone hacia fuera es `renderMongoTarget()`, que produce
`esquema=… hosts=N db=… credenciales=si (no se muestran)` — sin host, sin
usuario, sin password. Todo mensaje de error pasa por `sanitizeMongoText()`.

### La trampa de `authSource` (nos ha pasado)

Por especificacion, `authSource` **no es siempre `admin`**: por defecto es
**la base que venga en la ruta de la URI**, y solo cae a `admin` si la
ruta no trae ninguna. Atlas, en cambio, crea los usuarios en `admin`.

Asi que esta URI falla:

```text
mongodb+srv://usuario:clave@cluster0.xxxxx.mongodb.net/zentry_ai_department
```

El driver intenta autenticar contra `zentry_ai_department`, donde ese
usuario no existe, y el servidor responde con un escueto
`bad auth : authentication failed` que no menciona nada de esto. La forma
correcta es:

```text
mongodb+srv://usuario:clave@cluster0.xxxxx.mongodb.net/zentry_ai_department?authSource=admin&retryWrites=true&w=majority
```

**Ojo:** poner la variable `MONGODB_DB_NAME` NO arregla esto. Esa variable
solo decide contra que base se opera; el `authSource` sale de la URI. Hay
que editar la URI.

La sonda detecta la combinacion sospechosa (base en la ruta + sin
`authSource`) y avisa antes de conectar. Deliberadamente **no** la
corrige por detras: adivinar el `authSource` seria cambiar la semantica de
autenticacion en silencio.

### Los tres modos

| Modo | Fuente de verdad | Fallo de MongoDB |
| --- | --- | --- |
| `legacy` | fichero | no interviene |
| `shadow` | fichero | se reporta, la pasada continúa |
| `mongo` | **MongoDB** | **falla cerrado** |

Sin declaración explícita: `shadow` si hay credenciales, `legacy` si no.
**Nunca `mongo` por defecto** — convertir a MongoDB en fuente de verdad es
una decisión de arquitectura, no un efecto secundario de que una variable
esté puesta.

---

## 7. Comandos

```bash
# Sonda: conectar -> ping -> base -> escritura controlada -> exito
npm run state:probe-mongodb
npm run state:probe-mongodb -- --write-check

# Migracion del historico
npm run state:migrate-mongodb -- --dry-run
npm run state:migrate-mongodb -- --dry-run --data-dir /ruta/al/checkout/data
npm run state:migrate-mongodb -- --apply

# Guard de invariantes
npm run state:snapshot-mongodb -- --out /tmp/mongo-before.json
npm run state:verify-mongodb -- --before /tmp/mongo-before.json \
  --departmentRunId dept-2026-08-17T090000Z --require-finished

# Equivalencia legacy vs MongoDB (fase 2 de la transicion)
npm run state:verify-mongodb -- --mode equivalence

# Escritura de la pasada (shadow write)
npm run state:sync-mongodb -- --departmentRunId <id> --status succeeded
npm run state:sync-mongodb -- --decisions-only
```

`--dry-run` **no exige credenciales**: no escribe nada por definición, así
que se puede ensayar en local antes de tener ningún cluster.

> **`--data-dir` importa.** El estado vivo no está en el `data/` de `main`,
> sino en el de la rama `department-state`, que va por delante. Para migrar
> el histórico bueno hay que apuntar ahí:
> ```bash
> mkdir /tmp/state && cd /tmp/state
> git -C <repo> archive origin/department-state data | tar -x
> ```

---

## 8. La migración

Garantías, todas cubiertas por tests:

- **Idempotente.** Ejecutarla dos veces deja el mismo estado. La segunda
  ejecución escribe 0 y reporta N duplicados evitados.
- **Dry-run** que no escribe absolutamente nada.
- **No destructiva.** No hay `dropDatabase`, `dropCollection`,
  `deleteMany` ni `delete` en ninguna parte del código de persistencia.
- **No toca los `.jsonl` originales.** Se abren en solo lectura, en
  streaming (`action-backlog.jsonl` pesa 20 MB).
- **Aborta ante ambigüedad real** sin escribir nada, ni siquiera lo que sí
  estaba claro.
- **Informe saneado**: sin URI, sin credenciales, sin rutas absolutas.

### Regla de resolución

- **Clase A (entidades):** gana la frescura mayor (`updatedAt`) y, si
  empata, **la línea posterior**. Junto es exactamente la semántica que ya
  aplican los lectores actuales ("la última línea con ese id es el estado
  vigente"). Aplicar otra regla produciría un estado que no coincide con el
  que el departamento ve hoy.
- **Clase B (eventos):** un evento es inmutable. Repetido idéntico es una
  repetición inofensiva; repetido con contenido distinto **no tiene
  desempate posible** y aborta.

Los empates resueltos por orden de línea se cuentan y se reportan
(`tiesResolvedByLineOrder`): no son pérdidas, pero señalan que el
`updatedAt` de ese store no tiene resolución suficiente.

### Qué se migra y qué no

| Clase | Qué es | ¿Se migra? |
| --- | --- | --- |
| **A** | Estado autoritativo | **Sí** (`department_entities` + `human_decisions`) |
| **B** | Histórico append-only | **Sí** (`department_events`) |
| **C** | Derivado recalculable | **No.** Meterlo en la fuente de verdad daría a entender que su pérdida es grave, y no lo es |
| **D** | Artifact/backup puntual (`o21*.json`, `o22*.json`, dry-runs) | **No.** No es estado del departamento. Tampoco se borra |

El registro completo, con el motivo de cada clasificación, está en
`src/persistence/entity-registry.ts`.

---

## 9. Los dos guards

| | Guard legacy (`state:verify`) | Guard nuevo (`state:verify-mongodb`) |
| --- | --- | --- |
| Qué mide | crecimiento **físico** de ficheros | **invariantes** del estado autoritativo |
| Unidad | líneas y bytes | entidades, eventos, decisiones |
| `reports/` que encoge | **antes bloqueaba** — ahora solo avisa | indiferente |
| Estado | sigue activo durante la transición | activo cuando hay credenciales |

El guard legacy **no se ha desactivado**. Lo que ha cambiado es que solo
bloquea por regresiones en `data/`: una regresión en `reports/` se informa
pero no decide (`classifyStateRegressions`). `detectStateRegressions()`
sigue devolviendo todas las regresiones exactamente igual que antes — lo
que cambia es quién decide con ellas.

El guard nuevo comprueba: entidades que no desaparecen, eventos que no
encogen, **decisiones humanas que no desaparecen** (por clave concreta, no
solo por recuento — una decisión borrada y otra nueva mantendrían el
recuento), pasadas que no se pierden, y que la pasada quedó cerrada.

**Retirada del guard legacy:** solo cuando
`DEPARTMENT_PERSISTENCE_MODE=mongo` esté activo y verificado durante
varias pasadas. Es una decisión explícita y documentada, no un efecto
secundario.

---

## 10. Taxonomía de fallos

`src/persistence/mongo-errors.ts`:

| Tipo | ¿Reintentable? |
| --- | --- |
| `auth_failure` | no — se va a repetir igual |
| `network_failure` | sí |
| `timeout` | sí |
| `unavailable` | sí |
| `write_concern` | sí |
| `duplicate_key_expected` | **no es un fallo**: es la garantía funcionando |
| `duplicate_key_unexpected` | no — es un fallo de modelo |
| `validation` | no |
| `not_configured` | no — fail-closed antes de tocar la red |

Que un `duplicate key` sea esperado o no **lo decide quien llama**, no el
error: solo el llamante sabe si estaba haciendo una escritura idempotente.

---

## 11. Observabilidad

Cada pasada publica:

```text
persistenceBackend = mongodb | filesystem
mongoConnected = true | false
migrationMode = legacy | shadow | mongo
writesAttempted / writesSucceeded / writesFailed
duplicateWritesPrevented / staleWritesIgnored
destino = esquema=… hosts=N db=… credenciales=si (no se muestran)
```

Los únicos campos de texto son `migrationMode` y `destino`, y `destino`
viene de `renderMongoTarget()`. Ahí no puede colarse una credencial.

---

## 12. Los agentes no ven MongoDB

```text
Claude → input preparado → runtime/orquestador → capa de persistencia → MongoDB
```

`MONGODB_URI` no entra en ningún prompt, ningún agente tiene acceso al
repositorio de persistencia y ningún artifact de agente contiene
credenciales. Los especialistas siguen recibiendo un paquete de contexto ya
resuelto, exactamente igual que antes.

---

## 13. Recuperación de fallos

**La sonda falla en la pasada diaria.**
El log dice el tipo (`auth_failure`, `network_failure`…) sin filtrar la
URI. Si es `auth_failure`, la credencial es mala o no tiene permiso sobre
la base: no se reintenta. Si es `network_failure` o `unavailable`,
reintentar más tarde tiene sentido. En modo `shadow` la pasada continúa con
el sistema legacy.

**La migración aborta por colisión.**
El informe lista fichero, id y números de línea. Se revisan a mano. No se
ha escrito nada, así que se puede corregir y relanzar.

**El guard nuevo dice `decision_disappeared`.**
Es lo más grave que puede pasar. Nada del sistema borra decisiones, así que
significa que se está apuntando a otra base de datos o que alguien ha
borrado a mano. Comprobar `db=` en el log de la sonda antes que nada.

**Volver atrás.**
Poner `DEPARTMENT_PERSISTENCE_MODE=legacy`. El sistema vuelve al
comportamiento anterior de inmediato: en shadow mode MongoDB nunca fue
autoritativo, así que no hay nada que revertir. Los datos en MongoDB se
quedan donde están; no se borra nada.

---

## 14. Estado de la transición

- [x] **Fase 1 — shadow write.** Implementada.
- [x] **Fase 2 — verificación.** `--mode equivalence` compara semántica
      (ids, cardinalidad, decisiones), nunca bytes.
- [ ] **Fase 3 — lectores en MongoDB.** Bloqueada: nunca se ha llegado a
      conectar (ver abajo).
- [ ] **Fase 4 — MongoDB como fuente de verdad.**
- [ ] **Fase 5 — exports.** Los JSON/Markdown pasan a ser proyecciones.

### Bloqueo actual

Primeros intentos reales contra Atlas, workflow `MongoDB state migration`:

| run | resultado |
| --- | --- |
| `32013161621` | `[mongo:auth_failure] connect: bad auth : authentication failed` |
| `32013758714` | igual, ya con la lista de causas |
| `32013992701` | igual, y confirma la sospecha estructural |

La sonda reporta `esquema=mongodb+srv hosts=1 db=zentry_ai_department
credenciales=si (no se muestran)`: la URI **trae la base en la ruta y no
fija `authSource`**, que es exactamente la trampa descrita arriba.

El SRV resuelve y se llega a la fase de autenticación, así que **la red y
Network Access están bien**. Lo que falta es corregir la URI del secret
`MONGODB_URI` (o el usuario de Database Access). Hasta entonces no se
puede migrar nada, y el sistema sigue en shadow/legacy sin degradarse.

**SOURCE OF TRUTH: LEGACY — MONGODB SHADOW MODE**

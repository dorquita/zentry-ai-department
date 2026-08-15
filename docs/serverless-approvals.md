# Aprobaciones serverless: Cloudflare Workers + D1

Arquitectura del sistema de aprobaciones del departamento IA después de
sacarlo del VPS.

Sustituye, **solo en la parte de aprobaciones**, a
[`telegram-approval-system.md`](telegram-approval-system.md): el flujo
operativo, la máquina de estados, la regla anti-TOCTOU y las capacidades
de apply que allí se describen siguen siendo exactamente las mismas. Lo
que cambia es **dónde vive el estado** y **quién recibe el botón**.

> Nada de lo que hay aquí está desplegado. El procedimiento para
> desplegarlo es [`infra/cloudflare/README.md`](../infra/cloudflare/README.md).

---

## 1. El problema que resuelve

Una aprobación humana tarda horas o días. El runner de GitHub Actions
vive minutos y su filesystem se evapora al terminar. De ahí salía la
solución anterior: un VPS con un servicio systemd haciendo long-poll a
Telegram y un log JSONL en disco.

Eso funcionaba, pero significaba mantener una máquina encendida,
parcheada y con credenciales de producción de WordPress dentro, solo
para esperar a que alguien pulsara un botón.

La arquitectura nueva sustituye ese VPS por dos piezas:

- un **Worker de Cloudflare** que recibe el webhook de Telegram y expone
  una pequeña API HTTP para GitHub Actions;
- una base de datos **D1** que guarda el estado de las aprobaciones.

Y mantiene intacta la regla que sostiene todo lo demás: **quien escribe
en WordPress sigue siendo GitHub Actions, con los executors
deterministas de siempre**.

---

## 2. El flujo completo

```
  ┌─────────────────────────────────────────────────────────────────┐
  │ GITHUB ACTIONS — pasada diaria del departamento                 │
  │                                                                 │
  │  Growth → QA → Web Engineer                                     │
  │      ↓                                                          │
  │  APPLY EN STAGING  (executor determinista, WordPress staging)   │
  │      ↓                                                          │
  │  VALIDACIÓN releyendo staging  →  stagingVersionHash            │
  └──────────────────────────┬──────────────────────────────────────┘
                             │  POST /api/approvals
                             │  Authorization: Bearer <APPROVALS_API_TOKEN>
                             ▼
                    ┌────────────────────┐        ┌──────────────┐
                    │  WORKER (CF)       │◄──────►│   D1 (SQLite)│
                    │  zentry-approvals  │        │  approvals   │
                    └────────┬───────────┘        │  processed_… │
                             │                    │  rejection_… │
                             │ sendMessage        └──────────────┘
                             ▼
                    ┌────────────────────┐
                    │     TELEGRAM       │
                    │ ✅ APROBAR         │
                    │ ❌ RECHAZAR        │
                    │ 👁 VER CAMBIOS     │
                    │ 🔗 abrir staging   │
                    └────────┬───────────┘
                             │  POST /telegram/webhook
                             │  x-telegram-bot-api-secret-token: <secreto>
                             ▼
                    ┌────────────────────────────────────────────┐
                    │  WORKER                                    │
                    │  1. valida la cabecera secreta             │
                    │  2. update_id → processed_updates (PK)     │
                    │  3. chat_id / user_id autorizados          │
                    │  4. callback_data → approval_id            │
                    │  5. lee la aprobación REAL de D1           │
                    │  6. transición condicional y ATÓMICA       │
                    └────────┬───────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
        APROBAR                          RECHAZAR
              │                              │
   approved → production_queued     awaiting_rejection_reason
   (una sola vez, garantizado)        → motivo obligatorio
              │                        → rejected + feedback
              │                          persistente en D1
              ▼
      workflow_dispatch  { approvalId }
              │
              ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ GITHUB ACTIONS — department-production-apply.yml                │
  │                                                                 │
  │  1. lee la aprobación del Worker (GET /api/approvals/:id)       │
  │  2. exige status = production_queued                            │
  │  3. RECALCULA el hash de staging  → anti-TOCTOU, otra vez       │
  │  4. production_queued → production_applying                     │
  │  5. snapshot → escribir → validar releyendo → rollback si falla │
  │  6. production_applied / production_validation_failed / …       │
  └──────────────────────────┬──────────────────────────────────────┘
                             ▼
                      ┌─────────────┐
                      │  WORDPRESS  │
                      │  PRODUCCIÓN │
                      └─────────────┘
```

### La línea que no se cruza

**El Worker no toca WordPress. Nunca. Ni staging ni producción.**

No tiene la URL de WordPress, no tiene el usuario, no tiene el
Application Password, y no tiene ningún código que sepa hablar con la
API REST de WordPress. Lo único que hace cuando alguien aprueba es:

1. mover una fila de `approved` a `production_queued` en D1;
2. hacer un `workflow_dispatch` a GitHub con **un solo dato**: el
   `approvalId` (ver `ProductionDispatchInputs` en
   `src/approvals/api-contract.ts`).

Esto no es una preferencia de estilo, es contención de radio de
explosión: si el Worker quedara comprometido, el atacante consigue
disparar un workflow que publica **un cambio que un humano ya había
aprobado y que sigue validándose contra el hash de staging**. No
consigue escribir contenido arbitrario en la web, porque no hay ninguna
vía por la que el contenido viaje desde el Worker hasta WordPress.

---

## 3. Por qué Cloudflare Workers + D1 (y no Lambda + DynamoDB)

Decisión ya tomada. Los motivos, para que dentro de seis meses se sepa
por qué:

**Un fichero de configuración y un despliegue.** Todo el IaC de este
carril es `infra/cloudflare/wrangler.toml` y `npx wrangler deploy`. El
equivalente en AWS son roles y políticas de IAM, una función, un API
Gateway (o una Function URL), una tabla, y probablemente una plantilla
de SAM o CDK para mantener todo eso junto. Para un sistema cuyo trabajo
es *"recibir un botón y encolar un dispatch"*, esa complejidad no la
paga nadie. Sin IAM, sin VPC, sin grupos de seguridad, sin NAT.

**D1 es SQLite: transacciones y constraints de verdad.** Y las
constraints **son** la primitiva de idempotencia de este sistema:

- la clave primaria de `processed_updates` es lo que hace que un webhook
  reentregado no vuelva a ejecutar nada;
- el `UPDATE ... WHERE status IN (...)` con recuento de filas afectadas
  es lo que hace que dos pulsaciones de APROBAR produzcan un solo
  encolado.

En DynamoDB lo mismo se consigue con escrituras condicionales, sí, pero
expresadas en un DSL propio en vez de en SQL, y sin transacciones
multi-tabla sin entrar en `TransactWriteItems`. Aquí la garantía se lee
en el propio SQL, que es donde queremos que se pueda auditar.

**El runtime no es Node, y eso es una ventaja.** El Worker corre sobre
V8 con las APIs web estándar: no hay `node:crypto`, no hay `node:fs`.
Suena a limitación y es exactamente la propiedad que queremos: **el
Worker no puede calcular un hash de versión aunque quisiera**. Los
hashes los calcula quien de verdad releyó el sistema real — GitHub
Actions — y el Worker se limita a comparar identificadores opacos (ver
`src/approvals/version-compare.ts`, separado a propósito de
`src/department/apply/version.ts`). Un componente que no puede calcular
la prueba tampoco puede falsificarla.

**Latencia y coste.** No hay cold start apreciable y el plan gratuito
cubre este volumen de sobra (ver la sección de costes, con sus
salvedades).

Lo que se pierde, dicho sin adornos: se depende de un proveedor más
(Cloudflare), y D1 es un producto más joven que DynamoDB. Está en las
limitaciones del final.

---

## 4. Modelo de datos

Tres tablas. El DDL comentado está en
[`infra/cloudflare/schema.sql`](../infra/cloudflare/schema.sql).

### `approvals`

Una fila = una **versión concreta** de una recomendación, que es
exactamente el `changeId` de `DepartmentChangeRequest`
(`src/department/apply/change-types.ts`). El `changeId` **es** el
`approvalId`: no hay dos modelos de datos, hay uno.

| Columna | Para qué |
| --- | --- |
| `approval_id` | PK. Determinista (`<runId>#change-<rank>-v<version>`), así que crear dos veces la misma versión no duplica nada |
| `recommendation_id` | Agrupa las versiones v1, v2, v3… de una misma recomendación |
| `department_run_id` | Pasada que la generó |
| `version` | Ordena el historial de una recomendación |
| `status` | Estado de la máquina de estados. **En columna propia** |
| `record` | El `DepartmentChangeRequest` **entero** en JSON |
| `created_at` / `updated_at` | ISO 8601 |

El registro completo va como JSON en `record` porque el modelo es
profundo y anidado (`staging`, `telegram`, `humanDecision`,
`production`, `auditTrail`). Normalizarlo a columnas duplicaría el
contrato de TypeScript en el DDL y garantizaría que se desincronizaran.

`status` es la excepción, y por un motivo concreto: sobre esa columna se
resuelve la transición condicional atómica. Eso no se puede hacer contra
un campo enterrado en un blob JSON.

El `auditTrail` sigue siendo append-only **dentro** del registro: el
histórico de una aprobación no se reescribe, se le añaden entradas.
Lo que sí se sobrescribe es la fila (`updated_at`, `status`, `record`),
a diferencia del JSONL de la fase anterior, que guardaba una instantánea
por línea.

### `processed_updates`

```sql
update_id INTEGER PRIMARY KEY,
at        TEXT NOT NULL
```

Dos columnas y ningún índice extra. Es la garantía anti-replay del
webhook, explicada en la sección 6.

### `rejection_prompts`

La pregunta abierta *"¿por qué lo rechazas?"*. Correlaciona el siguiente
mensaje de texto con la aprobación que espera un motivo, por dos
caminos:

- **preferente**, por `reply_to_message_id` → índice
  `idx_rejection_prompts_message` sobre `(chat_id, prompt_message_id)`;
- **de respaldo**, por chat y usuario → índice
  `idx_rejection_prompts_open` sobre `(chat_id, user_id, closed_at)`,
  quedándose con el `created_at` más reciente.

Ninguno de los dos es único: pueden coexistir dos rechazos abiertos en
el mismo chat, y un índice único haría fallar el segundo RECHAZAR — un
error en caliente dentro del webhook, que Telegram reintentaría en
bucle.

El cierre es **blando**: `closeRejectionPrompt()` no borra la fila,
escribe `closed_at`. Las dos búsquedas filtran por `closed_at IS NULL`.
Queda así el rastro de que la pregunta se hizo y se contestó.

### Equivalencia con el código

`infra/cloudflare/schema.sql` es lo que se aplica con `wrangler`, pero
**no** es la fuente de verdad: tiene que ser equivalente a
`D1_SCHEMA_STATEMENTS` en `src/worker/d1-store.ts`, que es el único
código que consulta esta base de datos (y de donde se construye el doble
en memoria que usan los tests). Si los dos se separan, los tests pasan y
producción falla. Al escribir este documento se ha comprobado que
coinciden tabla a tabla, columna a columna e índice a índice.

---

## 5. Máquina de estados y `production_queued`

La máquina de estados no ha cambiado: sigue siendo
`src/department/apply/state-machine.ts`, fail-closed, con los mismos
invariantes que ya comprueban los tests.

```
proposed ─┬─► staging_applying ─┬─► staging_applied ─► awaiting_approval
          │                     └─► staging_validation_failed ─► staging_rolled_back
          ├─► requires_manual_staging_implementation
          └─► blocked

awaiting_approval ─┬─► approved ─► production_queued ─► production_applying ─┬─► production_applied
                   │                                                          └─► production_validation_failed
                   ├─► awaiting_rejection_reason ─► rejected                       └─► production_rolled_back
                   └─► approval_stale
```

### Por qué existe `production_queued`

Es el estado que hace segura la arquitectura serverless, y es lo único
que la máquina de estados ha ganado respecto a la fase del VPS.

En el VPS, quien recibía el botón y quien publicaba eran **el mismo
proceso**: `approved → production_applying` y a escribir. Aquí no. El
Worker recibe el botón; GitHub Actions publica. Entre los dos hace falta
un punto de sincronización, porque Telegram **reentrega** un webhook
mientras no reciba un 200, y una persona nerviosa pulsa el botón dos
veces.

`production_queued` es ese punto:

```sql
UPDATE approvals
   SET status = 'production_queued', updated_at = ?, record = ?
 WHERE approval_id = ?
   AND status = 'approved';
```

Una sola sentencia, atómica, resuelta por el motor. El Worker mira
cuántas filas cambió:

- **1 fila** → ha ganado la carrera → dispara el `workflow_dispatch`;
- **0 filas** → alguien llegó antes (o el estado ya no es `approved`) →
  responde 200 a Telegram y **no dispara nada**.

De ahí sale gratis la propiedad que importa: **como mucho un dispatch, y
por tanto como mucho un apply en producción**, sin locks, sin colas y
sin lógica de deduplicación escrita a mano.

`isProductionApplyAllowedFrom()` devuelve `true` **solo** para
`production_queued`, no para `approved`. Es decir: el workflow de
producción se niega a escribir sobre una aprobación que no haya pasado
por esa transición atómica. La regla está escrita como función propia en
el código, no como una comparación de strings suelta.

---

## 6. Idempotencia: los cuatro escenarios

Ninguno de los cuatro se resuelve con "leer, comprobar y luego
escribir". Todos se resuelven con **una sola operación atómica** cuyo
resultado (filas afectadas) es la decisión.

### a) Telegram reentrega el mismo webhook

Telegram reintenta mientras no reciba un 200: un timeout, un despliegue
a medias o un error transitorio bastan.

```sql
INSERT INTO processed_updates (update_id, at) VALUES (?, ?)
  ON CONFLICT (update_id) DO NOTHING;
```

- 1 fila escrita → primera vez → procesar;
- 0 filas → replay → responder 200 y **no hacer nada**.

Es lo primero que hace el Worker, antes de mirar siquiera de qué va el
update.

### b) Doble APPROVE (dos pulsaciones, o dos entregas simultáneas)

La transición condicional de la sección 5. Uno gana, el otro recibe
`conflict` (HTTP 409 en la API de servicio, ver `API_STATUS` en
`api-contract.ts`) y el usuario ve un mensaje del tipo *"esto ya está
encolado"* en vez de una segunda publicación.

### c) Doble dispatch

Se cubre en dos capas, a propósito:

1. El Worker solo dispara si ganó la transición a `production_queued`.
2. El workflow de producción, ya arrancado, hace su propia transición
   condicional `production_queued → production_applying`. Si pierde
   (porque otro run llegó antes), aborta sin escribir nada.

Así, incluso si GitHub duplicara el dispatch o alguien lo lanzara a mano
desde la interfaz, solo un run llega a escribir.

### d) Callback de un mensaje viejo

Alguien abre un chat de hace tres días y pulsa APROBAR sobre la v1 de
una recomendación que ya va por la v3.

Se cubre por partida doble:

- **Por estado**: cada versión tiene su propio `approvalId`. La v1 ya no
  está en `awaiting_approval` (está en `rejected`, `approval_stale` o lo
  que fuese), así que la transición condicional simplemente no ocurre.
  Los estados terminales no se reabren.
- **Por hash**: aunque el estado cuadrara, el workflow de producción
  recalcula el hash de staging antes de escribir. Si no coincide con el
  `stagingVersionHash` que se enseñó en aquel mensaje →
  `approval_stale`, no se publica nada, y hay que pedir una aprobación
  nueva (`matchesApprovedVersion()`, fail-closed: si falta cualquiera de
  los dos hashes, **no** coincide).

El Worker no puede hacer la comprobación de hash él mismo — no tiene
acceso a WordPress ni puede calcular hashes — y eso está bien: la
comprobación se hace donde hay acceso real al sistema, justo antes de
escribir, que es el único momento en que significa algo.

---

## 7. Seguridad

**Dos puertas, dos credenciales distintas.** El webhook público se
autentica con el `secret_token` de Telegram; la API de servicio, con un
bearer propio. Son valores distintos a propósito: comprometer uno no da
acceso al otro.

**`secret_token` de Telegram.** Se registra en `setWebhook` y Telegram
lo envía en la cabecera `x-telegram-bot-api-secret-token`
(`TELEGRAM_SECRET_HEADER` en `api-contract.ts`). El Worker compara y, si
no cuadra, responde y corta antes de leer el cuerpo. La URL del Worker
es pública y adivinable; esta cabecera es lo que hace que serlo no
importe.

**Usuario y chat autorizados.** Solo se aceptan decisiones del
`TELEGRAM_ALLOWED_CHAT_ID` y del `TELEGRAM_ALLOWED_USER_ID`
configurados. A un chat no autorizado **no se le responde nada**:
contestar confirmaría que el bot existe y que el id es válido. Si
Telegram no reporta autor → fail-closed, no se decide nada.

**`callback_data` solo lleva identificadores opacos.** El formato es
`dept:<accion>:<approvalId>` y ahí acaba. No viaja contenido, no viaja
el hash de versión, no viaja ningún token, y no viaja nada en lo que se
pueda confiar. Motivo: `callback_data` es un dato que vuelve **del
cliente**, y un dato que vuelve del cliente no es una fuente de verdad.

**Todo se valida contra la base de datos.** Al recibir un callback, el
Worker usa el `approvalId` únicamente para *buscar* la aprobación real
en D1, y decide con lo que hay en D1: el estado, el hash registrado, la
decisión humana previa. Lo que dijera el `callback_data` sobre el resto
del mundo es irrelevante.

**Nunca secretos en `callback_data`.** Ni ahí, ni en los mensajes, ni en
los logs. El límite de 64 bytes de `callback_data` se comprueba **antes**
de enviar el mensaje, no después.

**El Worker no tiene credenciales de WordPress.** Ya está dicho arriba,
pero es la propiedad de seguridad más importante del diseño y se repite
a conciencia.

**GitHub Actions no tiene credenciales de D1.** Habla con el Worker por
HTTPS con el bearer de servicio y nada más. Solo hay un componente con
acceso a la base de datos, y es el Worker.

---

## 8. Tabla de secretos

Sin valores. Los nombres son los de `ENV_VAR_NAMES`
(`src/approvals/api-contract.ts`) y los que ya usa el proyecto.

### Carril de aprobaciones

| SECRET | DÓNDE SE CONFIGURA | PARA QUÉ SIRVE |
| --- | --- | --- |
| `APPROVALS_API_URL` | GitHub Actions secret | URL base del Worker. Es a donde Actions manda las aprobaciones que crea |
| `APPROVALS_API_TOKEN` | GitHub Actions secret | Bearer con el que Actions se autentica ante el Worker. Mismo valor que `SERVICE_TOKEN` |
| `SERVICE_TOKEN` | `wrangler secret put` | El mismo bearer, del lado del Worker, para validarlo. Sin él, cualquiera podría crear aprobaciones |
| `TELEGRAM_WEBHOOK_SECRET` | `wrangler secret put` **y** parámetro `secret_token` de `setWebhook` | Valida que una entrega al webhook viene de Telegram y no de un tercero que adivinó la URL |
| `TELEGRAM_BOT_TOKEN` | `wrangler secret put` (y en el entorno de quien ejecuta `set-telegram-webhook.sh`) | Token del bot: enviar los mensajes de aprobación y responder a los botones |
| `TELEGRAM_ALLOWED_USER_ID` | `wrangler secret put` | Único usuario de Telegram autorizado a decidir |
| `TELEGRAM_ALLOWED_CHAT_ID` | `wrangler secret put` | Único chat autorizado |
| `GITHUB_DISPATCH_TOKEN` | `wrangler secret put` | PAT *fine-grained* (solo este repo, `Actions: read and write`) con el que el Worker dispara el workflow de producción |
| `GITHUB_REPOSITORY` | Var **no** secreta — `[vars]` de `wrangler.toml` | `owner/repo` destino del dispatch |
| `GITHUB_PRODUCTION_WORKFLOW` | Var **no** secreta — `[vars]` de `wrangler.toml` | Fichero del workflow de producción a disparar |
| `GITHUB_WORKFLOW_REF` | Var **no** secreta — `[vars]` de `wrangler.toml` | Rama sobre la que se lanza ese workflow |

### Credenciales de WordPress — solo en GitHub Actions

Ninguna de estas está en el Worker, y no debe estarlo nunca.

| SECRET | DÓNDE SE CONFIGURA | PARA QUÉ SIRVE |
| --- | --- | --- |
| `WORDPRESS_STAGING_BASE_URL` | GitHub Actions secret | Base de la API REST de staging |
| `WORDPRESS_USERNAME` | GitHub Actions secret | Usuario de staging |
| `WORDPRESS_APP_PASSWORD` | GitHub Actions secret | Application Password de staging |
| `WORDPRESS_PRODUCTION_BASE_URL` | GitHub Actions secret | Base de la API REST de producción |
| `WORDPRESS_PRODUCTION_USERNAME` | GitHub Actions secret | Usuario de producción |
| `WORDPRESS_PRODUCTION_APP_PASSWORD` | GitHub Actions secret | Application Password de producción. **La credencial más sensible del proyecto** |

### Interruptores — variables no secretas

Van como `env:` del workflow, no como secretos: su valor no es
confidencial y verlo en el fichero es justamente lo que se quiere.

| VARIABLE | DÓNDE SE CONFIGURA | PARA QUÉ SIRVE |
| --- | --- | --- |
| `DEPARTMENT_STAGING_APPLY_ENABLED` | Var no secreta (`env:` del workflow) | Habilita el apply en staging |
| `WORDPRESS_DRAFTS_ENABLED`, `WORDPRESS_BACKEND`, `WORDPRESS_ENV` | Var no secreta (`env:` del workflow) | Los otros tres interruptores que staging exige a la vez |
| `DEPARTMENT_PRODUCTION_APPLY_ENABLED` | Var no secreta (`env:` del workflow) | Habilita el apply en producción |
| `PRODUCTION_EXECUTION_ENABLED`, `PRODUCTION_DRAFTS_ENABLED`, `PRODUCTION_BACKEND` | Var no secreta (`env:` del workflow) | Los otros tres que producción exige a la vez |

Que los interruptores estén puestos **no autoriza nada por sí solo**: la
aprobación humana de la versión exacta se comprueba aparte, y ninguna de
las dos comprobaciones puede saltarse la otra. Con los interruptores
apagados una aprobación **no se pierde**: queda registrada en D1 y el
bot responde exactamente qué falta.

---

## 9. Costes

**No he podido verificar los precios ni los límites actuales de
Cloudflare al escribir este documento** (el acceso a
`developers.cloudflare.com` está bloqueado desde el entorno en el que se
redactó). Lo que sigue es un razonamiento de orden de magnitud, no una
cita de la lista de precios. **Confírmalo en
`https://developers.cloudflare.com/workers/platform/pricing/` y
`https://developers.cloudflare.com/d1/platform/pricing/` antes de dar
por buena ninguna cifra.**

El volumen real de este sistema:

| Evento | Frecuencia realista |
| --- | --- |
| Pasada del departamento | 1 al día |
| Aprobaciones creadas | unas pocas por pasada |
| Mensajes a Telegram | uno por aprobación |
| Callbacks de botones | unos pocos por aprobación |
| Dispatches a producción | como mucho uno por aprobación aprobada |

Es decir: **decenas de peticiones al día**, no miles. Y el tamaño de la
base de datos crece en unos pocos KB diarios (el `record` JSON de cada
cambio), lo que a este ritmo son megabytes al cabo de años.

Tanto Workers como D1 tienen plan gratuito, y un volumen de decenas de
peticiones diarias con una base de datos de megabytes está lejos de
cualquier umbral de facturación razonable de un plan gratuito. La
expectativa fundada es **coste cero**, pero es una expectativa, no una
comprobación.

Lo que sí conviene vigilar, porque no depende del volumen previsto:

- un webhook que empiece a fallar hace que **Telegram reintente**, y los
  reintentos también son invocaciones (aunque el Worker los descarte
  como replay);
- la tabla `processed_updates` crece monótonamente y nada la poda hoy
  (ver limitaciones).

---

## 10. Qué queda del VPS

**Para las aprobaciones, nada.**

Concretamente, quedan obsoletos para este flujo:

- **`deploy/zentry-telegram-approvals.service`** — la unit de systemd que
  mantenía vivo el receptor de Telegram por long-poll. Ya no hace falta
  ningún proceso permanente esperando: Telegram entrega por webhook.
- **`scripts/telegram-approvals-service.ts`** — el poller que ejecutaba
  esa unit.
- **`department-changes.jsonl`** (en el `data/` del cliente activo, ver
  `src/department/apply/change-registry.ts`) — el registro en
  filesystem. El estado de las aprobaciones vive ahora en D1. El fichero
  se conserva como histórico de la fase anterior; no es la fuente de
  verdad de nada nuevo.
- **Las fases `stage`, `notify`, `production` ejecutadas a mano en el
  VPS** — ahora las ejecutan workflows de GitHub Actions.

Ningún componente del carril de aprobaciones necesita ya una máquina
encendida. **En particular, ya no hay credenciales de producción de
WordPress en un VPS**: viven en los secretos de GitHub Actions y solo
existen durante el job que publica.

Si el VPS sigue en pie por otros motivos (por ejemplo el
`zentry-seo-watcher.service`), eso es independiente de este documento.
Antes de apagar la unit de aprobaciones, comprueba que no queda ninguna
aprobación viva en el registro JSONL sin migrar.

---

## 11. Limitaciones honestas

**Un proveedor más.** Si Cloudflare tiene una caída, no se pueden tomar
decisiones. El impacto real es acotado (las decisiones se retrasan, no
se pierden: Telegram reintenta y las aprobaciones siguen en D1), pero
existe.

**D1 es un producto joven.** Más que DynamoDB o Postgres. Sus límites de
tamaño, de consultas concurrentes y su modelo de replicación pueden
cambiar. No los he verificado al escribir esto.

**No hay copias de seguridad automáticas configuradas.** D1 tiene
mecanismos de recuperación, pero este proyecto no ha configurado ninguna
política. El `wrangler d1 export` está documentado en el runbook y hay
que ejecutarlo a mano. Si se pierde la base de datos, se pierde el
historial de aprobaciones y el feedback humano acumulado.

**`processed_updates` crece sin límite.** No hay poda. A este volumen
tardaría años en ser un problema, pero no está resuelto, solo aplazado.

**El `approvalId` va en el `callback_data`, con 64 bytes de límite.**
El formato es determinista (`<runId>#change-<rank>-v<version>`), así que
un `departmentRunId` largo puede no caber. La comprobación se hace antes
de enviar el mensaje, así que el fallo es visible y no silencioso — pero
es un fallo, y significa que ese cambio no se puede aprobar desde
Telegram hasta arreglarlo.

**Una sola persona autorizada.** `TELEGRAM_ALLOWED_USER_ID` es uno solo.
No hay aprobación por dos personas, ni suplente, ni delegación. Si esa
persona no está disponible, no se publica nada. Es deliberado para esta
fase, pero es una limitación real.

**El Worker no puede comprobar el hash de staging.** No tiene acceso a
WordPress. Entre que se pulsa APROBAR y que el workflow arranca hay una
ventana (segundos o minutos) en la que staging podría cambiar. La
comprobación se hace en el workflow, justo antes de escribir, que es el
único momento en que es concluyente — pero significa que el usuario
puede ver "encolado" en Telegram y luego recibir un `approval_stale`.
Es el comportamiento correcto (no publicar), no el más cómodo.

**Nada de esto está desplegado ni probado contra servicios reales.** No
se ha creado ninguna base de datos, ni desplegado ningún Worker, ni
registrado ningún webhook.

---

## 12. Suposiciones explícitas

Cosas que este documento y el IaC dan por hechas y que hay que confirmar
al desplegar. Se listan en vez de darlas por buenas en silencio:

1. **El entrypoint del Worker es `src/worker/index.ts`** y expone las
   rutas de `API_ROUTES`. Es lo que dice `main` en `wrangler.toml`. Al
   cerrar este documento existían ya `d1-store.ts`, `env.ts`,
   `webhook.ts`, `github-dispatch.ts` y `telegram-client.ts`, pero
   **todavía no `index.ts`**: lo está terminando otro trabajo en
   paralelo. Si el fichero acaba llamándose de otra forma, hay que
   cambiar `main`.
2. ~~Los nombres de columna de `schema.sql`~~ — **verificado**, ya no es
   una suposición: `schema.sql` se ha comprobado contra
   `D1_SCHEMA_STATEMENTS` de `src/worker/d1-store.ts` y produce
   exactamente las mismas tablas, columnas e índices.
3. **El workflow de producción se llama
   `department-production-apply.yml` y vive en la rama `main`.** Es lo
   que hay en `[vars]` de `wrangler.toml`. Si el fichero o la rama son
   otros, la API de GitHub devuelve 404 al disparar.
4. **`GITHUB_REPOSITORY` es `dorquita/zentry-ai-department`**, tomado del
   remoto `origin` del repositorio.
5. **`binding = "DB"`** es el nombre con el que el Worker accede a D1.
   Confirmado contra `Env` en `src/worker/env.ts`.
6. **`schema.sql` no lleva `CHECK` de estados, ni `CHECK (json_valid(record))`,
   ni la clave ajena de `rejection_prompts` hacia `approvals`.** Las tres
   se valoraron y se descartaron a propósito (el porqué está comentado en
   el propio fichero): una constraint que falla dentro del webhook
   produce un error que Telegram reintenta en bucle, y el doble en
   memoria de los tests no las aplicaría.
7. **`compatibility_date = "2026-05-01"`** es una fecha reciente elegida
   sin poder consultar el calendario de compatibilidad de Cloudflare.
   Ajústala si wrangler avisa.
8. **`wrangler` se usa vía `npx`** y no se ha añadido a `package.json`.
   No se ha fijado ninguna versión.
9. **`main` en `wrangler.toml` es `../../src/worker/index.ts`, no
   `src/worker/index.ts`.** Wrangler resuelve las rutas del fichero de
   configuración contra el directorio **de ese fichero**
   (`infra/cloudflare/`), no contra el directorio desde el que se lanza
   el comando. Con la ruta sin `../../` buscaría
   `infra/cloudflare/src/worker/index.ts`, que no existe.

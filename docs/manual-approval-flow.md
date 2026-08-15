# Flujo de aprobación manual (vigente)

Cómo se decide hoy qué cambios del departamento IA se aplican: **un email
por la mañana con las propuestas numeradas, y una conversación en Claude
Code más tarde**.

Este es el flujo **vigente**. El carril de aprobaciones por Telegram
sobre Cloudflare Workers + D1 está **implementado y probado, pero en
STANDBY**: no está desplegado ni activo. Ver
[`serverless-approvals.md`](serverless-approvals.md) y
[`telegram-approval-system.md`](telegram-approval-system.md).

---

## 1. El flujo diario

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ 07:00 UTC — GITHUB ACTIONS (zentry-ai-department-daily.yml)      │
  │                                                                  │
  │   SEO ─────────┐                                                 │
  │   Content ──────┼─▶ Growth Director ─▶ QA Reviewer ─▶ Web Eng.   │
  │   Analytics ────┘                                                │
  │                          ↓                                       │
  │   [APPLY] --phase plan   → contrato de apply de la pasada        │
  │                            (¿hay executor determinista?)         │
  │                          ↓                                       │
  │   [COORD] Daily Brief    → JSON + Markdown + step summary        │
  │                          ↓                                       │
  │   [EMAIL] Daily Brief    → PROPUESTAS NUMERADAS                  │
  │                                                                  │
  │   AQUÍ TERMINA. Escrituras en sistemas externos: NINGUNA.        │
  └──────────────────────────────────────────────────────────────────┘
                             │
                             │   (horas o días después, sin prisa)
                             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ PERSONA + CLAUDE CODE                                            │
  │                                                                  │
  │   "aprueba 1, 2 y 4; rechaza 3 porque el copy no me gusta;       │
  │    deja 5 pendiente"                                             │
  │                          ↓                                       │
  │   1. Claude INTERPRETA  → decisions.json (nº + acción)           │
  │   2. Claude MUESTRA cómo lo ha entendido (DRY-RUN por defecto)   │
  │   3. VALIDACIÓN determinista  (src/approvals/manual/decision.ts) │
  │        · número inexistente        → no se ejecuta NADA          │
  │        · rechazo sin motivo        → no se ejecuta NADA          │
  │        · nº repetido con 2 acciones→ no se ejecuta NADA          │
  │   4. nº visible → id real (changeId / recommendationId)          │
  │   5. Comprobación de versión (STALE) contra el ancla del brief   │
  │   6. Se registra la decisión (log append-only en data/)          │
  │   7. Se ejecuta SOLO lo aprobado, con --execute:                 │
  │        snapshot → escribir → validar releyendo → rollback si     │
  │        falla → verificar el rollback                             │
  │   8. SEGUNDO EMAIL con los resultados                            │
  └──────────────────────────────────────────────────────────────────┘
```

La segunda mitad la ejecuta
[`scripts/run-approval-session.ts`](../scripts/run-approval-session.ts)
(`npm run approvals:session -- --departmentRunId <id> --decisions
decisions.json`). **Es DRY-RUN por defecto**: enseña cómo ha interpretado
la decisión y no toca nada hasta que se le pasa `--execute`.

La pasada diaria **no escribe en ningún sistema externo** y **no depende
de Telegram, Cloudflare, D1 ni de `APPROVALS_API_*`**: su fase de apply
es únicamente `--phase plan` (ver el step `[APPLY] Planificar el contrato
de apply` en `.github/workflows/zentry-ai-department-daily.yml`), y esa
fase no construye ningún cliente de la API de aprobaciones.

---

## 2. La numeración: qué garantiza y qué no

Definida en [`src/approvals/manual/proposal.ts`](../src/approvals/manual/proposal.ts).

1. **El número es determinista.** Sale del `recommendationRank` de la
   pasada, no del orden en que se hayan escrito los items. Dos lecturas
   del mismo Daily Brief numeran igual.
2. **El número siempre viaja junto al id real** (`changeId` cuando ya
   existe registro; si no, `recommendationId`). El número es para la
   persona; el id es para el sistema. Nunca se ejecuta nada resolviendo
   solo por número.
3. **Se numeran TODAS las propuestas de la pasada**, también las que no
   se pueden aplicar. Si se numerasen solo las accionables, el "3" del
   email y el "3" que dice la persona podrían no ser el mismo — que es
   exactamente el fallo que ese módulo existe para impedir.

Los números **son de una pasada concreta**. El "3" del brief de hoy no es
el "3" del de ayer. Si la instrucción se da sobre un email antiguo, la
validación lo detecta en cuanto un número no existe en la pasada actual
(y si existiera, el id y la comprobación de versión son la segunda red;
ver §6).

---

## 3. Cómo dar el prompt de aprobación

Se escribe en lenguaje natural. Claude traduce esa frase a un fichero de
instrucciones `{ number, action, reason?, overrides?, target? }`, **enseña
cómo lo ha entendido** y solo después ejecuta:

```json
[
  { "number": 1, "action": "approve" },
  { "number": 3, "action": "reject", "reason": "el copy suena a folleto" },
  { "number": 4, "action": "approve", "overrides": { "title": "..." } },
  { "number": 5, "action": "defer" }
]
```

El reparto es deliberado: **Claude interpreta** (eso es razonamiento) y
**el código valida y ejecuta** (eso es determinismo, y por eso vive en
`src/approvals/manual/` con sus reglas escritas, no en la memoria del
modelo).

### Frases que funcionan

| Lo que dices | Lo que hace el sistema |
|---|---|
| `aprueba 1, 2 y 4` | Aprueba esas tres para **staging**. El resto quedan PENDIENTES, no rechazadas. |
| `rechaza 3 porque el copy suena a folleto` | Registra el rechazo con ese motivo **literal**. |
| `deja 5 pendiente` | No toca nada del 5. Es lo mismo que no decir nada, pero explícito. |
| `aprueba todas menos la 7` | Claude expande a la lista real de números de la pasada y te la enseña antes de ejecutar. |
| `para la 3 cambia el title por "Taquillas fenólicas para vestuarios" antes de aplicarla` | Aprueba la 3 con `overrides.title`. El executor escribe ese title, no el propuesto. |
| `aprueba 1 y 2, y la 4 llévala a producción` | 1 y 2 a staging; la 4 con `target: "production"`, que exige además todo lo de §5. |

Por defecto **todo va a STAGING**. Publicar en producción se pide aparte
y explícitamente (`ApprovalTarget` en
[`decision.ts`](../src/approvals/manual/decision.ts)).

### Frases que NO van a colar

Las reglas duras están en `resolveHumanDecisions()`. Es **fail-closed**:
si hay cualquier error, **no se ejecuta absolutamente nada** — ni siquiera
la parte correcta de la instrucción.

| Lo que dices | Qué pasa |
|---|---|
| `aprueba 9` (y solo hay 6 propuestas) | **Error de la instrucción entera.** No se ignora el 9: lo más probable es que estés mirando otro Daily Brief. No se ejecuta nada, tampoco lo demás que hubieras dicho. |
| `rechaza 3` (sin motivo) | **Error.** El motivo es el producto del rechazo: alimenta el feedback de las siguientes pasadas. Sin motivo, no se registra el rechazo. |
| `aprueba 2 y rechaza 2` | **Ambiguo → error.** Un mismo número con dos acciones distintas no se resuelve por su cuenta. |
| `para la 4 cámbiame el H1 y añade una FAQ` | La aprobación **no se ejecuta**: ninguna capacidad determinista de hoy sabe hacer eso. No se aplica "la parte que sí sabe": o entero o nada. Se reporta el motivo exacto y queda como trabajo manual en staging. |
| `aprueba la 5` cuando la 5 está bloqueada por QA o no tiene executor | Se registra la decisión, pero **no se ejecuta**: aprobar algo no accionable no lo hace accionable. El informe dice por qué (`notActionableReason`). |
| *(no decir nada de la 6)* | La 6 queda **PENDIENTE**. **El silencio nunca es aprobación.** |

Hoy la única capacidad de apply que existe es
`staging_published_meta_update`: **title y meta description** de una
página de staging que ya está publicada y que el sistema controla
(`src/department/apply/capability.ts`). Cualquier otra cosa —cuerpo,
H1, bloques nuevos, imágenes, páginas nuevas— no tiene executor y no se
aplica automáticamente.

---

## 4. Qué ve la persona en el email

Cada propuesta numerada lleva, según `NumberedProposal`
([`proposal.ts`](../src/approvals/manual/proposal.ts)):

| Campo | Qué es |
|---|---|
| `number` | El número visible, 1-based, estable para esa pasada. |
| `id` / `changeId` / `recommendationId` | El id real. Es lo que se ejecuta. |
| `sourceAgents` | De qué empleados viene la evidencia (origen). |
| `impact`, `confidence`, `effort` | Prioridad tal como la declaró Growth. |
| `targets`, `stagingUrl` | Páginas/componentes afectados y la URL de staging para verlo. |
| `changes[]` | **Before/after campo a campo.** El *before* dice explícitamente "actual en staging, se lee antes de aplicar": antes del apply no se ha leído la página, así que no se inventa. |
| `capability`, `capabilityReason` | Qué executor determinista hay detrás, o `ninguna` y por qué. |
| `qaStatus` | Veredicto de QA. |
| `risk` | Riesgo real derivado del estado y de la capacidad, nunca una etiqueta de marketing: `BLOQUEADA`, `SIN EXECUTOR` o `BAJO` (cambio reversible de title/meta en staging, con snapshot, validación y rollback). |
| `status` / `statusLabel` | Estado en la máquina de estados. |
| `actionable` / `notActionableReason` | Si se puede ejecutar hoy, y si no, por qué. |

Todo eso va en un bloque propio del correo —**"PROPUESTAS NUMERADAS — ESTO
ES LO QUE PUEDES APROBAR HOY"**, con el total entre paréntesis— que
aparece justo después del resumen ejecutivo, en texto plano y en HTML, y
que además dice cómo responder: *"Responde en Claude Code, en lenguaje
natural, citando los números de esta lista"*.

Lo construye
[`src/department/brief-email.ts`](../src/department/brief-email.ts), que
además nunca inventa una métrica: un dato ausente se dice ("no
reportado"), nunca se rellena con 0, y ningún valor de credencial aparece
jamás en el correo.

> **Ojo al número que se mira.** El bloque de propuestas numeradas se
> construye con `buildNumberedProposals()`, cuyo número es el **índice
> 1-based** sobre las propuestas ordenadas por `recommendationRank`. La
> sección "ESTADO DE APPLY" del mismo correo, en cambio, imprime el
> `recommendationRank` en crudo: coinciden solo si los rangos son
> contiguos desde 1. **La numeración válida para aprobar es la del bloque
> de propuestas numeradas**, porque es la que valida `decision.ts`.

---

## 5. Garantías que se mantienen

Cambiar Telegram por una conversación **no relaja ninguna garantía de
ejecución**. Todas siguen viniendo del mismo código:

- **Snapshot antes de escribir.** El executor de staging lee el estado
  previo REAL del sistema antes de tocar nada
  (`src/department/apply/staging-executor.ts`).
- **Validación releyendo.** Después de escribir se relee el estado real;
  si no coincide, se hace **rollback al snapshot y se verifica**. Si el
  rollback falla, el cambio queda `blocked` y se dice que requiere
  intervención humana inmediata: nunca se esconde el fallo.
- **Guards de entorno, asimétricos a propósito**
  (`src/department/apply/guards.ts`):
  - Staging exige `WORDPRESS_ENV=staging`,
    `DEPARTMENT_STAGING_APPLY_ENABLED=true`, `WORDPRESS_DRAFTS_ENABLED=true`
    y `WORDPRESS_BACKEND=rest`.
  - Producción exige además `DEPARTMENT_PRODUCTION_APPLY_ENABLED`,
    `PRODUCTION_EXECUTION_ENABLED`, `PRODUCTION_DRAFTS_ENABLED` y
    `PRODUCTION_BACKEND=rest`.
  - El adaptador de WordPress vuelve a comprobar lo suyo por su cuenta:
    defensa en profundidad, no sustitución.
- **Executors deterministas.** Claude razona y propone; **nunca ejecuta
  código sobre WordPress**. El catálogo de capacidades decide si una
  propuesta se traduce en una operación permitida, y el executor de
  TypeScript ejecuta solo esa operación.
- **Máquina de estados fail-closed**
  (`src/department/apply/state-machine.ts`): una transición no declarada
  es un error. `staging_applied` **no tiene ninguna arista a
  producción**; el único origen de `production_applying` es
  `production_queued`, y a él solo se llega desde `approved`, al que solo
  se llega con una decisión humana explícita. Los estados terminales
  (`rejected`, `approval_stale`, `*_rolled_back`, `blocked`) no se
  reabren: una versión nueva es un cambio nuevo con su propia aprobación.
- **Destino de producción inequívoco.** Una sola página publicada cuyo
  slug coincide exactamente con el de staging. Cero o varias
  coincidencias → `blocked`. Nunca se adivina.
- **Audit trail.** Toda transición del registro de aprobaciones lleva
  `audit: { event, detail }` y se aplica en la misma operación atómica
  que el cambio de estado (`src/approvals/store.ts`). Además, cada pasada
  deja su directorio completo (`manifest.json`, `promotion.json`,
  `apply-summary.json`, Daily Brief y coste por empleado) como artifact
  con 90 días de retención.

---

## 6. STALE: una aprobación es de UNA versión

Es la defensa anti-TOCTOU, y sigue vigente igual que antes
(`src/department/apply/version.ts` +
`src/approvals/version-compare.ts`).

Entre el email de la mañana y la conversación de la tarde pueden pasar
horas o días. En ese hueco staging puede cambiar: otro agente, una
edición manual en wp-admin, una versión nueva de la propuesta. Si eso
pasa, **la aprobación ya no se refiere a lo que la persona vio**.

Por eso cada versión de una página tiene un **hash determinista de su
contenido real** (status + title + meta + cuerpo, normalizado de forma
tolerante al reformateo de WordPress pero no al contenido). Se guarda
cuando se muestra la propuesta y se recalcula al ir a ejecutar. Si no
coinciden → **`approval_stale`, no se publica nada** y hace falta una
aprobación nueva sobre la versión nueva.

El **ancla** se registra en la pasada de la mañana: el step `[APPLY]
--phase plan` lee (SOLO lectura) la página objetivo de cada propuesta y
guarda su hash en la trazabilidad del item. Por eso ese step recibe las
credenciales de staging y ningún interruptor de escritura.

Y si no hay ancla, no se finge que la hay: la sesión de aprobación
**se niega a ejecutar** salvo que se le pase `--allow-unverified` de forma
explícita, y en ese caso dice literalmente que la deriva desde el Daily
Brief no se ha podido verificar. Preferimos no poder verificar y decirlo,
a fingir que verificamos.

Dos consecuencias prácticas del mismo principio:

- **La aprobación va atada a la versión exacta que se vio en el Daily
  Brief.** Si la página cambió desde entonces, no se ejecuta
  automáticamente aunque digas "aprueba 3".
- **`aprueba 1-6` nunca aprueba recomendaciones creadas DESPUÉS de ese
  brief.** Los números se resuelven contra las propuestas de *esa*
  pasada, y cada decisión se comprueba contra su id y su versión. Una
  recomendación nacida en una pasada posterior no está en esa lista, y
  por tanto no entra en el rango.

---

## 7. Qué pasa con los rechazos

El motivo **es** el producto del rechazo. Por eso sin motivo no hay
rechazo registrado (§3).

Lo que se hace con él (`src/approvals/manual/decision-store.ts` +
`src/approvals/human-feedback-context.ts`):

1. **Se guarda literal**, entre comillas, con su fecha y la versión sobre
   la que se decidió. No se resume, no se parafrasea, no se "traduce".
   El registro es un log **append-only** en el `data/` del cliente activo
   (`department-human-decisions.jsonl`), que se versiona con el
   repositorio: por eso la pasada de mañana, que corre en un runner
   limpio de GitHub Actions, puede leer los rechazos de hoy. Nunca se
   borra ni se reescribe una línea.
2. **Entra en `previousHumanFeedback[]`** como contexto de las siguientes
   pasadas: los empleados lo leen en su prompt como evidencia de una
   decisión humana anterior, no como una orden.
3. **No se convierte en una regla global.** Si escribes "el H1 es
   demasiado genérico", el empleado lee exactamente eso — no una regla
   inventada como "preferir H1 específicos".
4. **No hay entrenamiento.** Nada aprende de esto automáticamente.

Se conservan como máximo los 5 motivos más recientes por recomendación
(`MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION`): un prompt no es un archivo
histórico. Las entradas sin texto real se descartan.

---

## 8. El segundo email

Al terminar la ejecución de lo aprobado se envía un **segundo correo**,
distinto del Daily Brief de la mañana, con:

- **TRABAJOS REALIZADOS** — qué se aplicó de verdad, con número, id,
  página, before/after real (ya leído del sistema), resultado de la
  validación y del rollback si lo hubo.
- **PENDIENTES** — lo que quedó sin decidir (silencio) y lo aprobado que
  **no se pudo ejecutar**, con el motivo exacto: sin capacidad, bloqueado
  por QA, `approval_stale`, guard apagado.
- **RECHAZADAS + motivo** — el motivo literal, tal como se escribió.
- **NUEVAS RECOMENDACIONES** — lo que haya surgido durante la ejecución.
- **Escrituras en STAGING** y **escrituras en PRODUCCIÓN**, contadas por
  separado y de forma explícita (cero es un dato, y se dice).
- **Costes** de la pasada y **run IDs** de GitHub Actions implicados.

> **Pendiente.** La sesión de aprobación ya deja todo lo que ese correo
> necesita en `approval-session.json`, dentro del directorio de la pasada:
> `outcomes[]` (número, id, título, acción, destino, estado, before/after,
> validación, rollback, motivo de rechazo), `pending[]` y la
> `interpretation` con la que se ejecutó. Lo que **no** existe todavía es
> el render y el envío de ese segundo correo: hoy el único script de
> correo del departamento es
> [`scripts/send-department-daily-brief-email.ts`](../scripts/send-department-daily-brief-email.ts)
> (`npm run department:email`), que renderiza el **Daily Brief**.
> Reutilizará el mismo mailer y la misma resolución fail-closed de
> configuración, pero es trabajo pendiente.

---

## 9. Secretos: qué hace falta y qué ya no

### Obligatorios para la pasada diaria (email de la mañana)

| Variable | Para qué |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` | Invocar a los seis empleados Claude. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `REPORT_EMAIL_FROM` | Enviar el correo. |
| `DAILY_BRIEF_EMAIL_TO` (o, como alternativa, `REPORT_EMAIL_TO`) | Destinatario. |

Si falta cualquiera, **no se envía nada** y el log dice qué **nombres**
de variables faltan — nunca sus valores
(`src/department/email-config.ts`).

### Obligatorios solo para ejecutar cambios (paso manual)

| Variable | Para qué |
|---|---|
| `WORDPRESS_STAGING_BASE_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` | Escribir en staging. |
| `DEPARTMENT_STAGING_APPLY_ENABLED`, `WORDPRESS_DRAFTS_ENABLED`, `WORDPRESS_BACKEND`, `WORDPRESS_ENV` | Los cuatro interruptores de staging. |
| `WORDPRESS_PRODUCTION_*` + `DEPARTMENT_PRODUCTION_APPLY_ENABLED`, `PRODUCTION_EXECUTION_ENABLED`, `PRODUCTION_DRAFTS_ENABLED`, `PRODUCTION_BACKEND` | Solo si se publica en producción. |

### Ya NO son obligatorios

Con el carril serverless en standby (`SERVERLESS_APPROVALS_ENABLED`
en `false`), pasan a **opcionales**:

- `APPROVALS_API_URL`, `APPROVALS_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_ALLOWED_CHAT_ID`,
  `TELEGRAM_APPROVALS_ENABLED`
- Todo lo de Cloudflare (`wrangler`, D1, `GITHUB_PRODUCTION_WORKFLOW`)

Si no existen, **la pasada diaria funciona exactamente igual y el email
se envía igual**: `--phase plan` no construye ningún cliente de la API de
aprobaciones.

El flag vive en
[`src/approvals/feature-flag.ts`](../src/approvals/feature-flag.ts)
(`SERVERLESS_APPROVALS_ENABLED`, **`false` por defecto**). Con el flag
apagado, las fases del carril serverless (`stage`, `notify` de
`department:apply`) **se niegan a correr y dicen por qué**, en vez de
fallar en silencio o degradarse a "no hago nada". La ejecución del flujo
manual no pasa por ellas: va por
`scripts/run-approval-session.ts`, que persiste en el log local de
decisiones y no construye ningún cliente de la API de aprobaciones.

---

## 10. Estado real de la implementación

Este documento describe el flujo **decidido**. Algunas de sus piezas ya
corren y otras se están cableando en esta misma rama; conviene no
confundirlas. Estado en el momento de escribirlo:

| Pieza | Estado |
|---|---|
| Pasada diaria sin dependencias cloud (`--phase plan` + email) | En el workflow, funcionando. |
| Ancla de versión de cada página objetivo en el `plan` (solo lectura) | Implementada. |
| Numeración determinista de propuestas (`src/approvals/manual/proposal.ts`) | Implementada. |
| Validación de decisiones humanas (`src/approvals/manual/decision.ts`) | Implementada. |
| Sesión de aprobación manual (`scripts/run-approval-session.ts`), dry-run por defecto | Implementada. |
| Registro append-only de decisiones (`decision-store.ts`) | Implementado. |
| Flag `SERVERLESS_APPROVALS_ENABLED` (`feature-flag.ts`), `false` por defecto | Implementado. |
| Máquina de estados, guards, executors, versionado, audit trail | Implementados y en uso. |
| Bloque de propuestas numeradas dentro del email (`brief-email.ts` usando `proposal.ts`) | Implementado, en texto plano y en HTML. |
| **Segundo email** con los resultados de la sesión | Pendiente: la sesión deja `approval-session.json` en el directorio de la pasada, pero no envía correo. |
| Carril serverless (Worker + D1 + webhook) | Implementado y probado, **en standby**: no desplegado, no activo. |

Si al leer esto una fila ya no cuadra con el repositorio, manda el
repositorio: la tabla se actualiza a mano.

---

## Ver también

- [`serverless-approvals.md`](serverless-approvals.md) — arquitectura del
  carril en standby.
- [`telegram-approval-system.md`](telegram-approval-system.md) — flujo
  staging-first, capacidades y anti-TOCTOU (vigentes).
- [`department-apply.md`](department-apply.md) — contrato de apply.
- [`department-daily-brief-email.md`](department-daily-brief-email.md) —
  el correo de la mañana.

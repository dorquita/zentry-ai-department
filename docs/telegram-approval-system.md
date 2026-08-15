# Telegram Approval System + Staging-First Apply

> ## ⏸ La parte de APROBACIONES POR TELEGRAM esta en STANDBY
>
> **Ningun boton de Telegram esta activo.** Ni el poller del VPS de la
> primera fase, ni el Worker de Cloudflare + D1 que lo sustituyo: ese
> carril serverless esta **implementado y probado, pero NO desplegado ni
> activo**, y requiere `SERVERLESS_APPROVALS_ENABLED=true` mas la
> infraestructura del runbook
> ([`infra/cloudflare/README.md`](../infra/cloudflare/README.md)).
> Mientras el flag este en `false` no hace falta ninguna infraestructura
> cloud. El codigo se conserva a proposito para retomarlo.
>
> **Como se aprueba hoy:
> [`docs/manual-approval-flow.md`](manual-approval-flow.md)** — email
> diario con las propuestas numeradas, y la decision se da despues por
> prompt en Claude Code ("aprueba 1, 2 y 4; rechaza 3 porque...").
>
> **Lo que SIGUE VIGENTE de este documento**, sin cambios y en uso: el
> flujo staging-first, la maquina de estados, las capacidades de apply,
> los executors deterministas, el anti-TOCTOU por hash de version, los
> guards de entorno y el audit trail. La decision humana entra por otro
> sitio; lo que ocurre despues de ella es exactamente esto.
>
> Arquitectura del carril en standby:
> [`docs/serverless-approvals.md`](serverless-approvals.md).

Documento de referencia del flujo operativo por el que un cambio del
departamento IA llega desde una recomendacion hasta produccion.

## 1. El flujo

```
AI Department
    v
Growth  ->  QA  ->  Web Engineer
    v
APPLY AUTOMATICO A STAGING        (sin aprobacion humana previa)
    v
VALIDACION                        (releyendo staging)
    v
TELEGRAM
    v
[ ✅ APROBAR ]   [ ❌ RECHAZAR ]   [ 👁 VER CAMBIOS ]

APROBAR  -> APPLY PRODUCCION -> VALIDACION -> rollback si falla
RECHAZAR -> motivo obligatorio -> feedback persistente -> estado rejected
```

### Regla fundamental: NO se usan borradores

Los cambios aprobables se publican directamente en **STAGING**, sobre
paginas que ya estan publicadas. Motivo: desde el movil hay que poder
abrir una URL normal y ver el cambio. Un borrador de WordPress no es
revisable asi, y lo que no es revisable no es aprobable.

De ahi la asimetria deliberada entre entornos:

| | Staging | Produccion |
| --- | --- | --- |
| Que es | Entorno de trabajo y revision | Zona protegida |
| Aprobacion humana previa | **No** | **Siempre**, explicita |
| Snapshot previo | Si | Si |
| Validacion posterior | Si | Si |
| Rollback verificado | Si | Si |
| Audit trail | Si | Si |

Staging **no** se bloquea por requerir aprobacion humana: es
deliberadamente nuestro entorno de trabajo. Produccion **nunca** se toca
sin ella.

## 2. Maquina de estados

`src/department/apply/state-machine.ts`. Fail-closed: una transicion que
no este declarada explicitamente es un error, nunca un "pasa igual".

```
proposed
  -> staging_applying -> staging_applied -> awaiting_approval
                      -> staging_validation_failed -> staging_rolled_back
  -> requires_manual_staging_implementation
  -> blocked

awaiting_approval -> approved                -> production_applying -> production_applied
                  -> awaiting_rejection_reason -> rejected                                -> production_validation_failed
                  -> approval_stale                                                       -> production_rolled_back
```

Invariantes que los tests comprueban explicitamente:

- El **unico** origen de `production_applying` es `approved`. No existe
  ningun camino desde `staging_applied` (ni desde un QA en PASS) hasta
  produccion que no pase por la arista humana `awaiting_approval ->
  approved`. El test lo demuestra cortando esa arista y comprobando que
  produccion deja de ser alcanzable.
- Los estados terminales (`rejected`, `approval_stale`,
  `production_applied`, `production_rolled_back`, `staging_rolled_back`,
  `blocked`, `requires_manual_staging_implementation`) no se reabren. Una
  version nueva es un **cambio nuevo**, con su propia aprobacion.
- Una validacion fallida solo puede acabar en rollback o en bloqueo,
  nunca en "aplicado".

## 3. Trazabilidad

Cada cambio es un objeto con la cadena completa:

```
departmentRunId
  -> recommendationId
    -> stagingChangeId   (staging::<changeId>)
      -> telegramApprovalId + telegramMessageId
        -> humanDecision (quien, cuando, y el motivo si es un rechazo)
          -> productionApplyId (production::<changeId>)
```

Vive en `data/department-changes.jsonl`, log **append-only** de
instantaneas (mismo patron que `approval-requests.jsonl` y el resto de
registros del proyecto). El estado actual de un cambio es su instantanea
mas reciente; ninguna linea se borra ni se reescribe.

## 4. Persistencia: por que NO en el runner de CI

GitHub Actions genera el trabajo del departamento, pero el estado de una
aprobacion no puede depender del filesystem efimero del runner: una
solicitud enviada desde ahi generaria una aprobacion que nadie podria
completar, porque el registro desaparece con el runner.

Por eso:

- El workflow diario ejecuta **solo** `--phase plan` (no escribe nada, no
  crea registros, no envia nada).
- Las fases `stage`, `notify` y `production` corren donde el proyecto es
  persistente: el VPS, junto al servicio permanente de Telegram
  (`deploy/zentry-telegram-approvals.service`).

Una aprobacion sobrevive a: reinicio del VPS, cierre de Claude, final del
workflow, reinicio del bot y al paso de dias.

## 5. Anti-TOCTOU: la aprobacion es de UNA version

Entre que se envia el mensaje y alguien pulsa APROBAR pueden pasar horas
o dias. Si staging cambia en ese hueco, la aprobacion ya no se refiere a
lo que la persona vio.

Cada version de la pagina tiene un hash determinista de su contenido real
(`status + title + meta + cuerpo`, ver `version.ts`). Ese hash se guarda
al enviar el mensaje y se recalcula al recibir la aprobacion:

- coinciden -> se publica;
- no coinciden, o no se puede releer staging -> `approval_stale`, no se
  publica **nada** y hay que pedir una aprobacion nueva.

La comprobacion se hace **dos veces**: en el handler de Telegram y otra
vez dentro del executor de produccion, justo antes de escribir.

## 6. Los tres botones

### ✅ APROBAR

1. Autorizacion (chat, y usuario si `TELEGRAM_USER_ID` esta configurado).
2. Precondiciones: el cambio esta en `awaiting_approval`, no esta ya
   aprobado (doble aprobacion -> idempotente, no republica) ni rechazado,
   y la solicitud no ha caducado (72 h).
3. Comprobacion anti-TOCTOU.
4. Se registra la decision humana (quien, cuando) y se sincroniza el
   registro comun de aprobaciones del proyecto.
5. Publicacion en produccion: snapshot -> escribir -> validar releyendo
   -> rollback si falla -> verificar el rollback.
6. Telegram informa del resultado real:
   - `✅ CAMBIO PUBLICADO` + URL, o
   - `🚨 PUBLICACION FALLIDA` + si el rollback se ejecuto correctamente,
     o `REQUIERE INTERVENCION HUMANA INMEDIATA` si el rollback fallo.

Nunca se esconde un fallo.

### ❌ RECHAZAR

No basta con `status=rejected`. El bot responde **"Indicame el motivo del
rechazo"** y el cambio entra en `awaiting_rejection_reason`, un estado
persistente. El siguiente mensaje de ese chat se guarda como
`rejectionReason` junto con `rejectedBy` y `rejectedAt`, y solo entonces
el cambio pasa a `rejected`.

Un motivo vacio (o de menos de 3 caracteres) no cierra el rechazo: se
sigue esperando.

El motivo queda disponible para las siguientes ejecuciones de los agentes
(`inheritedFeedback` + el registro de feedback humano del proyecto), de
forma que la propuesta v2 sepa que se rechazo de v1 y **por que**.

### 👁 VER CAMBIOS

Responde con datos reales del apply, nunca reconstruidos:

- URL exacta de staging y `page_id`;
- before -> after campo a campo, incluidos los campos que **no** han
  cambiado (se declaran, no se ocultan);
- resultado de la validacion y hash de la version aprobable;
- recordatorio de que produccion no se ha tocado.

Ademas, cuando hay URL de staging, el mensaje incluye un boton-URL
directo para abrirla de un toque desde el movil.

## 7. Seguridad de Telegram

- Solo se aceptan decisiones del **chat autorizado**. A un chat no
  autorizado no se le responde nada (contestar confirmaria que el id
  existe).
- Si `TELEGRAM_USER_ID` esta configurado, ademas se exige que el
  **user id** coincida. Si esta configurado y Telegram no reporta autor
  -> fail-closed.
- `callback_data` propio (`dept:approve|reject|view:<approvalRequestId>`)
  que no colisiona con el flujo historico (`appr:`), y se comprueba que
  cabe en el limite de 64 bytes **antes** de enviar el mensaje.
- Callback de un mensaje viejo (solicitud caducada) -> `approval_stale`.
- Doble aprobacion -> idempotente, no se vuelve a publicar.
- Aprobacion de una version ya sustituida -> no aplica: cada version
  tiene su propio `changeId` y su propia solicitud.
- Nunca se muestran secretos (el gateway ya sanitiza y redacta).

## 8. Capacidades de apply

Claude **razona y propone**. El executor de TypeScript ejecuta unicamente
operaciones permitidas. Nunca se ejecuta codigo arbitrario contra
WordPress.

Capacidad soportada hoy, una sola y explicita:

| Capacidad | Que hace | Executor |
| --- | --- | --- |
| `staging_published_meta_update` | title y/o meta description de una pagina de staging **ya publicada** y propia del sistema | `updateStagingPublishedPageContent()` (verifica `status === "publish"`, nunca cambia status ni slug) |

Para que una propuesta sea ejecutable, la especificacion de web-engineer
debe cumplir **las dos** condiciones:

1. citar EXACTAMENTE una pagina del catalogo (`page_id=<N>` o su URL
   exacta de staging);
2. declarar el contenido nuevo en lineas propias:

   ```
   TITLE: <nuevo title>
   META: <nueva meta description>
   ```

Cualquier ambiguedad -> `requires_manual_staging_implementation` con el
motivo exacto. Nunca "se intenta a ver si cuela".

El destino de **produccion** se resuelve por slug: exactamente una pagina
publicada cuyo slug coincida de forma exacta con el de staging. Cero o
varias coincidencias -> `blocked`. No se adivina el destino de una
escritura en produccion.

## 9. Interruptores de entorno

Staging (los cuatro a la vez):

| Variable | Valor requerido |
| --- | --- |
| `DEPARTMENT_STAGING_APPLY_ENABLED` | `true` |
| `WORDPRESS_DRAFTS_ENABLED` | `true` |
| `WORDPRESS_BACKEND` | `rest` |
| `WORDPRESS_ENV` | `staging` |

Produccion (los cuatro a la vez, **ademas** de la aprobacion humana):

| Variable | Valor requerido |
| --- | --- |
| `DEPARTMENT_PRODUCTION_APPLY_ENABLED` | `true` |
| `PRODUCTION_EXECUTION_ENABLED` | `true` |
| `PRODUCTION_DRAFTS_ENABLED` | `true` |
| `PRODUCTION_BACKEND` | `rest` |

Que los interruptores esten puestos **no** autoriza nada por si solo: la
aprobacion humana de la version exacta se comprueba aparte, y ninguna de
las dos comprobaciones puede saltarse la otra. Con los interruptores
apagados, una aprobacion **no se pierde**: queda registrada y el bot
responde exactamente que falta.

Opcional: `TELEGRAM_USER_ID` (capa adicional de autorizacion).

## 10. Comandos

```bash
# En CI (o donde sea): planificar, sin escribir nada
npm run department:apply -- --phase plan --departmentRunId <runId>

# En el VPS (persistente):
npm run department:apply -- --phase stage      --departmentRunId <runId>
npm run department:apply -- --phase notify     --departmentRunId <runId>
npm run department:apply -- --phase production --departmentRunId <runId>
npm run department:apply -- --phase sync       --departmentRunId <runId>

# Estado del registro persistente
npm run department:changes:list
npm run department:changes:list -- --status awaiting_approval
npm run department:changes:list -- --changeId <changeId> --verbose
```

La fase `production` tambien se dispara sola al pulsar ✅ APROBAR en
Telegram, a traves del servicio permanente
(`deploy/zentry-telegram-approvals.service`). El comando manual existe
para poder reintentar o diagnosticar desde el VPS.

## 11. Daily Brief y email

El **Daily Brief** muestra cada cambio con su etiqueta operativa:
`STAGING READY`, `AWAITING APPROVAL`, `APPROVED`, `REJECTED`,
`PRODUCTION APPLIED`, `REQUIRES MANUAL STAGING IMPLEMENTATION`... con la
URL de staging, la de produccion si se publico, y el motivo del rechazo
cuando lo hay.

El **email** diario sigue mostrando las prioridades, pero la aprobacion
no se hace por email en esta fase: cuando hay cambios listos, el email
dice cuantos estan *"listos para revisar en Telegram"* y remite alli.
Telegram es el canal OPERATIVO de aprobacion.

## 12. Que NO hace este sistema

- No usa borradores de WordPress en este flujo.
- No crea, publica, despublica, borra ni restaura paginas.
- No cambia slugs.
- No toca WooCommerce, formularios, precios ni checkout.
- No toca Google Ads, GA4/GTM, Search Console ni n8n.
- No reutiliza una aprobacion vieja para una version nueva.
- No publica en produccion sin aprobacion humana explicita de la version
  exacta que hay en staging.

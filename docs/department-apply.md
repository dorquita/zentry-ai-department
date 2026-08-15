# APPLY del departamento (EMAIL + SCHEDULE + APPLY)

Fase en la que la pasada coordinada deja de ser solo READ / ANALYZE /
PROPOSE y **puede** llegar a ejecutar un cambio real — con una cadena de
condiciones que no se relaja en ningun punto.

```
SEO / Content / Analytics
        ↓
Growth Director
        ↓
QA Reviewer            <- "es suficientemente valida para PROPONERSE"
        ↓
Web Engineer           <- especificacion tecnica
        ↓
APROBACION HUMANA      <- "Pau ha dicho que si"   (NUNCA lo dice QA)
        ↓
capacidad soportada    <- existe un executor determinista y reversible
        ↓
interruptores          <- DEPARTMENT_APPLY_ENABLED + los 3 de WordPress
        ↓
snapshot → apply → validacion → rollback si falla
```

**QA PASS no es una aprobacion.** Es la regla central de esta fase y esta
escrita en el codigo (`src/department/apply/plan.ts`), en el contrato
(`src/department/apply/types.ts`) y verificada por tests
(`test/department-apply-approval.test.ts`).

## Contrato de apply

Un elemento por recomendacion de la pasada, en
`reports/department/<departmentRunId>/apply-summary.json`
(`DepartmentApplyItem`):

| Campo | Que es |
|---|---|
| `applyItemId` | `<departmentRunId>#apply-<rank>` — determinista, estable entre replanificaciones. |
| `recommendationId` | `<departmentRunId>#rec-<rank>` — trazabilidad a la prioridad de Growth. |
| `sourceAgents` | Empleados de los que procede la evidencia citada. |
| `evidenceRefs` | Refs literales de la recomendacion. |
| `qaStatus` | Veredicto de QA. **No** es una aprobacion. |
| `webEngineerSpecification` | Los cambios de web-engineer atribuidos a esta recomendacion. |
| `humanApproval` | `none` / `pending` / `approved` / `rejected` / `unknown` + quien y cuando. |
| `applyCapability` | Si existe executor determinista, cual, y con que parametros ya resueltos. |
| `applyStatus` | Ver estados abajo. |
| `validationStatus` | `not_run` / `passed` / `failed`. |
| `rollbackStatus` | `not_needed` / `rolled_back` / `rollback_failed`. |
| `snapshot` | Estado previo REAL leido justo antes de escribir. |
| `auditTrail` | Rastro completo: `planned`, `snapshot_taken`, `applied`, `validated`, `validation_failed`, `rolled_back`, `rollback_failed`... |

### Estados

| Estado | Significado |
|---|---|
| `proposed` | Construido, sin resolver todavia. |
| `awaiting_approval` | Hay executor, **falta** aprobacion humana. |
| `approved` | Aprobacion humana explicita y vigente + executor. Unico estado que entra al executor. |
| `rejected` | Un humano dijo que no. |
| `applying` | Transitorio, persistido antes de tocar nada. |
| `applied` | Aplicado **y** validado. |
| `validation_failed` | Se aplico pero la validacion posterior fallo → dispara rollback. |
| `rolled_back` | Revertido y **verificado** contra el snapshot. |
| `requires_manual_implementation` | No existe executor determinista y seguro para esto. |
| `blocked` | Fail-closed: QA bloqueo, aprobacion indeterminada, o rollback fallido (critico). |

## La puerta de aprobacion reutiliza el sistema que ya existe

No hay un segundo sistema de aprobaciones. Se usa el registro de siempre
(`data/approval-requests.jsonl`, `src/core/approval-requests.ts`) con un
tipo nuevo `department_apply_item` y `relatedId = <applyItemId>`, con el
mismo patron **sin cascada** que `change_pack` y `staging_execution`:
responder no ejecuta nada, solo desbloquea que el executor lo intente.

Responder desde el CLI:

```bash
npm run approvals:list -- --relatedType department_apply_item --status pending
npm run approvals:update -- --approvalRequestId <id> --answer approved   # o rejected / snoozed
```

O desde Telegram (`approve <id>` / `reject <id>`), igual que el resto.

Fail-closed en todas las direcciones (`src/department/apply/approval.ts`):

- sin solicitud → `none`; `pending`/`snoozed` → `pending`; `rejected` /
  `cancelled` / `expired` → `rejected`.
- `approved` **caducada** (>72 h, misma ventana que el receptor de
  Telegram) → deja de valer.
- `approved` sin `answeredBy` → `unknown` → `blocked`.
- dos solicitudes para el mismo elemento → `unknown` → `blocked`.

## Que puede ejecutar APPLY hoy

**Una sola capacidad**, a proposito: `staging_draft_meta_update` —
actualizar `title` y/o meta description de una pagina que **ya existe
como borrador en staging** y que **ya pertenece a este sistema** (esta en
`data/staging-executions.jsonl` con status `applied_to_staging`).

Es reversible, no crea nada nuevo, y se apoya en un executor que ya
existia: `updateWordpressDraftPage()` (`src/adapters/wordpress.ts`), que
exige `WORDPRESS_DRAFTS_ENABLED=true`, llama a
`assertWordpressWriteAllowed()` (**produccion bloqueada de forma
incondicional**) y relee la pagina para rechazar escribir si su status no
es `draft`.

Para que una propuesta sea ejecutable, la especificacion de web-engineer
tiene que cumplir **las dos** condiciones (`src/department/apply/capability.ts`):

1. citar **exactamente una** pagina del catalogo, sin ambiguedad
   (`page_id=<N>` o la URL exacta del borrador);
2. declarar el contenido nuevo en lineas propias, en formato maquina:

   ```
   TITLE: <nuevo title>
   META: <nueva meta description>
   ```

Cualquier ambiguedad (ninguna pagina, varias, pagina ajena, sin valores
nuevos, valores desproporcionados) → `requires_manual_implementation` con
el motivo exacto. Es deliberadamente dificil de satisfacer por accidente:
el coste de un falso positivo aqui es escribir en un sitio real.

**Limitacion conocida de esta primera version:** `web-engineer` todavia no
recibe el catalogo de paginas de staging en su contexto ni se le pide ese
bloque `TITLE:`/`META:`, asi que en la practica sus propuestas salen como
`requires_manual_implementation` salvo que la especificacion las cite a
mano. El puente (catalogo en el contexto + instruccion aditiva al agente)
es el siguiente paso natural, y se ha dejado fuera de esta fase a
proposito para no cambiar el comportamiento de un empleado que ya
funciona.

## Ejecutar

```bash
# 1. Planificar (NO escribe en ningun sistema externo)
npm run department:apply -- --phase plan --departmentRunId <id>

# 2. Ejecutar SOLO lo que tenga aprobacion humana explicita y vigente
npm run department:apply -- --phase apply --departmentRunId <id>
```

La fase `apply` no hace nada salvo que **los cuatro** interruptores esten
bien a la vez:

| Variable | Valor exigido |
|---|---|
| `DEPARTMENT_APPLY_ENABLED` | `true` |
| `WORDPRESS_DRAFTS_ENABLED` | `true` |
| `WORDPRESS_BACKEND` | `rest` |
| `WORDPRESS_ENV` | `staging` (`production` esta bloqueado sin excepcion) |

Y aun asi, cada elemento sigue necesitando su propia aprobacion humana.

### Creacion de las solicitudes de aprobacion

`--phase plan` solo crea solicitudes si
`DEPARTMENT_APPLY_APPROVAL_REQUESTS_ENABLED=true`. Apagado por defecto y
**apagado en GitHub Actions** a proposito: el registro de aprobaciones es
persistente donde vive el proyecto de verdad; crear solicitudes en un
checkout efimero generaria peticiones que nadie podria responder porque
desaparecen con el runner. Con el interruptor apagado, los elementos se
quedan en `awaiting_approval` diciendo exactamente eso.

## Que hace (y que no hace) el workflow diario

`.github/workflows/zentry-ai-department-daily.yml` **solo planifica**
(`--phase plan`). La fase que escribe no se invoca desde ahi, y el
workflow no recibe ninguna credencial de WordPress. Verificado por test
(`test/department-coordination-safety.test.ts`).

## Seguridad

- Claude no llega al executor: recibe parametros ya resueltos por el
  registro de capacidades y no puede ampliar su propio alcance.
- El executor recibe sus dependencias **inyectadas**
  (`src/department/apply/executor.ts`), asi que es testeable sin red; el
  unico sitio de todo el sistema que cablea el adaptador real de
  WordPress para el apply es `scripts/run-department-apply.ts`, y solo con
  dos funciones: leer una pagina y actualizar un borrador.
- Nunca se escribe sin snapshot previo; nunca se afirma "aplicado" sin
  releer el estado real; nunca se afirma "revertido" sin verificar el
  rollback.
- Un rollback fallido deja el elemento en `blocked` con una entrada
  `rollback_failed` marcada como CRITICO, y el sistema no vuelve a tocar
  esa pagina.

# Approval Queue — gestion del Action Backlog

Ver tambien `docs/action-backlog.md` (que es una accion, formato del
fichero, estados),
`docs/autonomy-policy.md` (Fase O7: que se auto-procesa/auto-aprueba sin
intervencion humana y por que) y
`departments/web-growth/agents/approval-queue.agent.md` (spec del agente).

## Estados (Fase O7)

| Status | Quien lo decide | Significa |
|---|---|---|
| `new` | Sistema (raro tras O7) | Primera vez que se detecta y todavia sin clasificar por la politica de autonomia. |
| `open` | Sistema (raro tras O7) | Recurrente, todavia sin clasificar. |
| `auto_processed` | Politica de autonomia (`AUTO_INTERNAL`) | Mecanica interna del sistema, no una recomendacion sobre la que decidir. |
| `auto_approved_for_planning` | Politica de autonomia (`AUTO_PLAN`) | SEO/contenido/CRO/SEM/Analytics/competencia de riesgo bajo/medio — se convierte en work order sin esperar aprobacion humana. |
| `waiting_approval` | Politica de autonomia (`HUMAN_APPROVAL_REQUIRED`) o un humano manualmente | Tocaria produccion real si se ejecutara, o es un tipo de accion no reconocido (fallback seguro). |
| `approved` | Un humano (`actions:update`) | Un humano acepta explicitamente trabajar esta accion. |
| `rejected` | Un humano | Descartada. |
| `snoozed` | Un humano | Aplazada. |
| `blocked` | Politica de autonomia (`FORBIDDEN`) | Nunca automatico; necesita decision explicita fuera de este sistema. |
| `done` | Un humano | Ya ejecutada (fuera de este sistema). |

**Ninguno de estos estados implica ejecucion real**, incluidos los
automaticos de la Fase O7. Ver `docs/autonomy-policy.md` para el detalle
completo de que decide cada nivel y como cambiarlo.

## Listar acciones

```bash
npm run actions:list
npm run actions:list -- --status open
npm run actions:list -- --status auto_approved_for_planning
npm run actions:list -- --status waiting_approval
npm run actions:list -- --status blocked
npm run actions:list -- --priority high
npm run actions:list -- --brand zentry
npm run actions:list -- --keyword taquillas
npm run actions:list -- --autonomyLevel AUTO_PLAN
npm run actions:list -- --requiresApproval true
npm run actions:list -- --status open --priority high --limit 10
```

Filtros combinables: `--status`, `--priority` (`high`/`medium`/`low`),
`--brand` (`zentry`/`tukandado`/`both`/`none`), `--keyword` (substring,
sin distinguir mayusculas), `--autonomyLevel`
(`AUTO_INTERNAL`/`AUTO_PLAN`/`AUTO_DRAFT`/`HUMAN_APPROVAL_REQUIRED`/`FORBIDDEN`),
`--requiresApproval` (`true`/`false`), `--limit`.

## Aprobar / rechazar / snoozear manualmente

Solo hace falta para acciones `waiting_approval` (las que la politica de
autonomia no pudo auto-aprobar para planificacion). Las
`auto_approved_for_planning` y `auto_processed` **no** necesitan este
paso.

```bash
npm run actions:update -- --actionId <id> --status approved
npm run actions:update -- --actionId <id> --status rejected --reason "no aplica esta semana"
npm run actions:update -- --actionId <id> --status snoozed
npm run actions:update -- --actionId <id> --status waiting_approval
npm run actions:update -- --actionId <id> --status done
```

- `--actionId` es obligatorio (usa `actions:list` para encontrarlo).
- `--status` debe ser uno de los estados de la tabla de arriba. Cualquier
  otro valor falla con un error claro, sin tocar nada.
- `--reason` es opcional, se guarda en el log de auditoria.
- `--by` es opcional (por defecto `"cli"`), identifica quien hizo el
  cambio en el log de auditoria.

## Que NO hace el sistema aunque una accion este `approved` o `auto_approved_for_planning`

- **No publica nada en WordPress.**
- **No activa ninguna campana de Google Ads, no cambia presupuesto, no
  crea keywords ni anuncios.**
- **No modifica GA4 ni GTM.**
- **No toca n8n ni qdrant.**
- **No envia ningun email comercial ni ejecuta ninguna accion externa.**

`approved`/`auto_approved_for_planning` son exclusivamente senales
locales de que se puede trabajar esa accion (con o sin humano segun la
politica de autonomia). La ejecucion real (editar la pagina en
WordPress, crear la keyword en Ads, etc.) sigue siendo un paso manual,
fuera de este sistema, hasta que se implemente explicitamente un modo
`APPLY` con aprobacion por tarea — que no existe hoy.

## Auditoria

Cada cambio de estado (via `actions:update`, o via `upsertAction` cuando
una accion sin decidir vuelve a detectarse y la politica de autonomia la
reclasifica — ver `docs/autonomy-policy.md`) puede consultarse en
`data/action-audit.jsonl`:

```json
{
  "auditId": "uuid",
  "actionId": "uuid de la accion",
  "previousStatus": "new",
  "newStatus": "approved",
  "reason": "opcional",
  "changedBy": "cli",
  "changedAt": "2026-08-03T..."
}
```

## El agente Approval Queue

`npm run approval:queue` ejecuta el agente suelto (usa el
`departmentRunId` mas reciente si no se le pasa uno). Lee los eventos
`recommendation_created`/`competitor_keyword_detected` de esa pasada,
los convierte en acciones del backlog aplicando la politica de autonomia,
y escribe `reports/approval-queue/approval-queue-<fecha>.md` con las
secciones: auto-procesadas, auto-aprobadas para planificacion,
pendientes de aprobacion (esta pasada), bloqueadas (esta pasada),
aprobadas por humano sin ejecutar, snoozed, rechazadas, ya hechas.

Dentro del pase diario (`npm run growth:daily`), Approval Queue corre
**antes** que Growth Director — asi el informe final ya refleja el
backlog actualizado del dia (ver nota en
`scripts/run-daily-growth-department.ts`).

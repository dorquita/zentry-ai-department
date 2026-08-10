# De accion aprobada a work order

Guia rapida de comandos. Ver `docs/action-backlog.md` (que es una
accion) y `docs/work-orders.md` (que es una work order, formato
completo, categorias) para el detalle.

## 1. Ver que acciones estan pendientes de decidir

```bash
npm run actions:list -- --status open
npm run actions:list -- --status new
```

## 2. Aprobar una accion

```bash
npm run actions:update -- --actionId <id> --status approved
```

Esto **no** crea la work order todavia — eso lo hace el Approved Action
Planner en la siguiente pasada (`npm run growth:daily`, o suelto con
`npm run approved-actions:plan`).

## 3. Generar la work order (manual, sin esperar al pase diario)

```bash
npm run approved-actions:plan   # crea el borrador (draft), categorizado
npm run work-orders:seo         # amplia las de categoria SEO
npm run work-orders:content     # amplia las de categoria contenido
npm run work-orders:cro         # amplia las de categoria CRO
```

## 4. Revisar las work orders listas

```bash
npm run work-orders:list -- --status ready_for_review
npm run work-orders:list -- --targetBrand zentry --status ready_for_review
```

## 5. Decidir sobre una work order

```bash
npm run work-orders:update -- --workOrderId <id> --status approved_to_prepare
npm run work-orders:update -- --workOrderId <id> --status rejected --reason "..."
```

**`approved_to_prepare` no publica nada.** Solo es la senal de que Pau
quiere que se prepare esa propuesta con mas detalle o se pase a
ejecucion manual fuera de este sistema.

## Que NO hace el sistema en ningun paso de este flujo

- No publica ni crea borradores en WordPress.
- No activa campanas de Google Ads ni cambia presupuesto.
- No modifica GA4 ni GTM.
- No toca n8n ni qdrant.
- No envia ningun email comercial.

## Como se mantiene la seguridad

- Cada paso (accion -> work order -> decision) queda registrado en
  ficheros append-only (`data/action-backlog.jsonl`,
  `data/action-audit.jsonl`, `data/work-orders.jsonl`,
  `data/work-order-audit.jsonl`) — nunca se borra ni se reescribe
  historico.
- Los comandos `*:update` validan el status contra la lista de estados
  validos antes de escribir nada.
- Ningun comando de este sistema llama a una API externa de escritura.

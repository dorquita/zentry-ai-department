# WordPress Draft Agent

## Por que existe

Change Packs dio a Pau paquetes de cambio concretos (pasos de
implementacion, checklist, riesgos, notas de reversion) pensados para el
dia en que exista ejecucion controlada. Esta fase es ese primer paso de
ejecucion, pero deliberadamente limitado al minimo posible: convertir un
change pack ya revisado en un **borrador de WordPress**, nunca en una
publicacion. El resultado sigue siendo algo que un humano tiene que
revisar y publicar manualmente — el agente solo ahorra el trabajo de
copiar/pegar el contenido propuesto dentro de WordPress.

Ver `docs/wordpress-safety-policy.md` para el detalle completo de que
esto NUNCA hace.

## Los dos niveles de resultado

| Nivel | Cuando se genera | Llama a WordPress |
|---|---|---|
| **Preview local** | Siempre que un change pack esta `ready_for_review` o `approved_to_execute` y todavia no tiene draft | Nunca |
| **Borrador real en WordPress** | Solo si se cumplen las 5 condiciones de `docs/wordpress-safety-policy.md` | Si — creando una pagina nueva en `status: draft`, **solo en staging** |

Desde la Fase O10.5, cual de las dos implementaciones de "borrador real"
se usaria (si algun dia se activa) se elige con `WORDPRESS_BACKEND`
(`local_preview` por defecto, `rest` implementado, `mcp` solo un
skeleton) — ver `docs/wordpress-mcp-adapter.md`. Desde la Fase O10.6, a
que SITIO apuntaria esa escritura se elige con `WORDPRESS_ENV`
(`staging` por defecto y unico destino permitido, `production`
bloqueado de forma incondicional) — ver
`docs/wordpress-safety-policy.md`, seccion "Staging vs Produccion".

Un preview local es un fichero markdown en
`reports/wordpress-drafts/previews/<draftId>.md` con el mismo contenido
que tendria el borrador: titulo propuesto, meta description, H1/H2, copy
propuesto, FAQs, CTA, enlaces internos, mas las instrucciones de
implementacion y el checklist humano que ya traia el change pack.

## De donde saca el contenido de cada preview

Reutiliza el `proposedChanges` que ya genero el Work Order Builder
correspondiente (Fase O6) y que el Change Pack Builder ya reempaqueto —
nunca redacta nada nuevo. La forma exacta depende del `changeType`:

| `changeType` | Campos de origen |
|---|---|
| `seo_on_page_update` | `proposedTitle`, `proposedMetaDescription`, `proposedH1`, `suggestedH2s`, `copyBlock`, `suggestedFaqs`, `suggestedInternalLinks` |
| `new_content_page` / `content_update` | `recommendedTitle`, `structure`, `recommendedCta`, `internalLinks`, `clusterNote` (brief de contenido, no copy final — se marca explicitamente como pendiente de redaccion) |
| `cro_conversion_update` | `newCta`, `ctaPlacement`, `trustBlock`, `faqSection`, `visualImprovements` (sin titulo/H1/meta: es un cambio de conversion sobre una pagina existente, no una pagina nueva) |

## Deduplicacion

Un draft se deduplica por `changePackId`: un change pack nunca tiene mas
de un draft activo. Si el change pack se vuelve a ver en una pasada
posterior, el draft existente solo se "toca" (`updatedAt` fresco) — no se
regenera el preview ya escrito ni se crea un segundo draft.

## El camino hacia un borrador real, paso a paso

0. `WORDPRESS_ENV=staging` (el valor por defecto). Si algun dia esto
   fuera `production`, el paso 4 lanzaria un error incondicional antes de
   tocar la red — ver `docs/wordpress-safety-policy.md`, seccion
   "Staging vs Produccion".
1. El change pack pasa a `approved_to_execute`
   (`npm run change-packs:update -- --changePackId <id> --status approved_to_execute`).
2. En la siguiente pasada del WordPress Draft Agent, si
   `WORDPRESS_DRAFTS_ENABLED=true`, el agente crea una solicitud de
   aprobacion (`relatedType: "change_pack"`) y la envia por Telegram (si
   `TELEGRAM_APPROVALS_ENABLED=true`). No crea nada mas en esa pasada.
3. Pau responde por Telegram (o via
   `npm run approvals:update -- --approvalRequestId <id> --answer approved`).
   Esta respuesta **no cascada** ningun cambio de estado (a diferencia de
   una solicitud de tipo `action`/`work_order`) — solo queda registrada.
4. En la siguiente pasada, el agente ve la solicitud `approved` y crea el
   borrador real en WordPress **staging** (`status: draft`). El draft
   pasa de `local_preview` a `wp_draft_created`, con `wordpressDraftId` y
   `wordpressDraftUrl` rellenos (la URL sera de
   `staging.zentrylockers.com`, nunca de produccion).
5. Un humano entra en staging, revisa el borrador, y decide si lo aplica
   manualmente en produccion (fuera de este sistema — no hay ningun flujo
   automatico de staging a produccion). Este agente no hace nada mas a
   partir de aqui.

Si la respuesta es `rejected`, el draft pasa a `rejected` y no se crea
nada en WordPress.

## Formato de `data/wordpress-drafts.jsonl`

Log append-only de instantaneas, mismo patron que
`change-packs.jsonl`/`approval-requests.jsonl`.

```json
{
  "draftId": "uuid",
  "changePackId": "uuid del change pack origen",
  "workOrderId": "uuid heredado del change pack",
  "targetBrand": "zentry",
  "page": "https://zentrylockers.com/taquillas-melamina/",
  "keyword": "taquillas de melamina",
  "draftType": "seo_on_page_update",
  "status": "local_preview",
  "localPreviewPath": "reports/wordpress-drafts/previews/<draftId>.md",
  "wordpressDraftId": null,
  "wordpressDraftUrl": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Estados

```
local_preview -> wp_draft_created
              \-> rejected
              \-> superseded
              \-> manually_applied
```

| Estado | Significa |
|---|---|
| `local_preview` | Preview generado, nada llamado a WordPress todavia. |
| `wp_draft_created` | Borrador real creado en WordPress, `status: draft`, sin publicar. |
| `rejected` | La solicitud de Telegram para crear el borrador real se rechazo. |
| `superseded` | Reservado para uso manual futuro (p.ej. un draft mas reciente lo reemplaza). |
| `manually_applied` | Alguien aplico el contenido fuera de este flujo y lo registra aqui manualmente. |

## Comandos

```bash
npm run wordpress:drafts
npm run wordpress-drafts:list
npm run wordpress-drafts:list -- --status local_preview
npm run wordpress-drafts:list -- --status wp_draft_created
npm run wordpress-drafts:list -- --targetBrand zentry
npm run wordpress-drafts:list -- --changePackId <id>
```

No existe un `wordpress-drafts:update` (a diferencia de `change-packs:update`):
la unica forma de mover un draft entre estados es a traves del flujo de
aprobacion de Telegram descrito arriba (`npm run approvals:update`), para
que quede siempre trazado por que se creo (o se rechazo) cada borrador
real.

## Como se integra en el pase diario

Dentro de `npm run growth:daily` (19 pasos totales), corre justo despues
de los 3 Change Pack Builders y antes de Approval Gateway y Growth
Director — para que, cuando Growth Director consolide el informe del
dia, los previews/borradores de hoy ya existan. Ver
`docs/daily-growth-report.md`.

## Donde aparece en los informes

- **Informe tecnico** (`reports/daily/technical-<fecha>.md`): seccion
  "WordPress Draft Agent" con `WORDPRESS_DRAFTS_ENABLED`, total de
  previews/borradores, nuevos de hoy y pendientes de aprobacion.
- **Informe ejecutivo** (`reports/daily/executive-<fecha>.md`, el que se
  envia por email): dos lineas agregadas en "Estado de ejecucion"
  (previews preparados, y borradores reales creados o "creacion
  desactivada") — igual criterio que Change Packs, sin listar drafts
  individuales.
- El agente ademas escribe su propio informe detallado en
  `reports/wordpress-drafts/wordpress-drafts-<fecha>.md`, que desde la
  Fase O10.6 incluye tambien `WORDPRESS_ENV` y el destino resuelto
  (staging o produccion) en la cabecera. El informe tecnico de Growth
  Director no se ha modificado en esta fase — sigue mostrando solo
  `WORDPRESS_DRAFTS_ENABLED` y totales agregados.

## Seguridad

Ver `docs/wordpress-safety-policy.md` para el detalle completo, y
`docs/wordpress-mcp-adapter.md` para el diagnostico de MCP Novamira y por
que `WORDPRESS_BACKEND=mcp` todavia no esta implementado.

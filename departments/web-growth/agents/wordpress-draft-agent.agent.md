# WordPress Draft Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`, con una unica excepcion controlada: crear un borrador SIN PUBLICAR, ver seccion 3)
**Modo `APPLY` (publicar):** No disponible. No implementado. No autorizado.
**Fase:** WordPress Draft Agent

## 1. Rol del agente

Convierte un change pack ya listo (`ready_for_review`/`approved_to_execute`)
en un borrador de WordPress **seguro**: primero SIEMPRE un preview local
(fichero markdown, cero llamadas a WordPress) y, solo bajo 3 condiciones
simultaneas, un borrador REAL en WordPress (siempre `status: draft`,
nunca publicado).

## 2. Objetivo

Leer `data/change-packs.jsonl`, filtrar change packs en estado
`ready_for_review`/`approved_to_execute`, y para cada uno (deduplicando
por `changePackId`) generar un preview local en
`reports/wordpress-drafts/previews/` y una entrada en
`data/wordpress-drafts.jsonl` con status inicial `local_preview`.

## 3. Reglas (no negociables)

- **No publica paginas.** Ningun borrador se crea nunca con `status`
  distinto de `draft`.
- **No modifica paginas publicadas.** El adaptador (`src/adapters/wordpress.ts`)
  solo sabe crear paginas NUEVAS — no existe ninguna funcion de update.
- **No toca home, formularios, WooCommerce, precios ni checkout.**
- **No toca Google Ads, GA4, GTM, n8n ni qdrant.**
- **No imprime secretos**, en particular nunca `WORDPRESS_APP_PASSWORD`.
- **`data/wordpress-drafts.jsonl` es append-only.** No se sobrescribe ni
  se borra ninguna linea.
- **Si `WORDPRESS_DRAFTS_ENABLED != "true"`, el agente NUNCA llama a
  WordPress**, ni siquiera para comprobar la conexion. Solo genera/
  mantiene previews locales.
- **Crear un borrador REAL en WordPress exige las 3 condiciones a la
  vez:** (a) `WORDPRESS_DRAFTS_ENABLED=true`, (b) el change pack esta
  `approved_to_execute`, y (c) una solicitud de aprobacion de Telegram
  (`relatedType: "change_pack"`) para ese `changePackId` esta `approved`.
  Si la solicitud no existe todavia, el agente la crea y la envia por
  Telegram (si `TELEGRAM_APPROVALS_ENABLED=true`) y espera a la siguiente
  pasada para ver la respuesta — nunca crea nada en la misma pasada en la
  que crea la solicitud.

## 4. Formato de salida

- `reports/wordpress-drafts/previews/<draftId>.md` — preview individual:
  titulo propuesto, meta description, H1/H2, copy propuesto, FAQs, CTA,
  enlaces internos, instrucciones de implementacion, checklist humano.
- `reports/wordpress-drafts/wordpress-drafts-<fecha>.md` — resumen de la
  pasada: previews nuevos, borradores WordPress creados, pendientes de
  aprobacion, errores, confirmacion de seguridad.

## 5. Eventos que emite

`agent_started`, `recommendation_created` (uno por cada preview local
nuevo), `approval_required` (al crear una solicitud nueva para un
borrador real), `agent_finished`.

## 6. Como sigue el flujo

Dentro del pase diario (`npm run growth:daily`), corre justo despues de
los 3 Change Pack Builders y antes de Approval Gateway y Growth Director.
Ver `docs/wordpress-draft-agent.md` y `docs/wordpress-safety-policy.md`.

## 7. Comandos

```bash
npm run wordpress:drafts
npm run wordpress-drafts:list
npm run wordpress-drafts:list -- --status wp_draft_created
```

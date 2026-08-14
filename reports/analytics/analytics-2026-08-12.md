# Analytics Watcher — 2026-08-12

- **departmentRunId:** `growth-department-2026-08-12T080051Z`
- **Generado:** 2026-08-12T08:01:24.356Z
- **GA4 conectado:** no
- **GTM conectado:** no

## Resumen ejecutivo

No hay credenciales de GA4 ni GTM configuradas en este proyecto (o la lectura real fallo, ver Warnings). Este informe documenta los eventos clave esperados y propone validaciones manuales — no es una lectura real de GA4/GTM.

## Eventos clave que deberian existir en GA4 (documentado, no verificado en vivo)

| Evento | Descripcion | Validacion propuesta |
|---|---|---|
| `generate_lead_form_submit` | Envio de formulario de contacto/presupuesto. | Verificar en GA4 DebugView que se dispara al enviar CUALQUIER formulario de contacto del sitio (Zentry y Tukandado), no solo uno. |
| `click_whatsapp` | Clic en boton/enlace de WhatsApp. | Verificar que el evento incluye la pagina de origen para poder atribuir el lead a la landing correcta. |
| `click_phone` | Clic en numero de telefono (tel:). | Verificar que dispara tanto en movil como en escritorio (en escritorio a veces el enlace tel: no es clicable visualmente). |
| `click_request_quote` | Clic en CTA de "solicitar presupuesto" (distinto de un envio de formulario completado). | Verificar que se distingue de generate_lead_form_submit — uno es intencion (clic en CTA), el otro es conversion completa (formulario enviado). |
| `click_catalog_download` | Clic en enlace/boton de descarga de catalogo. | Verificar que el evento incluye la pagina de origen y, si hay varios catalogos (Zentry/Tukandado), que se puede distinguir cual se descargo. |
| `view_quote_page` | Vista de la pagina de solicitud de presupuesto (/solicitar-presupuesto/). | Verificar que se dispara solo en esa pagina y que precede logicamente a generate_lead_form_submit/click_request_quote en el funnel. |
| `view_contact_page` | Vista de la pagina de contacto. | Verificar que se distingue de view_quote_page — una es la pagina de contacto general, la otra es la de presupuesto. |

## Validaciones de tracking propuestas

- [ ] Confirmar en GA4 (DebugView o Realtime) que cada evento clave de la tabla anterior se dispara correctamente.
- [ ] Confirmar que los eventos distinguen Zentry de Tukandado si ambas marcas comparten el mismo GA4/GTM.
- [ ] Confirmar que `generate_lead_form_submit` esta marcado como evento de conversion (key event) en GA4.
- [ ] Si existe la campana de Google Ads (ver informe de SEM Watcher), confirmar el enlace GA4 <-> Google Ads antes de activarla.

## Warnings

- Hay credenciales de GA4 pero la lectura real fallo: Lectura de GA4 fallo: invalid_grant.
- Hay credenciales de GTM pero la lectura real fallo: Lectura de GTM fallo: invalid_grant.

## Confirmacion de seguridad

- No se ha modificado GA4 ni GTM.
- No se ha publicado ninguna version de contenedor GTM.
- Este agente solo leyo documentacion/config local y propone validaciones manuales.

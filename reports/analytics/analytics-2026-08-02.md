# Analytics Watcher — 2026-08-02

- **departmentRunId:** `growth-department-2026-08-02T221453Z`
- **Generado:** 2026-08-02T22:15:22.583Z
- **GA4 conectado:** no
- **GTM conectado:** no

## Resumen ejecutivo

No hay credenciales de GA4 ni GTM configuradas en este proyecto (ver `.env.example`). Este informe documenta los eventos clave esperados y propone validaciones manuales — no es una lectura real de GA4/GTM.

## Eventos clave que deberian existir en GA4

| Evento | Descripcion | Validacion propuesta |
|---|---|---|
| `generate_lead_form_submit` | Envio de formulario de contacto/presupuesto. | Verificar en GA4 DebugView que se dispara al enviar CUALQUIER formulario de contacto del sitio (Zentry y Tukandado), no solo uno. |
| `click_whatsapp` | Clic en boton/enlace de WhatsApp. | Verificar que el evento incluye la pagina de origen para poder atribuir el lead a la landing correcta. |
| `click_phone` | Clic en numero de telefono (tel:). | Verificar que dispara tanto en movil como en escritorio (en escritorio a veces el enlace tel: no es clicable visualmente). |
| `click_request_quote` | Clic en CTA de "solicitar presupuesto" (distinto de un envio de formulario completado). | Verificar que se distingue de generate_lead_form_submit — uno es intencion (clic en CTA), el otro es conversion completa (formulario enviado). |

## Validaciones de tracking propuestas

- [ ] Confirmar en GA4 (DebugView o Realtime) que cada evento clave de la tabla anterior se dispara correctamente.
- [ ] Confirmar que los eventos distinguen Zentry de Tukandado si ambas marcas comparten el mismo GA4/GTM.
- [ ] Confirmar que `generate_lead_form_submit` esta marcado como evento de conversion (key event) en GA4.
- [ ] Si existe la campana de Google Ads (ver informe de SEM Watcher), confirmar el enlace GA4 <-> Google Ads antes de activarla.

## Warnings

- Sin credenciales de GA4 (GA4_PROPERTY_ID, GA4_OAUTH_CLIENT_ID, GA4_OAUTH_CLIENT_SECRET, GA4_OAUTH_REFRESH_TOKEN). Se salta la lectura real de GA4.
- Sin credenciales de GTM (GTM_CONTAINER_ID, GTM_OAUTH_CLIENT_ID, GTM_OAUTH_CLIENT_SECRET, GTM_OAUTH_REFRESH_TOKEN). Se salta la lectura real de GTM.

## Confirmacion de seguridad

- No se ha modificado GA4 ni GTM.
- Este agente solo lee documentacion/config local y propone validaciones manuales.

# Analytics Watcher — 2026-08-09

- **departmentRunId:** `growth-department-2026-08-09T080059Z`
- **Generado:** 2026-08-09T08:01:40.296Z
- **GA4 conectado:** si
- **GTM conectado:** si

## Resumen ejecutivo

GA4: lectura real completada. GTM: lectura real completada. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.

## GA4 — Trafico por canal (2026-07-11 a 2026-08-08)

| Canal | Sesiones | Usuarios activos | Conversiones |
|---|---|---|---|
| Direct | 62 | 35 | 26 |
| Unassigned | 9 | 3 | 0 |
| Organic Search | 5 | 5 | 4 |
| AI Assistant | 3 | 3 | 0 |

## GA4 — Landing pages principales

| Landing page | Sesiones | Conversiones | Bounce rate |
|---|---|---|---|
| / | 38 | 24 | 44.7% |
|  | 6 | 0 | 100.0% |
| /bancos-de-vestuario | 4 | 1 | 25.0% |
| /cerraduras-inteligentes-taquillas | 4 | 1 | 25.0% |
| /cerraduras | 3 | 2 | 33.3% |
| /configurador-bancos | 3 | 0 | 100.0% |
| /digitalizacion-taquillas | 3 | 0 | 66.7% |
| (not set) | 2 | 0 | 50.0% |
| /taquillas-para-colegios | 2 | 0 | 50.0% |
| /aviso-legal | 1 | 0 | 100.0% |
| /cerraduras-para-taquillas | 1 | 0 | 100.0% |
| /contacto | 1 | 0 | 100.0% |
| /cookies | 1 | 0 | 100.0% |
| /privacidad | 1 | 0 | 100.0% |
| /product-category/bancos-de-vestuario | 1 | 1 | 0.0% |

## GA4 — Eventos clave (comparado contra lo esperado)

| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |
|---|---|---|---|
| `generate_lead_form_submit` | si | 2 | 2 |
| `click_whatsapp` | si | 2 | 2 |
| `click_phone` | NO | 0 | 0 |
| `click_request_quote` | si | 26 | 26 |
| `click_catalog_download` | si | 2 | 0 |
| `view_quote_page` | si | 10 | 0 |
| `view_contact_page` | si | 16 | 0 |

## GA4 — Fuentes / medios principales

| Fuente | Medio | Sesiones | Conversiones |
|---|---|---|---|
| (direct) | (none) | 62 | 26 |
| (not set) | (not set) | 9 | 0 |
| google | organic | 4 | 4 |
| chatgpt.com | ai-assistant | 3 | 0 |
| duckduckgo | organic | 1 | 0 |

## GTM — Estado del contenedor

- **Contenedor:** www.zentrylockers.com (GTM-MSPSGLK5, id interno 257386510)
- **Workspace:** Default Workspace (id 4)
- **Version live:** GA4 events + conversion tracking v1 (id 3)
- **Tags:** 8 — **Triggers:** 7 — **Variables:** 0

### Tags (hasta 30)

| Tag | Tipo | Pausado |
|---|---|---|
| GA4 Event - click_whatsapp | gaawe | no |
| Google Tag - GA4 - Zentry | googtag | no |
| GA4 Event - generate_lead_form_submit | gaawe | no |
| GA4 Event - click_phone | gaawe | no |
| GA4 Event - click_catalog_download | gaawe | no |
| GA4 Event - click_request_quote | gaawe | no |
| GA4 Event - view_quote_page | gaawe | no |
| GA4 Event - view_contact_page | gaawe | no |

### Triggers (hasta 30)

| Trigger | Tipo |
|---|---|
| click_phone | linkClick |
| /solicitar-presupuesto/ | linkClick |
| click_whatsapp | linkClick |
| Vista de una página - /gracias | pageview |
| click_catalog_download | linkClick |
| Page Path equals /solicitar-presupuesto/ | pageview |
| visita contacto | pageview |

### Variables (hasta 30)

Sin variables.

**Recordatorio:** este agente NUNCA publica una version de contenedor ni modifica ningun tag/trigger/variable.

## Validaciones de tracking propuestas

- [ ] Confirmar en GA4 (DebugView o Realtime) que cada evento clave de la tabla anterior se dispara correctamente.
- [ ] Confirmar que los eventos distinguen Zentry de Tukandado si ambas marcas comparten el mismo GA4/GTM.
- [ ] Confirmar que `generate_lead_form_submit` esta marcado como evento de conversion (key event) en GA4.
- [ ] Si existe la campana de Google Ads (ver informe de SEM Watcher), confirmar el enlace GA4 <-> Google Ads antes de activarla.

## Confirmacion de seguridad

- No se ha modificado GA4 ni GTM.
- No se ha publicado ninguna version de contenedor GTM.
- Este agente leyo GA4/GTM en modo solo lectura y propone; no existe ninguna llamada de escritura en estos adaptadores.

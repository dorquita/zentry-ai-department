# Analytics Watcher — 2026-08-07

- **departmentRunId:** `growth-department-2026-08-07T080030Z`
- **Generado:** 2026-08-07T08:01:09.660Z
- **GA4 conectado:** si
- **GTM conectado:** si

## Resumen ejecutivo

GA4: lectura real completada. GTM: lectura real completada. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.

## GA4 — Trafico por canal (2026-07-09 a 2026-08-06)

| Canal | Sesiones | Usuarios activos | Conversiones |
|---|---|---|---|
| Direct | 43 | 29 | 12 |
| Unassigned | 12 | 6 | 7 |
| Organic Search | 8 | 6 | 11 |
| AI Assistant | 3 | 3 | 0 |

## GA4 — Landing pages principales

| Landing page | Sesiones | Conversiones | Bounce rate |
|---|---|---|---|
| / | 32 | 8 | 65.6% |
|  | 9 | 3 | 100.0% |
| /cerraduras-inteligentes-taquillas | 4 | 1 | 25.0% |
| /taquillas-fenolicas | 4 | 9 | 75.0% |
| (not set) | 2 | 0 | 50.0% |
| /cerraduras | 2 | 2 | 0.0% |
| /contacto | 2 | 0 | 100.0% |
| /taquillas-para-colegios | 2 | 0 | 50.0% |
| /aviso-legal | 1 | 0 | 100.0% |
| /cookies | 1 | 0 | 100.0% |
| /digitalizacion-taquillas | 1 | 0 | 100.0% |
| /product/banco-vestuario-melamina | 1 | 0 | 100.0% |
| /product/taquilla-2-puertas-modulo-1-metalica | 1 | 0 | 100.0% |
| /solicitar-presupuesto | 1 | 1 | 0.0% |
| /soluciones | 1 | 0 | 100.0% |

## GA4 — Eventos clave (comparado contra lo esperado)

| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |
|---|---|---|---|
| `generate_lead_form_submit` | si | 3 | 3 |
| `click_whatsapp` | si | 3 | 3 |
| `click_phone` | NO | 0 | 0 |
| `click_request_quote` | si | 24 | 24 |
| `click_catalog_download` | si | 3 | 0 |
| `view_quote_page` | si | 12 | 0 |
| `view_contact_page` | si | 14 | 0 |

## GA4 — Fuentes / medios principales

| Fuente | Medio | Sesiones | Conversiones |
|---|---|---|---|
| (direct) | (none) | 43 | 12 |
| (not set) | (not set) | 12 | 7 |
| google | organic | 7 | 11 |
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

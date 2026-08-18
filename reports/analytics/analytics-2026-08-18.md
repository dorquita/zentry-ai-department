# Analytics Watcher — 2026-08-18

- **departmentRunId:** `dept-2026-08-18T012804Z`
- **Generado:** 2026-08-18T01:28:25.253Z
- **GA4 conectado:** si
- **GTM conectado:** si

## Resumen ejecutivo

GA4: lectura real completada. GTM: lectura real completada. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.

## GA4 — Trafico por canal (2026-07-20 a 2026-08-17)

| Canal | Sesiones | Usuarios activos | Conversiones |
|---|---|---|---|
| Direct | 172 | 68 | 81 |
| Organic Search | 8 | 6 | 3 |
| Referral | 3 | 1 | 2 |
| AI Assistant | 2 | 2 | 0 |
| Unassigned | 1 | 1 | 1 |

## GA4 — Landing pages principales

| Landing page | Sesiones | Conversiones | Bounce rate |
|---|---|---|---|
| / | 115 | 59 | 31.3% |
| /configurador-bancos | 10 | 6 | 10.0% |
| /configurador-taquillas | 6 | 1 | 0.0% |
| (not set) | 4 | 2 | 50.0% |
| /bancos-de-vestuario | 4 | 2 | 0.0% |
| /cerraduras-inteligentes-taquillas | 4 | 1 | 25.0% |
| /cerraduras-para-taquillas | 4 | 0 | 50.0% |
| /product/taquilla-2-puertas-modulo-1-melamina | 4 | 11 | 25.0% |
| /taquillas-metalicas | 4 | 0 | 25.0% |
| /digitalizacion-taquillas | 3 | 0 | 66.7% |
| /taquillas-para-colegios | 3 | 0 | 33.3% |
| /taquillas-para-empresas | 3 | 0 | 66.7% |
| /cookies | 2 | 0 | 50.0% |
| /product/taquilla-1-puertas-modulo-1-melamina | 2 | 0 | 0.0% |
| /product/taquilla-2-puertas-modulo-1-metalica | 2 | 0 | 50.0% |

## GA4 — Eventos clave (comparado contra lo esperado)

| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |
|---|---|---|---|
| `generate_lead_form_submit` | si | 6 | 6 |
| `click_whatsapp` | si | 15 | 15 |
| `click_phone` | NO | 0 | 0 |
| `click_request_quote` | si | 66 | 66 |
| `click_catalog_download` | si | 4 | 0 |
| `view_quote_page` | si | 12 | 0 |
| `view_contact_page` | si | 39 | 0 |

## GA4 — Fuentes / medios principales

| Fuente | Medio | Sesiones | Conversiones |
|---|---|---|---|
| (direct) | (none) | 172 | 81 |
| google | organic | 7 | 3 |
| tagassistant.google.com | referral | 3 | 2 |
| chatgpt.com | ai-assistant | 2 | 0 |
| (not set) | (not set) | 1 | 1 |
| duckduckgo | organic | 1 | 0 |

## GTM — Estado del contenedor

- **Contenedor:** www.zentrylockers.com (GTM-MSPSGLK5, id interno 257386510)
- **Workspace:** Default Workspace (id 4)
- **Version live:** O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau) (id 5)
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

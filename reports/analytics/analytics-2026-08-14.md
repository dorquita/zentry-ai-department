# Analytics Watcher — 2026-08-14

- **departmentRunId:** `growth-department-2026-08-14T111247Z`
- **Generado:** 2026-08-14T11:13:33.727Z
- **GA4 conectado:** si
- **GTM conectado:** si

## Resumen ejecutivo

GA4: lectura real completada. GTM: lectura real completada. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.

## GA4 — Trafico por canal (2026-07-16 a 2026-08-13)

| Canal | Sesiones | Usuarios activos | Conversiones |
|---|---|---|---|
| Direct | 142 | 61 | 67 |
| Organic Search | 5 | 5 | 3 |
| AI Assistant | 2 | 2 | 0 |

## GA4 — Landing pages principales

| Landing page | Sesiones | Conversiones | Bounce rate |
|---|---|---|---|
| / | 87 | 53 | 25.3% |
| /configurador-bancos | 10 | 6 | 10.0% |
| /configurador-taquillas | 6 | 1 | 0.0% |
| (not set) | 4 | 2 | 50.0% |
| /bancos-de-vestuario | 4 | 2 | 0.0% |
| /cerraduras-inteligentes-taquillas | 4 | 1 | 25.0% |
| /digitalizacion-taquillas | 3 | 0 | 66.7% |
| /product/taquilla-2-puertas-modulo-1-melamina | 3 | 0 | 33.3% |
| /taquillas-metalicas | 3 | 0 | 0.0% |
| /taquillas-para-colegios | 3 | 0 | 33.3% |
| /cookies | 2 | 0 | 50.0% |
| /product/taquilla-1-puertas-modulo-1-melamina | 2 | 0 | 0.0% |
| /product/taquilla-2-puertas-modulo-1-metalica | 2 | 0 | 50.0% |
| /aviso-legal | 1 | 0 | 100.0% |
| /cerraduras | 1 | 1 | 0.0% |

## GA4 — Eventos clave (comparado contra lo esperado)

| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |
|---|---|---|---|
| `generate_lead_form_submit` | si | 6 | 6 |
| `click_whatsapp` | si | 9 | 9 |
| `click_phone` | NO | 0 | 0 |
| `click_request_quote` | si | 55 | 55 |
| `click_catalog_download` | si | 2 | 0 |
| `view_quote_page` | si | 12 | 0 |
| `view_contact_page` | si | 34 | 0 |

## GA4 — Fuentes / medios principales

| Fuente | Medio | Sesiones | Conversiones |
|---|---|---|---|
| (direct) | (none) | 142 | 67 |
| google | organic | 4 | 3 |
| chatgpt.com | ai-assistant | 2 | 0 |
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

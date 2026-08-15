# Analytics Watcher — 2026-08-10

- **departmentRunId:** `growth-department-2026-08-10T090000Z`
- **Generado:** 2026-08-10T09:00:12.000Z
- **GA4 conectado:** si
- **GTM conectado:** si

## Resumen ejecutivo

GA4: lectura real completada. GTM: lectura real completada. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.

## GA4 — Trafico por canal (2026-07-13 a 2026-08-09)

| Canal | Sesiones | Usuarios activos | Conversiones |
|---|---|---|---|
| Direct | 200 | 90 | 40 |
| Organic Search | 50 | 45 | 10 |
| Paid Search | 10 | 9 | 1 |

## GA4 — Landing pages principales

| Landing page | Sesiones | Conversiones | Bounce rate |
|---|---|---|---|
| / | 120 | 30 | 22.0% |
| /ejemplo-producto | 20 | 5 | 15.0% |

## GA4 — Eventos clave (comparado contra lo esperado)

| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |
|---|---|---|---|
| `generate_lead_form_submit` | si | 12 | 12 |
| `click_whatsapp` | si | 18 | 18 |
| `click_phone` | NO | 0 | 0 |
| `click_request_quote` | si | 40 | 40 |

## GA4 — Fuentes / medios principales

| Fuente | Medio | Sesiones | Conversiones |
|---|---|---|---|
| (direct) | (none) | 200 | 40 |
| google | organic | 45 | 9 |

## GTM — Estado del contenedor

- **Contenedor:** www.ejemplo-cliente.com (GTM-EXAMPLE1, id interno 100000001)
- **Workspace:** Default Workspace (id 1)
- **Version live:** V12 - version de ejemplo (id 12)
- **Tags:** 4 — **Triggers:** 3 — **Variables:** 0

### Tags (hasta 30)

| Tag | Tipo | Pausado |
|---|---|---|
| GA4 Event - click_whatsapp | gaawe | no |
| Google Tag - GA4 - Ejemplo | googtag | no |
| GA4 Event - generate_lead_form_submit | gaawe | no |
| GA4 Event - click_phone | gaawe | si |

### Triggers (hasta 30)

| Trigger | Tipo |
|---|---|
| click_phone | linkClick |
| click_whatsapp | linkClick |
| Vista de una pagina - /gracias | pageview |

### Variables (hasta 30)

Sin variables.

**Recordatorio:** este agente NUNCA publica una version de contenedor ni modifica ningun tag/trigger/variable.

## Validaciones de tracking propuestas

- [ ] Confirmar en GA4 (DebugView o Realtime) que cada evento clave de la tabla anterior se dispara correctamente.

## Confirmacion de seguridad

- No se ha modificado GA4 ni GTM.
- No se ha publicado ninguna version de contenedor GTM.
- Este agente leyo GA4/GTM en modo solo lectura y propone; no existe ninguna llamada de escritura en estos adaptadores.

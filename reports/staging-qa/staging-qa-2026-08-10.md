# Staging QA Agent — 2026-08-10

- **departmentRunId:** `growth-department-2026-08-10T125242Z`
- **Generado:** 2026-08-10T12:52:59.052Z

## Salud general de staging

- **Alcanzable:** si
- **HTTP 200:** si (codigo 200)
- **Sin errores PHP visibles:** si
- **noindex preservado:** no — REVISAR, staging nunca deberia indexarse

## Borradores verificados (6)

Pasan: **5** (de los cuales con warning no bloqueante: **5**). Fallan: **1**.

### FALLA — taquillas escolares (`staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 1959
- title presente: no | contenido no vacio: no
- enlace interno: no | CTA detectado (heuristica): no | sin <form>: si
- QA visual/SEO/CRO (Fase O13.6b): FALLA -- botones: 0 | bloques visuales: 0 | CTA above the fold: no | estructura H1/H2: mal | contenido: 0 caracteres
  - Fallo al leer la pagina via REST API: WordPress REST API respondio 404 leyendo la pagina 1959: {"code":"rest_post_invalid_id","message":"El ID de la entrada no es v\u00e1lido.","data":{"status":404}}

### PASA (con warning) — taquillas melamina (`staging-exec-10f00b91-ccce-4fd7-962f-a3c2c2a87649`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 2091
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: no detectada en este draft.
- QA visual/SEO/CRO (Fase O13.6b): PASA -- botones: 3 | bloques visuales: 5 | CTA above the fold: si | estructura H1/H2: ok | contenido: 1915 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.

### PASA (con warning) — taquillas melamina (`staging-exec-e49c3c89-baf8-4cc8-9a0a-130bab430236`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 2092
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: no detectada en este draft.
- QA visual/SEO/CRO (Fase O13.6b): PASA -- botones: 3 | bloques visuales: 5 | CTA above the fold: si | estructura H1/H2: ok | contenido: 1915 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.

### PASA (con warning) — taquillas colegios (`staging-exec-45a65248-c0f6-41b4-a3c2-aafb7977fbab`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 2093
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: no detectada en este draft.
- QA visual/SEO/CRO (Fase O13.6b): PASA -- botones: 3 | bloques visuales: 5 | CTA above the fold: si | estructura H1/H2: ok | contenido: 2033 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.

### PASA (con warning) — taquilla para el personal (`staging-exec-cf802a36-a97c-43e8-b009-d1c8aad380a0`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 2094
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: no detectada en este draft.
- QA visual/SEO/CRO (Fase O13.6b): PASA -- botones: 3 | bloques visuales: 5 | CTA above the fold: si | estructura H1/H2: ok | contenido: 2075 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.

### PASA (con warning) — taquillas fenólicas en palencia (`staging-exec-b7cca47a-6cf0-472a-8c99-735d4fbc6202`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 2095
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: no detectada en este draft.
- QA visual/SEO/CRO (Fase O13.6b): PASA -- botones: 3 | bloques visuales: 5 | CTA above the fold: si | estructura H1/H2: ok | contenido: 1993 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.

## Confirmacion de seguridad

- Este agente es 100% solo lectura: no existe ninguna llamada de escritura en todo el fichero.
- No se ha revertido nada automaticamente. Un fallo aqui NO dispara un rollback — eso sigue siendo una decision humana explicita (ver docs/staging-rollback.md).
- Produccion no se ha tocado: este agente solo conoce WORDPRESS_STAGING_BASE_URL y la REST API de staging; no existe ninguna referencia a produccion en su codigo.

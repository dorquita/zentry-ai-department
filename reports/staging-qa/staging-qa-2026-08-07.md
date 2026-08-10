# Staging QA Agent — 2026-08-07

- **departmentRunId:** `growth-department-2026-08-07T080030Z`
- **Generado:** 2026-08-07T08:01:37.950Z

## Salud general de staging

- **Alcanzable:** si
- **HTTP 200:** si (codigo 200)
- **Sin errores PHP visibles:** si
- **noindex preservado:** si

## Borradores verificados (1)

Pasan: **1** (de los cuales con warning no bloqueante: **1**). Fallan: **0**.

### PASA (con warning) — taquillas escolares (`staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 1959
- title presente: si | contenido no vacio: si
- enlace interno: no | CTA detectado (heuristica): si | sin <form>: si
- imagen hero: media 1962 | formato image/webp | peso 66KB | alt text: si
- QA visual/SEO/CRO (Fase O13.6b): FALLA -- botones: 0 | bloques visuales: 1 | CTA above the fold: no | estructura H1/H2: ok | contenido: 654 caracteres
  - WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "seo_on_page_update" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.
  - FALLO QA VISUAL/SEO/CRO: Solo 0 boton(es) real(es) detectado(s) -- minimo 2.
  - FALLO QA VISUAL/SEO/CRO: Solo 1 bloque(s) visual(es) detectado(s) (columnas/botones/imagenes) -- minimo 3.
  - FALLO QA VISUAL/SEO/CRO: No hay ningun CTA (boton) antes del primer H2 -- falta CTA above the fold.
  - FALLO QA VISUAL/SEO/CRO: Se detecto texto de placeholder/editorial sin resolver visible en el contenido.

## Confirmacion de seguridad

- Este agente es 100% solo lectura: no existe ninguna llamada de escritura en todo el fichero.
- No se ha revertido nada automaticamente. Un fallo aqui NO dispara un rollback — eso sigue siendo una decision humana explicita (ver docs/staging-rollback.md).
- Produccion no se ha tocado: este agente solo conoce WORDPRESS_STAGING_BASE_URL y la REST API de staging; no existe ninguna referencia a produccion en su codigo.

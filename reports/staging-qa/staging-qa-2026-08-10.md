# Staging QA Agent — 2026-08-10

- **departmentRunId:** `growth-department-2026-08-10T104124Z`
- **Generado:** 2026-08-10T10:41:27.569Z

## Salud general de staging

- **Alcanzable:** si
- **HTTP 200:** si (codigo 200)
- **Sin errores PHP visibles:** si
- **noindex preservado:** no — REVISAR, staging nunca deberia indexarse

## Borradores verificados (1)

Pasan: **0** (de los cuales con warning no bloqueante: **0**). Fallan: **1**.

### FALLA — taquillas escolares (`staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c`)

- changeType: seo_on_page_update (criterio de enlaces: no bloqueante)
- wordpressPageId: 1959
- title presente: no | contenido no vacio: no
- enlace interno: no | CTA detectado (heuristica): no | sin <form>: si
- QA visual/SEO/CRO (Fase O13.6b): FALLA -- botones: 0 | bloques visuales: 0 | CTA above the fold: no | estructura H1/H2: mal | contenido: 0 caracteres
  - Fallo al leer la pagina via REST API: WordPress REST API respondio 404 leyendo la pagina 1959: {"code":"rest_post_invalid_id","message":"El ID de la entrada no es v\u00e1lido.","data":{"status":404}}

## Confirmacion de seguridad

- Este agente es 100% solo lectura: no existe ninguna llamada de escritura en todo el fichero.
- No se ha revertido nada automaticamente. Un fallo aqui NO dispara un rollback — eso sigue siendo una decision humana explicita (ver docs/staging-rollback.md).
- Produccion no se ha tocado: este agente solo conoce WORDPRESS_STAGING_BASE_URL y la REST API de staging; no existe ninguna referencia a produccion en su codigo.

# Asset Generation Workflow (Fase O12.4 -> O12.7)

## Estado actual: 1 asset real ya paso por todo el ciclo hasta `uploaded_to_wordpress`

El ciclo completo esta implementado y verificado con un caso real (ver
`docs/n8n-asset-generation.md` para O12.5/O12.6): generacion real via
n8n + OpenAI (`gpt-image-1-mini`) y subida real a la Media Library de
WordPress **staging** (Fase O12.7, `src/adapters/wordpress.ts`,
`uploadMediaToWordpress()`). Sigue habiendo un paso NO implementado:
**insertar la imagen subida dentro del contenido de un draft/pagina**
(eso es la Fase O12.8, todavia no hecha) — hoy la imagen vive en la
Media Library de staging, subida pero sin usar en ninguna pagina.

- Se PROPONEN peticiones de imagen (`data/asset-requests.jsonl`, status
  `proposed`) — Fase O12.4.
- El webhook de n8n genera imagenes reales cuando esta activo y
  configurado (Fase O12.5/O12.6) — normalmente queda **inactivo** entre
  pruebas controladas (ver rollback en `docs/n8n-asset-generation.md`).
- La imagen generada (recibida como data URI base64) se puede subir de
  verdad a la Media Library de WordPress **staging** con
  `npm run assets:upload-to-wordpress` (Fase O12.7) — gateado por
  `WORDPRESS_DRAFTS_ENABLED`/`WORDPRESS_BACKEND=rest`/`WORDPRESS_ENV=staging`,
  igual que el resto de escrituras reales del proyecto. **Nunca sube a
  produccion** (`assertWordpressWriteAllowed()` bloquea incondicionalmente).
- **NO se inserta todavia en ninguna pagina/draft** (ni el draft 1959 ni
  ningun otro) — la funcion de subida es create-only en la Media
  Library, deliberadamente desacoplada de `updateWordpressDraftPage()`.

## El ciclo de vida completo (diseñado, no implementado mas alla de "proposed")

```
proposed -> ready_for_generation -> sent_to_n8n -> generated -> uploaded_to_wordpress
                                                  \-> failed
                    \-> rejected (en cualquier punto antes de sent_to_n8n)
```

1. **`proposed`** (Fase O12.4, IMPLEMENTADO): `src/agents/visual-asset-planner.ts`
   detecta que un change pack necesitaria una imagen (segun su plantilla
   visual, ver `docs/visual-template-system.md`) y crea la peticion con
   prompt/negative prompt/style guide/alt text/nombre de fichero
   sugerido/dimensiones ya rellenos.
2. **`ready_for_generation`** (NO IMPLEMENTADO -- se salta hoy):
   un humano (o una futura politica de autonomia) revisaria el prompt
   propuesto y lo marcaria listo para generar — equivalente a
   `approved_to_execute` en change packs. Hoy el flujo real probado va
   directo de `proposed` a `sent_to_n8n` via `npm run assets:send-test`,
   sin pasar por este estado intermedio.
3. **`sent_to_n8n`** (Fase O12.5, IMPLEMENTADO pero gateado):
   `requestAssetGeneration()` en `src/adapters/n8n-asset-webhook.ts` ya
   hace la llamada real al webhook de n8n — pero SOLO si
   `N8N_ASSET_GENERATION_ENABLED=true` Y
   `N8N_ASSET_GENERATION_WEBHOOK_URL` estan configuradas (ninguna de las
   dos esta en el `.env` real hoy). Probar con
   `npm run assets:send-test` (simula si faltan las condiciones, pide
   confirmacion explicita si no). Ver `docs/n8n-asset-generation.md` y
   `docs/n8n-asset-webhook-contract.md` para el contrato exacto.
4. **`generated`** (Fase O12.6, IMPLEMENTADO): n8n genera la imagen de
   verdad via OpenAI (`gpt-image-1-mini`) y la devuelve como data URI
   base64 (nunca URL hospedada -- ese modelo siempre devuelve binario).
   Guardado en `data/asset-requests.jsonl` -> `generatedImageUrl`.
   Verificado con 1 caso real: `asset-req-b0b62ca5-992c-4410-9248-9b331cb066ea`
   (taquillas escolares, hero, PNG 1536x1024).
5. **`uploaded_to_wordpress`** (Fase O12.7, IMPLEMENTADO): la imagen se
   sube de verdad a la Media Library de WordPress **staging** (nunca
   produccion, mismo guardrail incondicional que el resto del sistema —
   `docs/wordpress-safety-policy.md`) via `npm run assets:upload-to-wordpress`.
   Guarda `wordpressMediaId`/`wordpressMediaUrl`/`uploadedAt`/`fileSize`/
   `width`/`height` reales en el asset request. **Todavia NO se asocia a
   ningun draft/pagina** -- eso es la Fase O12.8.
6. **`rejected`** (NO IMPLEMENTADO): un humano rechaza la propuesta antes
   de generar nada.
7. **`failed`** (parcialmente implementado): si la subida a WordPress
   falla, `upload-asset-to-wordpress.ts` marca el asset request como
   `failed` con `lastError`. La generacion via n8n todavia no tiene un
   reintento automatico -- si falla, el asset request se queda en
   `proposed`/`sent_to_n8n` y hay que relanzar `assets:send-test` a mano.

## Visual Asset Planner Agent (lo unico implementado hoy)

`src/agents/visual-asset-planner.ts` (`npm run visual-assets:plan`):

1. Lee change packs elegibles (mismo criterio que WordPress Draft Agent
   y Visual Template Builder: `ready_for_review`/`approved_to_execute`).
2. Para cada uno, selecciona su plantilla visual
   (`selectVisualTemplate()`) y calcula que "slots" de imagen necesita:
   siempre hero + imagen destacada, mas un icono si aplica el bloque de
   cerraduras inteligentes (ver `docs/visual-template-system.md`).
3. Por cada slot, si no existe ya una peticion para
   (changePackId, imagePurpose) — dedup, igual patron que change-packs.ts —
   construye un prompt/negative prompt/style guide/alt text/nombre de
   fichero/dimensiones y crea la peticion en `proposed`.
4. Nunca llama a `requestAssetGeneration()`. Nunca comprueba siquiera si
   `N8N_ASSET_GENERATION_WEBHOOK_URL` esta configurada mas alla de
   informarlo en el log/informe (`n8nConfigured`) — configurar la
   variable NO activa nada por si sola.

## Estructura de un prompt generado

Cada peticion combina: proposito de la imagen (hero/tarjeta/producto en
contexto/icono), el tema (`keyword` del change pack), el sector detectado
si lo hay, la guia de estilo de marca (`BRAND_STYLE_GUIDE` en
`visual-asset-planner.ts` — distinta para Zentry, Tukandado, ambas
marcas o generica) y las dimensiones objetivo. El negative prompt es fijo
y comparte los mismos criterios de seguridad de marca para todas las
peticiones: sin texto superpuesto, sin marcas de agua, sin logotipos de
terceros, sin personas reconocibles, sin manos/dedos deformes, sin
resultados de baja calidad.

## Que falta para activar el resto del ciclo (no hecho todavia)

- Decidir el proveedor de generacion de imagenes con IA (no fijado).
- Habilitar el nodo "Generar Imagen" del workflow real en n8n con las
  credenciales de ese proveedor, y activar el workflow (`active: true`)
  — decision manual del cliente en la UI de n8n, fuera de este proyecto.
- Implementar la subida a WordPress (Media Library, staging) dentro del
  workflow de n8n — no existe todavia ni un nodo placeholder para esto.
- Rellenar `N8N_ASSET_GENERATION_ENABLED`/`N8N_ASSET_GENERATION_WEBHOOK_URL`
  en el `.env` real cuando el cliente decida activar el envio desde este
  proyecto.
- Decidir el flujo de aprobacion humana entre `proposed` y
  `ready_for_generation` (¿automatico para riesgo bajo, como
  `autonomy-policy.json`? ¿siempre manual?) — no decidido todavia.

## Ver tambien

- `docs/visual-template-system.md` — de donde salen los slots de imagen.
- `docs/n8n-asset-webhook-contract.md` — el contrato de red exacto,
  todavia no implementado.
- `docs/wordpress-safety-policy.md` — por que cualquier subida futura
  seguiria restringida a staging.

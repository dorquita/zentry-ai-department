# Contrato futuro: webhook de generacion de assets via n8n (Fase O12.4)

## Estado: SOLO CONTRATO, NO IMPLEMENTADO

Este documento fija la FORMA de un webhook que **todavia no existe**.
`/opt/n8n` no se ha tocado en ningun momento por la Fase O12.4: no se ha
creado ningun workflow, no se ha llamado a ninguna URL, no se ha
reiniciado el servicio. El unico rastro en codigo es
`src/adapters/n8n-asset-webhook.ts`, un skeleton cuya funcion
`requestAssetGeneration()` **siempre lanza un error** — mismo patron que
`src/adapters/wordpress-mcp.ts` (Fase O10.5) para MCP/Novamira.

## Variable de entorno

`N8N_ASSET_GENERATION_WEBHOOK_URL` — documentada en `.env.example`,
**no anadida al `.env` real** en esta fase (ninguna variable de este
proyecto se toca en el `.env` real salvo peticion explicita del
cliente). Mientras no exista o el codigo no la use (hoy no la usa en
ningun sitio salvo para informar `n8nConfigured` en los informes),
configurarla no tiene ningun efecto.

## Peticion (cuando exista de verdad): `POST N8N_ASSET_GENERATION_WEBHOOK_URL`

Tipo `N8nAssetGenerationRequest` en `src/adapters/n8n-asset-webhook.ts`:

```json
{
  "assetRequestId": "asset-req-...",
  "prompt": "Fotografia/render tipo hero de landing. Tema: \"taquillas escolares\" (plantilla: sector_landing). Contexto de sector: colegio. Zentry: mobiliario/taquillas metalicas e industriales, paleta de grises y azules corporativos, fotografia de producto o render limpio con fondo neutro o instalaciones reales (vestuarios, oficinas, colegios), iluminacion profesional tipo catalogo, sin ambiente oscuro ni dramatico. Dimensiones objetivo: 1600x900px. Hero: Placeholder hoy: bloque solido/icono generico de Kadence (sin imagen real). Foto real o render de taquillas en un entorno del sector (vestuario de gimnasio, pasillo escolar, etc.). Se sustituye por una imagen real solo cuando exista una peticion de asset \"generated\"/\"uploaded_to_wordpress\" — ver docs/asset-generation-workflow.md. Nunca se genera ni se sube nada en esta fase.",
  "negativePrompt": "sin texto superpuesto, sin marcas de agua, sin logotipos de terceros, sin personas reconocibles, sin manos/dedos deformes, sin marcas o logos inventados, sin baja resolucion, sin bordes/marcos decorativos",
  "dimensions": { "width": 1600, "height": 900 },
  "filenameSuggestion": "taquillas-escolares-hero-zentry.jpg",
  "altText": "Taquillas escolares — imagen principal",
  "targetEnv": "staging",
  "targetWordPress": "staging.zentrylockers.com"
}
```

`targetEnv` es **siempre `"staging"`** — el tipo TypeScript lo fija como
literal (`"staging"`, no `string`), no como configuracion runtime,
precisamente para que no pueda apuntar nunca a produccion aunque el
workflow de n8n se implemente sin cuidado. Cuando el workflow real exista,
debera IGUALMENTE respetar `docs/wordpress-safety-policy.md` (bloqueo
incondicional de produccion) por su cuenta, ya que n8n corre fuera del
proceso Node de este proyecto y `assertWordpressWriteAllowed()` no lo
protege automaticamente.

## Respuesta esperada

Tipo `N8nAssetGenerationResponse`:

```json
{
  "assetRequestId": "asset-req-...",
  "status": "uploaded_to_wordpress",
  "imageUrl": "https://.../generated/taquillas-escolares-hero.jpg",
  "wordpressMediaId": 1234,
  "wordpressMediaUrl": "https://staging.zentrylockers.com/wp-content/uploads/.../taquillas-escolares-hero.jpg",
  "altText": "Taquillas escolares — imagen principal",
  "fileSize": 245760,
  "width": 1600,
  "height": 900
}
```

`status` en la respuesta es un subconjunto deliberado de
`AssetRequestStatus`: solo `"generated"`, `"uploaded_to_wordpress"` o
`"failed"` (con `error` relleno en ese caso) — los estados
`proposed`/`ready_for_generation`/`sent_to_n8n`/`rejected` son
exclusivamente de este lado (Node), n8n nunca los asigna.

## Que haria este proyecto con la respuesta (diseño, no implementado)

1. Nunca marcar `generated`/`uploaded_to_wordpress` de forma optimista —
   solo tras una respuesta 2xx real con los campos esperados presentes
   (mismo criterio que `createWordpressDraftPage()`: "si la respuesta no
   confirma el resultado, tratar como fallo").
2. Sanitizar cualquier error de red antes de loguearlo (mismo patron que
   `sanitizeWordpressError()`/`sanitizeTelegramError()`) — la URL del
   webhook nunca se imprime si llegara a incluir un token.
3. `data/asset-requests.jsonl` seguiria el mismo patron append-only de
   instantaneas que el resto del proyecto — nunca se sobrescribe una
   linea existente.

## Validaciones que deberia hacer el futuro workflow de n8n (no verificado, es responsabilidad de n8n)

- Confirmar que `targetEnv` es `"staging"` antes de subir nada (defensa
  en profundidad adicional, aunque el tipo ya lo fuerza en origen).
- Nunca sobrescribir un `wordpressMediaId` existente — cada peticion
  genera un medio nuevo.
- Aplicar el `negativePrompt` recibido tal cual, sin modificarlo.
- No reintentar indefinidamente ante un fallo del proveedor de imagenes;
  devolver `status: "failed"` con `error` para que este proyecto pueda
  reintentar de forma controlada en su siguiente pasada.

## Ver tambien

- `docs/asset-generation-workflow.md` — el ciclo de vida completo de una
  peticion de asset, de principio a fin.
- `docs/visual-template-system.md` — de donde sale cada peticion.
- `docs/wordpress-mcp-adapter.md` — mismo patron de "skeleton que
  siempre lanza" aplicado a MCP/Novamira (Fase O10.5).

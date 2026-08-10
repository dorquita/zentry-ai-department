# n8n Asset Generation — Workflow real (Fase O12.5 + O12.6)

## Diagnostico de la instancia n8n (solo lectura)

- **Ubicacion:** `/opt/n8n` en el mismo VPS que este proyecto
  (`/opt/zentry-ai-department`). Vecino de `/opt/qdrant` — ninguno de los
  dos se toca desde este proyecto.
- **Despliegue:** Docker Compose (`/opt/n8n/docker-compose.yml`), un unico
  contenedor `n8nio/n8n`, `restart: always`, puerto publicado solo en
  `127.0.0.1:5678` (no expuesto directamente a internet). Datos
  persistidos en `./data` (montado a `/home/node/.n8n`).
- **Dominio publico:** `srv1777637.hstgr.cloud` (variable `N8N_HOST`/
  `WEBHOOK_URL` del propio docker-compose), servido detras de un proxy.
- **API disponible:** SI — `N8N_MCP_ACCESS_ENABLED=true` en el
  docker-compose. Es la MISMA instancia que ya estaba conectada a las
  sesiones de Claude Code como servidor MCP `n8n-mcp` (confirmado
  comparando el hostname). Por eso toda la interaccion de esta fase se
  hizo via ese MCP oficial, NUNCA editando ficheros de n8n directamente
  ni extrayendo credenciales.
- **Credenciales existentes** (solo nombres/tipos, nunca valores —
  `list_credentials` de n8n-mcp garantiza no devolver secretos): HubSpot
  Private App, Qdrant Internal, Apollo API Key, Instantly Webhook Secret,
  OpenAI - AI Reply Agent. **Ninguna es especifica de generacion de
  imagenes** — confirma lo que ya decia `docs/asset-generation-workflow.md`
  desde la Fase O12.4: el proveedor de imagenes IA sigue sin decidir.
- **Workflows existentes:** 25 workflows reales de Zentry/Tukandado
  (HubSpot, Instantly, Apollo, RAG/Qdrant, prospeccion...), varios
  **activos** (p.ej. "Instantly - Reply Received to HubSpot"). Ninguno
  se toco, se leyo o se modifico durante esta fase — solo se uso
  `search_workflows` (solo lectura) para confirmar que no habia colision
  de nombre con el workflow nuevo.

## El workflow: "Zentry - AI Asset Generation - Staging"

Creado de verdad en la instancia real de n8n del cliente (no solo un
JSON exportado):

- **workflowId:** `BbPipJYbV3YD84gM`
- **URL:** `https://srv1777637.hstgr.cloud/workflow/BbPipJYbV3YD84gM`
- **Proyecto:** personal de Pau Dorca (`Pau Dorca <info@tukandado.com>`)
  — el mismo proyecto donde viven el resto de workflows de Zentry/Tukandado.
- **Estado: INACTIVO** (`active: false`, `triggerCount: 0`). Nadie lo ha
  activado ni lo activara desde este proyecto — activarlo es una
  decision manual del cliente en la UI de n8n, fuera de este sistema.
- **Webhook (cuando se active):** `POST https://srv1777637.hstgr.cloud/webhook/zentry-ai-asset-generation-staging`
  (path exacto pedido: `/webhook/zentry-ai-asset-generation-staging`).
  Mientras el workflow siga inactivo, esa URL no responde nada.

### Los 7 nodos

1. **Receive Asset Request** (Webhook, POST, sin autenticacion — es un
   endpoint interno de proyecto, no de terceros; se puede anadir
   autenticacion mas adelante si se decide).
2. **Validar Payload** (Code): exige los 8 campos del contrato
   (`assetRequestId`, `prompt`, `negativePrompt`, `dimensions`,
   `filenameSuggestion`, `altText`, `targetEnv`, `targetWordPress`) y
   ademas **rechaza cualquier `targetEnv` que no sea exactamente
   `"staging"`** — segunda capa de proteccion contra produccion, dentro
   del propio n8n (la primera capa vive en el tipo TypeScript
   `N8nAssetGenerationRequest.targetEnv: "staging"` en
   `src/adapters/n8n-asset-webhook.ts`, que ni compila con otro valor).
3. **Generar Imagen (no configurado)** (HTTP Request) — **`disabled: true`
   deliberadamente**. URL placeholder pendiente de que se decida un
   proveedor. Mientras este deshabilitado, n8n lo salta como un
   pass-through: los datos pasan intactos al siguiente nodo sin llamar a
   ninguna API externa.
4. **Guardar Binario/URL** (Set): construye la respuesta honesta —
   `status: "failed"` y un `error` explicando que la generacion no esta
   configurada todavia. Cuando se habilite el nodo 3 de verdad, este paso
   pasaria a capturar la URL/binario real devuelto por el proveedor.
5. **Optimizar Nombre de Archivo** (Code): normaliza el
   `filenameSuggestion` (minusculas, sin acentos, slug, fuerza extension
   `.jpg` si falta).
6. **Responder JSON** (Respond to Webhook): devuelve el
   `N8nAssetGenerationResponse` — hoy siempre con `status: "failed"`
   mientras el nodo 3 este desactivado.
7. **Sticky Note**: nota visible en el canvas de n8n explicando el estado
   "modo seguro" para cualquiera que abra el workflow en la UI.

### Por que se creo INACTIVO con el nodo de generacion DESHABILITADO

Doble gate, igual filosofia que el resto del proyecto (WordPress Draft
Agent, Staging Executor): incluso si alguien activara el workflow por
error, el nodo de generacion seguiria sin poder llamar a ningun proveedor
de imagenes real — haria falta (a) activar el workflow Y (b) habilitar
el nodo 3 con una URL/credencial real, dos acciones manuales distintas en
la UI de n8n, ninguna de las cuales se ha hecho ni se hara desde este
proyecto.

## Copia de referencia (JSON exportable)

`reports/n8n-workflows/zentry-ai-asset-generation-staging.json` — copia
exacta de la definicion del workflow real (nodos, conexiones,
parametros), por si hace falta reimportar o auditar sin depender de la
API. **No hace falta importarla** — el workflow real ya existe. Solo
usarla si algun dia hay que recrear el workflow desde cero (borrado
accidental, migracion a otra instancia...).

### Como importarla manualmente (si algun dia hace falta)

1. Abrir n8n → menu superior derecho → **Import from File**.
2. Seleccionar `zentry-ai-asset-generation-staging.json`.
3. Revisar que el nodo "Generar Imagen (no configurado)" siga
   `disabled` antes de guardar.
4. **No activar el workflow** salvo decision explicita — se importa
   inactivo por defecto, igual que el original.

## Integracion con el proyecto (`src/adapters/n8n-asset-webhook.ts`)

`requestAssetGeneration()` ya NO es un skeleton que siempre lanza (Fase
O12.4) — ahora hace la llamada real, pero **solo si se cumplen las 2
condiciones a la vez**:

1. `N8N_ASSET_GENERATION_ENABLED=true`
2. `N8N_ASSET_GENERATION_WEBHOOK_URL` configurada

Sin las dos, lanza un error explicito ANTES de tocar la red — no hay
ninguna llamada "silenciosa". Ninguna variable existe en el `.env` real
del proyecto hoy (verificado por booleano, nunca impreso) — el
comportamiento por defecto sigue siendo "nunca llama a n8n".

## CLI de prueba: `npm run assets:send-test`

```bash
npm run assets:send-test                                  # usa la peticion "proposed" mas reciente
npm run assets:send-test -- --assetRequestId asset-req-...  # una peticion concreta
```

- **Sin las 2 variables de entorno:** SIMULA — imprime el payload exacto
  que se enviaria y la respuesta esperada, sin tocar la red.
- **Con las 2 variables:** pide confirmacion explicita (escribir "si")
  antes de hacer la llamada real. Incluso confirmando, hoy la respuesta
  seguira siendo `status: "failed"` porque el nodo de generacion sigue
  desactivado en n8n — es un test de CONECTIVIDAD end-to-end (webhook
  correcto, validacion de payload correcta, respuesta con la forma
  correcta), no un test de generacion de imagenes real.
- Si el envio real tiene exito, actualiza el registro correspondiente en
  `data/asset-requests.jsonl` (nueva instantanea, append-only) con el
  `status` devuelto por n8n.

## Fase O12.6 — Primera generacion real (2026-08-04)

Proveedor decidido: **OpenAI, modelo `gpt-image-1-mini`** (no `dall-e-3`
-- ver "Por que gpt-image-1-mini y no dall-e-3" abajo). Credencial
dedicada creada por el cliente directamente en la UI de n8n: **"OpenAI -
Asset Generation"** (`openAiApi`, id `Dreuo29oWsZHuSUa`), distinta de
"OpenAI - AI Reply Agent" para no mezclar costes/uso. Conectada al nodo
"Generar Imagen (GPT Image)" via `setNodeCredential` (nunca se vio ni se
peg + el valor de la API key en esta conversacion).

### Nodos nuevos/cambiados respecto a O12.5

1. **Elegir Tamano Imagen** (Code, nuevo): mapea las dimensiones custom
   del asset (p.ej. 1600x900) al tamano soportado mas cercano de
   `gpt-image-1-mini` (1024x1024 / 1536x1024 / 1024x1536) segun el ratio
   de aspecto.
2. **Generar Imagen (GPT Image)** (antes "Generar Imagen (no
   configurado)" / "Generar Imagen (DALL-E 3)"): `@n8n/n8n-nodes-langchain.openAi`,
   `resource: image`, `operation: generate`, `modelId: gpt-image-1-mini`,
   `quality: medium`, `binaryPropertyOutput: data`. Ya **habilitado** y
   con credencial real.
3. **Convertir Imagen a Base64** (Code, nuevo): el nodo OpenAI devuelve
   la imagen como binario (nunca como URL con `gpt-image-1-mini`); este
   nodo la convierte a un data URI (`data:image/png;base64,...`) para
   poder devolverla en la respuesta JSON del webhook sin subir nada a
   ningun sitio.
4. **Guardar Binario/URL**: ahora calcula `status: "generated"/"failed"`
   de verdad segun si se recibio imagen, e incluye `imageUrl` (el data
   URI) y `fileSize` (bytes) reales en vez de un `status: "failed"` fijo.
5. **Responder JSON**: incluye `imageUrl` y `fileSize` en la respuesta.

### Por que gpt-image-1-mini y no dall-e-3

Primer intento con `dall-e-3` + `returnImageUrls: true` fallo en
produccion con un 400 real de OpenAI: `Unknown parameter:
'response_format'` -- la cuenta/API en uso ya no acepta ese parametro
que el nodo de n8n sigue enviando para dall-e-2/3. `gpt-image-1-mini`
nunca envia `response_format` (siempre devuelve binario), asi que evita
el problema por completo. Esto ocurrio en la llamada real (0 coste, ya
que OpenAI devuelve 400 antes de generar nada) -- documentado por si se
quiere reintentar dall-e-3 en el futuro cuando n8n actualice el nodo.

### Resultado de la prueba controlada

- **assetRequestId:** `asset-req-b0b62ca5-992c-4410-9248-9b331cb066ea`
  (taquillas escolares, hero, changePackId `e21b2a0d-b0b1-4080-8b5a-ea0d4a404ca5`)
- **status:** `generated` (registrado en `data/asset-requests.jsonl`,
  nueva instantanea append-only)
- **Imagen real:** PNG, 1536x1024px (mapeado desde el objetivo
  1600x900), ~2.07MB, verificada visualmente -- taquillas metalicas
  azul/gris en pasillo, fotografia tipo catalogo, sin texto/marcas de
  agua/personas, coherente con el prompt y la guia de estilo.
- **Filename:** `taquillas-escolares-hero-zentry.jpg` (sugerido; el
  archivo real generado es PNG)
- **Alt text:** "Taquillas escolares — imagen principal"
- **Coste aproximado:** `gpt-image-1-mini`, calidad `medium`,
  1536x1024 -- del orden de unos pocos centimos de USD por imagen (no
  hay forma de leer el coste exacto facturado desde n8n/MCP; solo se
  genero 1 imagen en total en esta fase, los 2 intentos previos con
  dall-e-3 fallaron antes de llegar a facturar nada).
- **NO se subio a WordPress.** El data URI solo se guardo en
  `data/asset-requests.jsonl` (campo `generatedImageUrl`) y se
  inspecciono localmente para verificacion; no se toco `staging.zentrylockers.com`
  ni produccion.

### Rollback / como desactivar (ya aplicado tras la prueba)

El workflow se **desactivo de nuevo** (`active: false`) inmediatamente
despues de esta prueba controlada, para no dejar un webhook publico sin
autenticacion capaz de generar imagenes de pago en cualquier momento.
Estado actual dejado tras O12.6:

- Workflow: **inactivo**. Para reactivar: `publish_workflow` (MCP) o
  toggle "Active" en la UI de n8n.
- Nodo "Generar Imagen (GPT Image)": **habilitado**, con la credencial
  real ya conectada. Para bloquear del todo sin desactivar el workflow
  entero: deshabilitar este nodo en la UI (`disabled: true`).
- `.env` del proyecto: `N8N_ASSET_GENERATION_ENABLED=true` y
  `N8N_ASSET_GENERATION_WEBHOOK_URL` se quedaron configurados tal como
  se pidio -- el gate real que impide llamadas accidentales es que el
  workflow esta inactivo (el webhook no responde en absoluto mientras lo
  este).
- Sticky note del workflow actualizada en n8n con este mismo resumen de
  estado.

## Que sigue pendiente (no hecho todavia)

- **Implementada la subida a WordPress en la Fase O12.7** (fuera de
  n8n -- via `npm run assets:upload-to-wordpress`, que llama
  directamente a la REST API de medios de WordPress desde este
  proyecto, no desde un nodo de n8n). Ver `docs/asset-generation-workflow.md`.
  Sigue pendiente **asociar** esa media ya subida a un draft/pagina
  real (Fase O12.8, no hecha).
- Decidir una politica de reactivacion del workflow (¿reactivar solo
  para lotes puntuales y desactivar despues, como en O12.6? ¿anadir
  autenticacion al webhook si se deja activo mas tiempo?).
- Revisar si vale la pena volver a intentar `dall-e-3` mas adelante
  (mejor calidad/control de estilo) si n8n actualiza el nodo para dejar
  de enviar `response_format`.

## Ver tambien

- `docs/asset-generation-workflow.md` — ciclo de vida completo de una
  peticion de asset (Fase O12.4), actualizado con el estado real de esta
  fase.
- `docs/n8n-asset-webhook-contract.md` — el contrato de red original
  (Fase O12.4), ahora implementado tal cual se documento.
- `docs/visual-template-system.md` — de donde salen las peticiones de
  asset que este workflow recibiria.

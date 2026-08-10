# Politica de seguridad de WordPress

## Por que existe este documento aparte

El resto del departamento (`docs/change-packs.md`, `docs/autonomy-policy.md`,
`docs/notification-gateway.md`) describe agentes que nunca llaman a
ninguna API de escritura. El WordPress Draft Agent (Fase O10) y, desde la
Fase O12, el Staging Executor (`docs/staging-execution.md`) son los
UNICOS agentes de todo el proyecto con permiso para escribir algo en un
sistema de produccion real (WordPress) — aunque sea solo un borrador sin
publicar, y aunque el destino real siga siendo exclusivamente staging.
Por eso necesitan su propia politica explicita, en un documento propio,
en vez de heredar sin mas la politica general de "solo lectura". Ambos
agentes comparten el MISMO adaptador (`src/adapters/wordpress.ts`) y por
tanto las MISMAS garantias descritas aqui.

## Lo que este agente NUNCA hace (por diseno, no por descuido)

- **No publica ninguna pagina.** Ningun borrador se crea nunca con
  `status` distinto de `"draft"`. `src/adapters/wordpress.ts` fuerza
  literalmente ese valor en el cuerpo de la peticion; no hay parametro
  para cambiarlo.
- **No modifica ninguna pagina publicada existente.** El adaptador
  implementa la creacion de paginas NUEVAS (`POST /wp-json/wp/v2/pages`
  sin `id`) y, desde la Fase O12, la actualizacion de una pagina
  EXISTENTE — pero `updateWordpressDraftPage()` verifica con un GET,
  ANTES de escribir, que el status actual es `"draft"`; si es cualquier
  otra cosa (`publish`, `trash`, `private`...) rechaza sin tocar nada. No
  hay ninguna via en todo el proyecto para actualizar una pagina
  publicada.
- **No toca la home.** No existe ningun flujo que apunte a la pagina de
  inicio; ademas, el adaptador bloquea explicitamente cualquier
  titulo/slug propuesto que contenga terminos como "home"/"inicio" (ver
  `PROTECTED_SLUG_TERMS` en `src/adapters/wordpress.ts`).
- **No toca formularios.** Ningun change pack de tipo CRO modifica
  formularios via WordPress — solo propone (en el preview local) un texto
  de CTA/formulario para que un humano lo aplique manualmente.
- **No toca WooCommerce.** No se llama a ningun endpoint de
  `/wp-json/wc/*`. No existe codigo en este proyecto que importe o
  referencie la API de WooCommerce.
- **No toca precios.** Ningun change pack ni preview modifica un precio;
  el adaptador no tiene ninguna funcion que apunte a productos.
- **No toca checkout.** El adaptador bloquea explicitamente cualquier
  titulo/slug que contenga "checkout"/"cart"/"carrito"/"pago".
- **No toca Google Ads, GA4, GTM, n8n ni qdrant.** El WordPress Draft
  Agent solo importa `src/adapters/wordpress.ts`; no existe ninguna
  importacion cruzada hacia ningun otro adaptador externo.
- **No escribe nunca en produccion (Fase O10.6).** `WORDPRESS_ENV`
  distingue `staging` (unico destino de escritura permitido) de
  `production` (bloqueado de forma incondicional). Ver seccion "Staging
  vs Produccion" mas abajo.
- **No sube media.** No existe ninguna funcion de upload en el adaptador.
- **No borra nada.** No existe ninguna funcion de `delete` en el
  adaptador — ni siquiera el rollback del Staging Executor (Fase O12)
  borra: revierte via `updateWordpressDraftPage()` (restaura el
  contenido anterior, o vacia y marca como revertido un borrador nuevo)
  y el borrador sigue existiendo, sin publicar. Ver
  `docs/staging-rollback.md`.
- **No imprime secretos.** `WORDPRESS_APP_PASSWORD` nunca se loguea ni se
  imprime en consola; cualquier error de red/API se sanitiza antes de
  mostrarse (ver `sanitizeWordpressError()` en `src/adapters/wordpress.ts`,
  mismo patron que `sanitizeTelegramError()`).
- **`data/wordpress-drafts.jsonl` es append-only.** Ninguna funcion de
  `src/core/wordpress-drafts.ts` borra ni reescribe una linea existente.

## Las 5 condiciones para crear un borrador REAL (deben cumplirse las 5 a la vez)

1. **`WORDPRESS_DRAFTS_ENABLED=true`** en `.env`. Mientras sea `false` (o
   no exista), el agente entero se salta el paso de escritura en el
   codigo — no solo responde "no" a una comprobacion, literalmente no
   importa ni ejecuta ese bloque.
2. **`WORDPRESS_BACKEND` es `"rest"` o `"mcp"` (Fase O10.5).** El valor
   por defecto, `"local_preview"`, es una capa de seguridad ADICIONAL e
   independiente de `WORDPRESS_DRAFTS_ENABLED`: aunque esa este en
   `true`, con `WORDPRESS_BACKEND=local_preview` el agente sigue sin
   entrar en el bloque de escritura real. Hoy `"mcp"` es solo un skeleton
   que siempre lanza un error (ver `docs/wordpress-mcp-adapter.md`) — en
   la practica, la unica opcion funcional es `"rest"`.
3. **`WORDPRESS_ENV` es `"staging"` (Fase O10.6).** Si es `"production"`,
   `assertWordpressWriteAllowed()` (en
   `src/adapters/wordpress-backend.ts`) lanza un error ANTES de resolver
   ninguna URL ni tocar la red — de forma incondicional, sin importar
   `WORDPRESS_DRAFTS_ENABLED`/`WORDPRESS_BACKEND`/aprobaciones. Ver la
   seccion "Staging vs Produccion" mas abajo.
4. **El change pack esta `approved_to_execute`.** Un change pack
   `ready_for_review` solo genera preview local, nunca un borrador real,
   pase lo que pase con las variables de entorno.
5. **Hay una solicitud de aprobacion de Telegram (`relatedType:
   "change_pack"`) con status `approved` para ESE `changePackId`
   concreto.** Esta aprobacion es independiente de la que ya acepto el
   change pack como `approved_to_execute` — son dos decisiones humanas
   distintas: "acepto este plan" (change pack) y "adelante, crea el
   borrador en WordPress ahora" (aprobacion de Telegram). Si la solicitud
   todavia no existe, el agente la crea y la envia (si
   `TELEGRAM_APPROVALS_ENABLED=true`) pero espera a la siguiente pasada
   para ver la respuesta — nunca crea el borrador en la misma pasada en
   la que crea la solicitud.

## Staging vs Produccion (Fase O10.6)

| | `staging` | `production` |
|---|---|---|
| URL | `WORDPRESS_STAGING_BASE_URL` (`https://staging.zentrylockers.com`) | `WORDPRESS_PRODUCTION_BASE_URL` (`https://zentrylockers.com`) |
| Escritura real permitida | Si, bajo las otras 4 condiciones | **NUNCA, sin excepcion** |
| Como se bloquea | No aplica — es el destino sancionado | `assertWordpressWriteAllowed()` lanza siempre, antes de resolver la URL o las credenciales |
| Que SI se permite | Lectura, y la unica escritura real de todo el sistema | Solo lectura, o un futuro deploy manual con aprobacion humana explicita fuera de este sistema (no implementado) |

El bloqueo de produccion vive en un unico sitio
(`src/adapters/wordpress-backend.ts#assertWordpressWriteAllowed`), y lo
llaman tanto `src/adapters/wordpress.ts` (backend `rest`) como
`src/adapters/wordpress-mcp.ts` (backend `mcp`, skeleton) — cualquier
funcion nueva que algun dia intente escribir en WordPress debe llamarlo
tambien, antes de tocar la red. No hay ninguna ruta de codigo hoy que
pueda escribir en produccion, ni siquiera con
`WORDPRESS_DRAFTS_ENABLED=true`, `WORDPRESS_BACKEND=rest`, un change pack
`approved_to_execute` y una aprobacion de Telegram — el unico factor que
importa para este bloqueo es `WORDPRESS_ENV`.

Este gate de Telegram es **incondicional**: a diferencia de Approval
Gateway (que consulta `config/notification-policy.json` para decidir si
algo necesita aprobacion instantanea), escribir en WordPress siempre
exige esta aprobacion explicita, codificada directamente en
`src/agents/wordpress-draft-agent.ts` — un cambio futuro en
`notification-policy.json` no puede debilitar esta regla.

## Que pasa si algo falla al crear el borrador

Si la llamada a la API de WordPress falla (red, credenciales, respuesta
inesperada), el draft se queda en `local_preview` — nunca se asume exito.
El error se registra (sanitizado) en el log y en el informe del agente; se
reintenta en la siguiente pasada diaria sin perder nada.

## Que pasa si se rechaza la aprobacion de Telegram

El draft pasa a status `rejected` en `data/wordpress-drafts.jsonl`. No se
crea nada en WordPress. El preview local sigue existiendo como
referencia.

## Revocar el permiso de escritura por completo

Cualquiera de estas tres acciones es suficiente por si sola (no hace
falta hacer las tres): poner `WORDPRESS_DRAFTS_ENABLED=false` en `.env`
(o borrar la variable), poner `WORDPRESS_BACKEND=local_preview` (o
borrarla — es el valor por defecto), o poner `WORDPRESS_ENV=production`
(bloquea la escritura de forma incondicional, aunque las otras dos
variables sigan en modo "escritura permitida"). El agente vuelve a
operar en modo 100% lectura + preview local, sin necesidad de tocar
ninguna otra parte del sistema.

## Fase O12 — Staging Executor: ejecucion controlada mas alla de un solo borrador

El Staging Executor anade dos capacidades sobre el WordPress Draft Agent,
con las MISMAS garantias de esta politica (staging unicamente, siempre
`draft`, nunca `delete`/`publish`/media/WooCommerce/formularios/home/
checkout, nunca Google Ads/GA4/GTM/n8n/qdrant, nunca Novamira/MCP/
execute-php/run-wp-cli):

1. **Puede ACTUALIZAR un borrador que el mismo creo antes** (si la misma
   `canonicalKey` ya tiene una ejecucion `applied_to_staging`), no solo
   crear paginas nuevas — siempre verificando primero que sigue en
   `draft`.
2. **Rollback real**: revertir una ejecucion aplicada, siempre via
   `update` (nunca `delete`), con snapshot previo guardado ANTES de
   escribir.

Necesita 6 condiciones simultaneas (las 5 de mas arriba + un interruptor
adicional `STAGING_EXECUTION_ENABLED` propio) — ver el detalle completo
en `docs/staging-execution.md`. `WORDPRESS_ENV="production"` sigue
bloqueando de forma incondicional cualquier escritura del Staging
Executor, exactamente igual que al WordPress Draft Agent — es el mismo
guardrail (`assertWordpressWriteAllowed()`), no una copia.

## Ver tambien

- `docs/wordpress-draft-agent.md` — como funciona el WordPress Draft Agent paso a paso.
- `docs/staging-execution.md` — como funciona el Staging Executor (Fase O12).
- `docs/staging-rollback.md` — como funciona el rollback real (Fase O12).
- `docs/wordpress-mcp-adapter.md` — diagnostico de MCP Novamira y por que
  `WORDPRESS_BACKEND=mcp` todavia no esta implementado (fuera de alcance
  en la Fase O12).
- `docs/change-packs.md` — de donde vienen los change packs que estos
  agentes convierten en borradores/ejecuciones.
- `docs/telegram-approvals.md` — como funciona el canal de aprobacion.

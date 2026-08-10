# Aprobaciones por Telegram (Fase O8)

## Que es

Telegram es el **unico** canal de aprobacion instantanea implementado
hoy. Cuando el Approval Gateway Agent detecta algo que tocaria
produccion real (ver `docs/notification-gateway.md`), crea una solicitud
local y, si esta activado, envia un mensaje a un chat de Telegram con
instrucciones claras de como responder.

**MVP de esta fase = CLI, no un bot conversacional.** Pau responde
ejecutando un comando en el VPS (`npm run approvals:update`), no
escribiendo en el chat de Telegram. La Seccion "Fase futura" mas abajo
explica que falta para que responder directamente en el chat funcione.

## Como configurar Telegram (paso a paso)

### 1. Crear el bot con @BotFather

1. Abre Telegram y busca **@BotFather**.
2. Envia `/newbot` y sigue las instrucciones (nombre visible + username
   que termine en `bot`, ej. `zentry_ai_department_bot`).
3. BotFather te da un **token** con forma `123456789:AA...`. Ese es tu
   `TELEGRAM_BOT_TOKEN`. No lo compartas ni lo pegues en ningun sitio
   publico — quien lo tenga puede enviar mensajes en nombre del bot.

### 2. Obtener `TELEGRAM_CHAT_ID`

El chat_id identifica a donde debe llegar el mensaje (tu chat personal
con el bot, o un grupo).

**Opcion mas simple (chat personal):**

1. Busca tu bot por su username y envia le cualquier mensaje (ej.
   `hola`) para "abrir" la conversacion — un bot no puede escribirte
   primero.
2. Desde el VPS (o cualquier maquina con `curl`), con el token ya en
   mano:

   ```bash
   curl -s "https://api.telegram.org/bot<TU_TOKEN>/getUpdates"
   ```

3. En la respuesta JSON, busca `"chat":{"id":XXXXXXXXX, ...}` — ese
   numero (puede ser negativo si es un grupo) es tu `TELEGRAM_CHAT_ID`.

**Si prefieres un grupo:** anade el bot al grupo, envia un mensaje
cualquiera en el grupo, y repite el mismo `getUpdates` — el chat_id de un
grupo es un numero negativo.

No hace falta ningun script de este proyecto para este paso — es
puramente configuracion del lado de Telegram, con `curl` o el navegador.

### 3. Rellenar `.env`

```
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_CHAT_ID=987654321
TELEGRAM_APPROVALS_ENABLED=false
```

**Importante:** dejalo en `TELEGRAM_APPROVALS_ENABLED=false` la primera
vez. Con el token y chat_id ya rellenos pero el interruptor en `false`,
nada se envia todavia — es el estado seguro para probar sin riesgo de
mandarte spam si algo esta mal configurado.

### 4. Probar el envio manualmente (opcional, antes de activarlo)

```bash
node -e "
require('dotenv').config();
const { sendTelegramMessage } = require('./dist/core/telegram-gateway');
sendTelegramMessage('Prueba de Zentry AI Department').then(() => console.log('OK')).catch(console.error);
"
```

(Requiere `npm run build` antes, o usar `ts-node -e` con la ruta a
`src/core/telegram-gateway.ts` si prefieres no compilar.) Si prefieres
no tocar la terminal para esto, basta con activar
`TELEGRAM_APPROVALS_ENABLED=true` y esperar a que exista una solicitud
real (hoy no hay ninguna con datos reales, ver mas abajo) — o pedirselo
explicitamente a quien mantiene el proyecto.

### 5. Activar de verdad

```
TELEGRAM_APPROVALS_ENABLED=true
```

A partir de aqui, cualquier solicitud `INSTANT_APPROVAL_REQUIRED` nueva
se envia por Telegram automaticamente dentro del pase diario
(`npm run growth:daily`, paso 13 de 15) o al ejecutar
`npm run approvals:gateway` suelto.

## Como responder a una solicitud

```bash
npm run approvals:list -- --status pending
npm run approvals:update -- --approvalRequestId <id> --answer approved
npm run approvals:update -- --approvalRequestId <id> --answer rejected --reason "no aplica"
npm run approvals:update -- --approvalRequestId <id> --answer snoozed --reason "revisar en septiembre"
```

`approvals:update`:

1. Actualiza el status de la solicitud (`pending` → `approved`/`rejected`/`snoozed`).
2. **Cascada** esa misma decision al Action Backlog o al Work Order
   Registry relacionado (misma mecanica que `actions:update`/
   `work-orders:update`, con su propio registro de auditoria):
   - `approved` sobre una accion → `status: approved`.
   - `approved` sobre una work order → `status: approved_to_prepare`.
   - `rejected` → `status: rejected` en ambos casos.
   - `snoozed` sobre una accion → `status: snoozed`. Sobre una work order
     no hay estado equivalente (no existe `snoozed` en `WorkOrderStatus`)
     — solo queda registrado en la solicitud de aprobacion.
3. **Nunca ejecuta nada real** — ni publica en WordPress, ni activa Ads,
   ni toca GA4/GTM/n8n/qdrant. Solo actualiza estado local, exactamente
   igual que `actions:update`/`work-orders:update`.

## Nunca se aceptan respuestas ambiguas

`--answer` se valida contra la lista cerrada de estados
(`pending`/`approved`/`rejected`/`snoozed`/`expired`/`cancelled`) —
cualquier otro valor falla con un error claro, sin tocar nada. Si en el
futuro se implementa un listener que lea el chat de Telegram (ver mas
abajo), aplicara la misma regla: solo reconoce exactamente "aprobar
`<id>`" / "rechazar `<id>`" / "posponer `<id>`", nunca infiere intencion
de un mensaje ambiguo.

## Con los agentes de hoy, esto nunca se activa (y esta bien)

Los 8 agentes de deteccion del departamento generan siempre acciones
`AUTO_PLAN` (riesgo bajo/medio, planificacion pura) — ninguna llega a
`INSTANT_APPROVAL_REQUIRED`. Eso significa que, aunque actives Telegram
hoy mismo, **no recibiras ningun mensaje** hasta que exista un agente que
proponga algo de impacto real (un borrador de WordPress, un cambio de
Ads, etc.). Es el comportamiento esperado, no un fallo — la tuberia
completa (politica -> gateway -> Telegram -> CLI -> cascada) esta
probada de punta a punta y lista para cuando haga falta.

## Fase futura: respuestas directamente en el chat

Esta fase (O8) implementa el modo CLI (`npm run approvals:update`) por
ser el mas simple y robusto de construir primero, sin depender de un
proceso corriendo permanentemente. Quedan documentadas, pero NO
implementadas, dos evoluciones:

- **Polling manual** (`npm run approvals:listen`): un script que llama a
  `getUpdates` de Telegram cada cierto tiempo, detecta mensajes tipo
  "aprobar `<id>`"/"rechazar `<id>`"/"posponer `<id>`", y llama
  internamente a la misma logica que `approvals:update`. No requiere un
  servicio systemd — se ejecutaria a mano cuando Pau quiera revisar.
- **Bot con long polling como servicio systemd separado**: la version
  "de verdad" (respuesta casi instantanea desde el chat), pero requiere
  un proceso persistente nuevo (`zentry-telegram-listener.service`),
  manejo de reconexion, y mas superficie para vigilar. No se crea
  todavia porque no hace falta: sin ningun agente generando
  `INSTANT_APPROVAL_REQUIRED` con datos reales, no hay urgencia de
  respuesta en tiempo real.

Cuando se implemente cualquiera de las dos, la regla de "nunca aceptar
respuestas ambiguas" y "nunca ejecutar produccion directamente, solo
actualizar estado local" (cascada identica a la de `approvals:update`)
se mantiene sin cambios.

## WhatsApp — fase futura

WhatsApp queda **documentado, no implementado**. No se ha creado ningun
codigo, variable de entorno ni dependencia de WhatsApp en esta fase. Si
se implementa mas adelante (via WhatsApp Business Cloud API), el diseño
esperado seria:

- Un nuevo modulo `src/core/whatsapp-gateway.ts` con la misma forma que
  `telegram-gateway.ts` (`sendMessage`, `sendApprovalRequest`, mismas
  garantias de sanitizado y de no imprimir secretos).
- `notification-policy.json` ganaria un `channel: "whatsapp"` adicional
  (hoy el tipo `NotificationChannel` solo admite `"none" |
  "email_digest" | "telegram"` — habria que ampliarlo).
- Variables nuevas en `.env.example` (`WHATSAPP_*`), documentadas aqui
  antes de implementarse, siguiendo la misma disciplina que esta seccion
  ya establece para Telegram.

No hay ninguna decision tomada sobre cuando construir esto — se
documenta para no perder el hilo, no como compromiso de fecha.

## Seguridad

- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` nunca se imprimen en logs ni
  en consola por ningun script de este proyecto.
- `sanitizeOutgoingText()` (`src/core/telegram-gateway.ts`) redacta
  cualquier valor de variable de entorno "secreta" que apareciera
  literalmente en un mensaje antes de enviarlo, y trunca mensajes
  demasiado largos.
- Los errores de red/API de Telegram se sanitizan antes de loguearse
  (por si la URL de la peticion, que contiene el token, apareciera en el
  mensaje de error).
- Con `TELEGRAM_APPROVALS_ENABLED=false`, el modulo de Telegram ni
  siquiera se invoca — no hace falta tener las credenciales configuradas
  para que el resto del sistema funcione.
- `data/approval-requests.jsonl` es append-only.

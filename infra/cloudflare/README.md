# Despliegue del Worker de aprobaciones (Cloudflare Workers + D1)

Runbook ejecutable paso a paso. Al terminarlo tienes: una base de datos
D1 con el schema aplicado, el Worker desplegado, el webhook de Telegram
apuntando a él y GitHub Actions capaz de crear aprobaciones.

**Nada de esto está desplegado todavía.** Este documento describe cómo
hacerlo, no un estado existente.

La arquitectura y el porqué de cada decisión están en
[`docs/serverless-approvals.md`](../../docs/serverless-approvals.md).
Esto de aquí es solo el procedimiento.

Ficheros de este directorio:

| Fichero | Qué es |
| --- | --- |
| `wrangler.toml` | Configuración del Worker: entrypoint, binding de D1 y variables **no** secretas |
| `schema.sql` | DDL de las tres tablas (`approvals`, `processed_updates`, `rejection_prompts`) |
| `set-telegram-webhook.sh` | Registra / consulta / retira el webhook de Telegram |

---

## 0. Antes de empezar

Necesitas:

- Cuenta de Cloudflare (el plan gratuito basta para este volumen; ver la
  sección de costes de `docs/serverless-approvals.md`).
- Node.js instalado. `wrangler` se usa con `npx`, no hace falta
  instalarlo global ni añadirlo a `package.json`.
- El bot de Telegram ya creado y su token a mano.
- Tu `chat_id` y tu `user_id` de Telegram.
- Un PAT de GitHub para que el Worker pueda disparar el workflow de
  producción (ver paso 4).
- Permisos de admin en el repo, para poner los secretos de Actions.

Todos los comandos se ejecutan **desde este directorio**:

```bash
cd infra/cloudflare
```

(Las rutas de `wrangler.toml` son relativas a este directorio. Si
prefieres lanzarlo desde la raíz del repo, añade
`--config infra/cloudflare/wrangler.toml` a cada comando de wrangler.)

### Autenticarse

```bash
npx wrangler login
npx wrangler whoami     # confirma cuenta y account_id
```

---

## 1. Crear la base de datos D1

```bash
npx wrangler d1 create zentry-approvals
```

Devuelve un bloque con `database_id`. **Cópialo a `wrangler.toml`**, en
`[[d1_databases]]`, sustituyendo el placeholder `<rellenar: ...>`.

Comprueba que existe:

```bash
npx wrangler d1 list
```

---

## 2. Aplicar el schema

```bash
npx wrangler d1 execute zentry-approvals --remote --file=./schema.sql
```

`--remote` es obligatorio: sin esa bandera wrangler escribe en la copia
**local** de desarrollo y la base de datos real se queda vacía.

Verifica que están las tres tablas:

```bash
npx wrangler d1 execute zentry-approvals --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Debe listar `approvals`, `processed_updates` y `rejection_prompts`.

`schema.sql` es idempotente (todo es `CREATE ... IF NOT EXISTS`): puedes
volver a ejecutarlo sin perder datos. Lo que **no** hace es migrar
tablas ya creadas — si cambias una columna, eso es una migración aparte
y hay que escribirla a mano.

---

## 3. Generar los valores de los secretos

Dos de ellos los inventas tú ahora. Genéralos con entropía real y
**guárdalos en tu gestor de contraseñas antes de seguir**: el
`secret put` de wrangler no te los va a volver a enseñar nunca.

```bash
# Bearer de servicio: lo comparten GitHub Actions (APPROVALS_API_TOKEN)
# y el Worker (SERVICE_TOKEN). Tienen que ser el MISMO valor.
openssl rand -hex 32

# secret_token del webhook de Telegram: lo comparten Telegram
# (parámetro de setWebhook) y el Worker (TELEGRAM_WEBHOOK_SECRET).
openssl rand -hex 32
```

Son dos secretos **distintos** a propósito: el webhook público y la API
de servicio se autentican con credenciales separadas, así que
comprometer una no da acceso a la otra.

---

## 4. Cargar los secretos en el Worker

Uno por uno. `wrangler secret put` pide el valor por stdin: **no** lo
pases como argumento y **no** lo escribas en ningún fichero del repo.

```bash
npx wrangler secret put SERVICE_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID
npx wrangler secret put TELEGRAM_ALLOWED_CHAT_ID
npx wrangler secret put GITHUB_DISPATCH_TOKEN
```

| Secreto | Valor que se pega |
| --- | --- |
| `SERVICE_TOKEN` | El primer `openssl rand` del paso 3 |
| `TELEGRAM_WEBHOOK_SECRET` | El segundo `openssl rand` del paso 3 |
| `TELEGRAM_BOT_TOKEN` | El token del bot (`123456:AA...`) |
| `TELEGRAM_ALLOWED_USER_ID` | Tu `user_id` numérico de Telegram |
| `TELEGRAM_ALLOWED_CHAT_ID` | El `chat_id` del chat autorizado |
| `GITHUB_DISPATCH_TOKEN` | PAT de GitHub, ver abajo |

**El PAT de GitHub** (`GITHUB_DISPATCH_TOKEN`) debe ser *fine-grained*,
limitado **a este repositorio** y con el permiso mínimo que permita
`workflow_dispatch` (`Actions: Read and write`). No le des acceso a
`contents: write` ni a otros repos: lo único que tiene que poder hacer
es lanzar un workflow.

Comprueba qué secretos hay cargados (muestra los **nombres**, nunca los
valores):

```bash
npx wrangler secret list
```

Las tres variables **no** secretas (`GITHUB_REPOSITORY`,
`GITHUB_PRODUCTION_WORKFLOW`, `GITHUB_WORKFLOW_REF`) ya están en
`[vars]` de `wrangler.toml`. Revisa que apuntan al repo, al fichero de
workflow y a la rama correctos antes de desplegar.

---

## 5. Desplegar

```bash
npx wrangler deploy
```

La salida incluye la URL pública, del estilo
`https://zentry-approvals.<tu-subdominio>.workers.dev`. **Anótala**: es
el valor de `APPROVALS_API_URL`.

Verifica el health check:

```bash
curl -s https://zentry-approvals.<tu-subdominio>.workers.dev/health
```

Debe responder 200. Si responde 500, mira los logs en vivo con
`npx wrangler tail` y repite la petición.

Comprueba también que la API de servicio **rechaza** a quien no lleva el
bearer — que responda 200 aquí sería un fallo grave:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://zentry-approvals.<tu-subdominio>.workers.dev/api/approvals/no-existe
# esperado: 401
```

---

## 6. Registrar el webhook de Telegram

El script lee los secretos **del entorno**, nunca de argumentos (un
argumento quedaría en `~/.bash_history` y visible en `ps`).

```bash
export TELEGRAM_BOT_TOKEN='...'                 # ojo: espacio delante para no dejarlo en el historial
export TELEGRAM_WEBHOOK_SECRET='...'            # el MISMO del paso 4
export APPROVALS_API_URL='https://zentry-approvals.<tu-subdominio>.workers.dev'

./set-telegram-webhook.sh set
./set-telegram-webhook.sh info
```

En `info`, lo que tiene que salir:

- `url` acabada en `/telegram/webhook`;
- `pending_update_count: 0`;
- `last_error_message` vacío.

Si aparece `last_error_message` con un 401, el `TELEGRAM_WEBHOOK_SECRET`
del Worker y el registrado en Telegram **no coinciden**. No hay forma de
consultarlo (`getWebhookInfo` no devuelve el secreto): se vuelven a
poner los dos, el `wrangler secret put` y el `set`.

Cuando termines, limpia el entorno de la sesión:

```bash
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
```

---

## 7. Secretos en GitHub Actions

Los workflows hablan con el Worker por HTTPS. **Nunca** tienen
credenciales de D1.

```bash
gh secret set APPROVALS_API_URL    # https://zentry-approvals.<sub>.workers.dev
gh secret set APPROVALS_API_TOKEN  # el MISMO valor que SERVICE_TOKEN
```

(O desde *Settings → Secrets and variables → Actions* en la web.)

El resto de secretos que necesita el carril de producción —
`WORDPRESS_PRODUCTION_BASE_URL`, `WORDPRESS_PRODUCTION_USERNAME`,
`WORDPRESS_PRODUCTION_APP_PASSWORD` y los de staging — viven **solo**
en GitHub Actions. El Worker no los tiene ni los necesita: no escribe en
WordPress. La tabla completa está en `docs/serverless-approvals.md`.

---

## 8. Verificación de extremo a extremo

Sin publicar nada en producción:

```bash
# ¿qué hay en la base de datos?
npx wrangler d1 execute zentry-approvals --remote \
  --command "SELECT approval_id, status, updated_at FROM approvals ORDER BY updated_at DESC LIMIT 10;"

# ¿está el webhook siendo idempotente?
npx wrangler d1 execute zentry-approvals --remote \
  --command "SELECT COUNT(*) AS updates_procesados FROM processed_updates;"

# logs en vivo mientras pulsas un botón en Telegram
npx wrangler tail
```

Prueba real recomendada: lanza una pasada del departamento con el
interruptor de producción **apagado**
(`DEPARTMENT_PRODUCTION_APPLY_ENABLED` distinto de `true`). El cambio
llega a `awaiting_approval`, el mensaje llega a Telegram, pulsas
APROBAR, y compruebas que:

1. la fila pasa a `approved` y luego a `production_queued`;
2. el workflow de producción se dispara;
3. el workflow no publica nada porque el interruptor está apagado, y lo
   dice explícitamente.

Así se valida todo el circuito sin tocar la web real.

---

## Cómo revertir

De menos a más drástico. Los tres primeros pasos **no** pierden datos.

### a) Parar las decisiones, conservarlo todo

Retira el webhook. Telegram deja de entregar nada, los botones dejan de
tener efecto y las aprobaciones se quedan en D1 tal cual estaban.

```bash
export TELEGRAM_BOT_TOKEN='...'
./set-telegram-webhook.sh delete
unset TELEGRAM_BOT_TOKEN
```

Para reactivarlo, el paso 6 otra vez.

### b) Volver a la versión anterior del Worker

```bash
npx wrangler deployments list
npx wrangler rollback [<version-id>]
```

D1 no se toca: los datos siguen ahí.

### c) Cortar el carril de producción sin tocar la infraestructura

Pon `DEPARTMENT_PRODUCTION_APPLY_ENABLED` / `PRODUCTION_EXECUTION_ENABLED`
a algo distinto de `true` en el workflow de producción. Las aprobaciones
se siguen registrando; simplemente no se publica nada. Es el freno de
mano: no pierde ninguna decisión humana.

### d) Rotar un secreto comprometido

```bash
npx wrangler secret put <NOMBRE>   # sobrescribe el valor
npx wrangler deploy                # que el Worker recoja el nuevo valor
```

Si rotas `SERVICE_TOKEN`, actualiza `APPROVALS_API_TOKEN` en GitHub **a
la vez**: mientras no coincidan, Actions no puede crear aprobaciones.
Si rotas `TELEGRAM_WEBHOOK_SECRET`, hay que volver a ejecutar
`./set-telegram-webhook.sh set` con el valor nuevo.

### e) Desmontarlo entero (destructivo)

```bash
./set-telegram-webhook.sh delete
npx wrangler delete                                   # borra el Worker
npx wrangler d1 delete zentry-approvals               # BORRA LA BASE DE DATOS
```

El último comando **destruye el historial completo de aprobaciones y de
feedback humano**, que no está replicado en ningún otro sitio. Antes,
saca una copia:

```bash
npx wrangler d1 export zentry-approvals --remote --output ./backup-approvals.sql
```

Guarda ese fichero fuera del repositorio: contiene el contenido de los
cambios y los motivos de rechazo escritos por una persona.

---

## Operación diaria

```bash
npx wrangler tail                                     # logs en vivo
npx wrangler d1 execute zentry-approvals --remote \
  --command "SELECT status, COUNT(*) FROM approvals GROUP BY status;"
```

Copia de seguridad periódica (recomendable; **no** está automatizada):

```bash
npx wrangler d1 export zentry-approvals --remote --output ./backup-$(date +%F).sql
```

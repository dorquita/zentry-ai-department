#!/usr/bin/env bash
#
# Registra (o retira, o consulta) el webhook de Telegram que apunta al
# Worker de aprobaciones.
#
#   ./set-telegram-webhook.sh set      registra el webhook con secret_token
#   ./set-telegram-webhook.sh info     consulta getWebhookInfo
#   ./set-telegram-webhook.sh delete   retira el webhook (revertir)
#
# LOS SECRETOS SE LEEN DEL ENTORNO, NUNCA DE ARGUMENTOS.
#
# Un `./set-telegram-webhook.sh set 123456:ABC...` dejaria el token del
# bot escrito para siempre en ~/.bash_history y visible en `ps` para
# cualquier usuario de la maquina. Este script se niega a aceptarlos por
# ahi (ver `reject_secret_looking_args` mas abajo).
#
# Variables de entorno:
#
#   TELEGRAM_BOT_TOKEN        (obligatoria siempre)  token del bot
#   TELEGRAM_WEBHOOK_SECRET   (obligatoria en `set`) valor del secret_token
#   APPROVALS_API_URL         (obligatoria en `set`) URL base del Worker,
#                             p.ej. https://zentry-approvals.<sub>.workers.dev
#   DROP_PENDING_UPDATES      (opcional, "true")     descarta los updates
#                             que Telegram tenga en cola. Por defecto NO
#                             se descartan: uno de ellos podria ser una
#                             decision humana real todavia sin procesar.
#   TELEGRAM_API_BASE         (opcional)             por defecto https://api.telegram.org
#
# Forma recomendada de cargarlas sin que queden en el historial:
#
#   set -a; . ./.env.telegram; set +a     # fichero fuera de git, chmod 600
#   ./set-telegram-webhook.sh set
#
# El script NUNCA imprime el token ni el secreto: todo lo que sale por
# pantalla pasa antes por `redact`.

set -euo pipefail

# AVISO: registrar un webhook DESACTIVA getUpdates para ese bot (el Bot
# API devuelve 409 a partir de ese momento). Si este token es el mismo
# que usa el poller del VPS (scripts/telegram-approvals-service.ts), ese
# servicio dejara de funcionar. Ver la seccion "conflicto de bot" del
# README de este directorio: la recomendacion es usar un SEGUNDO bot.
echo "AVISO: registrar el webhook desactiva getUpdates para este bot." >&2
echo "       Si el poller del VPS usa el MISMO token, dejara de recibir nada (409)." >&2
echo "       Ver infra/cloudflare/README.md, seccion 'conflicto de bot con el sistema V1'." >&2

readonly TELEGRAM_API_BASE="${TELEGRAM_API_BASE:-https://api.telegram.org}"

# Ruta del webhook. Es la misma constante que API_ROUTES.telegramWebhook
# en src/approvals/api-contract.ts: si alli cambia, aqui tambien.
readonly WEBHOOK_PATH="/telegram/webhook"

# Solo estos dos tipos de update le interesan al Worker: el mensaje de
# texto con el motivo del rechazo y la pulsacion de los botones. Todo lo
# demas (ediciones, canales, encuestas...) ni se recibe: menos superficie
# y menos invocaciones del Worker.
readonly ALLOWED_UPDATES='["message","callback_query"]'

tmp_dir=""
cleanup() {
  if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT INT TERM

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'Uso: %s <set|info|delete>\n' "${0##*/}" >&2
  printf 'Los secretos se leen del entorno (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET), nunca como argumentos.\n' >&2
}

# Reemplaza cualquier aparicion de los secretos por un marcador antes de
# imprimir. Se aplica a stdout Y a stderr de curl: un mensaje de error de
# curl puede incluir la URL completa, y la URL de Telegram lleva el token
# dentro.
redact() {
  local out
  out="$(cat)"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    out="${out//"$TELEGRAM_BOT_TOKEN"/<TELEGRAM_BOT_TOKEN>}"
  fi
  if [ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
    out="${out//"$TELEGRAM_WEBHOOK_SECRET"/<TELEGRAM_WEBHOOK_SECRET>}"
  fi
  printf '%s\n' "$out"
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    die "falta la variable de entorno ${name}. No se acepta como argumento a proposito: quedaria en el historial del shell."
  fi
}

# Si alguien intenta pasar el token "por si acaso", se corta aqui en vez
# de ignorarlo en silencio: el usuario tiene que saber que acaba de
# escribir un secreto en su historial y que conviene rotarlo.
reject_secret_looking_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      set | info | delete) continue ;;
    esac
    die "argumento no reconocido. Este script NO acepta tokens ni secretos como argumentos (quedarian en el historial del shell y en \`ps\`). Exportalos como variables de entorno. Si acabas de escribir un secreto en la linea de comandos, rotalo."
  done
}

# Llama a un metodo de la Bot API.
#
# La URL lleva el token dentro, asi que NO se pasa por la linea de
# comandos: se escribe en un fichero de configuracion temporal con
# permisos 600 que curl lee con `--config`. Asi el token no aparece en la
# tabla de procesos. El cuerpo (que lleva el secret_token) va por otro
# fichero temporal con `--data @fichero`: en `ps` solo se ve la ruta.
call_telegram() {
  local method="$1"
  local body_file="${2:-}"
  local cfg="${tmp_dir}/curl.cfg"
  local -a extra=()

  : >"$cfg"
  chmod 600 "$cfg"
  {
    printf 'url = "%s/bot%s/%s"\n' "$TELEGRAM_API_BASE" "$TELEGRAM_BOT_TOKEN" "$method"
    printf 'silent\n'
    printf 'show-error\n'
    printf 'max-time = 30\n'
  } >>"$cfg"

  if [ -n "$body_file" ]; then
    extra=(--header "Content-Type: application/json" --data "@${body_file}")
  fi

  # `|| true`: se quiere ver el cuerpo de la respuesta aunque curl salga
  # con codigo != 0; el veredicto lo da `"ok":true` mas abajo.
  curl --config "$cfg" ${extra[@]+"${extra[@]}"} 2>&1 || true
}

# Ejecuta un metodo y decide si fue bien. Nunca imprime la respuesta en
# crudo: siempre pasa por `redact`.
run_method() {
  local method="$1"
  local body_file="${2:-}"
  local response

  response="$(call_telegram "$method" "$body_file")"

  printf '%s' "$response" | redact

  case "$response" in
    *'"ok":true'*) return 0 ;;
    *) die "Telegram rechazo la llamada a ${method} (ver la respuesta de arriba)." ;;
  esac
}

cmd_set() {
  require_env TELEGRAM_BOT_TOKEN
  require_env TELEGRAM_WEBHOOK_SECRET
  require_env APPROVALS_API_URL

  # Telegram acepta secret_token de 1 a 256 caracteres A-Z a-z 0-9 _ -.
  # Se valida el formato SIN imprimir el valor: un secreto con un
  # caracter no permitido hace que setWebhook falle con un mensaje
  # generico y se pierde media tarde averiguando por que.
  if ! [[ "$TELEGRAM_WEBHOOK_SECRET" =~ ^[A-Za-z0-9_-]{1,256}$ ]]; then
    die "TELEGRAM_WEBHOOK_SECRET tiene un formato que Telegram no acepta. Solo se permiten A-Z a-z 0-9 _ - y entre 1 y 256 caracteres. (No se imprime el valor.)"
  fi
  if [ "${#TELEGRAM_WEBHOOK_SECRET}" -lt 32 ]; then
    die "TELEGRAM_WEBHOOK_SECRET es demasiado corto (menos de 32 caracteres). Generalo con: openssl rand -hex 32"
  fi

  local base="${APPROVALS_API_URL%/}"
  case "$base" in
    https://*) ;;
    *) die "APPROVALS_API_URL tiene que empezar por https:// (Telegram no entrega webhooks por HTTP plano). Valor recibido: ${base}" ;;
  esac
  if ! [[ "$base" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
    die "APPROVALS_API_URL tiene que ser SOLO la URL base del Worker (sin ruta), p.ej. https://zentry-approvals.<sub>.workers.dev. Valor recibido: ${base}"
  fi

  local webhook_url="${base}${WEBHOOK_PATH}"
  local drop="false"
  if [ "${DROP_PENDING_UPDATES:-}" = "true" ]; then
    drop="true"
  fi

  local body_file="${tmp_dir}/body.json"
  : >"$body_file"
  chmod 600 "$body_file"
  # El secret_token esta validado contra [A-Za-z0-9_-] y la URL contra
  # [A-Za-z0-9.:/-], asi que ninguno de los dos necesita escapado JSON.
  printf '{"url":"%s","secret_token":"%s","allowed_updates":%s,"drop_pending_updates":%s,"max_connections":10}\n' \
    "$webhook_url" "$TELEGRAM_WEBHOOK_SECRET" "$ALLOWED_UPDATES" "$drop" >>"$body_file"

  printf 'Registrando webhook -> %s\n' "$webhook_url"
  printf '  allowed_updates      : %s\n' "$ALLOWED_UPDATES"
  printf '  drop_pending_updates : %s\n' "$drop"
  printf '  secret_token         : (configurado, %s caracteres, no se imprime)\n' "${#TELEGRAM_WEBHOOK_SECRET}"
  printf '\n'

  run_method setWebhook "$body_file"

  printf '\nHecho. Comprueba el estado con: %s info\n' "${0##*/}"
  printf 'RECUERDA: el MISMO valor de TELEGRAM_WEBHOOK_SECRET tiene que estar cargado en el Worker\n'
  printf '          (npx wrangler secret put TELEGRAM_WEBHOOK_SECRET). Si no coinciden, el Worker\n'
  printf '          rechazara todas las entregas y ningun boton de Telegram hara nada.\n'
}

cmd_info() {
  require_env TELEGRAM_BOT_TOKEN

  printf 'Estado actual del webhook (getWebhookInfo):\n\n'
  run_method getWebhookInfo ""

  printf '\nQue mirar:\n'
  printf '  url                    -> debe acabar en %s\n' "$WEBHOOK_PATH"
  printf '  has_custom_certificate -> false\n'
  printf '  pending_update_count   -> 0 en reposo. Si crece, el Worker no esta devolviendo 200.\n'
  printf '  last_error_message     -> vacio. Si dice "Wrong response ... 401", el secret_token del\n'
  printf '                            Worker y el registrado aqui no coinciden.\n'
  printf '\nNota: getWebhookInfo NO devuelve el secret_token. Si sospechas que no coinciden,\n'
  printf 'no hay forma de comprobarlo: se vuelven a poner los dos (`secret put` y `set`).\n'
}

cmd_delete() {
  require_env TELEGRAM_BOT_TOKEN

  local drop="false"
  if [ "${DROP_PENDING_UPDATES:-}" = "true" ]; then
    drop="true"
  fi

  local body_file="${tmp_dir}/body.json"
  : >"$body_file"
  chmod 600 "$body_file"
  printf '{"drop_pending_updates":%s}\n' "$drop" >>"$body_file"

  printf 'Retirando el webhook (drop_pending_updates=%s)...\n\n' "$drop"
  run_method deleteWebhook "$body_file"

  printf '\nWebhook retirado. A partir de ahora Telegram NO entrega nada al Worker:\n'
  printf 'los botones de aprobar/rechazar dejan de tener efecto. Las aprobaciones ya\n'
  printf 'creadas siguen en D1 intactas, en el estado en el que estaban.\n'
}

main() {
  if [ "$#" -ne 1 ]; then
    usage
    exit 1
  fi
  reject_secret_looking_args "$@"

  tmp_dir="$(mktemp -d)"
  chmod 700 "$tmp_dir"

  case "$1" in
    set) cmd_set ;;
    info) cmd_info ;;
    delete) cmd_delete ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"

#!/usr/bin/env bash
# Будильник Аи: раз в минуту правит одно сообщение в канале «Мост».
#
# Платформа будит сердце только обновлением из Telegram. Этот файл и есть такое
# обновление по расписанию: отдельный бот-будильник правит своё сообщение в
# канале, Telegram сообщает об этом Аи, она просыпается — и напоминает,
# досылает отложенное, присылает утреннюю сводку. Без него всё это случается
# только когда ей кто-нибудь напишет.
#
# Где запускать: второй телефон (Termux) или ноутбук (Git Bash). Подробно —
# docs/ALARM.md. Ключи живут вне репозитория, в файле ~/.heart-alarm.env:
#
#   ALARM_BOT_TOKEN=...   токен бота-будильника (не Аи и не Юи)
#   ALARM_CHAT_ID=...     числовой ID канала «Мост»
#
# Необязательно:
#   ALARM_EVERY=60        период в секундах (не меньше 20)
#   ALARM_MODE=edit       edit — править одно сообщение; post — новое вместо старого
set -u

ENV_FILE="${ALARM_ENV:-$HOME/.heart-alarm.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

if [ -z "${ALARM_BOT_TOKEN:-}" ] || [ -z "${ALARM_CHAT_ID:-}" ]; then
  echo "Нет ALARM_BOT_TOKEN или ALARM_CHAT_ID. Запишите их в $ENV_FILE (см. docs/ALARM.md)." >&2
  exit 1
fi

EVERY="${ALARM_EVERY:-60}"
case "$EVERY" in ''|*[!0-9]*) EVERY=60 ;; esac
[ "$EVERY" -lt 20 ] && EVERY=20
MODE="${ALARM_MODE:-edit}"
STATE="${ALARM_STATE:-$HOME/.heart-alarm.msg}"
API="https://api.telegram.org/bot${ALARM_BOT_TOKEN}"

# Телефон не должен усыплять Termux, пока будильник идёт.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

call() { curl -sS --max-time 20 "$API/$1" "${@:2}" 2>/dev/null; }
id_of() { sed -n 's/.*"message_id":\([0-9][0-9]*\).*/\1/p' | head -n 1; }

post() {
  local answer
  answer=$(call sendMessage -d "chat_id=$ALARM_CHAT_ID" -d "disable_notification=true" --data-urlencode "text=$1")
  printf '%s' "$answer" | id_of
}

id=$(cat "$STATE" 2>/dev/null || true)
fails=0
echo "Будильник идёт: раз в ${EVERY} с, режим ${MODE}. Остановить — Ctrl+C."

while true; do
  text="⏰ $(date '+%d.%m %H:%M:%S')"
  ok=0
  if [ "$MODE" = "post" ]; then
    new=$(post "$text")
    if [ -n "$new" ]; then
      ok=1
      [ -n "$id" ] && call deleteMessage -d "chat_id=$ALARM_CHAT_ID" -d "message_id=$id" >/dev/null
      id="$new"; printf '%s\n' "$id" > "$STATE"
    fi
  elif [ -z "$id" ]; then
    id=$(post "$text")
    [ -n "$id" ] && { ok=1; printf '%s\n' "$id" > "$STATE"; }
  else
    answer=$(call editMessageText -d "chat_id=$ALARM_CHAT_ID" -d "message_id=$id" --data-urlencode "text=$text")
    case "$answer" in
      *'"ok":true'*|*'not modified'*) ok=1 ;;
      # Сообщение удалили руками: в следующий раз будет новое.
      *'not found'*|*"can't be edited"*|*'MESSAGE_ID_INVALID'*) id=""; rm -f "$STATE" ;;
    esac
  fi

  if [ "$ok" = 1 ]; then
    fails=0
  else
    fails=$((fails + 1))
    # Молчать о первой неудаче: связь на телефоне пропадает на секунды.
    [ "$fails" = 3 ] && echo "$(date '+%H:%M') три неудачи подряд: нет связи, либо бот-будильник не админ канала." >&2
  fi

  # Спать до следующей границы периода: удары приходятся на начало минуты.
  now=$(date +%s)
  sleep $((EVERY - now % EVERY))
done

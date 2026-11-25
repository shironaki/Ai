#!/usr/bin/env bash
# Дом Аи на телефоне: автопубликация и будильник — без GitHub Actions.
#
# Один процесс делает два дела:
#   • следит за веткой в GitHub: пришла новая сборка — проверяет её и
#     публикует сам, как это делала кнопка deploy;
#   • будит сердце, чтобы напоминания и сводка приходили без сообщений.
#
#   bash scripts/phone.sh           работать: вечный цикл (остановить — Ctrl+C)
#   bash scripts/phone.sh check     проверить настройку; ничего не публикует.
#                                   Нет файла ключей — кладёт пустой
#   bash scripts/phone.sh deploy    опубликовать сейчас то, что лежит в ветке
#   bash scripts/phone.sh tick      разбудить сердце один раз
#   bash scripts/phone.sh once      один круг цикла — для cron и для тестов
#   bash scripts/phone.sh events    спросить платформу, какие события она отдаёт
#                                   (нужно для «секретаря»); ничего не публикует
#   bash scripts/phone.sh door      дверь отдельного приложения (docs/DOOR.md): по
#                                   шагам — бот двери, канал, ключ, публикация
#                                   сердца с ключом, опыт; потом снова работает дом
#
# Ключи живут вне репозитория, в файле ~/.heart.env — строки «ИМЯ=значение»,
# кавычки не нужны. Читаются один раз, при запуске. Подробно — docs/PHONE.md.
#
#   TGCLOUD_HEART_TOKEN=…   токен публикации (app…:…)
#   AI_PROVIDER_KEY=…       ключ модели
#   OWNER_TG_ID=…           числовой ID владельца
#   KEY_GIGACHAT=…          ключ запасных мозгов: имя после KEY_ — id провайдера
#                           (GIGACHAT, EXPLABS, CLOUDFLARE — список в docs/BRAINS.md)
#   KEY_TAVILY=…            поиск в интернете; ещё KEY_EXA и KEY_YOU — спрашиваются
#                           в этом порядке, без ключей остаётся Википедия
#   KEY_CLOUDFLARE=ID:токен  рисование и запасной мозг: ID аккаунта, двоеточие, токен
#   KEY_DOOR=канал:секрет   дверь отдельного приложения (docs/DOOR.md): номер закрытого
#                           канала двери, двоеточие, секрет от 32 знаков
#   DOOR_BOT_TOKEN=…        токен бота двери — своего, от @BotFather: не Аи и не бота,
#                           который живёт на сервере. Обе строки пишет «phone.sh door»
#   HEART_BRANCH=…          за какой веткой следить (без строки — ветка, с
#                           которой склонирована папка)
#   ALARM_BOT_TOKEN=…       токен любого бота, кроме Аи, — минутный будильник
#   ALARM_CHAT_ID=…         числовой ID канала «Мост»
#
# Необязательно:
#   HEART_DEPLOY_ON=build   build — публиковать, когда сменился номер сборки;
#                           commit — каждый новый коммит
#   HEART_TESTS=on          off — не гонять локальные тесты перед публикацией
#   HEART_SYNC_EVERY=180    как часто смотреть в GitHub, секунд
#   ALARM_EVERY=60          период будильника через канал, секунд
#   ALARM_RUN_EVERY=600     период будильника без второго бота, секунд
#   HEART_RETRY_EVERY=3600  как часто повторять публикацию, не вышедшую трижды
#   HEART_CALL_LIMIT=420    сколько секунд ждать ответа платформы на один запрос
#   HEART_DOOR_WAIT=600     сколько секунд «door» ждёт, пока бота двери сделают
#                           администратором канала
#
# В облако уходит не папка с Аи, а копия коммита (~/.heart/stage): в неё
# вписываются ключи, из неё убираются комментарии (scripts/slim.mjs) — код легче
# на пятую часть. Папка с Аи при публикации не меняется.
#
# Весь файл — одна функция: bash читает её целиком до запуска, поэтому
# обновление самого скрипта из GitHub не ломает идущий процесс.
set -u

main() {
  local MODE="${1:-run}"
  # Второе слово режима «door» — токен нового бота двери (можно и без него: спросят).
  local DOOR_ARG="${2:-}"
  # REPO, LIVE, LIVE_CLEAN, LOCK, LOCKED, NAP — не local: ими пользуется уборка
  # при выходе, а она срабатывает уже после main, когда local-переменных нет.
  local SELF
  SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  REPO="$(cd "$(dirname "$SELF")/.." && pwd)"
  cd "$REPO" || { echo "Нет папки репозитория: $REPO" >&2; return 1; }

  local HOME_DIR="${HEART_HOME:-$HOME/.heart}"
  local ENV_FILE="${HEART_ENV:-$HOME/.heart.env}"
  mkdir -p "$HOME_DIR" || { echo "Не могу создать $HOME_DIR" >&2; return 1; }
  local LOG="$HOME_DIR/phone.log" DEPLOY_LOG="$HOME_DIR/deploy.log" TEST_LOG="$HOME_DIR/tests.log"
  local CLI_VERSION="0.2.0"
  local CLI="${HEART_CLI:-$HOME_DIR/cli/node_modules/@tgcloud/cli/bin/tgcloud.js}"

  log() {
    local line
    line="$(date '+%d.%m %H:%M') $*"
    echo "$line"
    echo "$line" >> "$LOG" 2>/dev/null
    # Журнал не растёт без конца: больше мегабайта — остаётся хвост.
    if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1000000 ]; then
      tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
    fi
  }

  # Файл ключей читается как текст, а не исполняется: JSON с кавычками и
  # знаки вроде «$» в ключе остаются собой.
  # Имя — заглавные латинские буквы, цифры и «_»: всё остальное — не настройка,
  # а, скорее всего, ключ, вставленный отдельной строкой. Такие строки не
  # читаются, а их номера запоминаются для проверки (сам текст — никогда).
  local UNREAD=""
  load_env() {
    local file="$1" line key value n=0
    [ -f "$file" ] || return 1
    UNREAD=""
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      line="${line%$'\r'}"
      case "$line" in ''|'#'*) continue ;; esac
      case "${line// /}" in '') continue ;; esac
      case "$line" in *=*) ;; *) UNREAD="$UNREAD $n"; continue ;; esac
      key="${line%%=*}"; value="${line#*=}"
      key="${key#export }"; key="${key// /}"
      case "$key" in ''|[!A-Z]*|*[!A-Z0-9_]*) UNREAD="$UNREAD $n"; continue ;; esac
      value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
      case "$value" in
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
      esac
      export "$key=$value"
    done < "$file"
    return 0
  }
  # Прежний файл будильника тоже годится: в нём те же два имени.
  load_env "$HOME/.heart-alarm.env" || true
  UNREAD=""
  local HAVE_ENV=0
  load_env "$ENV_FILE" && HAVE_ENV=1

  # За какой веткой следить. Строка HEART_BRANCH — главное слово. Нет её —
  # ветка, с которой склонирована папка, а не main: в main этого скрипта может
  # ещё не быть. После первого обновления папка стоит на коммите, а не на
  # ветке, поэтому имя запоминается.
  local BRANCH="${HEART_BRANCH:-}" BRANCH_FROM="строка HEART_BRANCH"
  if [ -z "$BRANCH" ]; then
    BRANCH="$(git -C "$REPO" symbolic-ref -q --short HEAD 2>/dev/null || true)"
    if [ -n "$BRANCH" ]; then
      BRANCH_FROM="ветка папки"
      printf '%s\n' "$BRANCH" > "$HOME_DIR/branch" 2>/dev/null
    else
      BRANCH="$(sed -n '1p' "$HOME_DIR/branch" 2>/dev/null || true)"
      BRANCH_FROM="ветка папки, как в прошлый раз"
    fi
    [ -n "$BRANCH" ] || { BRANCH="main"; BRANCH_FROM="по умолчанию"; }
  fi
  local DEPLOY_ON="${HEART_DEPLOY_ON:-build}"
  local SYNC_EVERY="${HEART_SYNC_EVERY:-180}"
  local EVERY="${ALARM_EVERY:-60}"
  local RUN_EVERY="${ALARM_RUN_EVERY:-600}"
  local RETRY_EVERY="${HEART_RETRY_EVERY:-3600}"
  # Сколько ждать ответа платформы на один запрос и сколько выждать перед повтором оборванного.
  local CALL_LIMIT="${HEART_CALL_LIMIT:-420}" RETRY_PAUSE="${HEART_RETRY_PAUSE:-20}"
  case "$CALL_LIMIT" in ''|*[!0-9]*) CALL_LIMIT=420 ;; esac
  [ "$CALL_LIMIT" -lt 5 ] && CALL_LIMIT=5
  case "$RETRY_PAUSE" in ''|*[!0-9]*) RETRY_PAUSE=20 ;; esac
  case "$SYNC_EVERY" in ''|*[!0-9]*) SYNC_EVERY=180 ;; esac
  case "$EVERY" in ''|*[!0-9]*) EVERY=60 ;; esac
  case "$RUN_EVERY" in ''|*[!0-9]*) RUN_EVERY=600 ;; esac
  [ "$EVERY" -lt 20 ] && EVERY=20
  [ "$RUN_EVERY" -lt 120 ] && RUN_EVERY=120
  [ "$SYNC_EVERY" -lt 30 ] && SYNC_EVERY=30
  case "$RETRY_EVERY" in ''|*[!0-9]*) RETRY_EVERY=3600 ;; esac
  [ "$RETRY_EVERY" -lt 300 ] && RETRY_EVERY=300
  # В Git Bash на Windows тесты падают из-за среды, а не кода (PROJECT.md §4.5).
  local TESTS="${HEART_TESTS:-}"
  if [ -z "$TESTS" ]; then
    case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) TESTS=off ;; *) TESTS=on ;; esac
  fi

  local TOKEN="${TGCLOUD_HEART_TOKEN:-}"
  local VOICE="${ALARM_BOT_TOKEN:-}" ROOM="${ALARM_CHAT_ID:-}"
  # Образец вместо токена бота или ID канала — всё равно что пустая строка:
  # будильник тогда идёт через платформу, а не стучится в Telegram впустую.
  local VOICE_BAD=0 ROOM_BAD=0
  if [ -n "$VOICE" ] && ! printf '%s' "$VOICE" | LC_ALL=C grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then VOICE_BAD=1; VOICE=""; fi
  if [ -n "$ROOM" ] && ! printf '%s' "$ROOM" | LC_ALL=C grep -Eq '^(-?[0-9]+|@[A-Za-z0-9_]+)$'; then ROOM_BAD=1; ROOM=""; fi
  # О своих сообщениях бот обновлений не получает: будильник голосом самой Аи
  # её не разбудит. Число перед двоеточием в токене бота — его номер; если оно
  # то же, что после «app» в токене публикации, это один и тот же бот, и
  # будильник идёт через платформу. (Что номера совпадают именно у одного
  # бота — предположение о платформе: не совпали — остаётся подсказка в check.)
  local VOICE_SELF=0
  if [ -n "$VOICE" ] && [ -n "$TOKEN" ] && [ "${VOICE%%:*}" = "$(printf '%s' "${TOKEN%%:*}" | sed 's/^app//')" ]; then VOICE_SELF=1; fi
  local CHANNEL_ALARM=0
  if [ -n "$VOICE" ] && [ -n "$ROOM" ] && [ "$VOICE_SELF" = 0 ]; then CHANNEL_ALARM=1; fi
  local TG_API="https://api.telegram.org/bot${VOICE}"

  # Пароль в терминале git не спрашивает никогда: вопрос посреди цикла — это
  # зависший дом. Вход git берёт у gh, если тот установлен, — так же, как при
  # клонировании: отдельно настраивать git на телефоне не нужно.
  export GIT_TERMINAL_PROMPT=0
  local GIT_ERR=""
  fetch_branch() {
    if command -v gh > /dev/null 2>&1; then
      GIT_ERR="$(git -C "$REPO" -c "credential.helper=!gh auth git-credential" fetch -q origin "$BRANCH" 2>&1)" && return 0
    else
      GIT_ERR="$(git -C "$REPO" fetch -q origin "$BRANCH" 2>&1)" && return 0
    fi
    return 1
  }
  # Почему GitHub не отдал ветку — словами, по которым понятно, что делать.
  why_fetch() {
    case "$GIT_ERR" in
      *"ouldn't find remote ref"*) echo "ветки «$BRANCH» в GitHub нет — сверьте строку HEART_BRANCH" ;;
      *"could not read Username"*|*"terminal prompts disabled"*|*"Authentication failed"*|*"nvalid username or password"*|*"epository not found"*|*"error: 403"*)
        echo "GitHub не пускает: выполните «gh auth login», затем «gh auth setup-git»" ;;
      *"ermission denied"*|*"publickey"*|*"ost key verification failed"*)
        echo "GitHub не пускает по SSH: выполните «gh auth login» с выбором HTTPS, затем «git -C $REPO remote set-url origin https://github.com/$(git -C "$REPO" remote get-url origin 2>/dev/null | sed -e 's#^.*github\.com[:/]##' -e 's#\.git$##').git»" ;;
      *"ould not resolve host"*|*"ailed to connect"*|*"timed out"*|*"unable to access"*) echo "нет связи с GitHub" ;;
      *"ot a git repository"*) echo "папка $REPO — не копия репозитория: см. docs/PHONE.md, раздел 1" ;;
      *) echo "GitHub не отвечает или ветки «$BRANCH» нет" ;;
    esac
  }
  # Ключ — латиница, цифры и знаки без пробелов. Строка-образец из инструкции
  # («ключ модели») ключом не является и в живого бота уйти не должна.
  keylike() {
    [ "${#1}" -ge 6 ] || return 1
    ! printf '%s' "$1" | LC_ALL=C grep -q '[^!-~]'
  }

  # Вид токена публикации — тот же, что проверяет сам инструмент.
  tokenlike() { printf '%s' "${1:-}" | LC_ALL=C grep -Eq '^app[0-9]+:[A-Za-z0-9_-]+$'; }

  build_of() { sed -n 's/^export const BUILD = "\([^"]*\)";.*/\1/p' "$REPO/tgcloud/lib/heart.js" 2>/dev/null | head -n 1; }
  short() { printf '%s' "${1:-}" | cut -c1-7; }
  # Инструмент ищет проект вверх по дереву — по папке .tgcloud — и работает из
  # найденного места. Своя такая папка прямо здесь (она в .gitignore) — и
  # чужая, оставшаяся где-нибудь выше, его не уведёт.
  # WORK — откуда он работает: при публикации это копия коммита, у удара через
  # платформу — слепок опубликованного, в остальных случаях — сама папка.
  # У каждого запроса предел времени: зависшее соединение иначе держит дом,
  # пока его не бросит сама система (17.11.2026 — двадцать с лишним минут).
  # Предел стоит внутри самого процесса: Ctrl+C доходит до него, как и раньше.
  WORK=""
  tg() {
    local code
    ( cd "${WORK:-$REPO}" && mkdir -p .tgcloud && TGCLOUD_TOKEN="$TOKEN" node --import "data:text/javascript,setTimeout(function(){process.exit(124)},${CALL_LIMIT}000).unref()" "$CLI" "$@" ) < /dev/null
    code=$?
    [ "$code" = 124 ] && echo "✗ Платформа не ответила за $CALL_LIMIT с — запрос снят."
    return "$code"
  }
  voice() { curl -sS --max-time 20 "$TG_API/$1" "${@:2}" 2>/dev/null; }
  # Прежние версии скрипта вписывали ключи прямо в папку: после них остаётся уборка.
  restore() { git -C "$REPO" checkout -q -- tgcloud/lib/secrets.js 2>/dev/null; }
  inject() { ( cd "${WORK:-$REPO}" && node scripts/inject-secrets.mjs "$@" ) < /dev/null; }

  # Слово владельцу — от имени того же бота, что говорит в канал. Нет его —
  # останется строка в журнале; об удачной публикации Аи пишет сама. Весть
  # начинается словом «Телефон»: 17.11.2026 владелец спросил, почему второй бот
  # пишет ему про новую сборку, — из вести не было видно, кто говорит.
  tell_owner() {
    [ -n "$VOICE" ] && [ -n "${OWNER_TG_ID:-}" ] || return 0
    voice sendMessage -d "chat_id=${OWNER_TG_ID}" --data-urlencode "text=$1" > /dev/null
    return 0
  }

  ensure_cli() {
    [ -f "$CLI" ] && return 0
    [ -n "${HEART_CLI:-}" ] && { log "Нет файла HEART_CLI: $CLI"; return 1; }
    log "Ставлю инструмент публикации (@tgcloud/cli@$CLI_VERSION) — один раз."
    npm install --silent --no-audit --no-fund --prefix "$HOME_DIR/cli" "@tgcloud/cli@$CLI_VERSION" >> "$DEPLOY_LOG" 2>&1
    [ -f "$CLI" ] || { log "Инструмент публикации не поставился: нет связи с npm? Подробности: $DEPLOY_LOG"; return 1; }
  }

  # Тестам ключи и настройки дома не нужны, а мешать могут: до них не доходит
  # ничего из того, что скрипт прочёл в файле ключей или получил в окружении.
  run_tests() {
    (
      cd "$REPO" || exit 1
      local name
      for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
        case "$name" in
          HEART_*|ALARM_*|TGCLOUD_*|KEY_*|DOOR_*|AI_PROVIDER_KEY|AI_EXTRA_KEYS|OWNER_TG_ID) unset "$name" ;;
        esac
      done
      npm run ci
    ) > "$TEST_LOG" 2>&1 < /dev/null
  }

  # Какие тесты не прошли и почему. node пишет журнал в одном из двух видов
  # (TAP — «not ok», или «✖ …» с итоговым разделом); в обоих каждая неудача
  # показывается один раз, со строкой причины.
  why_tests() {
    [ -f "$TEST_LOG" ] || return 0
    # Краски терминала, если они попали в журнал, разбору не мешают.
    sed $'s/\033\\[[0-9;]*m//g' "$TEST_LOG" 2>/dev/null | awk -v max=6 '
      function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
      function emit(name, why) {
        if (name == "" || (name in seen)) return
        seen[name] = 1; count++
        if (count > max) return
        print "✖ " name
        if (why != "") print "    " why
      }
      /failing tests:/ { summary = 1; next }
      summary && /^[ \t]*✖ / {
        if (pending != "") emit(pending, "")
        pending = trim($0); sub(/^✖ /, "", pending); sub(/ \([0-9.]+ms\)$/, "", pending); next
      }
      summary && pending != "" && NF { emit(pending, trim($0)); pending = ""; next }
      !summary && /^[ \t]*not ok [0-9]+ - / {
        if (tapname != "") emit(tapname, "")
        tapname = $0; sub(/^[ \t]*not ok [0-9]+ - /, "", tapname); next
      }
      tapname != "" && /^[ \t]*error: / {
        why = $0; sub(/^[ \t]*error: /, "", why)
        if (why == "|-" || why == "|") { if ((getline why) > 0) why = trim(why); else why = "" }
        else { gsub(/^[\047"]|[\047"]$/, "", why) }
        emit(tapname, why); tapname = ""; next
      }
      tapname != "" && /^[ \t]*\.\.\.[ \t]*$/ { emit(tapname, ""); tapname = "" }
      END {
        if (pending != "") emit(pending, "")
        if (tapname != "") emit(tapname, "")
        if (count > max) print "… и ещё " (count - max)
      }
    ' 2>/dev/null
  }

  # ── слепок опубликованного ───────────────────────────────────────────────
  # Удар через платформу исполняет код с телефона, а в папке к тому времени
  # может лежать следующий, ещё не опубликованный коммит. В живую базу ходит
  # только тот код, что уже в боте, — поэтому удар берётся из слепка, снятого
  # в момент публикации. Нет слепка — этот телефон ещё ничего не публиковал,
  # и бить нечем.
  LIVE="$HOME_DIR/live"; LIVE_CLEAN="$HOME_DIR/live.secrets.js"
  local NO_LIVE_SAID=0 SLIM_SAYS=""
  # Комментарии облаку не нужны, а весят пятую часть кода; инструмент же шлёт
  # весь код одним запросом (scripts/slim.mjs — зачем и как). Нет скрипта в
  # коммите (сборка до 0.36.3) — код уходит как есть. Итог — в SLIM_SAYS.
  slim() {
    SLIM_SAYS=""
    [ -f "$1/scripts/slim.mjs" ] || return 0
    local out
    out="$( ( cd "$1" && node scripts/slim.mjs ) 2>&1 < /dev/null )" || { printf '%s\n' "$out"; return 1; }
    SLIM_SAYS="$out"
    printf '%s\n' "$out"
  }
  # Число из итога облегчения («body» — вес запроса репетиции) и байты словами.
  slim_number() { printf '%s' "$SLIM_SAYS" | sed -n "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p" | head -n 1; }
  kb() { case "${1:-}" in ''|*[!0-9]*) echo "? КБ" ;; *) echo "$(( ($1 + 512) / 1024 )) КБ" ;; esac; }
  snapshot() {
    rm -rf "$LIVE.new" 2>/dev/null
    mkdir -p "$LIVE.new" || return 1
    if git -C "$REPO" archive "$1" tgcloud scripts package.json 2>/dev/null | tar -x -C "$LIVE.new" 2>/dev/null \
      && [ -f "$LIVE.new/tgcloud/handlers/message.js" ] && [ -f "$LIVE.new/tgcloud/lib/secrets.js" ] \
      && mkdir -p "$LIVE.new/.tgcloud"; then
      slim "$LIVE.new" > /dev/null 2>&1 || true
      rm -rf "$LIVE" && mv "$LIVE.new" "$LIVE" && cp "$LIVE/tgcloud/lib/secrets.js" "$LIVE_CLEAN" && return 0
    fi
    rm -rf "$LIVE.new" 2>/dev/null
    return 1
  }
  # Копия для облака: чистый коммит, без комментариев; пустой файл ключей
  # откладывается рядом — им копия закроется, когда станет слепком.
  stage() {
    unstage
    mkdir -p "$STAGE" || return 1
    # Настройки проекта для инструмента (tgcloud.jsonc) и страница мини-приложения
    # (miniapp/) — если они есть в коммите.
    local extra=""
    git -C "$REPO" cat-file -e "$1:tgcloud.jsonc" 2>/dev/null && extra="tgcloud.jsonc"
    git -C "$REPO" cat-file -e "$1:miniapp/index.html" 2>/dev/null && extra="$extra miniapp"
    # shellcheck disable=SC2086
    git -C "$REPO" archive "$1" tgcloud scripts package.json $extra 2>/dev/null | tar -x -C "$STAGE" 2>/dev/null || return 1
    [ -f "$STAGE/tgcloud/handlers/message.js" ] && [ -f "$STAGE/tgcloud/lib/secrets.js" ] || { echo "в коммите нет tgcloud/handlers/message.js или tgcloud/lib/secrets.js"; return 1; }
    mkdir -p "$STAGE/.tgcloud" || return 1
    if ! slim "$STAGE"; then SLIM_SAYS=""; echo "Комментарии убрать не вышло: код уйдёт как есть."; fi
    cp "$STAGE/tgcloud/lib/secrets.js" "$STAGE/.secrets.clean"
  }
  # Опубликованное становится слепком: удар через платформу и контрольная
  # репетиция идут ровно тем кодом, что в боте, — и без ключей.
  promote() {
    [ -f "$STAGE/.secrets.clean" ] && [ -f "$STAGE/tgcloud/handlers/message.js" ] || return 1
    cp "$STAGE/.secrets.clean" "$STAGE/tgcloud/lib/secrets.js" || return 1
    rm -rf "$LIVE" 2>/dev/null
    mv "$STAGE" "$LIVE" || return 1
    mv "$LIVE/.secrets.clean" "$LIVE_CLEAN" 2>/dev/null || cp "$LIVE/tgcloud/lib/secrets.js" "$LIVE_CLEAN"
  }
  # Ключи в слепке — только на время удара.
  restore_live() {
    [ -f "$LIVE_CLEAN" ] && [ -d "$LIVE/tgcloud/lib" ] && cp "$LIVE_CLEAN" "$LIVE/tgcloud/lib/secrets.js" 2>/dev/null
    return 0
  }

  # ── один процесс на телефон ──────────────────────────────────────────────
  LOCK="$HOME_DIR/lock"; LOCKED=0; NAP=""
  # Копия для облака (в ней на время публикации лежат ключи) и помощник, который
  # бьёт в канал, пока идёт публикация: уборка при выходе знает обоих.
  STAGE="$HOME_DIR/stage"; TICKER=""
  unstage() { rm -rf "$STAGE" 2>/dev/null; return 0; }
  ticker_off() {
    [ -n "$TICKER" ] && { kill "$TICKER" 2>/dev/null; wait "$TICKER" 2>/dev/null; }
    TICKER=""
    return 0
  }
  take_lock() {
    if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; LOCKED=1; return 0; fi
    local other
    other="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null && [ "$other" != "$$" ]; then
      echo "Дом уже запущен (процесс $other). Второй не нужен." >&2
      return 1
    fi
    # Прошлый процесс умер, не убрав за собой: место свободно.
    echo $$ > "$LOCK/pid"; LOCKED=1
    return 0
  }
  drop_lock() { [ "$LOCKED" = 1 ] && rm -rf "$LOCK" 2>/dev/null; LOCKED=0; }
  # Ключи из кода убирает только тот процесс, что держит замок: проверка,
  # запущенная в соседнем окне, не должна стереть их посреди чужой публикации.
  # shellcheck disable=SC2317
  leave() {
    [ -n "$NAP" ] && kill "$NAP" 2>/dev/null
    NAP=""
    ticker_off
    if [ "$LOCKED" = 1 ]; then restore; restore_live; unstage; fi
    drop_lock
  }
  # Замок взят — значит, других нет: ключи, оставшиеся в файлах после процесса,
  # который убили без предупреждения, убираются сразу.
  enter() { take_lock || return 1; restore; restore_live; unstage; return 0; }
  trap 'leave; exit 0' INT TERM
  trap 'leave' EXIT

  # ── что опубликовано и что не вышло ──────────────────────────────────────
  local PUBLISHED="$HOME_DIR/published" FAILED="$HOME_DIR/failed"
  published_commit() { sed -n '1p' "$PUBLISHED" 2>/dev/null; }
  published_build() { sed -n '2p' "$PUBLISHED" 2>/dev/null; }
  # С каким ключом двери сердце опубликовано: не сам ключ, а его контрольная
  # сумма — четвёртой строкой. По ней «door» видит, нужна ли новая публикация.
  published_door() { sed -n '4p' "$PUBLISHED" 2>/dev/null; }
  door_mark() {
    local mark
    [ -n "${KEY_DOOR:-}" ] || { echo "-"; return 0; }
    mark="$(printf '%s' "$KEY_DOOR" | cksum 2>/dev/null | tr -s ' \t' '-')"
    # Нет cksum — метка ни с чем не совпадёт, и публикация пройдёт заново: лишняя минута, а не закрытая дверь.
    [ -n "$mark" ] || mark="без-суммы-$$-$(date +%s)"
    echo "$mark"
  }
  failed_commit() { sed -n '1p' "$FAILED" 2>/dev/null; }
  failed_count() { local n; n="$(sed -n '2p' "$FAILED" 2>/dev/null)"; case "$n" in ''|*[!0-9]*) n=0 ;; esac; echo "$n"; }
  failed_at() { local n; n="$(sed -n '3p' "$FAILED" 2>/dev/null)"; case "$n" in ''|*[!0-9]*) n=0 ;; esac; echo "$n"; }

  dirty() {
    git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | grep -v ' tgcloud/lib/secrets\.js$' | grep -q .
  }

  # ── ветка: есть ли новое ─────────────────────────────────────────────────
  # Возвращает 0, только когда папка стоит на вершине ветки из GitHub: лишь
  # такое и публикуется.
  local DIRTY_SAID=0 OFFLINE_SAID=0 NOHOME_SAID=0
  sync() {
    if ! fetch_branch; then
      [ "$OFFLINE_SAID" = 0 ] && log "Новое из GitHub не взять: $(why_fetch). Попробую позже."
      OFFLINE_SAID=1
      return 1
    fi
    OFFLINE_SAID=0
    local remote here
    remote="$(git -C "$REPO" rev-parse -q --verify FETCH_HEAD 2>/dev/null)"
    here="$(git -C "$REPO" rev-parse -q --verify HEAD 2>/dev/null)"
    [ -n "$remote" ] || return 1
    [ "$remote" = "$here" ] && return 0
    # В той ветке нет этого скрипта (так выглядит main до слияния): перейти —
    # значит остаться без дома, запускать после этого было бы нечего.
    if ! git -C "$REPO" cat-file -e "$remote:scripts/phone.sh" 2>/dev/null; then
      [ "$NOHOME_SAID" = 0 ] && log "✗ В ветке «$BRANCH» нет scripts/phone.sh — на неё не перехожу и ничего не публикую. Нужная ветка — строкой HEART_BRANCH в $ENV_FILE."
      NOHOME_SAID=1
      return 1
    fi
    NOHOME_SAID=0
    if dirty; then
      [ "$DIRTY_SAID" = 0 ] && log "В папке есть несохранённые правки — новое из GitHub не беру, чтобы их не стереть."
      DIRTY_SAID=1
      return 1
    fi
    DIRTY_SAID=0
    local before after
    before="$(git -C "$REPO" rev-parse -q --verify "HEAD:scripts/phone.sh" 2>/dev/null)"
    restore
    git -C "$REPO" checkout -q --detach "$remote" 2>/dev/null || { log "Не получилось перейти на $(short "$remote")."; return 1; }
    log "Пришёл коммит $(short "$remote"), сборка $(build_of)."
    after="$(git -C "$REPO" rev-parse -q --verify "HEAD:scripts/phone.sh" 2>/dev/null)"
    if [ "$before" != "$after" ] && { [ "$MODE" = "run" ] || [ "$MODE" = "door" ]; }; then
      log "Сам скрипт обновился — перезапускаюсь."
      leave
      trap - EXIT INT TERM
      # Дверь продолжает дверью — с тем же словом после «door», если оно было.
      [ "$MODE" = "door" ] && exec bash "$SELF" door ${DOOR_ARG:+"$DOOR_ARG"}
      exec bash "$SELF" run
    fi
    return 0
  }

  # ── публикация ───────────────────────────────────────────────────────────
  local WHY="" LACK_SAID="" CAUSE="" CLOUD_SAID=0
  # Ответ последнего шага — отдельным файлом: по нему видно, что именно не вышло.
  local STEP_OUT="$HOME_DIR/step.out"
  # Какой коммит уже прошёл тесты на этом телефоне и с какого коммита нет связи с платформой.
  local TESTED="$HOME_DIR/tested" WAITING="$HOME_DIR/waiting"
  # Чего не хватает, чтобы публиковать; пусто — всё на месте. Попыткой это не
  # считается: чинится не новым коммитом, а строкой в файле ключей.
  lacking() {
    if [ -z "$TOKEN" ]; then echo "нет TGCLOUD_HEART_TOKEN в $ENV_FILE"
    elif ! tokenlike "$TOKEN"; then echo "TGCLOUD_HEART_TOKEN в $ENV_FILE не похож на токен публикации (app…:…)"
    elif ! keylike "${AI_PROVIDER_KEY:-}"; then echo "AI_PROVIDER_KEY в $ENV_FILE пуст или не похож на ключ (пробелы, русские буквы)"
    elif dirty; then echo "в папке несохранённые правки, а публикуется только то, что лежит в ветке (убрать их: git -C $REPO checkout -- .)"
    fi
    return 0
  }
  step() {
    local title="$1" code; shift
    printf '\n== %s ==\n' "$title" >> "$DEPLOY_LOG"
    "$@" > "$STEP_OUT" 2>&1; code=$?
    cat "$STEP_OUT" >> "$DEPLOY_LOG" 2>/dev/null
    [ "$code" = 0 ] && return 0
    WHY="$title"
    return 1
  }
  # Передача оборвалась или платформа не ответила в срок — а не «код плох».
  cut_off() { grep -Eq "Could not reach|не ответила за" "$STEP_OUT" 2>/dev/null; }
  # Шаг, который можно повторить без вреда (репетиция ничего не меняет): обрыв
  # бывает минутным, и один повтор дешевле новой попытки целиком.
  retry_step() {
    step "$@" && return 0
    cut_off || return 1
    sleep "$RETRY_PAUSE"
    printf '\n(обрыв — повторяю шаг)\n' >> "$DEPLOY_LOG"
    step "$@"
  }
  # Почему не вышла публикация, если это видно по ответу: связь или токен.
  hint() {
    if cut_off; then echo " Причина: нет связи с платформой Telegram."
    elif grep -q "TGCLOUD_TOKEN" "$STEP_OUT" 2>/dev/null; then echo " Причина: платформа не приняла токен публикации."
    fi
  }
  # Ключи на экран не попадают: в строке, которая печатается, их значения заменены.
  scrub() {
    local line name value
    while IFS= read -r line || [ -n "$line" ]; do
      for name in TGCLOUD_HEART_TOKEN AI_PROVIDER_KEY ALARM_BOT_TOKEN AI_EXTRA_KEYS $(env | sed -n 's/^\(KEY_[A-Za-z0-9_]*\)=.*/\1/p'); do
        value="${!name:-}"
        [ "${#value}" -ge 6 ] && line="${line//"$value"/***}"
        value="${value#*:}"
        [ "${#value}" -ge 6 ] && line="${line//"$value"/***}"
      done
      # Запасные ключи одной строкой JSON: каждое значение в кавычках — тоже ключ.
      for value in $(printf '%s' "${AI_EXTRA_KEYS:-}" | grep -o '"[^"]\{6,\}"' | tr -d '"'); do line="${line//"$value"/***}"; done
      printf '%s\n' "$line"
    done
  }
  # Что ответила платформа — на экран: по этим строкам видно, в чём дело, без
  # похода в журнал. Адрес вебхука и ключи не печатаются.
  # Файл ответа — первым словом; без него — ответ последнего шага.
  show_error() {
    local file="${1:-$STEP_OUT}" line
    [ -f "$file" ] || return 0
    sed $'s/\033\\[[0-9;]*m//g' "$file" 2>/dev/null | grep -v '^[[:space:]]*$' | grep -v -E '://|^[[:space:]]*(expected[[:space:]]+)?url:' | tail -n 4 | scrub | while IFS= read -r line; do log "   ${line:0:300}"; done
  }
  # Главная строка ответа платформы — для вести владельцу: последняя, где есть слово об отказе («Error», «✗»,
  # «limit», «too many»…), а нет такой — просто последняя. Без цвета, адресов и ключей; не длиннее 240 знаков.
  last_word() {
    local file="${1:-$STEP_OUT}" text line
    [ -f "$file" ] || return 0
    text="$(sed $'s/\033\\[[0-9;]*m//g' "$file" 2>/dev/null | grep -v '^[[:space:]]*$' | grep -v -E '://|^[[:space:]]*(expected[[:space:]]+)?url:')"
    line="$({ printf '%s\n' "$text" | grep -E -i 'error|✗|✖|refus|reject|denied|invalid|limit|too (many|large)' | tail -n 1; printf '%s\n' "$text" | tail -n 1; } | head -n 1 | scrub)"
    # Пробелы по краям — прочь: строка встанет в кавычки посреди предложения.
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    printf '%s' "${line:0:240}"
  }
  # Малый запрос к платформе: есть ли связь и принят ли токен. Кода он не шлёт.
  # 0 — да; 1 — связи нет; 2 — токен не принят; 3 — платформа ответила иначе.
  reach() {
    local out code
    out="$(tg webhook 2>&1)"; code=$?
    # Адрес вебхука в журнал не пишется (строки «url:» и «expected url:»); остальное — как есть.
    printf '%s\n' "$out" | grep -v -i -E '^[[:space:]]*(expected[[:space:]]+)?url:' >> "$DEPLOY_LOG" 2>/dev/null
    [ "$code" = 0 ] && return 0
    case "$out" in
      *"Could not reach"*|*"не ответила за"*) return 1 ;;
      *"TGCLOUD_TOKEN"*) return 2 ;;
    esac
    return 3
  }
  # Связи с платформой нет: это не неудача сборки — ни тестов, ни счёта попыток.
  # В журнал — один раз; владельцу — если связи нет уже четверть часа.
  no_cloud() {
    local head="$1" first told now
    [ "$CLOUD_SAID" = 0 ] && log "Платформа Telegram (cloud.telegram.org) не отвечает — публикация подождёт связи. Бот на прежней сборке."
    CLOUD_SAID=1
    now="$(date +%s)"
    if [ "$(sed -n '1p' "$WAITING" 2>/dev/null)" != "$head" ]; then printf '%s\n%s\n0\n' "$head" "$now" > "$WAITING"; return 0; fi
    first="$(sed -n '2p' "$WAITING" 2>/dev/null)"; told="$(sed -n '3p' "$WAITING" 2>/dev/null)"
    case "$first" in ''|*[!0-9]*) first="$now" ;; esac
    if [ "$told" != 1 ] && [ $((now - first)) -ge 900 ]; then
      printf '%s\n%s\n1\n' "$head" "$first" > "$WAITING"
      tell_owner "⚠️ Телефон: сборку $(build_of) пока не опубликовать — уже четверть часа нет связи с платформой Telegram. Повторю сам, когда связь вернётся. Аи пока на прежней сборке."
    fi
    return 0
  }
  # Контрольная репетиция: тот же запрос, но кодом, который уже в боте (слепок).
  # Она отвечает на вопрос «берёт ли платформа сейчас хоть какой-то код».
  # 0 — прошла; 1 — нет; 2 — слепка нет, проверить нечем.
  control() {
    [ -f "$LIVE/tgcloud/handlers/message.js" ] && [ -f "$LIVE/scripts/inject-secrets.mjs" ] || return 2
    local out code
    ( cd "$LIVE" && node scripts/inject-secrets.mjs ) > /dev/null 2>&1 < /dev/null
    out="$(WORK="$LIVE" tg run handlers/message '{ chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/start" }' --ctx '{ testRun: true }' 2>&1)"; code=$?
    restore_live
    printf '%s\n' "$out" >> "$DEPLOY_LOG" 2>/dev/null
    [ "$code" = 0 ]
  }
  # Почему не вышла отправка кода. Оборвалась передача — телефон выясняет сам:
  # малый запрос (есть ли связь), затем контрольная репетиция опубликованной
  # сборки (берёт ли платформа прежний код). Причина словами — в CAUSE.
  # 2 — связи нет: это не неудача сборки; 1 — всё остальное.
  diagnose() {
    CAUSE=""
    if grep -q "TGCLOUD_TOKEN" "$STEP_OUT" 2>/dev/null; then CAUSE="платформа не приняла токен публикации"; return 1; fi
    cut_off || return 1
    local sent=""
    [ -n "$SLIM_SAYS" ] && sent=" ($(kb "$(slim_number body)"))"
    printf '\n== после обрыва: связь с платформой ==\n' >> "$DEPLOY_LOG"
    reach
    if [ $? = 1 ]; then CAUSE="нет связи с платформой Telegram"; return 2; fi
    # Оборвалась не отправка кода, а другой запрос (состояние облака): сравнивать сборки незачем.
    case "$WHY" in репетиция*) ;; *) CAUSE="связь есть, но этот запрос платформа оборвала"; return 1 ;; esac
    printf '\n== после обрыва: контрольная репетиция опубликованной сборки ==\n' >> "$DEPLOY_LOG"
    control
    case $? in
      0) CAUSE="связь есть, и прежняя сборка в облаке репетируется, а эта$sent — нет: дело в самой сборке" ;;
      1) CAUSE="связь есть, но платформа сейчас обрывает отправку любого кода — и прежней сборки тоже: дело не в этой сборке" ;;
      *) CAUSE="связь есть, а отправку кода$sent платформа обрывает" ;;
    esac
    return 1
  }
  # Каких событий нет в подписке бота, хотя обработчик для них опубликован.
  WEBHOOK_MISSING=""
  webhook_check() {
    local out words file name
    WEBHOOK_MISSING=""
    out="$(tg webhook 2>&1)"
    # Адрес вебхука в журнал не пишется.
    printf '%s\n' "$out" | grep -v -i "url"
    if printf '%s' "$out" | grep -q "OUT OF SYNC"; then
      echo "Вебхук не совпал с обработчиками — чиню."
      out="$(tg webhook sync 2>&1)"
      printf '%s\n' "$out" | grep -v -i "url"
    fi
    # Подписка: событие каждого обработчика должно быть в списке «allowed updates».
    # Строки такой в ответе нет — проверять нечего, и тревоги нет.
    words="$(printf '%s\n' "$out" | sed "s/$(printf '\033')\[[0-9;]*m//g" | sed -n 's/^[[:space:]]*allowed updates:[[:space:]]*//p' | head -n 1 | tr ',' ' ')"
    if [ -n "$words" ]; then
      for file in "${WORK:-$REPO}"/tgcloud/handlers/*.js; do
        [ -f "$file" ] || continue
        name="$(basename "$file" .js)"
        case "$name" in _*) continue ;; esac
        case " $(printf '%s' "$words" | tr -s '[:space:]' ' ') " in *" $name "*) ;; *) WEBHOOK_MISSING="$WEBHOOK_MISSING $name" ;; esac
      done
      [ -z "$WEBHOOK_MISSING" ] || echo "В подписке бота нет событий:$WEBHOOK_MISSING"
    fi
    return 0
  }
  # Мини-приложение «Комната» — надстройка над ботом: что бы с ним ни вышло,
  # сам бот публикуется. APP — функция комнаты прошла репетицию и уходит вместе
  # с кодом; APP_WHY — почему мини-приложения в этой публикации нет (пусто —
  # всё на месте); PAGE_URL — адрес страницы, каким его назвала платформа.
  local APP=0 APP_WHY="" PAGE_URL=""
  # Адрес страницы знает только платформа: инструмент кладёт её ответ в
  # .tgcloud/static.json копии. В адрес попадают только безопасные знаки — он
  # уходит сердцу внутри строки настроек.
  page_url() {
    local url
    url="$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${WORK:-$REPO}/.tgcloud/static.json" 2>/dev/null | head -n 1)"
    case "$url" in https://*) ;; *) return 0 ;; esac
    case "$url" in *[!A-Za-z0-9._~:/-]*) return 0 ;; esac
    [ "${#url}" -le 200 ] || return 0
    printf '%s' "$url"
  }
  # Комната не идёт — её функции в копии для облака не место: инструмент
  # проверяет все модули копии, а не только отправляемые. Бот важнее комнаты.
  drop_room() { rm -rf "$STAGE/tgcloud/endpoints" 2>/dev/null; return 0; }
  # Лишние модули облака (0.49.1). Отправка с целями («push handlers lib schema») из облака ничего не убирает:
  # модуль, удалённый или переименованный в коде, остаётся там навсегда. Так с 0.36.3 в облаке лежал прежний
  # словарь (lib/data/phrases), счёт модулей дошёл до ста, и сборка 0.49.0 — с двумя новыми — публиковаться
  # перестала: репетиции проходили, а отправку платформа не принимала. Что дело в числе модулей — вывод из
  # совпадения чисел, ответа платформы никто не видел (docs/JOURNAL.md, «Сообщение 50»).
  # Что хранит платформа, видно после шага «состояние облака»: инструмент кладёт слепок облака в .tgcloud/remote
  # копии, модуль «lib/x» — файлом lib/x.js. CLOUD_COUNT — сколько модулей в облаке; STALE — те из них, которых в
  # копии коммита нет; LOCAL_COUNT — сколько модулей в самой копии; MIRROR=1 — отправка пойдёт без целей и
  # уберёт лишние.
  local CLOUD_COUNT="" LOCAL_COUNT="" STALE="" MIRROR=0 APP_WORD=""
  local PUSH_OUT="$HOME_DIR/push.out"
  cloud_modules() {
    CLOUD_COUNT=""; LOCAL_COUNT=""; STALE=""
    local remote="$STAGE/.tgcloud/remote" path
    [ -d "$remote" ] || return 0
    CLOUD_COUNT=0
    LOCAL_COUNT="$(find "$STAGE/tgcloud" -type f -name '*.js' 2>/dev/null | wc -l | tr -d ' ')"
    # Имена модулей — латиница, цифры, «_», «-» и «/»: пробелов в них нет, цикл по словам безопасен.
    # shellcheck disable=SC2044
    for path in $(cd "$remote" 2>/dev/null && find . -type f -name '*.js' 2>/dev/null | sed 's#^\./##' | sort); do
      CLOUD_COUNT=$((CLOUD_COUNT + 1))
      [ -f "$STAGE/tgcloud/$path" ] && continue
      # Функцию комнаты из копии убрал сам скрипт (не прошла репетицию): в облаке она не «лишняя».
      case "$path" in endpoints/*) [ -d "$STAGE/tgcloud/endpoints" ] || continue ;; esac
      STALE="${STALE:+$STALE }${path%.js}"
    done
    return 0
  }
  # Имена через запятую, не больше шести: остальные — числом.
  few() {
    local all=$# shown=""
    while [ $# -gt 0 ] && [ $((all - $#)) -lt 6 ]; do shown="${shown:+$shown, }$1"; shift; done
    [ $# -gt 0 ] && shown="$shown и ещё $#"
    printf '%s' "$shown"
  }
  # Отправка кода. Лишнего в облаке нет — как всегда, с целями: страница при этом не трогается. Лишнее есть —
  # без целей: только такая отправка убирает из облака то, чего нет в копии (так устроен инструмент: «a full push
  # deletes remote modules that are absent locally»). Без целей инструмент отправил бы заодно и страницу комнаты,
  # а она идёт отдельным шагом и бота держать не должна, — поэтому настройки проекта (tgcloud.jsonc, из них
  # инструмент узнаёт о странице) на время этой отправки из копии убираются: без них страница не трогается.
  # Запасные пути после неудачи идут мимо этой функции — прежней отправкой с целями (`publish_steps`).
  push_code() {
    [ "$MIRROR" = 1 ] || { tg push "$@"; return $?; }
    local code name hidden=""
    for name in tgcloud.jsonc tgcloud.json; do
      [ -f "$STAGE/$name" ] && mv "$STAGE/$name" "$STAGE/$name.off" 2>/dev/null && hidden="$hidden $name"
    done
    tg push; code=$?
    for name in $hidden; do mv "$STAGE/$name.off" "$STAGE/$name" 2>/dev/null; done
    return "$code"
  }
  # Отправку кода платформа не приняла. Её слова — на экран и владельцу: до 0.49.1 они оставались только в
  # журнале телефона, и по снимку экрана причину было не узнать (сообщение 50). Связь или токен — как раньше.
  refused() {
    local why word counts=""
    why="$(hint)"
    if [ -n "$why" ]; then log "✗ Публикация не прошла.$why Подробности: $DEPLOY_LOG"; return 0; fi
    log "✗ Публикация не прошла: платформа не приняла код. Подробности: $DEPLOY_LOG"
    show_error "$PUSH_OUT"
    [ -z "$CLOUD_COUNT" ] || counts=" Модулей в коммите: $LOCAL_COUNT, в облаке до отправки: $CLOUD_COUNT."
    [ -z "$counts" ] || log "  $counts"
    word="$(last_word "$PUSH_OUT")"
    WHY="платформа не приняла код"
    [ -z "$word" ] || WHY="$WHY. Её ответ: «$word»"
    WHY="$WHY.$counts Перешлите эту строку в чат разработки"
    return 0
  }
  wake_new_build() {
    local out ctx='{ tick: true, deployed: true }'
    # Адрес страницы комнаты сердце узнаёт отсюда: по нему ставятся кнопки.
    [ -z "$PAGE_URL" ] || ctx="{ tick: true, deployed: true, page: \"$PAGE_URL\" }"
    out="$(tg run handlers/message '{}' --ctx "$ctx" 2>&1)"
    printf '%s\n' "$out"
    printf '%s' "$out" | grep -Eq "ok: ?true"
  }

  # 0 — опубликовано; 1 — попытка не вышла; 2 — попытки не было: не хватает
  # настроек или нет связи с платформой.
  publish_steps() {
    local head build lack kind
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"; build="$(build_of)"
    WHY=""; CAUSE=""; WORK=""; APP=0; APP_WHY=""; PAGE_URL=""; CLOUD_COUNT=""; LOCAL_COUNT=""; STALE=""; MIRROR=0; APP_WORD=""
    rm -f "$PUSH_OUT" 2>/dev/null
    lack="$(lacking)"
    if [ -n "$lack" ]; then
      [ "$lack" = "$LACK_SAID" ] || log "✗ Публикации нет, бот на прежней сборке: $lack."
      LACK_SAID="$lack"; WHY="$lack"
      return 2
    fi
    LACK_SAID=""
    ensure_cli || { WHY="инструмент публикации не поставился"; return 2; }
    : > "$DEPLOY_LOG"
    # Сначала — малый запрос: есть ли связь с платформой. Нет — тесты гонять
    # незачем, и сборка в этом не виновата.
    printf '\n== связь с платформой ==\n' >> "$DEPLOY_LOG"
    reach
    case $? in
      1) no_cloud "$head"; WHY="нет связи с платформой Telegram"; return 2 ;;
      2) log "✗ Публикации нет, бот на прежней сборке. Причина: платформа не приняла токен публикации."; WHY="платформа не приняла токен публикации"; return 1 ;;
    esac
    CLOUD_SAID=0
    rm -f "$WAITING"
    log "Публикую сборку $build ($(short "$head"))…"
    if [ "$TESTS" = "on" ]; then
      # Тесты одного коммита на одном телефоне дают один и тот же ответ: второй раз их гонять незачем.
      if [ "$(sed -n '1p' "$TESTED" 2>/dev/null)" = "$head" ]; then
        log "Тесты этой сборки здесь уже прошли — второй раз не гоняю."
      else
        log "Проверяю сборку тестами — на телефоне это несколько минут."
        if ! run_tests; then
          WHY="тесты"
          log "✗ Тесты не прошли — публикации нет, бот на прежней сборке. Журнал: $TEST_LOG"
          # Какие именно и почему — сразу на экран: по этим строкам видно, код
          # это или телефон. Не тесты, а что-то раньше них — хвост журнала.
          local reasons
          reasons="$(why_tests)"
          [ -n "$reasons" ] || reasons="$(grep -v '^[[:space:]]*$' "$TEST_LOG" 2>/dev/null | tail -n 5)"
          printf '%s\n' "$reasons" | while IFS= read -r line; do log "   $line"; done
          log "   Если дело в самом телефоне, а не в коде: строка HEART_TESTS=off в $ENV_FILE."
          return 1
        fi
        printf '%s\n' "$head" > "$TESTED"
      fi
    fi
    # В облако уходит копия коммита — без комментариев и с ключами. Папка с Аи не меняется.
    if ! step "копия для облака" stage "$head"; then
      WHY="копия кода для облака не собралась"
      log "✗ Не прошло: $WHY — публикации нет, бот на прежней сборке. Подробности: $DEPLOY_LOG"
      return 1
    fi
    WORK="$STAGE"
    if [ -n "$SLIM_SAYS" ]; then log "Код для облака: $(kb "$(slim_number body)") одним запросом (с комментариями было бы $(kb "$(slim_number bodyBefore)"))."
    elif [ -f "$STAGE/scripts/slim.mjs" ]; then log "Комментарии из кода убрать не вышло — отправляю как есть. Подробности: $DEPLOY_LOG"; fi
    # Страница комнаты уходит тоже без комментариев (0.51.0): scripts/slim.mjs облегчает её в той же копии.
    # Не вышло — она уйдёт как лежит: бота это не держит.
    if [ -n "$(slim_number page)" ] && [ "$(slim_number page)" != "$(slim_number pageBefore)" ]; then log "Страница комнаты: $(kb "$(slim_number page)") без картинок (с комментариями было бы $(kb "$(slim_number pageBefore)"))."; fi
    case "$SLIM_SAYS" in *'"pageError"'*) log "Комментарии из страницы комнаты убрать не вышло — она уйдёт как лежит. Подробности: $DEPLOY_LOG" ;; esac
    if ! step "ключи" inject --require-key; then WHY="нет ключа модели"; log "✗ Нет ключа модели (AI_PROVIDER_KEY) в $ENV_FILE."; return 1; fi
    # Репетиция в облаке: код там не собирается — живой бот не тронут.
    retry_step "репетиция: сообщение" tg run handlers/message '{ chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/start" }' --ctx '{ testRun: true }' \
      && retry_step "репетиция: пост канала" tg run handlers/channel_post '{ chat: { id: -1, type: "channel" }, text: "tick" }' --ctx '{ testRun: true }' \
      && { [ ! -f "$STAGE/tgcloud/handlers/callback_query.js" ] || retry_step "репетиция: кнопка" tg run handlers/callback_query '{ id: "1", from: { id: 1 }, data: "noop" }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$STAGE/tgcloud/handlers/business_connection.js" ] || retry_step "репетиция: подключение секретаря" tg run handlers/business_connection '{ id: "x", user: { id: 1 }, user_chat_id: 1, is_enabled: true }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$STAGE/tgcloud/handlers/business_message.js" ] || retry_step "репетиция: письмо секретарю" tg run handlers/business_message '{ business_connection_id: "x", chat: { id: 1, type: "private" }, from: { id: 1 }, text: "hi" }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$STAGE/tgcloud/handlers/my_chat_member.js" ] || retry_step "репетиция: её добавили в чат" tg run handlers/my_chat_member '{ chat: { id: -1, type: "supergroup", title: "x" }, from: { id: 1 }, old_chat_member: { status: "left" }, new_chat_member: { status: "member" } }' --ctx '{ testRun: true }'; } \
      && retry_step "состояние облака" tg fetch \
      || {
        diagnose; kind=$?
        # Связь пропала посреди отправки — это тоже не неудача сборки: тесты уже пройдены, повтор будет скорым.
        if [ "$kind" = 2 ]; then no_cloud "$head"; WHY="нет связи с платформой Telegram"; return 2; fi
        if [ -n "$CAUSE" ]; then
          log "✗ Не прошло: $WHY — публикации нет, бот на прежней сборке. Причина: $CAUSE. Подробности: $DEPLOY_LOG"
          WHY="$WHY. Причина: $CAUSE"
        else
          log "✗ Не прошло: $WHY — публикации нет, бот на прежней сборке. Подробности: $DEPLOY_LOG"
          show_error
        fi
        return 1
      }
    # Функция комнаты (её зовёт страница мини-приложения) — мягкая репетиция:
    # обрыв связи — как у прочих репетиций, а отказ платформы оставляет комнату
    # словами и публикации не мешает.
    if [ -f "$STAGE/tgcloud/endpoints/room.js" ]; then
      if retry_step "репетиция: комната" tg run endpoints/room '{ do: "look" }' --ctx '{ testRun: true }'; then
        APP=1
      elif cut_off; then
        no_cloud "$head"; WHY="нет связи с платформой Telegram"; return 2
      else
        APP_WHY="функция комнаты не прошла репетицию в облаке"; WHY=""
        drop_room
      fi
    fi
    local targets="handlers lib schema"
    [ "$APP" = 1 ] && targets="$targets endpoints"
    # Что платформа хранит сверх коммита. Есть лишнее — отправка пойдёт без целей и уберёт его.
    cloud_modules
    if [ -n "$STALE" ]; then
      MIRROR=1
      # shellcheck disable=SC2086
      log "В облаке модулей: $CLOUD_COUNT, из них лишних (в коде их уже нет): $(set -- $STALE; echo $#) — $(few $STALE). Убираю их этой публикацией."
    fi
    local stale_word=""
    # shellcheck disable=SC2086
    if ! step "публикация" push_code $targets; then
      # Ответ на первую отправку — главный: остальные — запасные пути.
      cp "$STEP_OUT" "$PUSH_OUT" 2>/dev/null
      # Запасные пути — прежние, с целями: что бы ни вышло с отправкой без целей, скрипт публикует не хуже, чем до
      # 0.49.1. Сначала — как всегда, с функцией комнаты (лишнее тогда остаётся в облаке до следующего раза); не
      # вышло — без неё: бот важнее комнаты. Пропала связь — запасные пути не при чём.
      # shellcheck disable=SC2086
      if [ "$MIRROR" = 1 ] && ! cut_off && step "публикация с целями" tg push $targets; then
        stale_word="$(last_word "$PUSH_OUT")"; WHY=""
      elif [ "$APP" = 1 ] && ! cut_off && drop_room && step "публикация без комнаты" tg push handlers lib schema; then
        APP=0; APP_WHY="платформа не приняла функцию комнаты"; WHY=""; APP_WORD="$(last_word "$PUSH_OUT")"
      else
        refused; return 1
      fi
    fi
    # С этой строки новый код уже в боте: дальнейшие неудачи — не «откат».
    local warn=""
    # Лишнее из облака убрать не вышло, а обычная отправка прошла: бот на новой сборке, но счёт модулей в облаке
    # прежний — об этом должен узнать тот, кто пишет код.
    if [ -n "$stale_word" ]; then
      warn="лишние модули из облака убрать не вышло (ответ платформы: «$stale_word»); перешлите эту строку в чат разработки"
    fi
    # Схема базы (0.67.0, сообщение 83: «сборка опубликована, но схема базы не применилась»). До 0.67.0 шаг делался
    # один раз: любая осечка — минутный обрыв связи тоже — давала весть «не применилась» без единого слова о причине.
    # Шаг повторяется без вреда (инструмент сам сверяет таблицы с опубликованной схемой): обрыв связи — до трёх
    # попыток, отказ платформы словами — две. Не вышло — в весть идёт причина: «нет связи» или ответ платформы. И
    # различается, менялась ли схема в этой сборке: не менялась — таблицы те же, что были, бот работает на них.
    local schema_ok=0 schema_try=0 schema_cut=0 schema_word=""
    while [ "$schema_try" -lt 3 ]; do
      schema_try=$((schema_try + 1))
      if step "схема базы" tg migrate --yes; then schema_ok=1; [ "$schema_try" -gt 1 ] && WHY=""; break; fi
      schema_word="$(last_word)"; schema_cut=0; cut_off && schema_cut=1
      [ "$schema_cut" = 1 ] || [ "$schema_try" -lt 2 ] || break
      if [ "$schema_try" -lt 3 ]; then
        sleep "$RETRY_PAUSE"
        printf '\n(схема базы: попытка %s)\n' "$((schema_try + 1))" >> "$DEPLOY_LOG"
      fi
    done
    if [ "$schema_ok" != 1 ]; then
      local schema_why="ответ платформы: «${schema_word:-пусто}»" schema_warn
      [ "$schema_cut" = 1 ] && schema_why="нет связи с платформой, попыток: $schema_try"
      # Та же ли схема, что в прежней публикации с этого телефона (её слепок — в «$LIVE»): файл совпал или его нет
      # ни там, ни тут. Слепка нет — публикация первая: схема новая.
      local schema_same=0
      if [ -d "$LIVE/tgcloud" ]; then
        if [ -f "$LIVE/tgcloud/schema.js" ] || [ -f "$STAGE/tgcloud/schema.js" ]; then
          cmp -s "$LIVE/tgcloud/schema.js" "$STAGE/tgcloud/schema.js" 2>/dev/null && schema_same=1
        else schema_same=1; fi
      fi
      if [ "$schema_same" = 1 ]; then
        schema_warn="схему базы сверить не вышло ($schema_why); таблицы в этой сборке не менялись — бот работает на прежних, следующая публикация сверит снова"
      else
        schema_warn="схема базы не применилась ($schema_why); перешлите эту строку в чат разработки"
      fi
      warn="${warn:+$warn; }$schema_warn"
    fi
    step "вебхук" webhook_check || true
    if [ -n "$WEBHOOK_MISSING" ]; then
      log "⚠ Бот не подписан на события:$WEBHOOK_MISSING — то, что на них держится (кнопки, секретарь, список её чатов), работать не будет. Пришлите эту строку в чат разработки."
      tell_owner "⚠️ Телефон: сборка $build опубликована, но бот не подписан на события:$WEBHOOK_MISSING. То, что на них держится (кнопки, секретарь, список её чатов), работать не будет. Перешлите эту строку в чат разработки."
    fi
    # Страница комнаты — отдельной отправкой и после кода: её неудача бота не
    # трогает. Адрес берётся из ответа платформы; не вышло отправить, а прежняя
    # страница есть — сердцу называется она.
    if [ "$APP" = 1 ]; then
      if [ -f "$STAGE/tgcloud.jsonc" ] && [ -f "$STAGE/miniapp/index.html" ]; then
        if retry_step "страница комнаты" tg push miniapp; then
          PAGE_URL="$(page_url)"
          [ -n "$PAGE_URL" ] || APP_WHY="платформа приняла страницу комнаты, но не назвала её адрес"
        else
          PAGE_URL="$(page_url)"
          if cut_off; then APP_WHY="страница комнаты не отправилась: пропала связь с платформой"
          else APP_WHY="платформа не приняла страницу комнаты"; APP_WORD="$(last_word)"; fi
        fi
        WHY=""
      else
        APP_WHY="в коммите нет страницы комнаты (miniapp/index.html и tgcloud.jsonc)"
      fi
    fi
    if step "пробуждение" wake_new_build; then :; else [ -z "$warn" ] && warn="пробуждение не подтвердилось"; fi
    WORK=""
    if ! promote; then
      unstage
      rm -rf "$LIVE" 2>/dev/null
      log "Слепок опубликованного не снялся: будильник через платформу подождёт следующей публикации."
    fi
    printf '%s\n%s\n%s\n%s\n' "$head" "$build" "$(date '+%F %T')" "$(door_mark)" > "$PUBLISHED"
    rm -f "$FAILED"
    if [ -n "$warn" ]; then
      log "Сборка $build опубликована, но $warn. Проверьте «статус» в боте. Подробности: $DEPLOY_LOG"
      tell_owner "⚠️ Телефон: сборка $build опубликована, но $warn. Скажите Аи «статус»."
    else
      log "✓ Сборка $build опубликована. Аи сама напишет «я обновилась»."
    fi
    if [ -n "$APP_WHY" ]; then
      # Прежняя страница жива — кнопки открывают её; нет — комната отвечает словами, как в 0.37.0.
      local rest="Комната пока отвечает словами."
      [ -z "$PAGE_URL" ] || rest="Кнопки открывают прежнюю страницу."
      log "⚠ Мини-приложение «Комната» не опубликовано: $APP_WHY. Сам бот на сборке $build. $rest Подробности: $DEPLOY_LOG"
      # Что именно ответила платформа (0.49.1): по этой строке причину видно без похода в журнал телефона.
      [ -z "$APP_WORD" ] || log "   Ответ платформы: $APP_WORD"
      tell_owner "⚠️ Телефон: сборка $build опубликована, но мини-приложение «Комната» — нет: $APP_WHY. $rest Перешлите эту строку в чат разработки.${APP_WORD:+ Ответ платформы: «$APP_WORD».}"
    elif [ -n "$PAGE_URL" ]; then
      log "✓ Мини-приложение «Комната» опубликовано: кнопка под ответом на «зайду к тебе» и в меню бота."
    fi
    WHY=""
    return 0
  }
  # Публикация идёт минутами (тесты, отправка кода), а цикл один: на это время
  # удары в канал берёт на себя помощник. Что бы ни вышло — копия с ключами
  # убирается.
  publish() {
    local code
    ticker_on
    publish_steps; code=$?
    ticker_off
    WORK=""
    unstage
    return "$code"
  }

  failed() {
    local head count
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"
    count=0; [ "$(failed_commit)" = "$head" ] && count="$(failed_count)"
    count=$((count + 1))
    printf '%s\n%s\n%s\n' "$head" "$count" "$(date +%s)" > "$FAILED"
    if [ "$count" = 1 ]; then
      tell_owner "⚠️ Телефон: сборка $(build_of) не опубликована — ${WHY:-причина в журнале телефона}. Аи осталась на прежней сборке."
    fi
    # Причина бывает и временной (связь), поэтому не «никогда», а «реже».
    if [ "$count" = 3 ]; then
      log "Три попытки подряд не вышли. Этот коммит дальше пробую раз в $((RETRY_EVERY / 60)) мин; новый коммит — сразу."
    fi
  }

  publish_if_needed() {
    local head build
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"; build="$(build_of)"
    [ -n "$head" ] && [ -n "$build" ] || return 0
    if [ "$DEPLOY_ON" = "commit" ]; then
      [ "$head" = "$(published_commit)" ] && return 0
    else
      [ "$build" = "$(published_build)" ] && return 0
    fi
    if [ "$(failed_commit)" = "$head" ] && [ "$(failed_count)" -ge 3 ] && [ $(( $(date +%s) - $(failed_at) )) -lt "$RETRY_EVERY" ]; then return 0; fi
    publish
    case $? in 0|2) ;; *) failed ;; esac
    return 0
  }

  # ── будильник ────────────────────────────────────────────────────────────
  local ALARM_STATE="$HOME_DIR/alarm.msg" ALARM_FAILS=0 LAST_RUN_TICK=0
  [ -f "$ALARM_STATE" ] || { [ -f "$HOME/.heart-alarm.msg" ] && cp "$HOME/.heart-alarm.msg" "$ALARM_STATE" 2>/dev/null; }
  # Поле ответа Telegram. JSON разбирает node: название канала приходит как
  # «\u041c\u043e…», и на экран должно выйти словом.
  field() {
    node -e 'let s = ""; process.stdin.on("data", (c) => { s += c; }).on("end", () => { try { const v = JSON.parse(s).result?.[process.argv[1]]; if (v != null) process.stdout.write(String(v)); } catch {} });' "$1" 2>/dev/null
  }
  id_of() { sed -n 's/.*"message_id":\([0-9][0-9]*\).*/\1/p' | head -n 1; }

  # Лёгкий удар: бот правит одно сообщение в канале, Telegram сообщает Аи.
  tick_channel() {
    local text id answer ok=0
    text="⏰ $(date '+%d.%m %H:%M:%S')"
    id="$(cat "$ALARM_STATE" 2>/dev/null || true)"
    if [ -z "$id" ]; then
      id="$(voice sendMessage -d "chat_id=$ROOM" -d "disable_notification=true" --data-urlencode "text=$text" | id_of)"
      [ -n "$id" ] && { ok=1; printf '%s\n' "$id" > "$ALARM_STATE"; }
    else
      answer="$(voice editMessageText -d "chat_id=$ROOM" -d "message_id=$id" --data-urlencode "text=$text")"
      case "$answer" in
        *'"ok":true'*|*'not modified'*) ok=1 ;;
        # Сообщение удалили руками: в следующий раз будет новое.
        *'not found'*|*"can't be edited"*|*'MESSAGE_ID_INVALID'*) rm -f "$ALARM_STATE" ;;
      esac
    fi
    if [ "$ok" = 1 ]; then ALARM_FAILS=0; return 0; fi
    ALARM_FAILS=$((ALARM_FAILS + 1))
    # Молчать о первой неудаче: связь на телефоне пропадает на секунды.
    [ "$ALARM_FAILS" = 3 ] && log "Будильник: три неудачи подряд — нет связи, либо бот не админ канала или не может править сообщения."
    return 1
  }

  # Тяжёлый удар: без второго бота, прямо через платформу. Каждый раз уходит
  # весь код, поэтому он редкий.
  tick_run() {
    [ -n "$TOKEN" ] || return 1
    # Слепка нет, но публикация с этого телефона была (прежняя версия скрипта
    # слепков не снимала): снять его с опубликованного коммита.
    if [ ! -f "$LIVE/tgcloud/handlers/message.js" ] && [ -n "$(published_commit)" ]; then snapshot "$(published_commit)" || true; fi
    if [ ! -f "$LIVE/tgcloud/handlers/message.js" ]; then
      [ "$NO_LIVE_SAID" = 0 ] && log "Будильник через платформу начнёт бить после первой публикации с этого телефона."
      NO_LIVE_SAID=1
      return 1
    fi
    ensure_cli || return 1
    local out
    ( cd "$LIVE" && node scripts/inject-secrets.mjs ) > /dev/null 2>&1 < /dev/null
    out="$(WORK="$LIVE" tg run handlers/message '{}' --ctx '{ tick: true }' 2>&1)"
    restore_live
    if printf '%s' "$out" | grep -q "build_mismatch"; then
      log "Будильник: в боте другая сборка, чем опубликована с этого телефона, — удар ничего не тронул."
      return 1
    fi
    printf '%s' "$out" | grep -Eq "ok: ?true"
  }

  alarm() {
    local now
    if [ "$CHANNEL_ALARM" = 1 ]; then tick_channel; return 0; fi
    now="$(date +%s)"
    if [ $((now - LAST_RUN_TICK)) -ge "$RUN_EVERY" ]; then
      LAST_RUN_TICK="$now"
      tick_run || true
    fi
    return 0
  }

  # Пока идёт публикация, цикл занят: тесты на телефоне — пять-шесть минут, и
  # отправка кода — ещё до нескольких. Вечером 17.11.2026 девять попыток заняли
  # около двух часов, и всё это время будильник молчал. Теперь на время
  # публикации удары в канал — в те же начала минут — шлёт помощник в фоне.
  # Будильник без второго бота (через платформу) помощнику не доверен: он сам
  # шлёт в облако весь код.
  ticker_on() {
    [ "$CHANNEL_ALARM" = 1 ] && [ -z "$TICKER" ] || return 0
    (
      nap=""
      trap '[ -n "$nap" ] && kill "$nap" 2>/dev/null; exit 0' TERM INT
      while :; do
        now="$(date +%s)"
        sleep $((EVERY - now % EVERY)) &
        nap=$!
        wait "$nap" 2>/dev/null
        nap=""
        tick_channel
      done
    ) &
    TICKER=$!
    return 0
  }

  # ── файл ключей ──────────────────────────────────────────────────────────
  # Пустой файл с готовыми именами: вписать остаётся только значения.
  # Существующий файл не трогается никогда.
  keys_template() {
    [ -e "$ENV_FILE" ] && return 1
    ( umask 077
      cat > "$ENV_FILE" <<EOF
# Ключи Аи для этого устройства. Значение — сразу после «=», без кавычек.
# В nano: сохранить — Ctrl+O, Enter; выйти — Ctrl+X.

# Токен публикации: @BotFather → бот Аи → Serverless → CLI Access → Access token
TGCLOUD_HEART_TOKEN=
# Ключ модели — тот же, что в секрете AI_PROVIDER_KEY
AI_PROVIDER_KEY=
# Ваш числовой ID в Telegram: кому писать, если публикация не вышла
OWNER_TG_ID=
# За какой веткой следить
HEART_BRANCH=$BRANCH

# По желанию: уберите «#» в начале строки и впишите значение.
# Запасные мозги (как получить каждый ключ — docs/BRAINS.md):
# KEY_GIGACHAT=
# KEY_EXPLABS=
# Рисование и ещё один запасной мозг (Cloudflare): ID аккаунта, двоеточие, токен
# KEY_CLOUDFLARE=
# Поиск в интернете — ключи Tavily, Exa, You (docs/BRAINS.md); без них ищет по Википедии:
# KEY_TAVILY=
# KEY_EXA=
# KEY_YOU=
# Минутный будильник — токен любого бота, кроме Аи, и числовой ID канала «Мост»:
# ALARM_BOT_TOKEN=
# ALARM_CHAT_ID=
# Дверь отдельного приложения (docs/DOOR.md). Обе строки пишет сама команда
# «bash scripts/phone.sh door»: токен своего бота двери и «номер канала:секрет».
# DOOR_BOT_TOKEN=
# KEY_DOOR=
EOF
    ) 2>/dev/null
  }

  # Чем открыть файл ключей: nano в Termux обычно есть, но не обязан.
  edit_hint() {
    if command -v nano > /dev/null 2>&1; then echo "nano $ENV_FILE"
    elif command -v pkg > /dev/null 2>&1; then echo "pkg install -y nano && nano $ENV_FILE"
    else echo "${EDITOR:-vi} $ENV_FILE"; fi
  }

  # ── проверка настройки ───────────────────────────────────────────────────
  check() {
    local bad=0 who title extra made=0
    echo "Папка:   $REPO"
    if [ "$HAVE_ENV" = 1 ]; then echo "Ключи:   $ENV_FILE — найден"
    elif keys_template; then made=1; echo "Ключи:   $ENV_FILE — файла не было, создан пустой: в него нужно вписать значения"
    else echo "Ключи:   $ENV_FILE — НЕТ ФАЙЛА"; fi
    [ -f "$HOME/.heart-alarm.env" ] && echo "         и прежний $HOME/.heart-alarm.env — его строки тоже читаются; не нужен — удалите"
    if [ -n "$UNREAD" ]; then
      echo "✗ в файле ключей не читаются строки:$UNREAD — нужно «ИМЯ=значение» в одной строке, значение сразу после «=»"; bad=1
    fi
    echo "Ветка:   $BRANCH ($BRANCH_FROM) · публиковать: $([ "$DEPLOY_ON" = commit ] && echo 'каждый коммит' || echo 'когда сменился номер сборки')"
    for tool in git node npm curl; do
      command -v "$tool" > /dev/null 2>&1 || { echo "✗ нет программы «$tool»"; bad=1; }
    done
    if command -v node > /dev/null 2>&1; then
      local major
      major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      [ "$major" -ge 22 ] 2>/dev/null && echo "✓ node $major" || { echo "✗ нужен node 22 или новее (сейчас $major)"; bad=1; }
    fi
    if [ -z "$TOKEN" ]; then echo "✗ нет TGCLOUD_HEART_TOKEN — публиковать нечем"; bad=1
    elif tokenlike "$TOKEN"; then echo "✓ токен публикации: вид правильный"
    else echo "✗ TGCLOUD_HEART_TOKEN не похож на токен публикации (app…:…) — впишите сам токен вместо образца"; bad=1; fi
    if [ -z "${AI_PROVIDER_KEY:-}" ]; then echo "✗ нет AI_PROVIDER_KEY"; bad=1
    elif keylike "$AI_PROVIDER_KEY"; then echo "✓ ключ модели: есть"
    else echo "✗ AI_PROVIDER_KEY не похож на ключ: в нём пробелы или русские буквы — впишите сам ключ вместо образца"; bad=1; fi
    case "${OWNER_TG_ID:-}" in
      ''|*[!0-9]*) echo "• OWNER_TG_ID не задан числом — годится, если владелец записан в config.js" ;;
      *) echo "✓ ID владельца: есть" ;;
    esac
    extra=""
    local name seek=""
    for name in $(env | sed -n 's/^\(KEY_[A-Za-z0-9_]*\)=..*/\1/p'); do
      if ! keylike "${!name}"; then echo "✗ $name не похож на ключ (пробелы или русские буквы) — впишите ключ или уберите строку"; bad=1; continue; fi
      # Ключи поисковиков — не мозги: о них отдельная строка.
      case "$name" in
        KEY_TAVILY|KEY_EXA|KEY_YOU) seek="$seek$(printf '%s' "${name#KEY_}" | tr 'A-Z' 'a-z') " ;;
        # Ключ двери приложения — тоже не мозг: о нём своя строка ниже.
        KEY_DOOR) ;;
        *) extra="$extra$(printf '%s' "${name#KEY_}" | tr 'A-Z' 'a-z') " ;;
      esac
    done
    [ -n "$extra" ] && echo "✓ запасные мозги: $extra"
    [ -n "$seek" ] && echo "✓ поиск в интернете: $seek"
    if [ -n "${KEY_CLOUDFLARE:-}" ]; then
      if printf '%s' "$KEY_CLOUDFLARE" | grep -Eq '^[0-9a-fA-F]{32}:[!-~]{20,}$'; then echo "✓ рисование: ключ Cloudflare записан верно"
      else echo "• KEY_CLOUDFLARE записан не так: нужен вид «ID аккаунта:токен» — 32 знака ID, двоеточие, токен, без пробелов. Пока так — рисования не будет"; fi
    fi
    if [ -n "${DOOR_BOT_TOKEN:-}" ] && ! printf '%s' "$DOOR_BOT_TOKEN" | LC_ALL=C grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then
      echo "• DOOR_BOT_TOKEN не похож на токен бота (цифры, двоеточие, буквы) — дверь приложения с ним не открыть: bash scripts/phone.sh door"
    fi
    if [ -n "${KEY_DOOR:-}" ]; then
      if printf '%s' "$KEY_DOOR" | grep -Eq '^-100[0-9]{5,15}:[!-~]{32,}$'; then echo "✓ дверь приложения: ключ записан верно$([ -n "${DOOR_BOT_TOKEN:-}" ] || echo '; своего бота двери на телефоне нет — проверить её отсюда: bash scripts/phone.sh door')"
      else echo "• KEY_DOOR записан не так: нужен вид «номер канала:секрет» — номер начинается с -100, двоеточие, секрет от 32 знаков, без пробелов. Пока так — дверь приложения закрыта"; fi
    fi
    [ -n "${AI_EXTRA_KEYS:-}" ] && echo "✓ запасные мозги: строка AI_EXTRA_KEYS есть"
    if fetch_branch; then
      local theirs mine
      theirs="$(git -C "$REPO" rev-parse -q --verify FETCH_HEAD 2>/dev/null)"; mine="$(git -C "$REPO" rev-parse -q --verify HEAD 2>/dev/null)"
      echo "✓ GitHub: ветка «$BRANCH» на месте, коммит $(short "$theirs")"
      if ! git -C "$REPO" cat-file -e "$theirs:scripts/phone.sh" 2>/dev/null; then
        echo "✗ в ветке «$BRANCH» нет scripts/phone.sh — следить за ней этот скрипт не может (так выглядит main до слияния). Нужная ветка — строкой HEART_BRANCH в $ENV_FILE"; bad=1
      elif [ "$theirs" != "$mine" ]; then
        if dirty; then echo "✗ папка на другом коммите ($(short "$mine")), и в ней есть несохранённые правки — сама она не обновится: git -C $REPO checkout -- ."; bad=1
        else echo "• папка пока на коммите $(short "$mine") — при запуске обновится сама"; fi
      fi
    else
      echo "✗ $(why_fetch)"; bad=1
    fi
    if tokenlike "$TOKEN" && ensure_cli; then
      if tg fetch > "$DEPLOY_LOG" 2>&1; then echo "✓ платформа: токен принят"
      elif grep -q "Could not reach" "$DEPLOY_LOG" 2>/dev/null; then echo "✗ нет связи с платформой Telegram (cloud.telegram.org) — проверьте сеть и повторите проверку"; bad=1
      elif grep -q "TGCLOUD_TOKEN" "$DEPLOY_LOG" 2>/dev/null; then echo "✗ платформа не приняла токен публикации — нужен действующий: @BotFather → бот Аи → Serverless → CLI Access"; bad=1
      else echo "✗ платформа ответила не так, как ждали (подробности: $DEPLOY_LOG)"; bad=1; fi
    fi
    [ "$VOICE_BAD" = 1 ] && { echo "✗ ALARM_BOT_TOKEN не похож на токен бота (цифры, двоеточие, буквы) — впишите токен или уберите строку"; bad=1; }
    [ "$ROOM_BAD" = 1 ] && { echo "✗ ALARM_CHAT_ID не похож на ID канала (число вида -100…) — впишите число или уберите строку"; bad=1; }
    if [ -n "$VOICE" ] && [ -n "$ROOM" ]; then
      who="$(voice getMe | field username)"
      if [ -z "$who" ]; then echo "✗ будильник: Telegram не принял ALARM_BOT_TOKEN"; bad=1
      else
        title="$(voice getChat -d "chat_id=$ROOM" | field title)"
        if [ "$VOICE_SELF" = 1 ]; then
          echo "✗ будильник: @${who} — это сама Аи (тот же бот, что публикуется): себя она не услышит. В ALARM_BOT_TOKEN нужен токен другого бота; пока его нет — раз в $((RUN_EVERY / 60)) мин через платформу"; bad=1
        else
          echo "✓ будильник: раз в ${EVERY} с от имени @${who}$([ -n "$title" ] && echo ", канал «$title»" || echo " — но канал ему не виден: добавьте его админом")"
          echo "  Если @${who} — это сама Аи, она себя не услышит: нужен токен другого бота."
          [ -n "$title" ] || bad=1
        fi
      fi
    elif [ "$VOICE_BAD$ROOM_BAD" != "00" ]; then
      echo "• будильник: пока строки ALARM_* не поправлены — раз в $((RUN_EVERY / 60)) мин через платформу"
    elif [ -n "$VOICE" ] || [ -n "$ROOM" ]; then
      echo "✗ будильник: нужны оба — ALARM_BOT_TOKEN и ALARM_CHAT_ID"; bad=1
    else
      echo "• будильник: без второго бота — раз в $((RUN_EVERY / 60)) мин через платформу, опубликованным кодом$([ -n "$(published_commit)" ] || echo ' (начнёт после первой публикации)')"
    fi
    echo "Сборка в папке: $(build_of) · опубликовано отсюда: $(published_build || true)$([ -f "$PUBLISHED" ] || echo 'ещё ничего')"
    if [ "$TESTS" = "on" ] && [ "${2:-}" = "tests" ]; then
      echo "Гоняю тесты — это минута-другая…"
      if run_tests; then echo "✓ тесты на этом устройстве проходят"
      else
        echo "✗ тесты на этом устройстве не проходят (журнал: $TEST_LOG):"; bad=1
        why_tests | sed 's/^/   /'
        echo "   Если дело в устройстве, а не в коде — строка HEART_TESTS=off."
      fi
    fi
    if [ "$bad" = 0 ]; then echo "Готово к работе: bash scripts/phone.sh"
    elif [ "$made" = 1 ] || [ "$HAVE_ENV" = 0 ]; then echo "Дальше: $(edit_hint) — вписать значения после «=», затем снова: bash scripts/phone.sh check"
    else echo "Сначала поправьте строки с ✗ (ключи — в $ENV_FILE), затем снова: bash scripts/phone.sh check"; fi
    return "$bad"
  }

  # ── режимы ───────────────────────────────────────────────────────────────
  # ── дверь приложения ─────────────────────────────────────────────────────
  # Одной командой и по шагам (docs/DOOR.md, раздел 9): бот двери → канал → ключ →
  # сердце с ключом → опыт. 22.11.2026 владелец выполнил те же шаги пятью
  # отдельными строками: первая не вышла (бот будильника живёт на сервере), а
  # остальные всё равно отработали — сердце опубликовалось второй раз впустую.
  # Здесь шаг, который не вышел, останавливает остальные.
  # Номер бота Аи — число после «app» в токене публикации: по нему посредник
  # называет её права в канале и не даёт взять для двери её же. Что это один и
  # тот же номер — предположение о платформе (как у будильника выше). Поэтому
  # посредник на нём ничего не обрывает: не сошлось — скажет «не вижу Аи среди
  # администраторов» и всё равно сделает опыт.
  # DOOR_EACH — сколько секунд ждать ответа каждым из трёх путей опыта; AI_NAME — имя бота Аи (его называет сердце);
  # DOOR_SEQ — номер последнего, что дверь слышала до опыта: после опыта сердце назовёт только то, что пришло за него.
  # DOOR_OPEN — сердце само сказало, что дверь у него открыта (ключ на месте, код новый): молчит опыт — дело не в ключе.
  local AI_ID="" AI_NAME="" DOOR_SAID="" DOOR_NOW="" DOOR_SEQ="" DOOR_OPEN="" DOOR_WAIT="${HEART_DOOR_WAIT:-600}" DOOR_EACH="${HEART_DOOR_TRY:-15}"
  case "${TOKEN%%:*}" in app[0-9]*) AI_ID="${TOKEN%%:*}"; AI_ID="${AI_ID#app}" ;; esac
  case "$AI_ID" in ''|*[!0-9]*) AI_ID="" ;; esac
  door_client() { DOOR_AI_ID="$AI_ID" DOOR_AI_NAME="$AI_NAME" DOOR_FLOW=1 HEART_ENV="$ENV_FILE" node "$REPO/scripts/door-client.mjs" "$@"; }
  # Вопрос самому сердцу — через платформу, как удар будильника без второго бота: что дверь слышала за последние
  # минуты. Первый живой опыт (22.11.2026) кончился словами «ответа нет», и по экрану было не узнать, дошёл ли
  # запрос до Аи. Заодно сердце включает у себя режим общения ботов и называет имя своего бота.
  # Первым словом команды — номер, после которого считать («что слышала за этот опыт»); без него — за четверть часа.
  # 0 — ответило: слова в DOOR_SAID, имя — в AI_NAME, номер последнего услышанного — в DOOR_NOW.
  door_state() {
    DOOR_SAID=""; DOOR_NOW=""; DOOR_OPEN=""
    [ -f "$LIVE/tgcloud/handlers/message.js" ] && [ -f "$LIVE/scripts/inject-secrets.mjs" ] || return 1
    ensure_cli > /dev/null 2>&1 || return 1
    local out name head ctx='{ door: "state" }'
    case "${1:-}" in ''|*[!0-9]*) ;; *) ctx="{ door: \"state\", after: $1 }" ;; esac
    ( cd "$LIVE" && node scripts/inject-secrets.mjs ) > /dev/null 2>&1 < /dev/null
    out="$(WORK="$LIVE" tg run handlers/message '{}' --ctx "$ctx" 2>&1)"
    restore_live
    DOOR_SAID="$(printf '%s\n' "$out" | sed "s/$(printf '\033')\[[0-9;]*m//g" | sed -n 's/^.*DOOR-SAYS //p' | head -n 1 | sed 's/  *[0-9][0-9]*ms *$//')"
    [ -n "$DOOR_SAID" ] || return 1
    head="${DOOR_SAID%% | *}"
    name="${head#name=}"; name="${name%% *}"
    case "$name" in ''|-|*[!A-Za-z0-9_]*) ;; *) AI_NAME="$name" ;; esac
    case "$head" in *' seq='*) DOOR_NOW="${head##* seq=}"; DOOR_NOW="${DOOR_NOW%% *}" ;; esac
    case "$DOOR_NOW" in ''|*[!0-9]*) DOOR_NOW="" ;; esac
    case "$DOOR_SAID" in *"Что слышала Аи"*) DOOR_OPEN=1 ;; esac
    return 0
  }
  # Что слышала Аи — строками на экран: по ним видно, какой путь до неё доходит, даже когда ответа не было.
  door_heard() {
    if door_state "$DOOR_SEQ"; then
      case "$DOOR_SAID" in *' | '*) printf '%s\n' "${DOOR_SAID#* | }" | tr '|' '\n' | sed 's/^ *//; s/ *$//' ;; esac
      return 0
    fi
    echo "Что слышала Аи, спросить у сердца не вышло. Скажите ей «статус» и пришлите в чат разработки этот экран и её строку «Дверь приложения»."
    return 1
  }
  # Слова платформы о вебхуке бота Аи — без цвета и без адреса (адрес ни на экран, ни в журнал не идёт).
  door_hook() { tg webhook "$@" 2>&1 | sed "s/$(printf '\033')\[[0-9;]*m//g" | grep -v -i -E '^[[:space:]]*(expected[[:space:]]+)?url:'; }
  # Каких событий двери нет в подписке. Личное сообщение бота приходит событием «message», пост канала —
  # «channel_post», его правка — «edited_channel_post»; считаются те, для которых в опубликованном коде есть обработчик.
  door_lacks() {
    local words name dir="$REPO" lacks=""
    words=" $(printf '%s' "$1" | tr ',' ' ' | tr -s '[:space:]' ' ') "
    [ -d "$LIVE/tgcloud/handlers" ] && dir="$LIVE"
    for name in message channel_post edited_channel_post; do
      [ -f "$dir/tgcloud/handlers/$name.js" ] || continue
      case "$words" in *" $name "*) ;; *) lacks="$lacks $name" ;; esac
    done
    printf '%s' "$lacks"
  }
  # Подписка бота Аи на события Telegram — строкой на экран, до опыта. Нет события в подписке — Telegram не отдаёт его
  # сердцу вовсе, а на экране это то же «ответа нет» и «не слышала» (опыт 22.11.2026 этого не различал). Нет нужного —
  # подписка чинится тут же.
  door_events() {
    local out words lacks
    ensure_cli > /dev/null 2>&1 || return 0
    out="$(door_hook)"
    words="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*allowed updates:[[:space:]]*//p' | head -n 1)"
    if [ -z "$words" ]; then echo "Подписку Аи на события Telegram узнать не вышло — опыт идёт и без этого."; return 0; fi
    lacks="$(door_lacks "$words")"
    if [ -z "$lacks" ]; then echo "✓ Подписка Аи на события Telegram: личные сообщения, посты канала и их правки — на месте."; return 0; fi
    echo "✗ Аи не подписана на события:$lacks — такие запросы Telegram ей не отдаёт вовсе. Чиню подписку…"
    out="$(door_hook sync)"
    words="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*allowed updates:[[:space:]]*//p' | head -n 1)"
    lacks="$(door_lacks "$words")"
    if [ -n "$words" ] && [ -z "$lacks" ]; then echo "✓ Подписка починена: теперь эти события до Аи доходят."
    else echo "✗ Подписка не починилась${lacks:+ — нет событий:$lacks}. Пришлите этот экран в чат разработки."; fi
    return 0
  }
  # Опыт не прошёл — что знает сам Telegram о доставке событий Аи: сколько их ждёт в очереди и чем кончилась
  # последняя доставка. Сердце о недоставленном не знает; видно это только здесь.
  door_delivery() {
    local out pending last
    ensure_cli > /dev/null 2>&1 || return 0
    out="$(door_hook)"
    pending="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*pending updates:[[:space:]]*//p' | head -n 1 | tr -cd '0-9')"
    last="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*last error:[[:space:]]*//p' | head -n 1 | sed 's#[A-Za-z][A-Za-z]*://[^ ]*#(адрес)#g' | scrub)"
    [ -n "$pending" ] || [ -n "$last" ] || return 0
    if [ -n "$last" ]; then echo "Telegram о доставке событий Аи: в очереди — ${pending:-0}; последняя ошибка доставки — «${last:0:200}»."
    else echo "Telegram о доставке событий Аи: в очереди — ${pending:-0}; ошибок доставки нет."; fi
    return 0
  }
  # Как у «deploy»: 0 — опубликовано; иначе причина уже названа строками публикации.
  door_publish() {
    local code
    publish; code=$?
    case "$code" in 0) return 0 ;; 2) return 1 ;; esac
    failed
    return 1
  }
  # Опыт — три пути по очереди (посредник, «ways»): личное сообщение бота, правка поста, новый пост.
  # Сразу после публикации: когда именно платформа начинает отвечать новым кодом, неизвестно — первая проба
  # без ответа ещё не приговор, через четверть минуты — вторая, и уже её слова — итог.
  door_fresh() {
    local code
    door_client ways "--wait=$DOOR_EACH" --try; code=$?
    # 5 — ответа нет; 7 — ответило сердце с другим ключом: прежний код ещё на месте.
    case "$code" in 5|7) ;; *) return "$code" ;; esac
    echo "Сердце только что опубликовано — возможно, новый код ещё не заработал. Пробую ещё раз…"
    sleep "${HEART_DOOR_PAUSE:-15}"
    door_client ways "--wait=$DOOR_EACH"
  }
  open_door() {
    local given="${1:-}" code line more published=0
    [ -f "$REPO/scripts/door-client.mjs" ] || { echo "В этой сборке двери приложения ещё нет."; return 1; }
    command -v node > /dev/null 2>&1 || { echo "Нет node — проверить дверь нечем."; return 1; }
    echo "Дверь приложения: бот двери → канал → ключ → сердце с ключом → опыт."
    # 1. Бот двери: свой и без вебхука. Нет такого — спросить токен нового.
    # Файл ключей перечитывается после каждой записи в него: ключи читались при
    # запуске, а окружение у посредника главнее файла — без этого он взял бы прежний токен.
    if [ -n "$given" ]; then
      door_client bot "$given" || return 1
      load_env "$ENV_FILE"
    else
      door_client bot; code=$?
      case "$code" in
        0) ;;
        3|4|6)
          # Не терминал (cron, тест) — спросить некого.
          # HEART_DOOR_ASK=1 — спросить и без терминала: ответ придёт по трубе (тесты).
          if [ ! -t 0 ] && [ "${HEART_DOOR_ASK:-}" != "1" ]; then echo "Когда токен будет: bash scripts/phone.sh door <токен нового бота>"; return 1; fi
          # Без показа: токен не должен остаться на экране — экран потом шлют в чат.
          printf 'Вставьте сюда токен нового бота (на экране он не покажется) и нажмите Enter: '
          IFS= read -rs line || line=""
          # Вставили всё сообщение @BotFather, а не одну строку, — дочитать остальное:
          # токен где-то в нём, а непрочитанные строки достались бы оболочке как команды.
          more=""
          while IFS= read -rs -t 1 more; do line="$line $more"; more=""; done
          # Последняя строка без Enter тоже прочитана — она в «more».
          [ -n "$more" ] && line="$line $more"
          echo
          [ -n "$line" ] || { echo "Токена нет — дверь подождёт. Когда он будет: bash scripts/phone.sh door"; return 1; }
          door_client bot "$line" || return 1
          load_env "$ENV_FILE" ;;
        *) return 1 ;;
      esac
    fi
    # 2. Канал и ключ: посредник ждёт, пока бота добавят в канал, и пишет ключ в файл.
    door_client setup "--wait=$DOOR_WAIT" || return 1
    load_env "$ENV_FILE"
    # 3. Сердце с этим ключом. Опубликовано с ним же и той же сборкой, что лежит в папке, — второй раз не нужно.
    # (Сборка в папке новее опубликованной — дом ещё не успел: опыт со старым сердцем был бы впустую.)
    if [ "$(published_door)" != "$(door_mark)" ] || [ "$(published_build)" != "$(build_of)" ]; then
      echo "Публикую сердце с ключом двери — минута-другая…"
      door_publish || { echo "✗ Сердце с ключом двери не опубликовалось — дверь пока закрыта. Причина — строками выше."; return 1; }
      published=1
    fi
    # 4. Опыт. Сначала — подписка бота Аи на события: без неё запрос до сердца не дойдёт, каким путём его ни шли.
    # Затем — вопрос сердцу: оно включает у себя режим общения ботов, называет имя своего бота и номер
    # последнего, что слышала дверь, — после опыта по этому номеру видно, что пришло именно за него.
    # Метка могла и обмануть (сердце публиковали не отсюда): молчит дверь или ключи разные — публикация и вторая попытка.
    door_events
    local open=""
    door_state && { DOOR_SEQ="$DOOR_NOW"; open="$DOOR_OPEN"; }
    if [ "$published" = 1 ]; then door_fresh; code=$?
    else
      door_client ways "--wait=$DOOR_EACH" --try; code=$?
      # Ответа нет (5), а сердце перед опытом само сказало, что дверь у него открыта: ключ на месте и код новый —
      # вторая публикация ничего не изменит, запрос теряется по дороге. Ключи разные (7) или сердце на вопрос
      # о двери не ответило (прежняя сборка, публиковали не отсюда) — публикация и вторая попытка. Она же — когда
      # запрос до сердца дошёл, но «не туда»: ключ у него от другого канала, и публикация с ключом из файла это правит.
      if [ "$code" = 5 ] && [ "$open" = 1 ] && door_state "$DOOR_SEQ"; then
        case "$DOOR_SAID" in *"пришёл не туда"*) open="" ;; esac
      fi
      if [ "$code" = 7 ] || { [ "$code" = 5 ] && [ "$open" != 1 ]; }; then
        echo "Публикую сердце заново: в опубликованном, похоже, нет этого ключа двери…"
        door_publish || { echo "✗ Сердце с ключом двери не опубликовалось — дверь пока закрыта. Причина — строками выше."; return 1; }
        door_fresh; code=$?
      fi
    fi
    # 5. Что слышала сама Аи: какой путь до неё дошёл — видно и тогда, когда ответа не было.
    door_heard || true
    # 6. Опыт не прошёл — что говорит Telegram о доставке её событий (очередь, последняя ошибка) и что делать с экраном.
    if [ "$code" != 0 ]; then
      door_delivery
      echo "Пришлите этот экран целиком в чат разработки: по нему видно, где теряется запрос."
    fi
    return "$code"
  }

  case "$MODE" in
    check) check "$@"; return $? ;;
    door)
      # Публикация вписывает ключи в копию кода: вдвоём с работающим домом нельзя.
      if ! enter; then echo "Остановите дом (Ctrl+C в его окне) и повторите: bash scripts/phone.sh door" >&2; return 1; fi
      command -v termux-wake-lock > /dev/null 2>&1 && termux-wake-lock
      # Сначала — свежее из ветки: поправка к двери могла прийти, пока дом стоял.
      # Не вышло (нет связи, правки в папке) — работать с тем, что есть.
      sync || true
      local door_code=0
      open_door "$DOOR_ARG" || door_code=$?
      # Что бы ни вышло с дверью, дом должен работать: будильник и публикации не
      # ждут второй команды. HEART_AFTER_DOOR=stop — только опыт (тесты, cron).
      if [ "${HEART_AFTER_DOOR:-home}" = "stop" ]; then
        command -v termux-wake-unlock > /dev/null 2>&1 && termux-wake-unlock
        return "$door_code"
      fi
      leave
      trap - EXIT INT TERM
      exec bash "$SELF" run ;;
    tick)
      if [ "$CHANNEL_ALARM" = 1 ]; then tick_channel && echo "Удар ушёл в канал." || { echo "Удар не ушёл."; return 1; }
      else
        # Удар через платформу на время вписывает ключи в слепок: вдвоём с
        # работающим домом этого делать нельзя.
        enter || return 1
        tick_run && echo "Сердце проснулось." || { echo "Пробуждение не подтвердилось."; return 1; }
      fi
      return 0 ;;
    deploy)
      enter || return 1
      # Публикация руками идёт минутами, а Termux в это время обычно в фоне:
      # телефон не должен усыпить его посреди отправки. Цикл берёт этот замок сам.
      command -v termux-wake-lock > /dev/null 2>&1 && termux-wake-lock
      sync || { echo "С веткой «$BRANCH» в GitHub свериться не вышло — публикации нет." >&2; command -v termux-wake-unlock > /dev/null 2>&1 && termux-wake-unlock; return 1; }
      publish; local published=$?
      command -v termux-wake-unlock > /dev/null 2>&1 && termux-wake-unlock
      case "$published" in 0) return 0 ;; 2) return 1 ;; esac
      failed; return 1 ;;
    once)
      enter || return 1
      sync && publish_if_needed
      alarm
      return 0 ;;
    events)
      # Какие события платформа отдаёт коду: «секретарю» нужно business_message.
      # Это только вопрос: в проекте ничего не создаётся и не публикуется;
      # инструмент лишь обновляет свою памятку в папке .tgcloud. Список у
      # платформы общий и открытый — токен для него не нужен.
      ensure_cli || { echo "Инструмент публикации не поставился: нет связи с npm? Подробности: $DEPLOY_LOG" >&2; return 1; }
      local asked_out listed
      # Цвета терминала из ответа убираются: в чат уходят буквы, а не «[31m».
      asked_out="$(tg add handlers 2>&1 | sed "s/$(printf '\033')\[[0-9;]*m//g")"
      listed="$(printf '%s\n' "$asked_out" | sed -n 's/.*Available handlers\/ types: \(.*\)\.$/\1/p' | head -n 1)"
      if [ -n "$listed" ]; then
        echo "Платформа отдаёт ещё такие события (кроме тех, что Аи уже слушает):"
        echo "  $listed"
        # В списке — только те события, для которых в проекте ещё нет файла.
        if [ -f "$REPO/tgcloud/handlers/business_message.js" ]; then
          echo "Событие business_message Аи уже слушает: «секретарь» в этой сборке есть."
        else
          case ", $listed," in
            *", business_message,"*) echo "Событие business_message есть — за «секретаря» можно браться." ;;
            *) echo "События business_message в списке нет — «секретаря» на этой платформе пока не сделать." ;;
          esac
        fi
        echo "Пришлите эти строки в чат разработки."
        return 0
      fi
      case "$asked_out" in
        *"already exists"*)
          if [ -f "$REPO/tgcloud/handlers/business_message.js" ]; then
            echo "Платформа отдаёт только те события, которые Аи уже слушает. Среди них business_message: «секретарь» в этой сборке есть."
          else
            echo "Платформа отдаёт только те события, которые Аи уже слушает. События business_message среди них нет — «секретаря» на этой платформе пока не сделать."
          fi ;;
        *)
          echo "Списка событий платформа не прислала. Её ответ:"
          printf '%s\n' "$asked_out" | sed 's/^/  /'
          echo "Пришлите эти строки в чат разработки." ;;
      esac
      return 0 ;;
    run) ;;
    *) echo "Не знаю режима «$MODE». Есть: run, check, deploy, tick, once, events, door." >&2; return 1 ;;
  esac

  if [ -z "$TOKEN" ] && [ "$CHANNEL_ALARM" = 0 ]; then
    echo "В $ENV_FILE нет ни токена публикации, ни будильника — делать нечего. Начните с проверки: bash scripts/phone.sh check" >&2
    return 1
  fi
  # Ключи читаются один раз, при запуске: с образцом вместо ключа цикл крутился
  # бы впустую — лучше сказать сразу.
  if [ -n "$TOKEN" ] && { ! tokenlike "$TOKEN" || ! keylike "${AI_PROVIDER_KEY:-}"; }; then
    echo "✗ С такими ключами публиковать нельзя: $(lacking)." >&2
    echo "  Поправьте файл и запустите снова. Проверка: bash scripts/phone.sh check" >&2
    return 1
  fi
  enter || return 1
  # Телефон не должен усыплять Termux, пока дом работает.
  command -v termux-wake-lock > /dev/null 2>&1 && termux-wake-lock
  # Запуск руками — это «попробуй ещё раз»: прошлые неудачи не в счёт.
  rm -f "$FAILED"
  log "Дом запущен: ветка «$BRANCH», сборка в папке $(build_of). Остановить — Ctrl+C."
  [ -z "$UNREAD" ] || log "В файле ключей не читаются строки:$UNREAD — подробнее: bash scripts/phone.sh check"
  [ "$VOICE_BAD$ROOM_BAD" = "00" ] || log "В строках ALARM_* образец вместо значения — будильник через канал выключен."
  [ "$VOICE_SELF" = 0 ] || log "ALARM_BOT_TOKEN — токен самой Аи: себя она не услышит, поэтому будильник идёт через платформу. Для минутного нужен токен другого бота."
  if [ "$CHANNEL_ALARM" = 1 ]; then log "Будильник: раз в ${EVERY} с через канал."
  else log "Будильник: раз в $((RUN_EVERY / 60)) мин через платформу (второго бота нет)."; fi
  [ -n "$TOKEN" ] || log "Токена публикации нет: только будильник."

  local last_sync=0 now
  while true; do
    now="$(date +%s)"
    if [ -n "$TOKEN" ] && [ $((now - last_sync)) -ge "$SYNC_EVERY" ]; then
      last_sync="$now"
      sync && publish_if_needed
    fi
    alarm
    # Спать до следующей границы периода: удары приходятся на начало минуты.
    # «sleep & wait» — чтобы остановка (Ctrl+C, kill) срабатывала сразу.
    now="$(date +%s)"
    sleep $((EVERY - now % EVERY)) &
    NAP=$!
    wait "$NAP" 2>/dev/null
    NAP=""
  done
}

main "$@"
exit $?

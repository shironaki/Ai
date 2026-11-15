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
#
# Ключи живут вне репозитория, в файле ~/.heart.env — строки «ИМЯ=значение»,
# кавычки не нужны. Читаются один раз, при запуске. Подробно — docs/PHONE.md.
#
#   TGCLOUD_HEART_TOKEN=…   токен публикации (app…:…)
#   AI_PROVIDER_KEY=…       ключ модели
#   OWNER_TG_ID=…           числовой ID владельца
#   KEY_GIGACHAT=…          ключ запасных мозгов: имя после KEY_ — id провайдера
#                           (MISTRAL, CEREBRAS, GEMINI, OPENROUTER, NVIDIA, GHMODELS, EXPLABS)
#   KEY_CLOUDFLARE=ID:токен  рисование и запасной мозг: ID аккаунта, двоеточие, токен
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
#
# Весь файл — одна функция: bash читает её целиком до запуска, поэтому
# обновление самого скрипта из GitHub не ломает идущий процесс.
set -u

main() {
  local MODE="${1:-run}"
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
  tg() { ( cd "$REPO" && mkdir -p .tgcloud && TGCLOUD_TOKEN="$TOKEN" node "$CLI" "$@" ) < /dev/null; }
  voice() { curl -sS --max-time 20 "$TG_API/$1" "${@:2}" 2>/dev/null; }
  restore() { git -C "$REPO" checkout -q -- tgcloud/lib/secrets.js 2>/dev/null; }
  inject() { ( cd "$REPO" && node scripts/inject-secrets.mjs "$@" ) < /dev/null; }

  # Слово владельцу — от имени того же бота, что говорит в канал. Нет его —
  # останется строка в журнале; об удачной публикации Аи пишет сама.
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
          HEART_*|ALARM_*|TGCLOUD_*|KEY_*|AI_PROVIDER_KEY|AI_EXTRA_KEYS|OWNER_TG_ID) unset "$name" ;;
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
  local NO_LIVE_SAID=0
  snapshot() {
    rm -rf "$LIVE.new" 2>/dev/null
    mkdir -p "$LIVE.new" || return 1
    if git -C "$REPO" archive "$1" tgcloud scripts package.json 2>/dev/null | tar -x -C "$LIVE.new" 2>/dev/null \
      && [ -f "$LIVE.new/tgcloud/handlers/message.js" ] && [ -f "$LIVE.new/tgcloud/lib/secrets.js" ] \
      && mkdir -p "$LIVE.new/.tgcloud"; then
      rm -rf "$LIVE" && mv "$LIVE.new" "$LIVE" && cp "$LIVE/tgcloud/lib/secrets.js" "$LIVE_CLEAN" && return 0
    fi
    rm -rf "$LIVE.new" 2>/dev/null
    return 1
  }
  # Ключи в слепке — только на время удара.
  restore_live() {
    [ -f "$LIVE_CLEAN" ] && [ -d "$LIVE/tgcloud/lib" ] && cp "$LIVE_CLEAN" "$LIVE/tgcloud/lib/secrets.js" 2>/dev/null
    return 0
  }

  # ── один процесс на телефон ──────────────────────────────────────────────
  LOCK="$HOME_DIR/lock"; LOCKED=0; NAP=""
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
    if [ "$LOCKED" = 1 ]; then restore; restore_live; fi
    drop_lock
  }
  # Замок взят — значит, других нет: ключи, оставшиеся в файлах после процесса,
  # который убили без предупреждения, убираются сразу.
  enter() { take_lock || return 1; restore; restore_live; return 0; }
  trap 'leave; exit 0' INT TERM
  trap 'leave' EXIT

  # ── что опубликовано и что не вышло ──────────────────────────────────────
  local PUBLISHED="$HOME_DIR/published" FAILED="$HOME_DIR/failed"
  published_commit() { sed -n '1p' "$PUBLISHED" 2>/dev/null; }
  published_build() { sed -n '2p' "$PUBLISHED" 2>/dev/null; }
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
    if [ "$before" != "$after" ] && [ "$MODE" = "run" ]; then
      log "Сам скрипт обновился — перезапускаюсь."
      leave
      trap - EXIT INT TERM
      exec bash "$SELF" run
    fi
    return 0
  }

  # ── публикация ───────────────────────────────────────────────────────────
  local WHY="" LACK_SAID=""
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
    local title="$1"; shift
    printf '\n== %s ==\n' "$title" >> "$DEPLOY_LOG"
    if "$@" >> "$DEPLOY_LOG" 2>&1; then return 0; fi
    WHY="$title"
    return 1
  }
  # Почему шаг не вышел, если это видно по журналу: связь, токен — или сам код.
  hint() {
    if grep -q "Could not reach" "$DEPLOY_LOG" 2>/dev/null; then echo " Причина: нет связи с платформой Telegram."
    elif grep -q "TGCLOUD_TOKEN" "$DEPLOY_LOG" 2>/dev/null; then echo " Причина: платформа не приняла токен публикации."
    fi
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
      for file in "$REPO"/tgcloud/handlers/*.js; do
        [ -f "$file" ] || continue
        name="$(basename "$file" .js)"
        case "$name" in _*) continue ;; esac
        case " $(printf '%s' "$words" | tr -s '[:space:]' ' ') " in *" $name "*) ;; *) WEBHOOK_MISSING="$WEBHOOK_MISSING $name" ;; esac
      done
      [ -z "$WEBHOOK_MISSING" ] || echo "В подписке бота нет событий:$WEBHOOK_MISSING"
    fi
    return 0
  }
  wake_new_build() {
    local out
    out="$(tg run handlers/message '{}' --ctx '{ tick: true, deployed: true }' 2>&1)"
    printf '%s\n' "$out"
    printf '%s' "$out" | grep -Eq "ok: ?true"
  }

  # 0 — опубликовано; 1 — попытка не вышла; 2 — не хватает настроек, попытки
  # не было.
  publish() {
    local head build lack
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"; build="$(build_of)"
    WHY=""
    lack="$(lacking)"
    if [ -n "$lack" ]; then
      [ "$lack" = "$LACK_SAID" ] || log "✗ Публикации нет, бот на прежней сборке: $lack."
      LACK_SAID="$lack"; WHY="$lack"
      return 2
    fi
    LACK_SAID=""
    ensure_cli || { WHY="инструмент публикации не поставился"; return 2; }
    : > "$DEPLOY_LOG"
    log "Публикую сборку $build ($(short "$head"))…"
    if [ "$TESTS" = "on" ]; then
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
    fi
    if ! step "ключи" inject --require-key; then restore; log "✗ Нет ключа модели (AI_PROVIDER_KEY) в $ENV_FILE."; return 1; fi
    # Репетиция в облаке: код там не собирается — живой бот не тронут.
    step "репетиция: сообщение" tg run handlers/message '{ chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/start" }' --ctx '{ testRun: true }' \
      && step "репетиция: пост канала" tg run handlers/channel_post '{ chat: { id: -1, type: "channel" }, text: "tick" }' --ctx '{ testRun: true }' \
      && { [ ! -f "$REPO/tgcloud/handlers/callback_query.js" ] || step "репетиция: кнопка" tg run handlers/callback_query '{ id: "1", from: { id: 1 }, data: "noop" }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$REPO/tgcloud/handlers/business_connection.js" ] || step "репетиция: подключение секретаря" tg run handlers/business_connection '{ id: "x", user: { id: 1 }, user_chat_id: 1, is_enabled: true }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$REPO/tgcloud/handlers/business_message.js" ] || step "репетиция: письмо секретарю" tg run handlers/business_message '{ business_connection_id: "x", chat: { id: 1, type: "private" }, from: { id: 1 }, text: "hi" }' --ctx '{ testRun: true }'; } \
      && { [ ! -f "$REPO/tgcloud/handlers/my_chat_member.js" ] || step "репетиция: её добавили в чат" tg run handlers/my_chat_member '{ chat: { id: -1, type: "supergroup", title: "x" }, from: { id: 1 }, old_chat_member: { status: "left" }, new_chat_member: { status: "member" } }' --ctx '{ testRun: true }'; } \
      && step "состояние облака" tg fetch \
      || { restore; log "✗ Не прошло: $WHY — публикации нет, бот на прежней сборке.$(hint) Подробности: $DEPLOY_LOG"; return 1; }
    if ! step "публикация" tg push handlers lib schema; then
      restore; log "✗ Публикация не прошла.$(hint) Подробности: $DEPLOY_LOG"; return 1
    fi
    # С этой строки новый код уже в боте: дальнейшие неудачи — не «откат».
    local warn=""
    step "схема базы" tg migrate --yes || warn="схема базы не применилась"
    step "вебхук" webhook_check || true
    if [ -n "$WEBHOOK_MISSING" ]; then
      log "⚠ Бот не подписан на события:$WEBHOOK_MISSING — то, что на них держится (кнопки, секретарь, список её чатов), работать не будет. Пришлите эту строку в чат разработки."
      tell_owner "⚠️ Сборка $build опубликована, но бот не подписан на события:$WEBHOOK_MISSING. То, что на них держится (кнопки, секретарь, список её чатов), работать не будет. Перешлите эту строку в чат разработки."
    fi
    if step "пробуждение" wake_new_build; then :; else [ -z "$warn" ] && warn="пробуждение не подтвердилось"; fi
    restore
    if ! snapshot "$head"; then
      rm -rf "$LIVE" 2>/dev/null
      log "Слепок опубликованного не снялся: будильник через платформу подождёт следующей публикации."
    fi
    printf '%s\n%s\n%s\n' "$head" "$build" "$(date '+%F %T')" > "$PUBLISHED"
    rm -f "$FAILED"
    if [ -n "$warn" ]; then
      log "Сборка $build опубликована, но $warn. Проверьте «статус» в боте. Подробности: $DEPLOY_LOG"
      tell_owner "⚠️ Сборка $build опубликована с телефона, но $warn. Скажите Аи «статус»."
    else
      log "✓ Сборка $build опубликована. Аи сама напишет «я обновилась»."
    fi
    WHY=""
    return 0
  }

  failed() {
    local head count
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"
    count=0; [ "$(failed_commit)" = "$head" ] && count="$(failed_count)"
    count=$((count + 1))
    printf '%s\n%s\n%s\n' "$head" "$count" "$(date +%s)" > "$FAILED"
    if [ "$count" = 1 ]; then
      tell_owner "⚠️ Сборка $(build_of) не опубликована: ${WHY:-причина в журнале}. Бот на прежней сборке."
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
    out="$( ( cd "$LIVE" && TGCLOUD_TOKEN="$TOKEN" node "$CLI" run handlers/message '{}' --ctx '{ tick: true }' ) 2>&1 < /dev/null )"
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
# KEY_MISTRAL=
# KEY_CEREBRAS=
# KEY_GEMINI=
# KEY_OPENROUTER=
# KEY_NVIDIA=
# KEY_GHMODELS=
# KEY_GIGACHAT=
# KEY_EXPLABS=
# Рисование и ещё один запасной мозг (Cloudflare): ID аккаунта, двоеточие, токен
# KEY_CLOUDFLARE=
# Поиск в интернете — ключ Tavily или Brave (docs/BRAINS.md); без них ищет по Википедии:
# KEY_TAVILY=
# KEY_BRAVE=
# Минутный будильник — токен любого бота, кроме Аи, и числовой ID канала «Мост»:
# ALARM_BOT_TOKEN=
# ALARM_CHAT_ID=
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
        KEY_TAVILY|KEY_BRAVE) seek="$seek$(printf '%s' "${name#KEY_}" | tr 'A-Z' 'a-z') " ;;
        *) extra="$extra$(printf '%s' "${name#KEY_}" | tr 'A-Z' 'a-z') " ;;
      esac
    done
    [ -n "$extra" ] && echo "✓ запасные мозги: $extra"
    [ -n "$seek" ] && echo "✓ поиск в интернете: $seek"
    if [ -n "${KEY_CLOUDFLARE:-}" ]; then
      if printf '%s' "$KEY_CLOUDFLARE" | grep -Eq '^[0-9a-fA-F]{32}:[!-~]{20,}$'; then echo "✓ рисование: ключ Cloudflare записан верно"
      else echo "• KEY_CLOUDFLARE записан не так: нужен вид «ID аккаунта:токен» — 32 знака ID, двоеточие, токен, без пробелов. Пока так — рисования не будет"; fi
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
  case "$MODE" in
    check) check "$@"; return $? ;;
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
      sync || { echo "С веткой «$BRANCH» в GitHub свериться не вышло — публикации нет." >&2; return 1; }
      publish
      case $? in 0) return 0 ;; 2) return 1 ;; esac
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
    *) echo "Не знаю режима «$MODE». Есть: run, check, deploy, tick, once, events." >&2; return 1 ;;
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

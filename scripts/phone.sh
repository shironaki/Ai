#!/usr/bin/env bash
# Дом Аи на телефоне: автопубликация и будильник — без GitHub Actions.
#
# Один процесс делает два дела:
#   • следит за веткой в GitHub: пришла новая сборка — проверяет её и
#     публикует сам, как это делала кнопка deploy;
#   • будит сердце, чтобы напоминания и сводка приходили без сообщений.
#
#   bash scripts/phone.sh           работать: вечный цикл (остановить — Ctrl+C)
#   bash scripts/phone.sh check     проверить настройку; ничего не публикует
#   bash scripts/phone.sh deploy    опубликовать сейчас то, что лежит в ветке
#   bash scripts/phone.sh tick      разбудить сердце один раз
#   bash scripts/phone.sh once      один круг цикла — для cron и для тестов
#
# Ключи живут вне репозитория, в файле ~/.heart.env — строки «ИМЯ=значение»,
# кавычки не нужны. Подробно — docs/PHONE.md.
#
#   TGCLOUD_HEART_TOKEN=…   токен публикации (app…:…)
#   AI_PROVIDER_KEY=…       ключ модели
#   OWNER_TG_ID=…           числовой ID владельца
#   KEY_GIGACHAT=…          ключ запасных мозгов: имя после KEY_ — id провайдера
#   HEART_BRANCH=…          за какой веткой следить (по умолчанию main)
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
#
# Весь файл — одна функция: bash читает её целиком до запуска, поэтому
# обновление самого скрипта из GitHub не ломает идущий процесс.
set -u

main() {
  local MODE="${1:-run}"
  local SELF REPO
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
  load_env() {
    local file="$1" line key value
    [ -f "$file" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      case "$line" in ''|'#'*) continue ;; esac
      case "$line" in *=*) ;; *) continue ;; esac
      key="${line%%=*}"; value="${line#*=}"
      key="${key#export }"; key="${key// /}"
      case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
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
  local HAVE_ENV=0
  load_env "$ENV_FILE" && HAVE_ENV=1

  local BRANCH="${HEART_BRANCH:-main}"
  local DEPLOY_ON="${HEART_DEPLOY_ON:-build}"
  local SYNC_EVERY="${HEART_SYNC_EVERY:-180}"
  local EVERY="${ALARM_EVERY:-60}"
  local RUN_EVERY="${ALARM_RUN_EVERY:-600}"
  case "$SYNC_EVERY" in ''|*[!0-9]*) SYNC_EVERY=180 ;; esac
  case "$EVERY" in ''|*[!0-9]*) EVERY=60 ;; esac
  case "$RUN_EVERY" in ''|*[!0-9]*) RUN_EVERY=600 ;; esac
  [ "$EVERY" -lt 20 ] && EVERY=20
  [ "$RUN_EVERY" -lt 120 ] && RUN_EVERY=120
  [ "$SYNC_EVERY" -lt 30 ] && SYNC_EVERY=30
  # В Git Bash на Windows тесты падают из-за среды, а не кода (PROJECT.md §4.5).
  local TESTS="${HEART_TESTS:-}"
  if [ -z "$TESTS" ]; then
    case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) TESTS=off ;; *) TESTS=on ;; esac
  fi

  local TOKEN="${TGCLOUD_HEART_TOKEN:-}"
  local VOICE="${ALARM_BOT_TOKEN:-}" ROOM="${ALARM_CHAT_ID:-}"
  local TG_API="https://api.telegram.org/bot${VOICE}"

  build_of() { sed -n 's/^export const BUILD = "\([^"]*\)";.*/\1/p' "$REPO/tgcloud/lib/heart.js" 2>/dev/null | head -n 1; }
  short() { printf '%s' "${1:-}" | cut -c1-7; }
  tg() { ( cd "$REPO" && TGCLOUD_TOKEN="$TOKEN" node "$CLI" "$@" ) < /dev/null; }
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

  # ── один процесс на телефон ──────────────────────────────────────────────
  local LOCK="$HOME_DIR/lock" LOCKED=0
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
  # shellcheck disable=SC2317
  leave() { restore; drop_lock; }
  trap 'leave; exit 0' INT TERM
  trap 'leave' EXIT

  # ── что опубликовано и что не вышло ──────────────────────────────────────
  local PUBLISHED="$HOME_DIR/published" FAILED="$HOME_DIR/failed"
  published_commit() { sed -n '1p' "$PUBLISHED" 2>/dev/null; }
  published_build() { sed -n '2p' "$PUBLISHED" 2>/dev/null; }
  failed_commit() { sed -n '1p' "$FAILED" 2>/dev/null; }
  failed_count() { local n; n="$(sed -n '2p' "$FAILED" 2>/dev/null)"; case "$n" in ''|*[!0-9]*) n=0 ;; esac; echo "$n"; }

  dirty() {
    git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | grep -v ' tgcloud/lib/secrets\.js$' | grep -q .
  }

  # ── ветка: есть ли новое ─────────────────────────────────────────────────
  local DIRTY_SAID=0 OFFLINE_SAID=0
  sync() {
    if ! git -C "$REPO" fetch -q origin "$BRANCH" 2>/dev/null; then
      [ "$OFFLINE_SAID" = 0 ] && log "GitHub не отвечает или ветки «$BRANCH» нет — попробую позже."
      OFFLINE_SAID=1
      return 1
    fi
    OFFLINE_SAID=0
    local remote here
    remote="$(git -C "$REPO" rev-parse -q --verify FETCH_HEAD 2>/dev/null)"
    here="$(git -C "$REPO" rev-parse -q --verify HEAD 2>/dev/null)"
    [ -n "$remote" ] || return 1
    [ "$remote" = "$here" ] && return 0
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
  local WHY=""
  step() {
    local title="$1"; shift
    printf '\n== %s ==\n' "$title" >> "$DEPLOY_LOG"
    if "$@" >> "$DEPLOY_LOG" 2>&1; then return 0; fi
    WHY="$title"
    return 1
  }
  webhook_check() {
    local out
    out="$(tg webhook 2>&1)"
    # Адрес вебхука в журнал не пишется.
    printf '%s\n' "$out" | grep -v -i "url"
    if printf '%s' "$out" | grep -q "OUT OF SYNC"; then
      echo "Вебхук не совпал с обработчиками — чиню."
      tg webhook sync 2>&1 | grep -v -i "url"
    fi
    return 0
  }
  wake_new_build() {
    local out
    out="$(tg run handlers/message '{}' --ctx '{ tick: true, deployed: true }' 2>&1)"
    printf '%s\n' "$out"
    printf '%s' "$out" | grep -Eq "ok: ?true"
  }

  publish() {
    local head build
    head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"; build="$(build_of)"
    WHY=""
    : > "$DEPLOY_LOG"
    if [ -z "$TOKEN" ]; then log "Нет TGCLOUD_HEART_TOKEN в $ENV_FILE — публиковать нечем."; WHY="нет токена публикации"; return 1; fi
    ensure_cli || { WHY="инструмент публикации"; return 1; }
    log "Публикую сборку $build ($(short "$head"))…"
    if [ "$TESTS" = "on" ]; then
      if ! ( cd "$REPO" && npm run ci ) > "$TEST_LOG" 2>&1 < /dev/null; then
        WHY="тесты"
        log "✗ Тесты не прошли — публикации нет, бот на прежней сборке. Журнал: $TEST_LOG"
        return 1
      fi
    fi
    if ! step "ключи" inject --require-key; then restore; log "✗ Нет ключа модели (AI_PROVIDER_KEY) в $ENV_FILE."; return 1; fi
    # Репетиция в облаке: код там не собирается — живой бот не тронут.
    step "репетиция: сообщение" tg run handlers/message '{ chat: { id: 1, type: "private" }, from: { id: 1 }, text: "/start" }' --ctx '{ testRun: true }' \
      && step "репетиция: пост канала" tg run handlers/channel_post '{ chat: { id: -1, type: "channel" }, text: "tick" }' --ctx '{ testRun: true }' \
      && { [ ! -f "$REPO/tgcloud/handlers/callback_query.js" ] || step "репетиция: кнопка" tg run handlers/callback_query '{ id: "1", from: { id: 1 }, data: "noop" }' --ctx '{ testRun: true }'; } \
      && step "состояние облака" tg fetch \
      || { restore; log "✗ Не прошло: $WHY — публикации нет, бот на прежней сборке. Подробности: $DEPLOY_LOG"; return 1; }
    if ! step "публикация" tg push handlers lib schema; then
      restore; log "✗ Публикация не прошла. Подробности: $DEPLOY_LOG"; return 1
    fi
    # С этой строки новый код уже в боте: дальнейшие неудачи — не «откат».
    local warn=""
    step "схема базы" tg migrate --yes || warn="схема базы не применилась"
    step "вебхук" webhook_check || true
    if step "пробуждение" wake_new_build; then :; else [ -z "$warn" ] && warn="пробуждение не подтвердилось"; fi
    restore
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
    printf '%s\n%s\n' "$head" "$count" > "$FAILED"
    if [ "$count" = 1 ]; then
      tell_owner "⚠️ Сборка $(build_of) не опубликована: ${WHY:-причина в журнале}. Бот на прежней сборке."
    fi
    if [ "$count" -ge 3 ]; then
      log "Три попытки подряд — жду нового коммита, этот больше не трогаю."
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
    [ "$(failed_commit)" = "$head" ] && [ "$(failed_count)" -ge 3 ] && return 0
    publish || failed
    return 0
  }

  # ── будильник ────────────────────────────────────────────────────────────
  local ALARM_STATE="$HOME_DIR/alarm.msg" ALARM_FAILS=0 LAST_RUN_TICK=0
  [ -f "$ALARM_STATE" ] || { [ -f "$HOME/.heart-alarm.msg" ] && cp "$HOME/.heart-alarm.msg" "$ALARM_STATE" 2>/dev/null; }
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
    ensure_cli || return 1
    local out
    inject > /dev/null 2>&1
    out="$(tg run handlers/message '{}' --ctx '{ tick: true }' 2>&1)"
    restore
    if printf '%s' "$out" | grep -q "build_mismatch"; then
      log "Будильник: в боте другая сборка, чем в этой папке, — удар ничего не тронул."
      return 1
    fi
    printf '%s' "$out" | grep -Eq "ok: ?true"
  }

  alarm() {
    local now
    if [ -n "$VOICE" ] && [ -n "$ROOM" ]; then tick_channel; return 0; fi
    now="$(date +%s)"
    if [ $((now - LAST_RUN_TICK)) -ge "$RUN_EVERY" ]; then
      LAST_RUN_TICK="$now"
      tick_run || true
    fi
    return 0
  }

  # ── проверка настройки ───────────────────────────────────────────────────
  check() {
    local bad=0 who title extra
    echo "Папка:   $REPO"
    echo "Ключи:   $ENV_FILE $([ "$HAVE_ENV" = 1 ] && echo '— найден' || echo '— НЕТ ФАЙЛА')"
    echo "Ветка:   $BRANCH · публиковать: $([ "$DEPLOY_ON" = commit ] && echo 'каждый коммит' || echo 'когда сменился номер сборки')"
    for tool in git node npm curl; do
      command -v "$tool" > /dev/null 2>&1 || { echo "✗ нет программы «$tool»"; bad=1; }
    done
    if command -v node > /dev/null 2>&1; then
      local major
      major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      [ "$major" -ge 22 ] 2>/dev/null && echo "✓ node $major" || { echo "✗ нужен node 22 или новее (сейчас $major)"; bad=1; }
    fi
    case "$TOKEN" in
      app[0-9]*:?*) echo "✓ токен публикации: вид правильный" ;;
      '') echo "✗ нет TGCLOUD_HEART_TOKEN — публиковать нечем"; bad=1 ;;
      *) echo "✗ TGCLOUD_HEART_TOKEN не похож на токен публикации (app…:…)"; bad=1 ;;
    esac
    [ -n "${AI_PROVIDER_KEY:-}" ] && echo "✓ ключ модели: есть" || { echo "✗ нет AI_PROVIDER_KEY"; bad=1; }
    case "${OWNER_TG_ID:-}" in
      ''|*[!0-9]*) echo "• OWNER_TG_ID не задан числом — годится, если владелец записан в config.js" ;;
      *) echo "✓ ID владельца: есть" ;;
    esac
    extra="$(env | sed -n 's/^KEY_\([A-Za-z0-9_]*\)=..*/\1/p' | tr 'A-Z' 'a-z' | tr '\n' ' ')"
    [ -n "$extra" ] && echo "✓ запасные мозги: $extra"
    [ -n "${AI_EXTRA_KEYS:-}" ] && echo "✓ запасные мозги: строка AI_EXTRA_KEYS есть"
    if git -C "$REPO" fetch -q origin "$BRANCH" 2>/dev/null; then
      echo "✓ GitHub: ветка «$BRANCH» на месте, коммит $(short "$(git -C "$REPO" rev-parse FETCH_HEAD 2>/dev/null)")"
    else
      echo "✗ GitHub не отвечает или ветки «$BRANCH» нет"; bad=1
    fi
    if [ -n "$TOKEN" ] && ensure_cli; then
      if tg fetch > "$DEPLOY_LOG" 2>&1; then echo "✓ платформа: токен принят"; else echo "✗ платформа не приняла токен или нет связи (подробности: $DEPLOY_LOG)"; bad=1; fi
    fi
    if [ -n "$VOICE" ] && [ -n "$ROOM" ]; then
      who="$(voice getMe | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
      if [ -z "$who" ]; then echo "✗ будильник: Telegram не принял ALARM_BOT_TOKEN"; bad=1
      else
        title="$(voice getChat -d "chat_id=$ROOM" | sed -n 's/.*"title":"\([^"]*\)".*/\1/p')"
        echo "✓ будильник: раз в ${EVERY} с от имени @${who}$([ -n "$title" ] && echo ", канал «$title»" || echo " — но канал ему не виден: добавьте его админом")"
        echo "  Если @${who} — это сама Аи, она себя не услышит: нужен токен другого бота."
        [ -n "$title" ] || bad=1
      fi
    elif [ -n "$VOICE" ] || [ -n "$ROOM" ]; then
      echo "✗ будильник: нужны оба — ALARM_BOT_TOKEN и ALARM_CHAT_ID"; bad=1
    else
      echo "• будильник: без второго бота — раз в $((RUN_EVERY / 60)) мин через платформу"
    fi
    echo "Сборка в папке: $(build_of) · опубликовано отсюда: $(published_build || true)$([ -f "$PUBLISHED" ] || echo 'ещё ничего')"
    if [ "$TESTS" = "on" ] && [ "${2:-}" = "tests" ]; then
      echo "Гоняю тесты — это минута-другая…"
      if ( cd "$REPO" && npm run ci ) > "$TEST_LOG" 2>&1 < /dev/null; then echo "✓ тесты на этом устройстве проходят"
      else echo "✗ тесты на этом устройстве не проходят (журнал: $TEST_LOG). Если дело в устройстве — HEART_TESTS=off."; bad=1; fi
    fi
    [ "$bad" = 0 ] && echo "Готово к работе: bash scripts/phone.sh" || echo "Сначала поправьте строки с ✗."
    return "$bad"
  }

  # ── режимы ───────────────────────────────────────────────────────────────
  case "$MODE" in
    check) check "$@"; return $? ;;
    tick)
      if [ -n "$VOICE" ] && [ -n "$ROOM" ]; then tick_channel && echo "Удар ушёл в канал." || { echo "Удар не ушёл."; return 1; }
      else tick_run && echo "Сердце проснулось." || { echo "Пробуждение не подтвердилось."; return 1; }
      fi
      return 0 ;;
    deploy)
      take_lock || return 1
      sync || true
      publish && return 0
      failed; return 1 ;;
    once)
      take_lock || return 1
      sync || true
      publish_if_needed
      alarm
      return 0 ;;
    run) ;;
    *) echo "Не знаю режима «$MODE». Есть: run, check, deploy, tick, once." >&2; return 1 ;;
  esac

  take_lock || return 1
  # Телефон не должен усыплять Termux, пока дом работает.
  command -v termux-wake-lock > /dev/null 2>&1 && termux-wake-lock
  if [ -z "$TOKEN" ] && { [ -z "$VOICE" ] || [ -z "$ROOM" ]; }; then
    echo "В $ENV_FILE нет ни токена публикации, ни будильника — делать нечего. См. docs/PHONE.md." >&2
    return 1
  fi
  log "Дом запущен: ветка «$BRANCH», сборка в папке $(build_of). Остановить — Ctrl+C."
  if [ -n "$VOICE" ] && [ -n "$ROOM" ]; then log "Будильник: раз в ${EVERY} с через канал."
  else log "Будильник: раз в $((RUN_EVERY / 60)) мин через платформу (второго бота нет)."; fi
  [ -n "$TOKEN" ] || log "Токена публикации нет: только будильник."

  local last_sync=0 now
  while true; do
    now="$(date +%s)"
    if [ -n "$TOKEN" ] && [ $((now - last_sync)) -ge "$SYNC_EVERY" ]; then
      last_sync="$now"
      sync || true
      publish_if_needed
    fi
    alarm
    # Спать до следующей границы периода: удары приходятся на начало минуты.
    # «sleep & wait» — чтобы остановка (Ctrl+C, kill) срабатывала сразу.
    now="$(date +%s)"
    sleep $((EVERY - now % EVERY)) &
    wait $! 2>/dev/null
  done
}

main "$@"
exit $?

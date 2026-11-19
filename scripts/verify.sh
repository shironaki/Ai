#!/usr/bin/env bash
# Проверка перед отправкой и перед выпуском — одной командой.
#
#   bash scripts/verify.sh          eslint + полный прогон тестов (перед каждым коммитом)
#   bash scripts/verify.sh all      то же и ещё прогон на Node 24 (перед выпуском сборки)
#   bash scripts/verify.sh lint     только eslint: необъявленные имена, повторы ключей
#   bash scripts/verify.sh ci       только тесты
#   bash scripts/verify.sh node24   только прогон на Node 24
#   bash scripts/verify.sh page     страница комнаты в настоящем браузере: каждое место нажато, движение,
#                                   старые копии (после любой правки в miniapp/; вторым словом — снимок)
#   bash scripts/verify.sh sheet <снимок.png> [rooms|her|cat|things|zones|файл.json] [час] [drawn]
#                                   лист рисунков комнаты — посмотреть глазами (после правки рисунка)
#   bash scripts/verify.sh sprite <картинка.png> <имя> [высота] [качество] [ось] [erase=x0,y0,x1,y1] [red]
#                                   спрайт Аи: картинка на зелёном фоне → модуль miniapp/her/<имя>.js
#   bash scripts/verify.sh blink <картинка с закрытыми глазами.png> <имя> [win=ШxВ] [at=x,y] [by=head]
#                                   моргание: заплатка «веки» в модуль спрайта (она же картинка, глаза закрыты)
#   bash scripts/verify.sh squeeze <картинка.png> <куда.png> <от 0–1> <до 0–1> <во сколько раз>
#                                   сжать по высоте полосу картинки (голени сидящей): до `sprite` и `blink`
#   bash scripts/verify.sh ref <имя>[,<имя>…] <куда.png> [высота] [closed]
#                                   образец для средства рисования: её картинка из модуля — на зелёном фоне
#                                   (closed — с закрытыми глазами: перенести веки на ту же позу в другом наряде)
#
# Зависимостей у проекта нет и не будет (на платформе нет npm), поэтому eslint и
# Node 24 ставятся во временную папку (VERIFY_TMP, по умолчанию /tmp) при первом
# запуске. В песочнице чата эта папка исчезает между ходами: первый запуск в ходе
# занимает около минуты дольше. Нужен доступ к registry.npmjs.org.
#
# `node --check` (npm run check) не видит необъявленных имён: обращение к переменной,
# которой нет, роняет обработчик только вживую. Поэтому eslint — обязательная часть.
# Журналы: $VERIFY_TMP/ci.log и $VERIFY_TMP/n24.log (TAP: упавшие — строки «not ok»).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${VERIFY_TMP:-/tmp}"
LINT="$TMP/lint"
N24="$TMP/n24"
PAGE="$TMP/page"

lint() {
  if [ ! -x "$LINT/node_modules/.bin/eslint" ]; then
    echo "eslint: ставлю в $LINT…"
    mkdir -p "$LINT"
    (cd "$LINT" && npm install --no-audit --no-fund --silent eslint@9 globals)
  fi
  cat > "$LINT/eslint.config.mjs" <<'CONFIG'
import globals from "globals";

export default [{
  files: ["**/*.js", "**/*.mjs"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
  linterOptions: { reportUnusedDisableDirectives: false },
  rules: { "no-undef": "error", "no-dupe-keys": "error", "no-const-assign": "error", "no-redeclare": "error" },
}, {
  // Страница мини-приложения исполняется в браузере: у неё свои встроенные имена.
  files: ["miniapp/**/*.js"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser } },
}];
CONFIG
  (cd "$ROOT" && "$LINT/node_modules/.bin/eslint" --no-config-lookup -c "$LINT/eslint.config.mjs" tgcloud scripts tests miniapp)
  echo "eslint: чисто"
}

# Итог прогона из журнала TAP; упавшие — по именам.
report() {
  local log="$1" label="$2" status="$3"
  if [ "$status" -ne 0 ] || grep -q "^not ok" "$log"; then
    grep -E "^not ok" "$log" | head -40 || true
    echo "$label: есть упавшие — подробности в $log"
    return 1
  fi
  echo "$label: $(grep -E '^# (tests|pass|fail)' "$log" | tr '\n' ' ')"
}

# Тесты не пропадают молча. 19.11.2026 новый файл тестов был записан поверх прежнего с тем же именем
# (`tests/life.test.mjs`, 19 тестов): eslint чист, прогон зелёный — а девятнадцати проверок нет. Видно это только по
# счёту, поэтому счёт сравнивается с последним коммитом, по файлам. Убраны намеренно — VERIFY_LOST=ok.
kept() {
  local file was now lost=0
  git -C "$ROOT" rev-parse --verify -q HEAD > /dev/null 2>&1 || return 0
  while IFS= read -r file; do
    was="$(git -C "$ROOT" show "HEAD:$file" 2>/dev/null | grep -c '^test(' || true)"
    now=0
    if [ -f "$ROOT/$file" ]; then now="$(grep -c '^test(' "$ROOT/$file" || true)"; fi
    if [ "${now:-0}" -lt "${was:-0}" ]; then
      echo "тестов стало меньше: $file — было $was, стало $now (сравнение с последним коммитом)"
      lost=1
    fi
  done < <(git -C "$ROOT" ls-tree -r --name-only HEAD -- tests | grep '\.test\.mjs$' || true)
  if [ "$lost" -ne 0 ]; then
    if [ "${VERIFY_LOST:-}" = "ok" ]; then echo "тесты убраны намеренно (VERIFY_LOST=ok)"; return 0; fi
    echo "Файл затёрт — вернуть: git show HEAD:<файл> > <файл>. Тесты убраны намеренно — VERIFY_LOST=ok bash scripts/verify.sh ci"
    return 1
  fi
}

ci() {
  local status=0
  kept || status=1
  (cd "$ROOT" && npm run check --silent && node --test --test-timeout=120000 --test-reporter=tap) > "$TMP/ci.log" 2>&1 || status=$?
  report "$TMP/ci.log" "тесты (Node $(node --version))" "$status"
}

node24() {
  if [ ! -x "$N24/node_modules/node/bin/node" ]; then
    echo "Node 24: ставлю в $N24…"
    mkdir -p "$N24"
    (cd "$N24" && npm install --no-audit --no-fund --silent node@24)
  fi
  local status=0
  (cd "$ROOT" && "$N24/node_modules/node/bin/node" --test --test-timeout=120000 --test-reporter=tap) > "$TMP/n24.log" 2>&1 || status=$?
  report "$TMP/n24.log" "тесты (Node $("$N24/node_modules/node/bin/node" --version))" "$status"
}

# Страница мини-приложения в браузере без экрана. Браузер — во временной папке, как eslint: зависимостью
# проекта он не становится. Сам сценарий — scripts/room-check.mjs; он запускается из этой папки, чтобы
# найти браузер рядом с собой.
browser() {
  if [ ! -d "$PAGE/node_modules/puppeteer-core" ] || [ ! -d "$PAGE/node_modules/@sparticuz/chromium" ]; then
    echo "браузер: ставлю в $PAGE (около минуты)…"
    mkdir -p "$PAGE"
    (cd "$PAGE" && npm install --no-audit --no-fund --silent puppeteer-core @sparticuz/chromium)
  fi
}

# Прежняя страница — та, что сейчас открыта у людей: последний коммит, где номер страницы (PAGE в
# miniapp/logic.js) был другим. Сценарий проверит, что её файлы и новые открываются вперемешку: после новой
# публикации браузер может какое-то время держать старую копию любого из четырёх файлов.
previous_page() {
  local now was commit
  rm -rf "$PAGE/previous"
  now="$(sed -n 's/^export const PAGE = "\([0-9]*\)";.*/\1/p' "$ROOT/miniapp/logic.js")"
  if [ -z "$now" ]; then echo "прежняя страница: номер страницы в miniapp/logic.js не найден"; return 0; fi
  for commit in $(cd "$ROOT" && git log --format=%H -n 300 -- miniapp/logic.js 2>/dev/null || true); do
    was="$(cd "$ROOT" && git show "$commit:miniapp/logic.js" 2>/dev/null | sed -n 's/^export const PAGE = "\([0-9]*\)";.*/\1/p' || true)"
    if [ -n "$was" ] && [ "$was" != "$now" ]; then
      mkdir -p "$PAGE/previous"
      (cd "$ROOT" && git archive "$commit" miniapp | tar -x -C "$PAGE/previous")
      echo "прежняя страница: номер $was, коммит ${commit:0:7} (сейчас — номер $now)"
      return 0
    fi
  done
  echo "прежняя страница: в истории нет страницы с другим номером"
}

page() {
  browser
  previous_page
  cp "$ROOT/scripts/room-check.mjs" "$PAGE/room-check.mjs"
  local before=""
  if [ -d "$PAGE/previous/miniapp" ]; then before="$PAGE/previous/miniapp"; fi
  (cd "$PAGE" && node room-check.mjs "$ROOT/miniapp" "${1:--}" "$before")
  seen
}

# Лист рисунков комнаты: тот же браузер, сценарий — scripts/room-sheet.mjs.
sheet() {
  if [ -z "${1:-}" ]; then echo "Куда положить снимок? bash scripts/verify.sh sheet /tmp/rooms.png [rooms|her|cat|things|zones|файл.json] [час]"; return 1; fi
  browser
  cp "$ROOT/scripts/room-sheet.mjs" "$PAGE/room-sheet.mjs"
  (cd "$PAGE" && node room-sheet.mjs "$ROOT" "$@")
}

# Спрайт Аи из картинки на зелёном фоне — в модуль страницы: сценарий — scripts/room-sprite.mjs.
sprite() {
  if [ -z "${2:-}" ]; then echo "Нужно: bash scripts/verify.sh sprite <картинка.png> <имя латиницей> [высота] [качество]"; return 1; fi
  browser
  cp "$ROOT/scripts/room-sprite.mjs" "$PAGE/room-sprite.mjs"
  local input="$1"; shift
  case "$input" in /*) ;; *) input="$PWD/$input" ;; esac
  (cd "$PAGE" && node room-sprite.mjs "$ROOT" "$input" "$@")
}

# Моргание: из той же картинки с закрытыми глазами — заплатка «веки» в модуль спрайта: сценарий — scripts/room-blink.mjs.
blink() {
  if [ -z "${2:-}" ]; then echo "Нужно: bash scripts/verify.sh blink <картинка с закрытыми глазами.png> <имя спрайта> [win=ШxВ] [at=x,y]"; return 1; fi
  browser
  cp "$ROOT/scripts/room-blink.mjs" "$PAGE/room-blink.mjs"
  local input="$1"; shift
  case "$input" in /*) ;; *) input="$PWD/$input" ;; esac
  (cd "$PAGE" && node room-blink.mjs "$ROOT" "$input" "$@")
}

# Каждая вещь комнаты видна на рисунке, а не закрыта мебелью: сценарий — scripts/room-seen.mjs.
seen() {
  browser
  cp "$ROOT/scripts/room-seen.mjs" "$PAGE/room-seen.mjs"
  (cd "$PAGE" && node room-seen.mjs "$ROOT")
}

# Сжать по высоте полосу картинки (голени сидящей): сценарий — scripts/room-squeeze.mjs.
squeeze() {
  if [ -z "${5:-}" ]; then echo "Нужно: bash scripts/verify.sh squeeze <картинка.png> <куда.png> <от 0–1> <до 0–1> <во сколько раз, 0.2–1>"; return 1; fi
  browser
  cp "$ROOT/scripts/room-squeeze.mjs" "$PAGE/room-squeeze.mjs"
  local input="$1" out="$2"; shift 2
  case "$input" in /*) ;; *) input="$PWD/$input" ;; esac
  case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
  (cd "$PAGE" && node room-squeeze.mjs "$input" "$out" "$@")
}

# Образец для средства рисования: её картинка из модуля на зелёном фоне — сценарий scripts/room-ref.mjs.
ref() {
  if [ -z "${2:-}" ]; then echo "Нужно: bash scripts/verify.sh ref <имя>[,<имя>…] <куда.png> [высота] [closed]"; return 1; fi
  browser
  cp "$ROOT/scripts/room-ref.mjs" "$PAGE/room-ref.mjs"
  local names="$1" out="$2"; shift 2
  case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
  (cd "$PAGE" && node room-ref.mjs "$ROOT" "$names" "$out" "$@")
}

case "${1:-quick}" in
  quick) lint; ci ;;
  all) lint; ci; node24 ;;
  lint) lint ;;
  ci) ci ;;
  node24) node24 ;;
  page) page "${2:-}" ;;
  sheet) shift; sheet "$@" ;;
  sprite) shift; sprite "$@" ;;
  blink) shift; blink "$@" ;;
  ref) shift; ref "$@" ;;
  squeeze) shift; squeeze "$@" ;;
  seen) seen ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

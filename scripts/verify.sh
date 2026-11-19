#!/usr/bin/env bash
# Проверка перед отправкой и перед выпуском — одной командой.
#
#   bash scripts/verify.sh          eslint + полный прогон тестов (перед каждым коммитом)
#   bash scripts/verify.sh all      то же и ещё прогон на Node 24 (перед выпуском сборки)
#   bash scripts/verify.sh lint     только eslint: необъявленные имена, повторы ключей
#   bash scripts/verify.sh ci       только тесты
#   bash scripts/verify.sh node24   только прогон на Node 24
#   bash scripts/verify.sh page     страница комнаты в настоящем браузере: каждое место нажато
#                                   (после любой правки в miniapp/; вторым словом — куда положить снимок)
#   bash scripts/verify.sh sheet <снимок.png> [rooms|her|cat|things|zones|файл.json] [час]
#                                   лист рисунков комнаты — посмотреть глазами (после правки рисунка)
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

ci() {
  local status=0
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

page() {
  browser
  cp "$ROOT/scripts/room-check.mjs" "$PAGE/room-check.mjs"
  (cd "$PAGE" && node room-check.mjs "$ROOT/miniapp" "${1:-}")
}

# Лист рисунков комнаты: тот же браузер, сценарий — scripts/room-sheet.mjs.
sheet() {
  if [ -z "${1:-}" ]; then echo "Куда положить снимок? bash scripts/verify.sh sheet /tmp/rooms.png [rooms|her|cat|things|zones|файл.json] [час]"; return 1; fi
  browser
  cp "$ROOT/scripts/room-sheet.mjs" "$PAGE/room-sheet.mjs"
  (cd "$PAGE" && node room-sheet.mjs "$ROOT" "$@")
}

case "${1:-quick}" in
  quick) lint; ci ;;
  all) lint; ci; node24 ;;
  lint) lint ;;
  ci) ci ;;
  node24) node24 ;;
  page) page "${2:-}" ;;
  sheet) shift; sheet "$@" ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

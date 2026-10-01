#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
BRANCH="${BOT_BRANCH:-test-global-assistant-upgrade}"
PYTHON="$REPO/.venv/bin/python"
BOT="$REPO/run.py"
PIDFILE="$REPO/termux-bot.pid"
LOCKDIR="$REPO/.termux-update.lock"
LOG="$REPO/termux-autoupdate.log"

export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-$REPO/data/${BOT_ENV}}"

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

cd "$REPO"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
if ! mkdir "$LOCKDIR" 2>/dev/null; then
    log "SKIP: another Termux update is already running"
    exit 0
fi
trap cleanup EXIT

if [[ -n "$(git status --porcelain)" ]]; then
    log "STOP: working tree is not clean"
    exit 1
fi

git fetch origin "$BRANCH" >> "$LOG" 2>&1
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

is_running() {
    [[ -f "$PIDFILE" ]] || return 1
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    [[ -n "$pid" ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    ps -p "$pid" -o command= 2>/dev/null | grep -F -q -- "$BOT"
}

stop_bot() {
    if ! is_running; then
        rm -f "$PIDFILE"
        return 0
    fi
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null || true
    for _ in {1..15}; do
        is_running || break
        sleep 1
    done
    rm -f "$PIDFILE"
}

install_dependencies() {
    if ! "$PYTHON" -m pip --version >> "$LOG" 2>&1; then
        log "STOP: pip unavailable"
        return 1
    fi

    local platform_name
    platform_name="$( "$PYTHON" -c 'import platform; print(platform.system().lower())' )"
    local is_termux="false"
    if [[ -n "${PREFIX:-}" && "$PREFIX" == /data/data/com.termux/* ]] || [[ -d /data/data/com.termux/files/usr ]]; then
        is_termux="true"
    fi

    if [[ "$platform_name" == "android" || "$is_termux" == "true" ]]; then
        log "DEPS: Android/Termux detected (platform=$platform_name); using Android wheels and skipping legacy native builds"

        local tmp_req
        tmp_req="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/ai-requirements.txt"
        if ! grep -vE '^[[:space:]]*aiogram([<=>].*)?[[:space:]]*$' "$REPO/requirements.txt" > "$tmp_req"; then
            log "STOP: failed to prepare Termux requirements"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --upgrade pip >> "$LOG" 2>&1; then
            log "STOP: failed to upgrade pip"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: "aiohttp>=3.14,<3.15" >> "$LOG" 2>&1; then
            log "STOP: Android aiohttp wheel installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: -r "$tmp_req" >> "$LOG" 2>&1; then
            log "STOP: Termux pure-Python dependency installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --no-deps "aiogram==2.25.2" >> "$LOG" 2>&1; then
            log "STOP: aiogram installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: "Babel>=2.9.1,<2.10" "certifi>=2021.10.8" "magic-filter>=1.0.9,<1.1.0" >> "$LOG" 2>&1; then
            log "STOP: aiogram runtime dependencies failed"
            rm -f "$tmp_req"
            return 1
        fi

        rm -f "$tmp_req"

        if ! "$PYTHON" -c 'import aiogram, aiohttp, requests; print("TERMUX IMPORTS OK", aiogram.__version__, aiohttp.__version__)' >> "$LOG" 2>&1; then
            log "STOP: Termux runtime imports failed"
            return 1
        fi
    else
        if ! "$PYTHON" -m pip install -r "$REPO/requirements.txt" >> "$LOG" 2>&1; then
            log "STOP: dependency installation failed"
            return 1
        fi
    fi

    "$PYTHON" -m pip install pytest >> "$LOG" 2>&1
}
start_bot() {
    if is_running; then
        return 0
    fi
    nohup "$PYTHON" "$BOT" >> "$REPO/bot.log" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    sleep 8
    "$PYTHON" "$REPO/scripts/healthcheck.py" >> "$LOG" 2>&1
}

rollback() {
    local good_commit="$1"
    log "ROLLBACK: restoring $good_commit"
    stop_bot || true
    git reset --hard "$good_commit" >> "$LOG" 2>&1
    install_dependencies || true
    start_bot
    log "ROLLBACK: stable revision restored and health-verified"
}

if [[ "$LOCAL" != "$REMOTE" ]]; then
    log "UPDATE: $LOCAL -> $REMOTE"
    if ! git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1; then
        log "STOP: fast-forward update failed; keeping $LOCAL"
        exit 1
    fi

    if ! install_dependencies; then
        rollback "$LOCAL"
        exit 0
    fi

    if ! "$PYTHON" -m pytest -q >> "$LOG" 2>&1; then
        rollback "$LOCAL"
        exit 0
    fi

    stop_bot
    if ! start_bot; then
        log "UPDATE: new revision failed health check"
        rollback "$LOCAL"
        exit 0
    fi
    log "UPDATE: bot restarted and health-verified"
elif ! is_running; then
    start_bot
    log "RECOVERY: bot started and health-verified"
else
    "$PYTHON" "$REPO/scripts/healthcheck.py" >> "$LOG" 2>&1 || {
        log "RECOVERY: health check failed; restarting bot"
        stop_bot
        start_bot
    }
fi

log "OK: Termux sync check completed at $(git rev-parse HEAD)"

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
    "$PYTHON" -m pip install -r "$REPO/requirements.txt" >> "$LOG" 2>&1 || true
    start_bot
    log "ROLLBACK: stable revision restored and health-verified"
}

if [[ "$LOCAL" != "$REMOTE" ]]; then
    log "UPDATE: $LOCAL -> $REMOTE"
    if ! git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1; then
        log "STOP: fast-forward update failed; keeping $LOCAL"
        exit 1
    fi

    if ! "$PYTHON" -m pip install -r "$REPO/requirements.txt" >> "$LOG" 2>&1; then
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

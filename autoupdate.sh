#!/bin/sh

set -u

REPO="/workspaces/Ai"
BRANCH="test-global-assistant-upgrade"
PYTHON="$REPO/.venv/bin/python"
BOT="$REPO/run.py"
PIDFILE="$REPO/bot.pid"
LOG="$REPO/autoupdate.log"

cd "$REPO" || exit 1

# Keep manual runs and updater restarts on the same TEST data namespace.
export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-data/${BOT_ENV}}"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

bot_running() {
    [ -f "$PIDFILE" ] || return 1
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    [ -n "$PID" ] || return 1
    kill -0 "$PID" 2>/dev/null || return 1
    CMD="$(ps -p "$PID" -o command= 2>/dev/null || true)"
    printf '%s\n' "$CMD" | grep -q '[ /]run\.py\( \|$\)'
}

start_bot() {
    if [ -z "${BOT_TOKEN:-}" ]; then
        log "STOP: BOT_TOKEN missing; bot not started"
        return 1
    fi

    nohup "$PYTHON" "$BOT" >> "$REPO/bot.log" 2>&1 < /dev/null &
    NEW_PID=$!
    echo "$NEW_PID" > "$PIDFILE"
    log "BOT: started PID $NEW_PID"
    return 0
}

log "AUTOUPDATE: check started"

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    log "STOP: wrong branch: $CURRENT_BRANCH"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    log "STOP: working tree is not clean"
    exit 0
fi

git fetch origin "$BRANCH" >> "$LOG" 2>&1 || {
    log "STOP: git fetch failed"
    exit 1
}

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
    if bot_running; then
        log "UP TO DATE: $LOCAL; BOT healthy"
    else
        log "UP TO DATE: $LOCAL; BOT missing; restarting"
        start_bot
    fi
    exit 0
fi

log "UPDATE: $LOCAL -> $REMOTE"

git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1 || {
    log "STOP: git pull failed"
    exit 1
}

log "TESTS: starting"

if ! "$PYTHON" -m pytest -q >> "$LOG" 2>&1; then
    log "STOP: tests FAILED; bot was NOT restarted"
    exit 1
fi

log "TESTS: passed"

if bot_running; then
    PID="$(cat "$PIDFILE")"
    log "BOT: stopping PID $PID"
    kill "$PID"
    sleep 2
fi

log "BOT: starting new version"
start_bot
log "AUTOUPDATE: completed"

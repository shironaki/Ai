#!/bin/sh

set -u

REPO="/workspaces/Ai"
BRANCH="test-global-assistant-upgrade"
PYTHON="$REPO/.venv/bin/python"
BOT="$REPO/run.py"
PIDFILE="$REPO/bot.pid"
LOG="$REPO/autoupdate.log"

cd "$REPO" || exit 1

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
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
    log "UP TO DATE: $LOCAL"
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

if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE")"

    if kill -0 "$PID" 2>/dev/null; then
        log "BOT: stopping PID $PID"
        kill "$PID"
        sleep 2
    fi
fi

log "BOT: starting new version"

nohup "$PYTHON" "$BOT" >> "$REPO/bot.log" 2>&1 < /dev/null &
NEW_PID=$!

echo "$NEW_PID" > "$PIDFILE"

log "BOT: started PID $NEW_PID"
log "AUTOUPDATE: completed"

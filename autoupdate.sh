#!/bin/sh
set -u
REPO="/workspaces/Ai"
BRANCH="test-global-assistant-upgrade"
PYTHON="$REPO/.venv/bin/python"
BOT="$REPO/run.py"
PIDFILE="$REPO/bot.pid"
LOG="$REPO/autoupdate.log"
HEALTHCHECK="$PYTHON $REPO/scripts/healthcheck.py"
cd "$REPO" || exit 1
export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-data/${BOT_ENV}}"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }
bot_running() {
    [ -f "$PIDFILE" ] || return 1
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    [ -n "$PID" ] || return 1
    kill -0 "$PID" 2>/dev/null || return 1
    CMD="$(ps -p "$PID" -o command= 2>/dev/null || true)"
    printf '%s\n' "$CMD" | grep -F -q -- "$BOT"
}
bot_healthy() {
    bot_running || return 1
    eval "$HEALTHCHECK" >> "$LOG" 2>&1
}
git_auth() {
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        git "$@"
        return
    fi
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=credential.helper \
    GIT_CONFIG_VALUE_0='!f() { printf "protocol=https\\nhost=github.com\\nusername=x-access-token\\npassword=%s\\n\\n" "$GITHUB_TOKEN"; }; f' \
    git "$@"
}
stop_bot() {
    if ! bot_running; then rm -f "$PIDFILE"; return 0; fi
    PID="$(cat "$PIDFILE")"
    log "BOT: stopping PID $PID"
    kill "$PID" 2>/dev/null || true
    i=0
    while bot_running && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
    if bot_running; then kill -TERM "$PID" 2>/dev/null || true; sleep 1; fi
    rm -f "$PIDFILE"
}
start_bot() {
    if [ -z "${BOT_TOKEN:-}" ]; then log "STOP: BOT_TOKEN missing; bot not started"; return 1; fi
    nohup "$PYTHON" "$BOT" >> "$REPO/bot.log" 2>&1 < /dev/null &
    NEW_PID=$!
    echo "$NEW_PID" > "$PIDFILE"
    i=0
    while [ "$i" -lt 20 ]; do
        if bot_healthy; then log "BOT: started and health-verified PID $NEW_PID"; return 0; fi
        if ! kill -0 "$NEW_PID" 2>/dev/null; then log "STOP: bot process exited during startup"; rm -f "$PIDFILE"; return 1; fi
        sleep 1; i=$((i + 1))
    done
    log "STOP: bot health verification timed out"
    return 1
}
log "AUTOUPDATE: check started"
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then log "STOP: wrong branch: $CURRENT_BRANCH"; exit 1; fi
if [ -n "$(git status --porcelain)" ]; then log "STOP: working tree is not clean"; exit 0; fi
git config --local --unset-all credential.helper >/dev/null 2>&1 || true
if [ -n "${GITHUB_TOKEN:-}" ]; then
    git_auth fetch origin "$BRANCH" >> "$LOG" 2>&1 || { log "STOP: git fetch failed"; exit 1; }
else
    git fetch origin "$BRANCH" >> "$LOG" 2>&1 || { log "STOP: git fetch failed"; exit 1; }
fi
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [ "$LOCAL" != "$REMOTE" ]; then
    log "UPDATE: $LOCAL -> $REMOTE"
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        git_auth pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1 || { log "STOP: git pull failed"; exit 1; }
    else
        git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1 || { log "STOP: git pull failed"; exit 1; }
    fi
    log "TESTS: starting"
    if ! "$PYTHON" -m pytest -q >> "$LOG" 2>&1; then log "STOP: tests FAILED; bot was NOT restarted"; exit 1; fi
    log "TESTS: passed"
    stop_bot
    log "BOT: starting new version"
    start_bot || exit 1
    log "AUTOUPDATE: update completed"
    exit 0
fi
if bot_healthy; then log "UP TO DATE: $LOCAL; BOT health verified"; exit 0; fi
if bot_running; then
    log "UP TO DATE: $LOCAL; BOT unhealthy; stopping stale process before recovery"
    stop_bot
else
    log "UP TO DATE: $LOCAL; BOT missing; starting recovery"
fi
start_bot || exit 1
log "AUTOUPDATE: restart completed"

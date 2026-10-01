#!/bin/sh
set -u

REPO="/workspaces/Ai"
cd "$REPO" || exit 1

# TEST Codespaces must use the same persistent data namespace as start.sh.
export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-data/${BOT_ENV}}"

LOG="$REPO/codespace-boot.log"
PIDFILE="$REPO/bot.pid"
UPDATER_PIDFILE="$REPO/updater.pid"
HEALTHCHECK="$REPO/.venv/bin/python $REPO/scripts/healthcheck.py"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

bot_running() {
    [ -f "$PIDFILE" ] || return 1
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    [ -n "$PID" ] || return 1
    kill -0 "$PID" 2>/dev/null || return 1
    CMD="$(ps -p "$PID" -o command= 2>/dev/null || true)"
    printf '%s\n' "$CMD" | grep -F -q -- "$REPO/run.py"
}
bot_healthy() {
    bot_running || return 1
    eval "$HEALTHCHECK" >> "$LOG" 2>&1
}

migrate_test_data() {
    SRC="$REPO/data/local"
    DST="$REPO/data/test"
    [ -d "$SRC" ] || return 0
    mkdir -p "$DST"
    for DB in users.db chats.db; do
        if [ -f "$SRC/$DB" ] && [ ! -f "$DST/$DB" ]; then
            cp "$SRC/$DB" "$DST/$DB"
            log "DATA: migrated $DB from data/local to data/test"
        fi
    done
}

log "BOOT: lifecycle started"
migrate_test_data
[ -n "${BOT_TOKEN:-}" ] && log "BOOT: BOT_TOKEN=SET" || log "BOOT: BOT_TOKEN=MISSING"
[ -n "${GITHUB_TOKEN:-}" ] && log "BOOT: GITHUB_TOKEN=SET" || log "BOOT: GITHUB_TOKEN=MISSING"

if [ ! -x "$REPO/.venv/bin/python" ]; then
    log "STOP: Python venv missing"
    exit 1
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
    git config --local --unset-all credential.helper >/dev/null 2>&1 || true
    log "BOOT: running immediate autoupdate check"
    if sh "$REPO/autoupdate.sh" >> "$LOG" 2>&1; then
        log "BOOT: immediate autoupdate completed"
    else
        log "BOOT: immediate autoupdate failed; continuing"
    fi
fi

if bot_healthy; then
    log "BOT: already running and health-verified"
elif [ -z "${BOT_TOKEN:-}" ]; then
    log "STOP: BOT_TOKEN missing; bot not started"
else
    if bot_running; then
        log "BOT: existing process is unhealthy; stopping stale process before recovery"
        PID="$(cat "$PIDFILE" 2>/dev/null || true)"
        [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
        sleep 2
        rm -f "$PIDFILE"
    fi
    nohup "$REPO/.venv/bin/python" "$REPO/run.py" >> "$REPO/bot.log" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    sleep 5
    if eval "$HEALTHCHECK" >> "$LOG" 2>&1; then
        log "BOT: started and health-verified PID $(cat "$PIDFILE")"
    else
        log "BOT: started but health check is not ready yet"
    fi
fi

if [ -f "$UPDATER_PIDFILE" ] && kill -0 "$(cat "$UPDATER_PIDFILE" 2>/dev/null)" 2>/dev/null; then
    log "UPDATER: already running"
elif [ -z "${GITHUB_TOKEN:-}" ]; then
    log "STOP: GITHUB_TOKEN missing; updater not started"
else
    nohup sh -c 'while true; do ./autoupdate.sh; sleep 60; done' >> "$REPO/updater.log" 2>&1 < /dev/null &
    echo $! > "$UPDATER_PIDFILE"
    log "UPDATER: started PID $(cat "$UPDATER_PIDFILE")"
fi

log "BOOT: lifecycle completed"

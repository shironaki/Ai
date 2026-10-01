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
if [ -n "${BOT_TOKEN:-}" ]; then
    log "BOOT: BOT_TOKEN=SET"
else
    log "BOOT: BOT_TOKEN=MISSING"
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
    log "BOOT: GITHUB_TOKEN=SET"
else
    log "BOOT: GITHUB_TOKEN=MISSING"
fi

if [ ! -x "$REPO/.venv/bin/python" ]; then
    log "STOP: Python venv missing"
    exit 1
fi

if bot_running; then
    log "BOT: already running"
else
    if [ -z "${BOT_TOKEN:-}" ]; then
        log "STOP: BOT_TOKEN missing; bot not started"
    else
        nohup "$REPO/.venv/bin/python" "$REPO/run.py" >> "$REPO/bot.log" 2>&1 < /dev/null &
        echo $! > "$PIDFILE"
        log "BOT: started PID $(cat "$PIDFILE")"
    fi
fi

if [ -f "$UPDATER_PIDFILE" ] && kill -0 "$(cat "$UPDATER_PIDFILE" 2>/dev/null)" 2>/dev/null; then
    log "UPDATER: already running"
else
    if [ -z "${GITHUB_TOKEN:-}" ]; then
        log "STOP: GITHUB_TOKEN missing; updater not started"
    else
        git config --local credential.helper '!f() { printf "protocol=https\\nhost=github.com\\nusername=x-access-token\\npassword=%s\\n\\n" "$GITHUB_TOKEN"; }; f'
        nohup sh -c 'while true; do ./autoupdate.sh; sleep 60; done' >> "$REPO/updater.log" 2>&1 < /dev/null &
        echo $! > "$UPDATER_PIDFILE"
        log "UPDATER: started PID $(cat "$UPDATER_PIDFILE")"
    fi
fi

log "BOOT: lifecycle completed"

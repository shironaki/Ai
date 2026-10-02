#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-15}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0
BATTERY_WATCHDOG="$REPO/scripts/termux_battery_watchdog.py"
BATTERY_PIDFILE="$REPO/termux-battery-watchdog.pid"
BATTERY_HASHFILE="$REPO/termux-battery-watchdog.sha256"

cd "$REPO" || exit 1

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

SUPERVISOR_PID="$REPO/termux-supervisor.pid"
echo "$$" > "$SUPERVISOR_PID"
trap 'rm -f "$SUPERVISOR_PID"' EXIT

report() {
    "$PYTHON" "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
}

ensure_battery_watchdog() {
    if [[ ! -f "$BATTERY_WATCHDOG" ]]; then
        return 0
    fi

    local current_hash=""
    current_hash="$(sha256sum "$BATTERY_WATCHDOG" 2>/dev/null | awk '{print $1}')"

    if [[ -f "$BATTERY_PIDFILE" ]]; then
        local pid
        pid="$(cat "$BATTERY_PIDFILE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            local running_hash=""
            running_hash="$(cat "$BATTERY_HASHFILE" 2>/dev/null || true)"
            if [[ -n "$current_hash" && "$running_hash" == "$current_hash" ]]; then
                return 0
            fi
            kill "$pid" 2>/dev/null || true
            for _ in {1..10}; do
                kill -0 "$pid" 2>/dev/null || break
                sleep 1
            done
        fi
        rm -f "$BATTERY_PIDFILE" "$BATTERY_HASHFILE"
    fi

    nohup "$PYTHON" "$BATTERY_WATCHDOG" >> "$REPO/termux-battery-watchdog.log" 2>&1 < /dev/null &
    echo $! > "$BATTERY_PIDFILE"
    printf '%s\n' "$current_hash" > "$BATTERY_HASHFILE"
}

while true; do
    ensure_battery_watchdog

    if ! bash "$REPO/scripts/termux_update.sh"; then
        report
    fi

    REPORT_ELAPSED=$((REPORT_ELAPSED + INTERVAL))
    if [ "$REPORT_ELAPSED" -ge "$REPORT_INTERVAL" ]; then
        report
        REPORT_ELAPSED=0
    fi

    sleep "$INTERVAL"
done

#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-60}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0
BATTERY_WATCHDOG="$REPO/scripts/termux_battery_watchdog.py"
BATTERY_PIDFILE="$REPO/termux-battery-watchdog.pid"

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
    if [[ -f "$BATTERY_PIDFILE" ]]; then
        local pid
        pid="$(cat "$BATTERY_PIDFILE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        rm -f "$BATTERY_PIDFILE"
    fi

    if [[ ! -f "$BATTERY_WATCHDOG" ]]; then
        return 0
    fi

    nohup "$PYTHON" "$BATTERY_WATCHDOG" >> "$REPO/termux-battery-watchdog.log" 2>&1 < /dev/null &
    echo $! > "$BATTERY_PIDFILE"
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

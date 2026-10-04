#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-15}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0
CONTROL_MAX_AGE="${TERMUX_CONTROL_MAX_AGE:-45}"
BATTERY_WATCHDOG="$REPO/scripts/termux_battery_watchdog.py"
BATTERY_PIDFILE="$REPO/termux-battery-watchdog.pid"
BATTERY_HASHFILE="$REPO/termux-battery-watchdog.sha256"
UPDATE_PIDFILE="$REPO/termux-update.pid"
CONTROL_PIDFILE="$REPO/termux-control.pid"

cd "$REPO" || exit 1

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

SUPERVISOR_PID="$REPO/termux-supervisor.pid"
SUPERVISOR_LOCKDIR="$REPO/.termux-supervisor.lock"
SUPERVISOR_HEARTBEAT="$REPO/data/test/runtime/supervisor-heartbeat"

supervisor_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        cmdline="$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        case "$cmdline" in *termux_supervisor.sh*) return 0;; esac
    fi
    return 1
}

if ! mkdir "$SUPERVISOR_LOCKDIR" 2>/dev/null; then
    existing_pid="$(cat "$SUPERVISOR_PID" 2>/dev/null || true)"
    if supervisor_process_matches "$existing_pid"; then
        exit 0
    fi
    rm -rf "$SUPERVISOR_LOCKDIR" 2>/dev/null || exit 0
    mkdir "$SUPERVISOR_LOCKDIR" 2>/dev/null || exit 0
fi

echo "$$" > "$SUPERVISOR_PID"
mkdir -p "$(dirname "$SUPERVISOR_HEARTBEAT")"
trap 'rm -f "$SUPERVISOR_PID"; rmdir "$SUPERVISOR_LOCKDIR" 2>/dev/null || true' EXIT

report() {
    "$PYTHON" "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
}

battery_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        cmdline="$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        case "$cmdline" in *termux_battery_watchdog.py*) return 0;; esac
    fi
    return 1
}

stop_battery_watchdog() {
    pid="$1"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 1
    done
    kill -KILL "$pid" 2>/dev/null || true
}

ensure_battery_watchdog() {
    [ -f "$BATTERY_WATCHDOG" ] || return 0
    current_hash="$(sha256sum "$BATTERY_WATCHDOG" 2>/dev/null | awk '{print $1}')"
    if [ -f "$BATTERY_PIDFILE" ]; then
        pid="$(cat "$BATTERY_PIDFILE" 2>/dev/null || true)"
        if battery_process_matches "$pid"; then
            running_hash="$(cat "$BATTERY_HASHFILE" 2>/dev/null || true)"
            if [ -n "$current_hash" ] && [ "$running_hash" = "$current_hash" ]; then
                return 0
            fi
            stop_battery_watchdog "$pid"
        fi
        rm -f "$BATTERY_PIDFILE" "$BATTERY_HASHFILE"
    fi
    nohup "$PYTHON" "$BATTERY_WATCHDOG" >> "$REPO/termux-battery-watchdog.log" 2>&1 < /dev/null &
    echo $! > "$BATTERY_PIDFILE"
    printf '%s\\n' "$current_hash" > "$BATTERY_HASHFILE"
}

update_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        cmdline="$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        case "$cmdline" in *termux_update.sh*) return 0;; esac
    fi
    return 1
}

control_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_control() {
    existing_pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    if control_process_matches "$existing_pid"; then
        mtime="$(stat -c %Y "$CONTROL_PIDFILE" 2>/dev/null || echo 0)"
        now="$(date +%s)"
        age=$((now - mtime))
        if [ "$age" -gt "$CONTROL_MAX_AGE" ]; then
            kill "$existing_pid" 2>/dev/null || true
            sleep 1
        else
            return 0
        fi
    fi
    rm -f "$CONTROL_PIDFILE"
    nohup "$PYTHON" "$REPO/scripts/termux_control.py" >> "$REPO/termux-autoupdate.log" 2>&1 < /dev/null &
    echo $! > "$CONTROL_PIDFILE"
}

reap_control() {
    pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$CONTROL_PIDFILE"
}

start_update() {
    existing_pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    if update_process_matches "$existing_pid"; then
        return 0
    fi
    rm -f "$UPDATE_PIDFILE"
    nohup bash "$REPO/scripts/termux_update.sh" >> "$REPO/termux-autoupdate.log" 2>&1 < /dev/null &
    echo $! > "$UPDATE_PIDFILE"
}

reap_update() {
    pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$UPDATE_PIDFILE"
}

while true; do
    printf '%s\\n' "$(date +%s.%N)" > "$SUPERVISOR_HEARTBEAT"
    ensure_battery_watchdog
    reap_control
    reap_update
    start_control
    start_update

    REPORT_ELAPSED=$((REPORT_ELAPSED + INTERVAL))
    if [ "$REPORT_ELAPSED" -ge "$REPORT_INTERVAL" ]; then
        report
        REPORT_ELAPSED=0
    fi

    sleep "$INTERVAL"
done

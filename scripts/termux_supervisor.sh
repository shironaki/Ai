#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-15}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
BATTERY_MAX_CACHE_AGE="${TERMUX_BATTERY_CACHE_MAX_AGE:-120}"
BATTERY_START_GRACE="${TERMUX_BATTERY_START_GRACE:-45}"
REPORT_ELAPSED=0
CONTROL_MAX_AGE="${TERMUX_CONTROL_MAX_AGE:-45}"
BATTERY_WATCHDOG="$REPO/scripts/termux_battery_watchdog.py"
BATTERY_PIDFILE="$REPO/termux-battery-watchdog.pid"
BATTERY_HASHFILE="$REPO/termux-battery-watchdog.sha256"
BATTERY_STATEFILE="$REPO/data/test/runtime/battery_watchdog.json"

cd "$REPO" || exit 1

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

SUPERVISOR_PID="$REPO/termux-supervisor.pid"
SUPERVISOR_LOCKDIR="$REPO/.termux-supervisor.lock"
UPDATE_PIDFILE="$REPO/termux-update.pid"
CONTROL_PIDFILE="$REPO/termux-control.pid"

supervisor_process_matches() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pid" -gt 1 ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [[ -r "/proc/$pid/cmdline" ]]; then
        local cmdline
        cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        [[ "$cmdline" == *"termux_supervisor.sh"* ]] && return 0
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
SUPERVISOR_HEARTBEAT="$REPO/data/test/runtime/supervisor-heartbeat"
echo "$$" > "$SUPERVISOR_PID"
mkdir -p "$(dirname "$SUPERVISOR_HEARTBEAT")"
trap 'rm -f "$SUPERVISOR_PID"; rmdir "$SUPERVISOR_LOCKDIR" 2>/dev/null || true' EXIT

report() {
    "$PYTHON" "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
}

battery_process_matches() {
    local pid="$1"
    local cmdline=""

    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pid" -gt 1 ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1

    if [[ -r "/proc/$pid/cmdline" ]]; then
        cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        [[ "$cmdline" == *"termux_battery_watchdog.py"* ]] && return 0
    fi

    return 1
}

battery_cache_fresh() {
    local now mtime age
    [[ -f "$BATTERY_STATEFILE" ]] || return 1

    now="$(date +%s)"
    mtime="$(stat -c %Y "$BATTERY_STATEFILE" 2>/dev/null || echo 0)"
    [[ "$mtime" =~ ^[0-9]+$ ]] || return 1
    [[ "$mtime" -gt 0 ]] || return 1

    age=$((now - mtime))
    (( age >= 0 && age <= BATTERY_MAX_CACHE_AGE ))
}

stop_battery_watchdog() {
    local pid="$1"
    kill "$pid" 2>/dev/null || true
    for _ in {1..10}; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 1
    done
    kill -KILL "$pid" 2>/dev/null || true
}

ensure_battery_watchdog() {
    if [[ ! -f "$BATTERY_WATCHDOG" ]]; then
        return 0
    fi

    local current_hash=""
    current_hash="$(sha256sum "$BATTERY_WATCHDOG" 2>/dev/null | awk '{print $1}')"

    if [[ -f "$BATTERY_PIDFILE" ]]; then
        local pid=""
        pid="$(cat "$BATTERY_PIDFILE" 2>/dev/null || true)"

        if battery_process_matches "$pid"; then
            local running_hash=""
            running_hash="$(cat "$BATTERY_HASHFILE" 2>/dev/null || true)"

            if [[ -n "$current_hash" && "$running_hash" == "$current_hash" ]]; then
                # The watchdog is responsible for handling transient Termux:API
                # failures/timeouts. A stale battery cache alone must not cause the
                # supervisor to restart a healthy watchdog: the API can legitimately
                # take longer than the cache window on some Android devices.
                # Only process identity and code hash determine whether we restart it.
                return 0
            fi

            stop_battery_watchdog "$pid"
        fi

        rm -f "$BATTERY_PIDFILE" "$BATTERY_HASHFILE"
    fi

    nohup "$PYTHON" "$BATTERY_WATCHDOG" >> "$REPO/termux-battery-watchdog.log" 2>&1 < /dev/null &
    echo $! > "$BATTERY_PIDFILE"
    printf '%s\n' "$current_hash" > "$BATTERY_HASHFILE"
}

update_process_matches() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pid" -gt 1 ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [[ -r "/proc/$pid/cmdline" ]]; then
        local cmdline
        cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        [[ "$cmdline" == *"termux_update.sh"* ]] && return 0
    fi
    return 1
}

control_process_matches() {
    local pid="$1"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pid" -gt 1 ]] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_control() {
    local existing_pid
    existing_pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    if control_process_matches "$existing_pid"; then
        local mtime now age
        mtime="$(stat -c %Y "$CONTROL_PIDFILE" 2>/dev/null || echo 0)"
        now="$(date +%s)"
        age=$((now - mtime))
        if (( age > CONTROL_MAX_AGE )); then
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
    local pid
    pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    [[ -n "$pid" ]] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$CONTROL_PIDFILE"
}

start_update() {
    local existing_pid
    existing_pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    if update_process_matches "$existing_pid"; then
        return 0
    fi
    rm -f "$UPDATE_PIDFILE"
    nohup bash "$REPO/scripts/termux_update.sh" >> "$REPO/termux-autoupdate.log" 2>&1 < /dev/null &
    echo $! > "$UPDATE_PIDFILE"
}

reap_update() {
    local pid
    pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    [[ -n "$pid" ]] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$UPDATE_PIDFILE"
}

while true; do
    printf '%s\n' "$(date +%s.%N)" > "$SUPERVISOR_HEARTBEAT"
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

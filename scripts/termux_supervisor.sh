#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
BRANCH="${BOT_BRANCH:-test-global-assistant-upgrade}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-15}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0
DATA_DIR="${BOT_DATA_DIR:-$REPO/data/test/runtime}"
LOG_FILE="$DATA_DIR/termux-autoupdate.log"
BOT_LOG_FILE="$DATA_DIR/bot.log"
QA_LOG_FILE="$DATA_DIR/qa-agent.log"
BATTERY_LOG_FILE="$DATA_DIR/termux-battery-watchdog.log"
CONTROL_MAX_AGE="${TERMUX_CONTROL_MAX_AGE:-45}"
BATTERY_WATCHDOG="$REPO/scripts/termux_battery_watchdog.py"
BATTERY_PIDFILE="$REPO/termux-battery-watchdog.pid"
BATTERY_HASHFILE="$REPO/termux-battery-watchdog.sha256"
UPDATE_PIDFILE="$REPO/termux-update.pid"
CONTROL_PIDFILE="$REPO/termux-control.pid"
CONTROL_HASHFILE="$REPO/termux-control.sha256"
CONTROL_HEARTBEAT="$REPO/data/test/runtime/control-heartbeat"
QA_PIDFILE="$REPO/qa-agent.pid"
QA_HASHFILE="$REPO/qa-agent.sha256"
QA_ENV_FILE="${QA_ENV_FILE:-$HOME/.config/ai/qa_agent.env}"

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
SUPERVISOR_HASHFILE="$REPO/termux-supervisor.sha256"

ensure_supervisor_revision() {
    current_hash="$(sha256sum "$0" 2>/dev/null | awk '{print $1}')"
    [ -n "$current_hash" ] || return 0
    previous_hash="$(tr -d "\000\r\n" < "$SUPERVISOR_HASHFILE" 2>/dev/null || true)"
    if [ -n "$previous_hash" ] && [ "$previous_hash" != "$current_hash" ]; then
        printf "%s\n" "$current_hash" > "$SUPERVISOR_HASHFILE"
        exec bash "$0"
    fi
    printf "%s\n" "$current_hash" > "$SUPERVISOR_HASHFILE"
}

supervisor_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        grep -aq 'termux_supervisor.sh' "/proc/$pid/cmdline" 2>/dev/null && return 0
    fi
    return 1
}

if ! mkdir "$SUPERVISOR_LOCKDIR" 2>/dev/null; then
    existing_pid="$(tr -cd '0-9' < "$SUPERVISOR_PID" 2>/dev/null || true)"
    if supervisor_process_matches "$existing_pid"; then
        exit 0
    fi
    rm -rf "$SUPERVISOR_LOCKDIR" 2>/dev/null || exit 0
    mkdir "$SUPERVISOR_LOCKDIR" 2>/dev/null || exit 0
fi

echo "$$" > "$SUPERVISOR_PID"
mkdir -p "$DATA_DIR" "$(dirname "$SUPERVISOR_HEARTBEAT")"
trap 'rm -f "$SUPERVISOR_PID"; rmdir "$SUPERVISOR_LOCKDIR" 2>/dev/null || true' EXIT

report() {
    "$PYTHON" "$REPO/scripts/termux_report.py" >> "$LOG_FILE" 2>&1 || true
}

sync_control_plane_files() {
    # The supervisor is the bootstrap authority for its own control plane.
    # If an older updater is blocked by stale staged runtime edits, it must
    # not be able to prevent the tested updater/control/QA scripts from
    # reaching the device.
    if ! git fetch --quiet origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
        return 0
    fi
    local path tmp remote_hash local_hash
    for path in scripts/termux_update.sh scripts/termux_control.py scripts/qa_agent.py qa/scenarios.json; do
        remote_hash="$(git rev-parse "origin/$BRANCH:$path" 2>/dev/null || true)"
        [ -n "$remote_hash" ] || continue
        local_hash="$(git hash-object "$REPO/$path" 2>/dev/null || true)"
        [ "$local_hash" = "$remote_hash" ] && continue
        tmp="$REPO/.control-plane-$(printf '%s' "$path" | tr '/' '_').remote.tmp"
        if git show "origin/$BRANCH:$path" > "$tmp" 2>/dev/null; then
            chmod --reference="$REPO/$path" "$tmp" 2>/dev/null || true
            mv -f "$tmp" "$REPO/$path"
            printf '%s BOOTSTRAP: synced control-plane file %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$path" >> "$LOG_FILE"
        else
            rm -f "$tmp"
        fi
    done
}

battery_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        grep -aq 'termux_battery_watchdog.py' "/proc/$pid/cmdline" 2>/dev/null && return 0
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
    nohup "$PYTHON" "$BATTERY_WATCHDOG" >> "$BATTERY_LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$BATTERY_PIDFILE"
    printf '%s\n' "$current_hash" > "$BATTERY_HASHFILE"
}

update_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        grep -aq 'termux_update.sh' "/proc/$pid/cmdline" 2>/dev/null && return 0
    fi
    return 1
}

control_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        grep -aq 'scripts/termux_control.py' "/proc/$pid/cmdline" 2>/dev/null && return 0
    fi
    return 1
}

start_control() {
    current_hash="$(sha256sum "$REPO/scripts/termux_control.py" 2>/dev/null | awk '{print $1}')"
    existing_pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    if control_process_matches "$existing_pid"; then
        running_hash="$(cat "$CONTROL_HASHFILE" 2>/dev/null || true)"
        if [ -n "$current_hash" ] && [ "$running_hash" != "$current_hash" ]; then
            kill "$existing_pid" 2>/dev/null || true
            sleep 1
        else
            mtime="$(stat -c %Y "$CONTROL_HEARTBEAT" 2>/dev/null || stat -c %Y "$CONTROL_PIDFILE" 2>/dev/null || echo 0)"
            now="$(date +%s)"
            age=$((now - mtime))
            if [ "$age" -gt "$CONTROL_MAX_AGE" ]; then
                kill "$existing_pid" 2>/dev/null || true
                sleep 1
            else
                return 0
            fi
        fi
    fi
    rm -f "$CONTROL_PIDFILE" "$CONTROL_HASHFILE"
    nohup "$PYTHON" "$REPO/scripts/termux_control.py" >> "$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$CONTROL_PIDFILE"
    printf "%s\n" "$current_hash" > "$CONTROL_HASHFILE"
}

reap_control() {
    pid="$(cat "$CONTROL_PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$CONTROL_PIDFILE"
}


qa_process_matches() {
    pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1;; esac
    [ "$pid" -gt 1 ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    if [ -r "/proc/$pid/cmdline" ]; then
        grep -aq 'scripts/qa_agent.py' "/proc/$pid/cmdline" 2>/dev/null && return 0
    fi
    return 1
}

start_qa_agent() {
    [ -f "$REPO/scripts/qa_agent.py" ] || return 0
    current_hash="$(sha256sum "$REPO/scripts/qa_agent.py" 2>/dev/null | awk '{print $1}')"
    if [ -f "$QA_PIDFILE" ]; then
        pid="$(cat "$QA_PIDFILE" 2>/dev/null || true)"
        if qa_process_matches "$pid"; then
            running_hash="$(cat "$QA_HASHFILE" 2>/dev/null || true)"
            if [ -n "$current_hash" ] && [ "$running_hash" = "$current_hash" ]; then
                return 0
            fi
            kill "$pid" 2>/dev/null || true
            sleep 1
        fi
        rm -f "$QA_PIDFILE" "$QA_HASHFILE"
    fi
    if [ -f "$QA_ENV_FILE" ]; then
        set -a
        . "$QA_ENV_FILE"
        set +a
    fi
    QA_RUNNER="${QA_PYTHON:-$HOME/Ai/qa_client/.venv/bin/python}"
    [ -x "$QA_RUNNER" ] || return 0
    nohup "$QA_RUNNER" "$REPO/scripts/qa_agent.py" >> "$QA_LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$QA_PIDFILE"
    printf "%s\n" "$current_hash" > "$QA_HASHFILE"
}

reap_qa_agent() {
    pid="$(cat "$QA_PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$QA_PIDFILE"
}

start_update() {
    existing_pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    if update_process_matches "$existing_pid"; then
        return 0
    fi
    rm -f "$UPDATE_PIDFILE"
    nohup bash "$REPO/scripts/termux_update.sh" >> "$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$UPDATE_PIDFILE"
}

reap_update() {
    pid="$(cat "$UPDATE_PIDFILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 0
    kill -0 "$pid" 2>/dev/null && return 0
    rm -f "$UPDATE_PIDFILE"
}

while true; do
    ensure_supervisor_revision
    printf '%s\n' "$(date +%s.%N)" > "$SUPERVISOR_HEARTBEAT"
    sync_control_plane_files
    ensure_battery_watchdog
    reap_control
    reap_update
    reap_qa_agent
    start_control
    start_qa_agent
    start_update

    REPORT_ELAPSED=$((REPORT_ELAPSED + INTERVAL))
    if [ "$REPORT_ELAPSED" -ge "$REPORT_INTERVAL" ]; then
        report
        REPORT_ELAPSED=0
    fi

    sleep "$INTERVAL"
done

#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
cd "$REPO" || exit 1

termux-wake-lock || true

SUPERVISOR="$REPO/scripts/termux_supervisor.sh"
SUPERVISOR_PID="$REPO/termux-supervisor.pid"
SUPERVISOR_LOG="$REPO/termux-supervisor.log"
GUARDIAN_PID="$REPO/termux-guardian.pid"

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

start_supervisor() {
    if [[ -f "$SUPERVISOR_PID" ]] && supervisor_process_matches "$(cat "$SUPERVISOR_PID" 2>/dev/null || true)"; then
        return 0
    fi
    rm -f "$SUPERVISOR_PID"
    nohup bash "$SUPERVISOR" >> "$SUPERVISOR_LOG" 2>&1 < /dev/null &
    echo $! > "$SUPERVISOR_PID"
}

start_supervisor

# Keep a tiny independent guardian alive after Termux:Boot returns. If Android
# kills the supervisor process, the guardian recreates it without touching the
# bot/lease directly. The supervisor remains the only component allowed to
# acquire or renew the active lease.
if [[ -f "$GUARDIAN_PID" ]]; then
    old_guardian="$(cat "$GUARDIAN_PID" 2>/dev/null || true)"
    if [[ "$old_guardian" =~ ^[0-9]+$ ]] && kill -0 "$old_guardian" 2>/dev/null; then
        exit 0
    fi
fi

(
    echo $BASHPID > "$GUARDIAN_PID"
    trap 'rm -f "$GUARDIAN_PID"' EXIT
    while true; do
        if ! supervisor_process_matches "$(cat "$SUPERVISOR_PID" 2>/dev/null || true)"; then
            start_supervisor
        fi
        sleep 30
    done
) >> "$SUPERVISOR_LOG" 2>&1 < /dev/null &

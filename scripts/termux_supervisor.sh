#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
PYTHON="${TERMUX_PYTHON:-$REPO/.venv/bin/python}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-60}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0

cd "$REPO" || exit 1

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

SUPERVISOR_PID="$REPO/termux-supervisor.pid"
echo "$" > "$SUPERVISOR_PID"
trap 'rm -f "$SUPERVISOR_PID"' EXIT

report() {
    "$PYTHON" "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
}

while true; do
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

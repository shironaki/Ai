#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-60}"
REPORT_INTERVAL="${TERMUX_REPORT_INTERVAL:-300}"
REPORT_ELAPSED=0

cd "$REPO" || exit 1

while true; do
    if ! sh "$REPO/scripts/termux_update.sh"; then
        sh "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
    fi

    REPORT_ELAPSED=$((REPORT_ELAPSED + INTERVAL))
    if [ "$REPORT_ELAPSED" -ge "$REPORT_INTERVAL" ]; then
        sh "$REPO/scripts/termux_report.py" >> "$REPO/termux-autoupdate.log" 2>&1 || true
        REPORT_ELAPSED=0
    fi

    sleep "$INTERVAL"
done

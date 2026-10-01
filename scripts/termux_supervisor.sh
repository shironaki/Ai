#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
INTERVAL="${TERMUX_UPDATE_INTERVAL:-60}"

cd "$REPO" || exit 1
while true; do
    sh "$REPO/scripts/termux_update.sh"
    sleep "$INTERVAL"
done

#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
cd "$REPO" || exit 1

termux-wake-lock || true

mkdir -p "$HOME/.termux/boot"
nohup sh "$REPO/scripts/termux_supervisor.sh" >> "$REPO/termux-supervisor.log" 2>&1 < /dev/null &
echo $! > "$REPO/termux-supervisor.pid"

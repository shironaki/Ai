#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
BOOT_DIR="$HOME/.termux/boot"
TARGET="$BOOT_DIR/ai-bot"

mkdir -p "$BOOT_DIR"
chmod +x "$REPO/scripts/termux_boot.sh"
ln -sfn "$REPO/scripts/termux_boot.sh" "$TARGET"

echo "Termux:Boot installed: $TARGET"

#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BOT_TOKEN:-}" ]]; then
  echo "BOT_TOKEN is not set. Configure it as an environment secret." >&2
  exit 1
fi

export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-data/${BOT_ENV}}"

echo "Starting Ai bot in ${BOT_ENV} environment; data: ${BOT_DATA_DIR}"
exec python run.py

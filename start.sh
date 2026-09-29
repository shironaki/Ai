#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BOT_TOKEN:-}" ]]; then
  echo "BOT_TOKEN is not set. Configure it as an environment secret." >&2
  exit 1
fi

exec python run.py
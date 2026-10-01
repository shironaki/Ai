# Termux TEST automation

The Termux contour is designed to keep the TEST bot alive without manual restarts:

`GitHub test-global-assistant-upgrade -> fetch -> fast-forward -> dependencies -> pytest -> restart -> Telegram health check`.

If the new revision fails dependency installation, tests, or Telegram health after restart, Termux automatically restores the previous local commit and starts the last known-good revision.

## One-time setup

From the repository:

```bash
cd ~/Ai
chmod +x scripts/termux_update.sh scripts/termux_supervisor.sh scripts/termux_boot.sh scripts/install_termux_boot.sh
sh scripts/install_termux_boot.sh
```

The installer creates `~/.termux/boot/ai-bot`. With the Termux:Boot add-on installed, Android startup launches the supervisor automatically.

Start it immediately without rebooting:

```bash
sh ~/Ai/scripts/termux_boot.sh
```

The supervisor checks GitHub every 60 seconds. It starts the bot when it is missing, restarts it when health fails, and processes new commits transactionally.

## Automatic rollback

A new commit is accepted only after:

1. fast-forward succeeds;
2. Python dependencies install;
3. the full pytest suite passes;
4. the bot starts;
5. Telegram health passes.

If any post-fetch step fails, the local checkout is reset to the previous commit, dependencies are restored from that revision, and the previous bot is started and health-checked.

The failed revision remains on GitHub; Termux does not destroy or rewrite the remote branch.

## Safety

- TEST only: `BOT_ENV=test`.
- Never put `BOT_TOKEN` or GitHub tokens in tracked files.
- A dirty working tree stops automation instead of overwriting local changes.
- Only a fast-forward update is accepted.
- Tests must pass before an updated bot is restarted.
- Telegram health requires the local runtime heartbeat, successful Telegram API calls, no configured webhook, and no recent polling conflict.
- Only one Termux update process is allowed at a time.

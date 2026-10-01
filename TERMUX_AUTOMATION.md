# Termux TEST automation

This contour follows the same TEST branch as Codespaces:

`GitHub test-global-assistant-upgrade -> Termux fetch -> fast-forward -> dependencies -> pytest -> restart -> Telegram health check`.

## One-time setup

Run in Termux from the repository:

```bash
cd ~/Ai
chmod +x scripts/termux_update.sh scripts/termux_supervisor.sh scripts/termux_boot.sh
```

Verify that Git authentication is already configured without putting a token in the repository.

Start the supervisor once:

```nohup sh ~/Ai/scripts/termux_supervisor.sh >> ~/Ai/termux-supervisor.log 2>&1 &
```

The supervisor checks GitHub every 60 seconds. It only restarts the bot after a fast-forward update, or when the health check fails.

## Reboot persistence

Install the Termux:Boot add-on and arrange for it to execute:

```bash
sh ~/Ai/scripts/termux_boot.sh
```

The boot script starts the same supervisor after the phone starts.

## Safety

- TEST only: `BOT_ENV=test`.
- Never put `BOT_TOKEN` or GitHub tokens in tracked files.
- A dirty working tree stops automation instead of overwriting local changes.
- Tests must pass before an updated bot is restarted.
- Telegram health requires both the local runtime heartbeat and a successful `getMe` API call.

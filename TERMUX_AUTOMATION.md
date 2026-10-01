# Termux TEST automation

The Termux contour keeps the TEST bot alive without manual restarts:

GitHub test-global-assistant-upgrade -> fetch -> fast-forward -> dependencies -> pytest -> restart -> Telegram health check.

If the new revision fails dependency installation, tests, or Telegram health after restart, Termux automatically restores the previous local commit and starts the last known-good revision.

## Current phone: no Termux:Boot required

The current phone is always on and already runs the supervisor manually. Do not install Termux:Boot on this phone.

Start the supervisor once:

```bash
cd ~/Ai
chmod +x scripts/termux_update.sh scripts/termux_supervisor.sh scripts/termux_report.py
nohup sh ~/Ai/scripts/termux_supervisor.sh >> ~/Ai/termux-supervisor.log 2>&1 &
```

The supervisor checks GitHub every 60 seconds, starts the bot when it is missing, restarts it when health fails, and processes new commits transactionally.

## Live telemetry

The supervisor publishes a sanitized runtime snapshot to GitHub Issue #23:

- current branch and commit;
- Telegram health-check result;
- bot and supervisor process state;
- tail of bot.log;
- tail of termux-autoupdate.log.

The snapshot is updated in one persistent comment rather than creating a new comment every cycle. It is published every 5 minutes and immediately after an updater failure.

The telemetry channel is separate from the code branch, so runtime diagnostics never make the working tree dirty and never block updates.

### One-time GitHub authentication for telemetry

The reporter needs write access to Issue #23. Store the GitHub token outside the repository, never in tracked files:

```bash
mkdir -p ~/.config/ai
printf 'TERMUX_GITHUB_TOKEN=%s\n' 'PASTE_GITHUB_TOKEN_HERE' > ~/.config/ai/termux.env
chmod 600 ~/.config/ai/termux.env
```

Before starting the supervisor, export the file into the shell environment:

```bash
set -a
. ~/.config/ai/termux.env
set +a
```

The reporter also accepts GITHUB_TOKEN, GH_TOKEN, or an authenticated gh CLI session.

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

- TEST only: BOT_ENV=test.
- Never put BOT_TOKEN or GitHub tokens in tracked files.
- A dirty working tree stops automation instead of overwriting local changes.
- Only a fast-forward update is accepted.
- Tests must pass before an updated bot is restarted.
- Telegram health requires the local runtime heartbeat, successful Telegram API calls, no configured webhook, and no recent polling conflict.
- Only one Termux update process is allowed at a time.
- Runtime telemetry is sanitized before publication.

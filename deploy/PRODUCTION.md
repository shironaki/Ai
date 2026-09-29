# Production runtime

The production bot is intentionally independent from Codespaces.

## Runtime model

- TEST: GitHub Codespace + test Telegram bot token + `data/test/`
- PROD: Linux host + production Telegram bot token + `/var/lib/ai-bot`
- Both use the same GitHub `main` codebase.
- Never run TEST and PROD with the same Telegram token.
- Production does not depend on Codespaces.

## First production setup

The repository is private. Configure GitHub authentication on the production host before cloning, preferably with an SSH deploy key that has read access to this repository. Do not put a GitHub access token into this file or commit one to the repository.

After GitHub access is configured:

```bash
sudo useradd --system --home /opt/ai-bot --shell /usr/sbin/nologin ai-bot
sudo mkdir -p /opt/ai-bot /var/lib/ai-bot
sudo chown -R ai-bot:ai-bot /opt/ai-bot /var/lib/ai-bot

git clone git@github.com:shironaki/Ai.git /opt/ai-bot
cd /opt/ai-bot
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

sudo cp deploy/systemd/ai-bot.env.example /etc/ai-bot.env
sudo chmod 600 /etc/ai-bot.env
sudoedit /etc/ai-bot.env

sudo cp deploy/systemd/ai-bot.service /etc/systemd/system/ai-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now ai-bot
```

In `/etc/ai-bot.env`, set the production `BOT_TOKEN` and `GROQ_API_KEY`. Never commit either secret.

Check:

```bash
sudo systemctl status ai-bot
```

Logs:

```bash
sudo journalctl -u ai-bot -f
```

The service restarts automatically after a process crash. SQLite data is outside the Git working tree, so deployments do not replace the live database.

## Updating production

```bash
cd /opt/ai-bot
git pull --ff-only origin main
.venv/bin/pip install -r requirements.txt
sudo systemctl restart ai-bot
sudo systemctl status ai-bot
```

Do not copy TEST database files into PROD. A database migration must be an explicit, separately verified operation.

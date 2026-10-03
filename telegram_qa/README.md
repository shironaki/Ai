# Live Telegram QA

This package drives the real Telegram bot through a dedicated user account using Telethon.

It is intentionally separate from bot polling. The QA account is a normal Telegram user session, so it does not participate in the bot's polling or lease logic.

## Setup

Create a dedicated Telegram account for QA. Do not use a personal account.

Create a Telegram developer application and obtain an API ID and API hash. Keep both private.

Install dependencies with: python -m pip install -r requirements-qa.txt

Set TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_QA_TARGET and optionally TELEGRAM_QA_SESSION=telegram_qa/session.

Run: python -m telegram_qa.run smoke

The first run performs normal Telegram user login and creates a local session file. Keep that file on the QA Termux device only.

## Security

Never commit the .session file. Never put API credentials, login codes, or the 2FA password into GitHub or logs. Use a dedicated QA account. If the session is compromised, revoke it in Telegram and create a fresh session.

## Roadmap

The runner is designed to grow into panel callbacks, confirmations, cancellation flows, AI fallback checks, multi-chat context isolation, runtime and diagnostics checks, negative/error scenarios, latency measurements, and JSON/JUnit reports.

Live Telegram tests are opt-in and should not run on ordinary code pushes until a dedicated test environment and secrets are configured.

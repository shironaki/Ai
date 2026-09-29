# Architecture

## Runtime

- `run.py` — единственная точка запуска.
- `main.py` — создание Bot/Dispatcher, middleware, диагностика и startup.
- `handlers/` — Telegram-команды и callbacks.

## Application layers

- `config/` — централизованные роли и их visible tags.
- `core/` — permission checks shared by handlers and services.
- `services/` — reusable business integrations (AI, moderation, users).
- `database/` — structured SQLite read layer and schemas.
- `base/` — compatibility layer for existing gameplay reads/writes; it remains active until every write path is migrated safely.

## Roles

The role catalogue is defined once in `config/role_config.py`:

- 👑 ОСНОВАТЕЛЬ
- ⚙️ СИСТЕМА
- 🛡️ АДМИНИСТРАТОР
- 👮 ХЕЛПЕР
- 🔨 МОДЕРАТОР
- 👤 ИГРОК

Permission checks must use `core.permissions`, not duplicate role sets inside handlers.

## AI

The AI integration lives in `services/ai_service.py` and uses the optional `GROQ_API_KEY` environment secret. Conversation history is short-lived in memory; no API key or prompt is stored in the repository.

## Database migration rule

The live bot still uses `base/users.py` and `base/chats.py` for legacy write paths. The new `database/` layer points at the same default database files and is intentionally read-oriented until all writes are migrated. This avoids creating a second database or silently losing existing user/game data.

## Security/runtime rules

- Secrets are environment variables only.
- Moderation/admin commands are hidden from the public Telegram command menu.
- Permission checks remain inside handlers even when a command is hidden.
- Runtime logs stay outside Git.
- Python 3.11 syntax is checked by GitHub Actions on pushes and pull requests.

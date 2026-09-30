# Architecture

## Runtime

- `run.py` — единственная точка запуска.
- `main.py` — создание Bot/Dispatcher, middleware, диагностика и startup.
- `handlers/` — Telegram-команды и callbacks.

## Application layers

- `config/` — централизованные роли и их visible tags.
- `core/` — permissions, command models, registry and authorization policy.
- `services/` — AI, command gateway, audit and security helpers.
- `database/` — structured SQLite read layer and schemas.
- `base/` — compatibility layer for existing gameplay reads/writes; it remains active until every write path is migrated safely.
- `handlers/` — Telegram transport layer. Handlers should delegate policy/business decisions to core/services instead of duplicating them.

## Command architecture

User-facing non-game commands have one registry in `core/command_registry.py`.
A command is described by:

- stable key;
- aliases;
- category;
- minimum role;
- supported scope;
- destructive flag;
- confirmation requirement.

Natural-language AI must produce an intent, not executable code. The intended pipeline is:

`Telegram -> intent -> registry -> policy -> target/scope validation -> confirmation -> executor -> audit`.

The AI layer is never allowed to execute arbitrary Python, SQL, shell commands or Telegram API methods.

Legacy game commands are intentionally outside the core registry. The game system will be rebuilt as a separate module.

## Roles

The role catalogue is defined once in `config/role_config.py`:

- 👑 ОСНОВАТЕЛЬ
- ⚙️ СИСТЕМА
- 🛡️ АДМИНИСТРАТОР
- 👮 ХЕЛПЕР
- 🔨 МОДЕРАТОР
- 👤 ИГРОК

Permission checks use `core.permissions` and command policy, not duplicated role sets inside handlers.

## AI

The AI integration lives in `services/ai_service.py` and uses the optional `GROQ_API_KEY` environment secret.

- Conversation history is short-lived in memory.
- API keys are never stored in repository files.
- Provider errors are redacted before diagnostics.
- AI command classification is allowlisted and currently supports only the runtime commands.
- Future command expansion must add registry entries and typed executors, not arbitrary code execution.

## Database

The live bot still uses `base/users.py` and `base/chats.py` for legacy write paths. The new `database/` layer points at the same default database files and remains read-oriented until all writes are migrated safely.

Local database directories are best-effort restricted to owner-only filesystem permissions on POSIX systems.

## Security/runtime rules

- Secrets are environment variables only.
- `.env*`, credential/key files, SQLite databases and runtime data are ignored by Git.
- Permission checks remain active even when a command is hidden from Telegram's public command menu.
- Destructive command intents require explicit confirmation.
- Founder pending intents are bound to both user and chat, preventing cross-chat scope confusion.
- Runtime logs do not store ordinary message content.
- Error diagnostics redact common API/token formats.
- Audit events contain command metadata only; AI prompts, message text and credentials are excluded.
- Runtime logs stay outside Git.
- Python 3.11 syntax is checked by GitHub Actions on pushes and pull requests.

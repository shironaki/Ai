# Architecture

The bot is being migrated to a modular structure without changing existing gameplay behavior.

## Current layers

- `main.py` — application bootstrap, dispatcher and startup.
- `config/` — configuration and role definitions.
- `core/` — shared permission logic.
- `handlers/` — Telegram command and callback handlers.
- `services/` — reusable business integrations such as AI.
- `base/` — current SQLite data access.

## Migration rule

New features should be added to the appropriate layer instead of growing `main.py` or mixing external services into handlers.

Existing handlers remain intact during migration. Each module is moved only after its imports and dispatcher registration are safe.

## Role model

Roles are defined centrally in `config/role_config.py`. Permission checks are exposed through `core/permissions.py`.

Visible role labels:

- 👑 ОСНОВАТЕЛЬ
- ⚙️ СИСТЕМА
- 🛡️ АДМИНИСТРАТОР
- 👮 ХЕЛПЕР
- 🔨 МОДЕРАТОР
- 👤 ИГРОК

## Database migration status

The new `database/` layer currently provides safe read access and schema definitions.
The legacy `base/` modules remain active until all existing write paths are migrated.
This prevents accidental data loss and keeps the current bot runtime stable during the refactor.

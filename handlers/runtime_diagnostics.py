"""Founder-only runtime status and diagnostics command handlers.

These handlers are concrete aiogram entry points for commands declared in the
authoritative command registry. Keeping them in a dedicated module prevents
registry metadata from being mistaken for actual Telegram registration.
"""

import os
import time

from aiogram import types

from main import (
    HEARTBEAT_FILE,
    PROCESS_STARTED_AT,
    bot,
    config,
    dp,
    psutil,
)

from core.identity import is_owner
from services.ai_data import runtime_summary
from services.battery_status import get_battery_status


FOUNDER_DENIAL = "⛔ Команда доступна только Основателю."


async def _founder_guard(message: types.Message) -> bool:
    if is_owner(message.from_user.id):
        return True
    await message.reply(FOUNDER_DENIAL, allow_sending_without_reply=True)
    return False


def _heartbeat_age() -> int | None:
    try:
        return max(0, int(time.time() - os.path.getmtime(HEARTBEAT_FILE)))
    except OSError:
        return None


@dp.message_handler(commands=["status"])
async def status_command(message: types.Message):
    """Founder-only global runtime status."""
    if not await _founder_guard(message):
        return

    runtime = runtime_summary(message.chat.id)
    heartbeat_age = _heartbeat_age()
    uptime = max(0, int(time.monotonic() - PROCESS_STARTED_AT))

    battery = None
    try:
        battery = get_battery_status()
    except Exception:
        pass

    lines = [
        "<b>🛰 RUNTIME STATUS</b>",
        f"Глобальный режим: <b>{'СТАЗИС' if runtime['global_paused'] else 'АКТИВЕН'}</b>",
        f"Текущий чат: <b>{'СТАЗИС' if runtime['current_chat_paused'] else 'АКТИВЕН'}</b>",
        f"Heartbeat: <b>{heartbeat_age}s</b>" if heartbeat_age is not None else "Heartbeat: <b>нет данных</b>",
        f"Uptime: <b>{uptime}s</b>",
    ]
    if battery is not None:
        lines.append(
            f"Phone2 battery: <b>{battery['percentage']}%</b>"
            + (" · ⚡ зарядка" if battery["charging"] else "")
            + (f" · cache {battery['age_seconds']}s" if battery.get("age_seconds") is not None else "")
        )

    await message.answer("\n".join(lines))


@dp.message_handler(commands=["diagnostics"])
async def diagnostics_command(message: types.Message):
    """Founder-only safe runtime/network diagnostics."""
    if not await _founder_guard(message):
        return

    checks = []
    try:
        me = await bot.get_me()
        checks.append(f"Telegram API: <b>OK</b> · @{me.username or 'unknown'}")
    except Exception as exc:
        checks.append(f"Telegram API: <b>ERROR</b> · <code>{type(exc).__name__}</code>")

    heartbeat_age = _heartbeat_age()
    checks.append(
        f"Heartbeat: <b>OK</b> · {heartbeat_age}s"
        if heartbeat_age is not None and heartbeat_age <= 30
        else "Heartbeat: <b>STALE/MISSING</b>"
    )

    if psutil is not None:
        try:
            checks.append(
                f"Process: <b>OK</b> · PID {os.getpid()} · "
                f"CPU {psutil.Process(os.getpid()).cpu_percent(interval=0.0):.1f}%"
            )
        except Exception as exc:
            checks.append(f"Process: <b>ERROR</b> · <code>{type(exc).__name__}</code>")
    else:
        checks.append("Process: <b>psutil unavailable</b>")

    try:
        battery = get_battery_status()
        checks.append(
            f"Phone2 battery cache: <b>OK</b> · {battery['percentage']}% · "
            f"age {battery['age_seconds']}s"
        )
    except Exception as exc:
        checks.append(f"Phone2 battery cache: <b>ERROR</b> · <code>{type(exc).__name__}</code>")

    await message.answer("<b>🧪 DIAGNOSTICS</b>\n" + "\n".join(f"• {item}" for item in checks))

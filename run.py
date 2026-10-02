"""Single-process runtime entrypoint for the TEST/PROD bot."""

import os
import sys

from main import start_bot


def _acquire_runtime_lock():
    """Prevent two local polling processes from consuming the same bot token."""
    try:
        import fcntl
    except ImportError:
        return None

    data_dir = os.getenv("BOT_DATA_DIR", os.path.join("data", os.getenv("BOT_ENV", "test")))
    os.makedirs(data_dir, exist_ok=True)
    lock_path = os.path.join(data_dir, "bot-runtime.lock")
    handle = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        print("Another bot runtime instance is already running; exiting.", file=sys.stderr)
        raise SystemExit(0)
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


if __name__ == "__main__":
    _runtime_lock = _acquire_runtime_lock()
    start_bot()

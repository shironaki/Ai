from pathlib import Path
import ast


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "windows_runtime.py"


def test_windows_runtime_compiles():
    ast.parse(SCRIPT.read_text(encoding="utf-8"))


def test_windows_runtime_is_not_termux_specific():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "termux-battery-status" not in text
    assert "/proc/" not in text
    assert "bash" not in text.lower()


def test_windows_runtime_defaults_to_standby_and_has_shared_lease():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'WINDOWS_RUNTIME_ROLE", "standby"' in text
    assert 'WINDOWS_DEVICE_ID", "pc1"' in text
    assert 'TERMUX_LEASE_BRANCH", "termux-lease"' in text
    assert 'TERMUX_LEASE_PATH", "lease.json"' in text


def test_windows_runtime_has_fencing_before_start():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "if not ok:" in text
    assert "stop_bot()" in text
    assert "release()" in text

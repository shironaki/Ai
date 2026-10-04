from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "install_windows_autostart.ps1"


def test_windows_autostart_uses_user_run_key():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" in text
    assert "New-ItemProperty" in text
    assert 'Ai Windows Runtime (pc1)' in text


def test_windows_autostart_does_not_require_scheduled_task():
    text = SCRIPT.read_text(encoding="utf-8").lower()
    assert "register-scheduledtask" not in text
    assert "new-scheduledtask" not in text
    assert "administrator privileges required" in text


def test_windows_autostart_targets_standby_pc1():
    text = SCRIPT.read_text(encoding="utf-8")
    assert '-Role standby -DeviceId pc1' in text
    assert 'scripts\\windows_host.ps1' in text

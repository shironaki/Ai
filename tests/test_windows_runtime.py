from pathlib import Path
import ast


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "windows_runtime.py"


def test_windows_runtime_compiles():
    ast.parse(SCRIPT.read_text(encoding="utf-8"))


def test_windows_runtime_is_not_termux_specific():
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    source = SCRIPT.read_text(encoding="utf-8")
    runtime_nodes = [
        node for node in tree.body
        if not isinstance(node, (ast.Expr, ast.Import, ast.ImportFrom))
    ]
    runtime_text = ast.unparse(ast.Module(body=runtime_nodes, type_ignores=[]))
    assert "termux-battery-status" not in runtime_text
    assert "/proc/" not in runtime_text
    assert "bash" not in runtime_text.lower()
    assert "termux" in source.lower()


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

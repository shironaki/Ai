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


def test_windows_runtime_tracks_confirmed_lease_expiry_on_git_failure():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "last_confirmed_expiry = 0" in text
    assert "last_confirmed_expiry > now" in text
    assert "LEASE CHECK ERROR: preserving active bot until confirmed expiry" in text
    assert "LEASE CHECK FAILED: fencing bot" in text


def test_windows_runtime_does_not_reacquire_inside_start_bot():
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    start = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "start_bot")
    start_text = ast.unparse(start)
    assert "acquire_or_renew" not in start_text


def test_windows_runtime_fetches_lease_into_explicit_remote_ref():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'refs/remotes/origin/{LEASE_BRANCH}' in text
    assert 'branch_ref = f"refs/heads/{LEASE_BRANCH}"' in text
    assert 'git("fetch", "origin", f"{branch_ref}:{remote_ref}")' in text
    assert 'rev-parse", remote_ref' in text

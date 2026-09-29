from pathlib import Path
import py_compile


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {ROOT / ".venv"}


def test_python_sources_compile():
    files = [
        path for path in ROOT.rglob("*.py")
        if not any(part in {".git", ".venv", "venv", "__pycache__"} for part in path.parts)
    ]
    assert files, "No Python sources found"
    for path in files:
        py_compile.compile(str(path), doraise=True)

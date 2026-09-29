import subprocess
import sys
from pathlib import Path


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parent
    main_script = project_root / "main.py"
    raise SystemExit(
        subprocess.call([sys.executable, str(main_script)], cwd=project_root)
    )

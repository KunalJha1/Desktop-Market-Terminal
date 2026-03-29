from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def env_candidates() -> list[Path]:
    return [
        Path.cwd() / ".env",
        BACKEND_ROOT / ".env",
        REPO_ROOT / ".env",
    ]


def load_local_backend_env() -> list[Path]:
    loaded: list[Path] = []
    for env_path in env_candidates():
        if env_path.exists():
            load_dotenv(env_path, override=False)
            loaded.append(env_path)
    return loaded

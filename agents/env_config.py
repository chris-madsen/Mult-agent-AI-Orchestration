from __future__ import annotations

import os
import pathlib

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
_DOTENV_PATH = _PROJECT_ROOT / ".env"


def _load_dotenv() -> None:
    if not _DOTENV_PATH.exists():
        return

    for raw_line in _DOTENV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[len("export "):].strip()

        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_google_cloud_project() -> str | None:
    _load_dotenv()
    value = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    return value or None


def get_google_cloud_location(default: str = "global") -> str:
    _load_dotenv()
    value = os.getenv("GOOGLE_CLOUD_LOCATION", "").strip()
    return value or default

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any


class ReceiptWriter:
    def __init__(self, path: str | Path | None = None):
        configured = path or os.environ.get("ACE_CONTEXT_RECEIPT_FILE", "")
        self.path = Path(configured) if configured else None
        self._lock = threading.Lock()

    def write(self, receipt: dict[str, Any]) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        sanitized = {
            key: value
            for key, value in receipt.items()
            if key not in {"contextText", "access_token", "refresh_token", "api_key", "credential"}
        }
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(sanitized, ensure_ascii=False, sort_keys=True) + "\n")

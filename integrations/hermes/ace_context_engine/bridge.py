from __future__ import annotations

import json
import os
import selectors
import shlex
import subprocess
import threading
from typing import Any


class BridgeClient:
    """Small request/response client for the direct ACE JSONL bridge."""

    def __init__(
        self,
        command: list[str] | None = None,
        timeout_seconds: float | None = None,
        startup_timeout_seconds: float | None = None,
        request_timeout_seconds: float | None = None,
    ):
        configured = os.environ.get("ACE_CONTEXT_BRIDGE_COMMAND", "").strip()
        self.command = command or (shlex.split(configured) if configured else ["node", "/ace/dist/bin/ace-context-bridge.js"])
        self.startup_timeout_seconds = startup_timeout_seconds or float(os.environ.get("ACE_CONTEXT_BRIDGE_STARTUP_TIMEOUT_SECONDS", "180"))
        self.request_timeout_seconds = request_timeout_seconds or timeout_seconds or float(os.environ.get("ACE_CONTEXT_BRIDGE_TIMEOUT_SECONDS", "30"))
        self.timeout_seconds = self.request_timeout_seconds
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    def _read_line(self, process: subprocess.Popen[str], timeout: float) -> str:
        if process.stdout is None:
            raise RuntimeError("ACE context bridge stdout is unavailable")
        selector = selectors.DefaultSelector()
        try:
            selector.register(process.stdout, selectors.EVENT_READ)
            events = selector.select(timeout=timeout)
            if not events:
                self.close()
                raise TimeoutError("ACE context bridge timed out")
            line = process.stdout.readline()
        finally:
            selector.close()
        if not line:
            self.close()
            raise RuntimeError("ACE context bridge exited before returning a response")
        return line

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._process is not None and self._process.poll() is None:
            return self._process
        env = os.environ.copy()
        env.setdefault("ACE_CONTEXT_BRIDGE_MODE", "true")
        self._process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # avoid deadlock on an unread stderr pipe
            text=True,
            encoding="utf-8",
            env=env,
            bufsize=1,
        )
        ready = json.loads(self._read_line(self._process, self.startup_timeout_seconds))
        if not isinstance(ready, dict) or ready.get("type") != "bridge_ready" or ready.get("schemaVersion") != 1:
            self.close()
            raise RuntimeError("ACE context bridge did not emit a valid bridge_ready record")
        if ready.get("runtimeId") != "ace-harbor-runtime-v1":
            self.close()
            raise RuntimeError("ACE context bridge runtime identity is not pinned")
        return self._process

    def transform(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            process = self._ensure_process()
            if process.stdin is None or process.stdout is None:
                raise RuntimeError("ACE context bridge pipes are unavailable")
            process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            process.stdin.flush()
            line = self._read_line(process, self.request_timeout_seconds)
            response = json.loads(line)
            if not isinstance(response, dict):
                raise RuntimeError("ACE context bridge returned a non-object response")
            return response

    def close(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        try:
            process.kill()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass

from __future__ import annotations

import json
import sys
import unittest
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from agent.context_engine import ContextEngine as _HermesContextEngine  # type: ignore[import-not-found]  # noqa: F401
except ModuleNotFoundError:
    agent_module = types.ModuleType("agent")
    context_module = types.ModuleType("agent.context_engine")

    class _HermesContextEngine:
        pass

    setattr(context_module, "ContextEngine", _HermesContextEngine)
    sys.modules.setdefault("agent", agent_module)
    sys.modules["agent.context_engine"] = context_module

from integrations.hermes.ace_context_engine.bridge import BridgeClient


READY = {"type": "bridge_ready", "schemaVersion": 1, "runtimeId": "ace-harbor-runtime-v1"}


class BridgeClientTests(unittest.TestCase):
    def test_consumes_ready_before_transform_response(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import json,sys; print(json.dumps({0}), flush=True); line=sys.stdin.readline(); print(json.dumps({{'ok':True,'requestId':json.loads(line)['requestId']}}), flush=True)".format(repr(READY).replace("'", '"')),
        ]
        client = BridgeClient(command=command, startup_timeout_seconds=1, request_timeout_seconds=1)
        try:
            response = client.transform({"requestId": "request-1"})
            self.assertTrue(response["ok"])
            self.assertEqual(response["requestId"], "request-1")
        finally:
            client.close()

    def test_rejects_unpinned_ready_identity(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import json; print(json.dumps({'type':'bridge_ready','schemaVersion':1,'runtimeId':'wrong'}), flush=True)",
        ]
        client = BridgeClient(command=command, startup_timeout_seconds=1, request_timeout_seconds=1)
        with self.assertRaises(RuntimeError):
            client.transform({"requestId": "request-1"})
        client.close()

    def test_partial_ready_line_cannot_bypass_startup_deadline(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import sys,time; sys.stdout.write(chr(123)+chr(34)+'type'+chr(34)+':'); sys.stdout.flush(); time.sleep(3)",
        ]
        client = BridgeClient(command=command, startup_timeout_seconds=0.05, request_timeout_seconds=1)
        try:
            with self.assertRaises(TimeoutError):
                client.transform({"requestId": "request-1"})
        finally:
            client.close()

    def test_startup_timeout_is_separate_from_request_timeout(self) -> None:
        command = [
            sys.executable,
            "-c",
            "import time; time.sleep(2)",
        ]
        client = BridgeClient(command=command, startup_timeout_seconds=0.01, request_timeout_seconds=10)
        with self.assertRaises(TimeoutError):
            client.transform({"requestId": "request-1"})
        client.close()


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import consilium_gateway as gateway


class GatewayRuntimeSafetyTests(unittest.TestCase):
    def test_env_int_parses_and_clamps(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_TEST_INT": "-5"}, clear=False):
            value = gateway._env_int("CONSILIUM_TEST_INT", default=10, minimum=0)
        self.assertEqual(value, 0)

        with patch.dict(os.environ, {"CONSILIUM_TEST_INT": "abc"}, clear=False):
            value = gateway._env_int("CONSILIUM_TEST_INT", default=10, minimum=0)
        self.assertEqual(value, 10)

    def test_persist_active_run_is_best_effort_when_path_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bad_active_dir = Path(tmp) / "active"
            bad_active_dir.write_text("not-a-directory", encoding="utf-8")
            state = gateway.ActiveExecution(
                request_id="req-1",
                session_id="sess-1",
                plan_path="/tmp/plan.md",
                command="ralphex plan.md",
                pid=123,
                pgid=123,
                started_monotonic=time.monotonic(),
                last_activity_monotonic=time.monotonic(),
            )
            with patch.object(gateway, "_ACTIVE_RUNS_DIR", bad_active_dir):
                gateway._persist_active_run(state)

    def test_auth_failure_log_does_not_expose_secrets(self) -> None:
        api_key = "super-secret-api-key"
        bad_token = "wrong-secret-token"
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": api_key}, clear=False):
            with self.assertLogs("consilium.gateway", level="WARNING") as logs:
                with self.assertRaises(HTTPException) as ctx:
                    gateway._check_bearer_token(f"Bearer {bad_token}")
        self.assertEqual(ctx.exception.status_code, 401)
        rendered = "\n".join(logs.output)
        self.assertNotIn(api_key, rendered)
        self.assertNotIn(bad_token, rendered)


if __name__ == "__main__":
    unittest.main()

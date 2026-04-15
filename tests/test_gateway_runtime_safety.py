from __future__ import annotations

import os
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import consilium_gateway as gateway


class GatewayRuntimeSafetyTests(unittest.TestCase):
    def test_resolve_public_model_name_falls_back_for_blank_env(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_PUBLIC_MODEL": "   "}, clear=False):
            name = gateway._resolve_public_model_name()
        self.assertEqual(name, "consilium-auto")

    def test_extract_text_keeps_stream_token_chunks_contiguous(self) -> None:
        stdout = "\n".join(
            [
                'data: {"choices":[{"delta":{"content":"Hel"}}]}',
                'data: {"choices":[{"delta":{"content":"lo"}}]}',
                'data: {"choices":[{"delta":{"content":" world"}}]}',
            ]
        )
        text = gateway.RalphexTransport._extract_text(stdout)
        self.assertEqual(text, "Hello world")

    def test_extract_text_keeps_line_breaks_for_plain_logs(self) -> None:
        stdout = "starting task execution phase\n--- task iteration 1 ---"
        text = gateway.RalphexTransport._extract_text(stdout)
        self.assertEqual(text, "starting task execution phase\n--- task iteration 1 ---")

    def test_probe_version_command_uses_binary_only_for_env_template(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.binary_path = None
        transport.command_template = 'ralphex --review "$CONSILIUM_PLAN_FILE"'
        self.assertEqual(transport._probe_version_command(), "ralphex --version")

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

    def test_format_chat_response_integration_health_for_progress_log(self) -> None:
        raw = """
starting task execution phase
--- task iteration 1 ---
[26-04-15 02:45:05] <<<RALPHEX:ALL_TASKS_DONE>>>
all tasks completed, starting code review...
[26-04-15 02:45:05] task execution completed successfully
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, "Да, интеграция живая.")

    def test_format_chat_response_integration_health_with_failed_signal(self) -> None:
        raw = """
starting task execution phase
--- task iteration 1 ---
[26-04-15 02:45:05] <<<RALPHEX:TASK_FAILED>>>
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, "Нет, интеграция не живая.")

    def test_format_chat_response_passthrough_for_non_logs(self) -> None:
        raw = "Да, интеграция живая."
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, raw)

    def test_format_chat_response_does_not_rewrite_plain_text_with_log_phrase(self) -> None:
        raw = "Starting code review is useful for teams."
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Explain why code review helps",
        )
        self.assertEqual(text, raw)

    def test_format_chat_response_does_not_rewrite_inline_signal_explanation(self) -> None:
        raw = "Token <<<RALPHEX:ALL_TASKS_DONE>>> is a completion signal in logs."
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Explain this marker",
        )
        self.assertEqual(text, raw)

    def test_format_chat_response_health_check_for_signal_only_output(self) -> None:
        raw = "<<<RALPHEX:ALL_TASKS_DONE>>>"
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, "Да, интеграция живая.")

    def test_format_chat_response_health_check_for_inconclusive_log(self) -> None:
        raw = """
starting task execution phase
--- task iteration 1 ---
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, "Статус интеграции неизвестен.")

    def test_format_chat_response_health_check_with_duration_but_no_terminal_signal(self) -> None:
        raw = """
starting task execution phase
completed in 3.1s
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertEqual(text, "Статус интеграции неизвестен.")

    def test_format_chat_response_extracts_final_answer_from_mixed_log(self) -> None:
        raw = """
starting task execution phase
--- task iteration 1 ---
[26-04-15 02:45:05] <<<RALPHEX:ALL_TASKS_DONE>>>
Final answer: Короткий ответ пользователю.
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Дай короткий ответ",
        )
        self.assertEqual(text, "Короткий ответ пользователю.")

    def test_format_chat_response_summary_does_not_expose_branch_name(self) -> None:
        raw = """
starting task execution phase
completed in 9.2s
branch: feature/internal-ticket-123
[26-04-15 02:45:05] <<<RALPHEX:ALL_TASKS_DONE>>>
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Что по прогону?",
        )
        self.assertIn("Ralphex завершил прогон успешно.", text)
        self.assertIn("Длительность: 9.2s.", text)
        self.assertNotIn("feature/internal-ticket-123", text)
        self.assertNotIn("Branch:", text)

    def test_list_models_includes_default_model(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            payload = gateway.list_models(authorization="Bearer test-key")
        self.assertEqual(payload.get("object"), "list")
        ids = {item.get("id") for item in payload.get("data", [])}
        self.assertIn(gateway.DEFAULT_MODEL, ids)
        self.assertNotIn("gpt-5.3-codex", ids)

    def test_get_model_returns_404_for_unknown_id(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with self.assertRaises(HTTPException) as ctx:
                gateway.get_model("missing-model", authorization="Bearer test-key")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_list_models_allows_discovery_without_auth(self) -> None:
        payload = gateway.list_models(authorization=None, x_api_key=None)
        self.assertEqual(payload.get("object"), "list")
        ids = {item.get("id") for item in payload.get("data", [])}
        self.assertIn(gateway.DEFAULT_MODEL, ids)

    def test_chat_completion_accepts_x_api_key_header(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._pipe, "complete", return_value="ok"):
                response = gateway.chat_completions(
                    request,
                    authorization=None,
                    x_session_id=None,
                    x_api_key="test-key",
                )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["model"], gateway.DEFAULT_MODEL)

    def test_chat_completion_response_model_is_public_alias(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._pipe, "complete", return_value="ok"):
                response = gateway.chat_completions(request, authorization="Bearer test-key", x_session_id=None)
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["model"], gateway.DEFAULT_MODEL)

    def test_chat_completion_plain_hello_uses_full_pipeline(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._transport, "quick_probe", return_value="probe") as probe_mock:
                with patch.object(gateway._pipe, "complete", return_value="ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["choices"][0]["message"]["content"], "ok")
        complete_mock.assert_called_once()
        probe_mock.assert_not_called()

    def test_chat_completion_ping_endpoint_request_uses_full_pipeline(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="Add ping endpoint to API")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._transport, "quick_probe", return_value="probe") as probe_mock:
                with patch.object(gateway._pipe, "complete", return_value="ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["choices"][0]["message"]["content"], "ok")
        complete_mock.assert_called_once()
        probe_mock.assert_not_called()

    def test_chat_completion_plain_ping_uses_probe_path(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="ping")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._transport, "quick_probe", return_value="probe") as probe_mock:
                with patch.object(gateway._pipe, "complete", return_value="ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["choices"][0]["message"]["content"], "probe")
        probe_mock.assert_called_once()
        complete_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()

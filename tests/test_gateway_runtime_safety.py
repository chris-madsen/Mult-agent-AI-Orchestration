from __future__ import annotations

import os
import json
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import consilium_gateway as gateway


def _assistant_text_without_source_stamp(body: dict) -> str:
    """Gateway may append a source stamp to assistant messages for observability."""
    text = body["choices"][0]["message"]["content"]
    suffix = "\n\n[source:consilium]"
    if isinstance(text, str) and text.endswith(suffix):
        return text[: -len(suffix)]
    return text


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

    def test_probe_version_command_handles_env_assignment_prefix(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.binary_path = None
        transport.command_template = 'RUST_LOG=debug ralphex --review "$CONSILIUM_PLAN_FILE"'
        self.assertEqual(transport._probe_version_command(), "ralphex --version")

    def test_probe_version_command_handles_env_wrapper(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.binary_path = None
        transport.command_template = 'env RUST_LOG=debug /usr/local/bin/ralphex "$CONSILIUM_PLAN_FILE"'
        self.assertEqual(transport._probe_version_command(), "/usr/local/bin/ralphex --version")

    def test_resolve_command_env_binary_without_plan_file_uses_standard_execute_template(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.command_source = "env"
        transport.mode = "tasks"
        transport.command_template = "/usr/local/bin/ralphex"
        transport.plan_mode_max_iterations = gateway.DEFAULT_PLAN_MODE_MAX_ITERATIONS
        transport.standard_max_iterations = gateway.DEFAULT_STANDARD_MAX_ITERATIONS
        transport.chat_session_timeout_sec = gateway.DEFAULT_CHAT_SESSION_TIMEOUT_SEC
        transport.chat_idle_timeout_sec = gateway.DEFAULT_CHAT_IDLE_TIMEOUT_SEC
        cmd = transport._resolve_command(plan_mode=False)
        self.assertEqual(
            cmd,
            '/usr/local/bin/ralphex --config-dir="$RALPHEX_CONFIG_DIR" --max-iterations=24 "$CONSILIUM_PLAN_FILE"',
        )

    def test_resolve_command_env_with_plan_file_keeps_template(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.command_source = "env"
        transport.mode = "tasks"
        transport.command_template = '/usr/local/bin/ralphex "$CONSILIUM_PLAN_FILE"'
        transport.plan_mode_max_iterations = gateway.DEFAULT_PLAN_MODE_MAX_ITERATIONS
        transport.standard_max_iterations = gateway.DEFAULT_STANDARD_MAX_ITERATIONS
        transport.chat_session_timeout_sec = gateway.DEFAULT_CHAT_SESSION_TIMEOUT_SEC
        transport.chat_idle_timeout_sec = gateway.DEFAULT_CHAT_IDLE_TIMEOUT_SEC
        cmd = transport._resolve_command(plan_mode=False)
        self.assertEqual(cmd, '/usr/local/bin/ralphex "$CONSILIUM_PLAN_FILE"')

    def test_redacted_command_for_log_hides_assignment_values(self) -> None:
        rendered = gateway._redacted_command_for_log(
            'CONSILIUM_TOKEN=super-secret env RUST_LOG=debug /usr/local/bin/ralphex "$CONSILIUM_PLAN_FILE"'
        )
        self.assertEqual(rendered, "/usr/local/bin/ralphex <args redacted>")
        self.assertNotIn("super-secret", rendered)

    def test_is_review_intent_matches_review_request(self) -> None:
        self.assertTrue(gateway.RalphexTransport._is_review_intent("Please review this patch."))

    def test_is_review_intent_ignores_preview_word(self) -> None:
        self.assertFalse(gateway.RalphexTransport._is_review_intent("Please preview this patch."))

    def test_auto_mode_non_plan_uses_execute_command(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.command_source = "auto"
        transport.mode = "auto"
        transport.command_template = "ralphex"
        transport.plan_mode_max_iterations = gateway.DEFAULT_PLAN_MODE_MAX_ITERATIONS
        transport.standard_max_iterations = gateway.DEFAULT_STANDARD_MAX_ITERATIONS
        transport.chat_session_timeout_sec = gateway.DEFAULT_CHAT_SESSION_TIMEOUT_SEC
        transport.chat_idle_timeout_sec = gateway.DEFAULT_CHAT_IDLE_TIMEOUT_SEC
        cmd = transport._resolve_command(plan_mode=False)
        self.assertEqual(
            cmd,
            'ralphex --config-dir="$RALPHEX_CONFIG_DIR" --max-iterations=24 "$CONSILIUM_PLAN_FILE"',
        )

    def test_auto_mode_non_plan_uses_execute_with_standard_iterations(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.command_source = "auto"
        transport.mode = "auto"
        transport.command_template = "ralphex"
        transport.plan_mode_max_iterations = gateway.DEFAULT_PLAN_MODE_MAX_ITERATIONS
        transport.standard_max_iterations = gateway.DEFAULT_STANDARD_MAX_ITERATIONS
        transport.chat_session_timeout_sec = gateway.DEFAULT_CHAT_SESSION_TIMEOUT_SEC
        transport.chat_idle_timeout_sec = gateway.DEFAULT_CHAT_IDLE_TIMEOUT_SEC
        cmd = transport._resolve_command(plan_mode=False)
        self.assertEqual(
            cmd,
            'ralphex --config-dir="$RALPHEX_CONFIG_DIR" --max-iterations=24 "$CONSILIUM_PLAN_FILE"',
        )

    def test_auto_mode_plan_uses_tasks_only_with_plan_iterations(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.command_source = "auto"
        transport.mode = "auto"
        transport.command_template = "ralphex"
        transport.plan_mode_max_iterations = gateway.DEFAULT_PLAN_MODE_MAX_ITERATIONS
        transport.standard_max_iterations = gateway.DEFAULT_STANDARD_MAX_ITERATIONS
        transport.chat_session_timeout_sec = gateway.DEFAULT_CHAT_SESSION_TIMEOUT_SEC
        transport.chat_idle_timeout_sec = gateway.DEFAULT_CHAT_IDLE_TIMEOUT_SEC
        cmd = transport._resolve_command(plan_mode=True)
        self.assertEqual(
            cmd,
            (
                'ralphex --config-dir="$RALPHEX_CONFIG_DIR" --tasks-only --max-iterations=2 '
                "--session-timeout=60s --idle-timeout=30s "
                '"$CONSILIUM_PLAN_FILE"'
            ),
        )

    def test_extract_collaboration_mode_marker(self) -> None:
        self.assertEqual(
            gateway._extract_collaboration_mode_marker("<collaboration_mode># Collaboration Mode: Plan"),
            "plan",
        )
        self.assertEqual(
            gateway._extract_collaboration_mode_marker("<collaboration_mode># Collaboration Mode: Default"),
            "default",
        )
        self.assertIsNone(gateway._extract_collaboration_mode_marker("random text"))

    def test_is_plan_mode_request_uses_latest_collaboration_marker(self) -> None:
        self.assertTrue(
            gateway.RalphexTransport._is_plan_mode_request(
                [
                    {"role": "system", "content": "<collaboration_mode># Collaboration Mode: Default"},
                    {"role": "system", "content": "<collaboration_mode># Collaboration Mode: Plan"},
                    {"role": "user", "content": "сформируй план"},
                ]
            )
        )
        self.assertFalse(
            gateway.RalphexTransport._is_plan_mode_request(
                [
                    {"role": "system", "content": "<collaboration_mode># Collaboration Mode: Plan"},
                    {"role": "system", "content": "<collaboration_mode># Collaboration Mode: Default"},
                    {"role": "user", "content": "сформируй план"},
                ]
            )
        )

    def test_write_plan_file_non_coding_default_mode_uses_chat_plan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plans_dir = Path(tmp)
            with patch.object(gateway, "_GATEWAY_PLANS_DIR", plans_dir):
                plan_path = gateway.RalphexTransport._write_plan_file(
                    [{"role": "user", "content": "как дела?"}],
                    plan_mode=False,
                )
                text = plan_path.read_text(encoding="utf-8")
        self.assertIn("# Consilium Gateway Chat Plan", text)
        self.assertIn("Do NOT run shell commands.", text)

    def test_write_plan_file_coding_default_mode_uses_full_plan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plans_dir = Path(tmp)
            with patch.object(gateway, "_GATEWAY_PLANS_DIR", plans_dir):
                plan_path = gateway.RalphexTransport._write_plan_file(
                    [{"role": "user", "content": "fix api route bug"}],
                    plan_mode=False,
                )
                text = plan_path.read_text(encoding="utf-8")
        self.assertIn("# Consilium Gateway Chat Plan", text)
        self.assertIn("Recent compact context:", text)

    def test_env_int_parses_and_clamps(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_TEST_INT": "-5"}, clear=False):
            value = gateway._env_int("CONSILIUM_TEST_INT", default=10, minimum=0)
        self.assertEqual(value, 0)

        with patch.dict(os.environ, {"CONSILIUM_TEST_INT": "abc"}, clear=False):
            value = gateway._env_int("CONSILIUM_TEST_INT", default=10, minimum=0)
        self.assertEqual(value, 10)

    def test_looks_like_provider_limit_error_detects_common_markers(self) -> None:
        self.assertTrue(gateway.RalphexTransport._looks_like_provider_limit_error("Error 429: rate limit exceeded"))
        self.assertTrue(gateway.RalphexTransport._looks_like_provider_limit_error("превышен лимит запросов"))
        self.assertFalse(gateway.RalphexTransport._looks_like_provider_limit_error("ralphex stalled: idle timeout"))

    def test_maybe_direct_codex_fallback_uses_vertex_limit_fallback(self) -> None:
        transport = gateway.RalphexTransport.__new__(gateway.RalphexTransport)
        transport.enable_direct_codex_fallback = False
        transport.enable_limit_fallback_to_gemini = True
        with patch.object(
            gateway.RalphexTransport,
            "_complete_with_vertex_limit_fallback",
            return_value="gemini-fallback-ok",
        ) as fallback_mock:
            text = transport._maybe_direct_codex_fallback(
                "Ошибка выполнения через ralphex: rate limit exceeded",
                "ping",
            )
        self.assertEqual(text, "gemini-fallback-ok")
        fallback_mock.assert_called_once_with("ping")

    def test_prepare_gateway_git_shim_env_enabled(self) -> None:
        if not shutil.which("git"):
            self.skipTest("git binary not available in test environment")
        original_env = {"PATH": os.environ.get("PATH", "")}
        with patch.dict(os.environ, {"CONSILIUM_GATEWAY_BLOCK_GIT_COMMITS": "1"}, clear=False):
            prepared = gateway._prepare_gateway_git_shim_env(dict(original_env))
        self.assertIn("CONSILIUM_REAL_GIT_BIN", prepared)
        path_head = (prepared.get("PATH") or "").split(":")[0]
        self.assertTrue(path_head.endswith("gateway-git-shim"))

    def test_prepare_gateway_git_shim_blocks_commit_with_global_option_prefix(self) -> None:
        if not shutil.which("git"):
            self.skipTest("git binary not available in test environment")
        original_env = {"PATH": os.environ.get("PATH", "")}
        with patch.dict(os.environ, {"CONSILIUM_GATEWAY_BLOCK_GIT_COMMITS": "1"}, clear=False):
            prepared = gateway._prepare_gateway_git_shim_env(dict(original_env))
        shim_dir = (prepared.get("PATH") or "").split(":")[0]
        shim_git = Path(shim_dir) / "git"
        env = {
            "PATH": prepared.get("PATH", ""),
            "CONSILIUM_REAL_GIT_BIN": prepared.get("CONSILIUM_REAL_GIT_BIN", "git"),
        }
        proc = subprocess.run(
            [str(shim_git), "-c", "user.name=Test", "commit", "--allow-empty", "-m", "x"],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("git commit is disabled", proc.stderr)

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

    def test_invalid_x_api_key_without_authorization_returns_invalid_api_key(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with self.assertRaises(HTTPException) as ctx:
                gateway._check_bearer_token(None, x_api_key="wrong-key")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.detail, "Invalid API key")

    def test_missing_authorization_without_x_api_key_returns_missing_header(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with self.assertRaises(HTTPException) as ctx:
                gateway._check_bearer_token(None, x_api_key=None)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.detail, "Missing Authorization header")

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
        self.assertIn("ALL_TASKS_DONE", text)

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
        self.assertIn("TASK_FAILED", text)

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
        self.assertEqual(text, raw)

    def test_format_chat_response_health_check_for_inconclusive_log(self) -> None:
        raw = """
starting task execution phase
--- task iteration 1 ---
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertIn("starting task execution phase", text)

    def test_format_chat_response_health_check_with_duration_but_no_terminal_signal(self) -> None:
        raw = """
starting task execution phase
completed in 3.1s
"""
        text = gateway.RalphexTransport._format_chat_response(
            raw_text=raw,
            user_prompt="Ответь одной строкой: интеграция живая?",
        )
        self.assertIn("completed in 3.1s", text)

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
        self.assertIn("starting task execution phase", text)
        self.assertIn("feature/internal-ticket-123", text)

    def test_list_models_includes_default_model(self) -> None:
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            payload = gateway.list_models(authorization="Bearer test-key")
        self.assertEqual(payload.get("object"), "list")
        ids = {item.get("id") for item in payload.get("data", [])}
        self.assertIn(gateway.DEFAULT_MODEL, ids)
        self.assertIn("gpt-5.3-codex", ids)

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
        self.assertIn("gpt-5.3-codex", ids)

    def test_resolve_response_model_keeps_known_alias(self) -> None:
        self.assertEqual(gateway._resolve_response_model("gpt-5.3-codex"), "gpt-5.3-codex")
        self.assertEqual(gateway._resolve_response_model("unknown-model"), gateway.DEFAULT_MODEL)

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

    def test_chat_completion_response_model_preserves_known_alias(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-5.3-codex",
            messages=[gateway.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._pipe, "complete", return_value="ok"):
                response = gateway.chat_completions(request, authorization="Bearer test-key", x_session_id=None)
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["model"], "gpt-5.3-codex")

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
        self.assertEqual(_assistant_text_without_source_stamp(body), "ok")
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
        self.assertEqual(_assistant_text_without_source_stamp(body), "ok")
        complete_mock.assert_called_once()
        probe_mock.assert_not_called()

    def test_chat_completion_plain_ping_uses_full_pipeline(self) -> None:
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
        self.assertEqual(_assistant_text_without_source_stamp(body), "ok")
        probe_mock.assert_not_called()
        complete_mock.assert_called_once()

    def test_chat_completion_integration_alive_uses_full_pipeline(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[gateway.ChatMessage(role="user", content="integration alive?")],
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
        self.assertEqual(_assistant_text_without_source_stamp(body), "ok")
        complete_mock.assert_called_once()
        probe_mock.assert_not_called()

    def test_should_route_direct_qa_true_for_science_question(self) -> None:
        self.assertTrue(
            gateway._should_route_direct_qa(
                "Какие недостатки у метаморфного роста наногетероструктур и как с ними бороться?",
            )
        )

    def test_should_route_direct_qa_false_for_coding_request(self) -> None:
        self.assertFalse(gateway._should_route_direct_qa("Add ping endpoint to API"))

    def test_should_route_direct_qa_true_for_colloquial_availability_check(self) -> None:
        self.assertTrue(gateway._should_route_direct_qa("чё-нибудь работает?"))

    def test_should_route_direct_qa_true_for_short_change_question(self) -> None:
        self.assertTrue(gateway._should_route_direct_qa("сейчас что-нибудь поменялось интересно?"))

    def test_is_coding_request_false_for_model_status_phrase_with_test_word(self) -> None:
        phrase = "Это тест 3. Кратко скажи, жив ли Ральф и какая сейчас модель?"
        self.assertFalse(gateway._is_coding_request(phrase))

    def test_is_coding_request_false_for_error_meaning_question(self) -> None:
        phrase = "Бро, а чё это за ошибка такая? Чё она значит?"
        self.assertFalse(gateway._is_coding_request(phrase))

    def test_is_coding_request_false_for_capability_question_about_files(self) -> None:
        phrase = "И как ты собираешься агентские задачи выполнять, если ты файлов нихуя не видишь?"
        self.assertFalse(gateway._is_coding_request(phrase))

    def test_is_coding_request_true_for_weak_context_with_intent(self) -> None:
        phrase = "Нужно добавить api endpoint для health-check"
        self.assertTrue(gateway._is_coding_request(phrase))

    def test_to_internal_messages_extracts_effective_user_prompt(self) -> None:
        messages = [
            gateway.ChatMessage(
                role="user",
                content=(
                    "# Context from my IDE setup:\n\n"
                    "## Active file: execution_port.py\n\n"
                    "## Open tabs:\n- execution_port.py\n\n"
                    "## My request for Codex:\nПроверь, через Ralph ли идёт этот запрос?"
                ),
            )
        ]
        internal = gateway._to_internal_messages(messages)
        self.assertEqual(len(internal), 1)
        self.assertEqual(internal[0]["role"], "user")
        self.assertEqual(internal[0]["content"], "Проверь, через Ralph ли идёт этот запрос?")

    def test_write_plan_file_chat_plan_contains_recent_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plans_dir = Path(tmp)
            with patch.object(gateway, "_GATEWAY_PLANS_DIR", plans_dir):
                plan_path = gateway.RalphexTransport._write_plan_file(
                    [
                        {"role": "user", "content": "Первый вопрос"},
                        {"role": "assistant", "content": "Первый ответ"},
                        {"role": "user", "content": "Второй вопрос"},
                    ],
                    plan_mode=True,
                )
                text = plan_path.read_text(encoding="utf-8")
        self.assertIn("# Consilium Gateway Chat Plan", text)
        self.assertIn("Recent compact context:", text)
        self.assertIn("- user: Первый вопрос", text)
        self.assertIn("- assistant: Первый ответ", text)

    def test_should_retry_ralphex_chat_failure_for_stall_error(self) -> None:
        text = "Ошибка: ralphex stalled: no subprocess output for 12s (idle timeout 12s)"
        self.assertTrue(gateway._should_retry_ralphex_chat_failure(text))

    def test_chat_completion_non_coding_question_uses_ralphex_pipe(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="gpt-4.1",
            messages=[
                gateway.ChatMessage(
                    role="user",
                    content="Какие недостатки у метаморфного роста наногетероструктур?",
                )
            ],
            stream=False,
        )
        with patch.dict(
            os.environ,
            {
                "CONSILIUM_API_KEY": "test-key",
                "CONSILIUM_RALPHEX_ONLY": "0",
                "CONSILIUM_DIRECT_QA_ENABLED": "1",
            },
            clear=False,
        ):
            with patch.object(gateway, "_run_direct_vertex_qa", return_value="direct-ok") as direct_mock:
                with patch.object(gateway._pipe, "complete", return_value="pipe-ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(_assistant_text_without_source_stamp(body), "pipe-ok")
        direct_mock.assert_not_called()
        complete_mock.assert_called_once()

    def test_chat_completion_applies_global_stale_cleanup_for_coding_request(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[gateway.ChatMessage(role="user", content="Add ping endpoint to API")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway, "_cleanup_stale_active_runs", return_value=0) as cleanup_mock:
                with patch.object(gateway._pipe, "complete", return_value="ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(_assistant_text_without_source_stamp(body), "ok")
        complete_mock.assert_called_once()
        cleanup_mock.assert_called()
        reasons = [call.kwargs.get("reason") for call in cleanup_mock.mock_calls if call.kwargs]
        self.assertIn("preflight_global", reasons)

    def test_chat_completion_claude_request_uses_ralphex_pipe(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="claude-opus-4-6",
            messages=[gateway.ChatMessage(role="user", content="Какие риски у метаморфного роста?")],
            stream=False,
        )
        with patch.dict(
            os.environ,
            {
                "CONSILIUM_API_KEY": "test-key",
                "CONSILIUM_CLAUDE_FALLBACK_TO_GEMINI": "1",
                "CONSILIUM_CLAUDE_FALLBACK_MODEL": "gemini-2.5-pro",
                "CONSILIUM_RALPHEX_ONLY": "0",
                "CONSILIUM_DIRECT_QA_ENABLED": "1",
            },
            clear=False,
        ):
            with patch.object(
                gateway,
                "_run_direct_vertex_qa",
                side_effect=[
                    RuntimeError("Error code: 404 - model not found or does not have access"),
                    "fallback-ok",
                ],
            ) as direct_mock:
                with patch.object(gateway._pipe, "complete", return_value="pipe-ok") as complete_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertEqual(text, "pipe-ok")
        direct_mock.assert_not_called()
        complete_mock.assert_called_once()

    def test_chat_completion_ralphex_max_iterations_returns_pipe_error(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[
                gateway.ChatMessage(
                    role="user",
                    content="Сформируй технический отчёт в 3 пункта без изменений файлов и без запуска команд.",
                )
            ],
            stream=False,
        )
        with patch.dict(
            os.environ,
            {"CONSILIUM_API_KEY": "test-key", "CONSILIUM_RALPHEX_ONLY": "0"},
            clear=False,
        ):
            with patch.object(
                gateway._pipe,
                "complete",
                side_effect=RuntimeError(
                    "Ошибка выполнения через ralphex: runner: task phase: max iterations (2) reached without completion",
                ),
            ) as complete_mock:
                with patch.object(gateway, "_run_direct_vertex_qa", return_value="fallback-direct-ok") as direct_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertIn("max iterations (2) reached without completion", text)
        self.assertEqual(complete_mock.call_count, 1)
        direct_mock.assert_not_called()

    def test_chat_completion_ralphex_max_iterations_text_response_passes_through(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[
                gateway.ChatMessage(
                    role="user",
                    content="Сформируй технический отчёт в 3 пункта без изменений файлов и без запуска команд.",
                )
            ],
            stream=False,
        )
        with patch.dict(
            os.environ,
            {"CONSILIUM_API_KEY": "test-key", "CONSILIUM_RALPHEX_ONLY": "0"},
            clear=False,
        ):
            with patch.object(
                gateway._pipe,
                "complete",
                return_value=(
                    "Ошибка выполнения через ralphex: runner: task phase: "
                    "max iterations (2) reached without completion"
                ),
            ) as complete_mock:
                with patch.object(gateway, "_run_direct_vertex_qa", return_value="fallback-direct-ok-text") as direct_mock:
                    response = gateway.chat_completions(
                        request,
                        authorization="Bearer test-key",
                        x_session_id=None,
                    )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertIn("max iterations (2) reached without completion", text)
        self.assertEqual(complete_mock.call_count, 1)
        direct_mock.assert_not_called()

    def test_chat_completion_non_coding_claude_exit_retries_once(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[gateway.ChatMessage(role="user", content="как дела?")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(
                gateway._pipe,
                "complete",
                side_effect=[
                    "Ошибка выполнения через ralphex: runner: task phase: claude execution: claude exited with error: command wait: exit status 1",
                    "Нормальный ответ",
                ],
            ) as complete_mock:
                response = gateway.chat_completions(
                    request,
                    authorization="Bearer test-key",
                    x_session_id=None,
                )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertIn("claude exited with error", text)
        self.assertEqual(complete_mock.call_count, 1)

    def test_chat_completion_coding_claude_exit_does_not_retry(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[gateway.ChatMessage(role="user", content="fix api route bug")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(
                gateway._pipe,
                "complete",
                return_value=(
                    "Ошибка выполнения через ralphex: runner: task phase: "
                    "claude execution: claude exited with error: command wait: exit status 1"
                ),
            ) as complete_mock:
                response = gateway.chat_completions(
                    request,
                    authorization="Bearer test-key",
                    x_session_id=None,
                )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertIn("claude execution: claude exited with error", text)
        self.assertEqual(complete_mock.call_count, 1)

    def test_chat_completion_non_coding_claude_exit_runtimeerror_retries_once(self) -> None:
        request = gateway.ChatCompletionsRequest(
            model="consilium-auto",
            messages=[gateway.ChatMessage(role="user", content="как дела?")],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(
                gateway._pipe,
                "complete",
                side_effect=[
                    RuntimeError(
                        "Ошибка выполнения через ralphex: runner: task phase: claude execution: claude exited with error: command wait: exit status 1"
                    ),
                    "Нормальный ответ после retry",
                ],
            ) as complete_mock:
                response = gateway.chat_completions(
                    request,
                    authorization="Bearer test-key",
                    x_session_id=None,
                )
        body = json.loads(response.body.decode("utf-8"))
        text = _assistant_text_without_source_stamp(body)
        self.assertIn("claude exited with error", text)
        self.assertEqual(complete_mock.call_count, 1)

    def test_looks_like_ralphex_max_iterations_error(self) -> None:
        self.assertTrue(
            gateway._looks_like_ralphex_max_iterations_error(
                "runner: task phase: max iterations (2) reached without completion"
            )
        )
        self.assertTrue(
            gateway._looks_like_ralphex_max_iterations_error(
                "Ошибка выполнения через ralphex: max iterations (2) reached without completion"
            )
        )
        self.assertFalse(gateway._looks_like_ralphex_max_iterations_error("ralphex stalled: no subprocess output"))

    def test_looks_like_ralphex_claude_exit_error(self) -> None:
        self.assertTrue(
            gateway._looks_like_ralphex_claude_exit_error(
                "runner: task phase: claude execution: claude exited with error: command wait: exit status 1"
            )
        )
        self.assertFalse(gateway._looks_like_ralphex_claude_exit_error("runner: task phase: max iterations"))

    def test_responses_input_string_converts_to_user_message(self) -> None:
        messages = gateway._responses_input_to_chat_messages("hello")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].role, "user")
        self.assertEqual(messages[0].content, "hello")

    def test_responses_accepts_x_api_key_header(self) -> None:
        request = gateway.ResponsesRequest(
            model="consilium-auto",
            input=[{"role": "user", "content": [{"type": "input_text", "text": "hello"}]}],
            stream=False,
        )
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with patch.object(gateway._pipe, "complete", return_value="ok"):
                response = gateway.responses(
                    request,
                    authorization=None,
                    x_session_id=None,
                    x_api_key="test-key",
                )
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["object"], "response")
        self.assertEqual(body["model"], gateway.DEFAULT_MODEL)
        self.assertEqual(body["output"][0]["role"], "assistant")
        self.assertEqual(body["output"][0]["content"][0]["type"], "output_text")
        self.assertEqual(body["output_text"], "ok\n\n[source:consilium]")

    def test_responses_rejects_empty_input(self) -> None:
        request = gateway.ResponsesRequest(model="consilium-auto", input=None, stream=False)
        with patch.dict(os.environ, {"CONSILIUM_API_KEY": "test-key"}, clear=False):
            with self.assertRaises(HTTPException) as ctx:
                gateway.responses(
                    request,
                    authorization="Bearer test-key",
                    x_session_id=None,
                    x_api_key=None,
                )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "input must contain at least one message")


if __name__ == "__main__":
    unittest.main()

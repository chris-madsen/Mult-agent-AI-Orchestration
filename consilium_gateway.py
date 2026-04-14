from __future__ import annotations

import json
import logging
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time
import uuid
from glob import glob
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

import autogen
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from execution_port import RalphexAdapter
from model_config import load_runtime_config

DEFAULT_API_KEY = "consilium-mvp-key"
DEFAULT_MODEL = "ralphex-mcp"
MAX_SESSION_MESSAGES = 80
DEFAULT_TIMEOUT_SEC = 1200
DEFAULT_IDLE_TIMEOUT_SEC = 300
DEFAULT_HEARTBEAT_SEC = 15
DEFAULT_IDLE_WARN_SEC = 45
LOGGER = logging.getLogger("consilium.gateway")
logging.basicConfig(level=os.getenv("CONSILIUM_GATEWAY_LOG_LEVEL", "INFO"))
_GATEWAY_PLANS_DIR = pathlib.Path(".consilium/gateway/plans")
_RALPHEX_CONFIG_DIR = pathlib.Path(".consilium/ralphex")
_CODEX_SANDBOX = os.getenv("CONSILIUM_CODEX_SANDBOX", "danger-full-access")
_ACTIVE_RUNS_DIR = pathlib.Path(".consilium/gateway/active")


def _resolve_ralphex_binary() -> str | None:
    user = os.getenv("USER", "").strip()
    store_candidates = sorted(glob("/nix/store/*-ralphex-*/bin/ralphex"), reverse=True)
    if not store_candidates:
        store_candidates = sorted(glob("/nix/store/*ralphex*/bin/ralphex"), reverse=True)

    candidates = [
        shutil.which("ralphex"),
        os.path.join(os.path.expanduser("~"), ".nix-profile", "bin", "ralphex"),
        f"/etc/profiles/per-user/{user}/bin/ralphex" if user else None,
        "/run/current-system/sw/bin/ralphex",
        *store_candidates,
    ]
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return max(minimum, value)


def _active_run_path(request_id: str) -> pathlib.Path:
    return _ACTIVE_RUNS_DIR / f"{request_id}.json"


def _persist_active_run(state: ActiveExecution) -> None:
    try:
        _ACTIVE_RUNS_DIR.mkdir(parents=True, exist_ok=True)
        now = time.monotonic()
        payload = {
            "request_id": state.request_id,
            "session_id": state.session_id,
            "pid": state.pid,
            "pgid": state.pgid,
            "phase": state.phase,
            "elapsed_sec": round(now - state.started_monotonic, 1),
            "idle_sec": round(now - state.last_activity_monotonic, 1),
            "stdout_bytes": state.stdout_bytes,
            "stderr_bytes": state.stderr_bytes,
            "plan_path": state.plan_path,
            "command": state.command,
        }
        target = _active_run_path(state.request_id)
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(target)
    except OSError as exc:
        LOGGER.warning(
            "active_run_persist_failed request_id=%s path=%s error=%s",
            state.request_id,
            str(_ACTIVE_RUNS_DIR),
            str(exc),
        )


def _register_active_run(state: ActiveExecution) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE_EXECUTIONS[state.request_id] = state
    _persist_active_run(state)


def _update_active_run(state: ActiveExecution, persist: bool = False) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE_EXECUTIONS[state.request_id] = state
    if persist:
        _persist_active_run(state)


def _clear_active_run(request_id: str) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE_EXECUTIONS.pop(request_id, None)
    try:
        _active_run_path(request_id).unlink()
    except FileNotFoundError:
        pass


def _active_runs_snapshot() -> list[dict]:
    now = time.monotonic()
    with _ACTIVE_LOCK:
        active = list(_ACTIVE_EXECUTIONS.values())
    result: list[dict] = []
    for state in active:
        result.append(
            {
                "request_id": state.request_id,
                "session_id": state.session_id,
                "pid": state.pid,
                "pgid": state.pgid,
                "phase": state.phase,
                "elapsed_sec": round(now - state.started_monotonic, 1),
                "idle_sec": round(now - state.last_activity_monotonic, 1),
                "stdout_bytes": state.stdout_bytes,
                "stderr_bytes": state.stderr_bytes,
                "plan_path": state.plan_path,
            }
        )
    result.sort(key=lambda item: item["elapsed_sec"], reverse=True)
    return result


def _kill_process_group(pgid: int, sig: signal.Signals) -> None:
    try:
        os.killpg(pgid, sig)
    except ProcessLookupError:
        return
    except PermissionError:
        return


def _terminate_process_group(pgid: int, grace_sec: float = 2.0) -> None:
    _kill_process_group(pgid, signal.SIGTERM)
    deadline = time.monotonic() + grace_sec
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            return
        time.sleep(0.1)
    _kill_process_group(pgid, signal.SIGKILL)


class ChatMessage(BaseModel):
    role: str
    content: str | list[dict] | None = ""


class ChatCompletionsRequest(BaseModel):
    model: str = DEFAULT_MODEL
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    user: str | None = None


@dataclass
class SessionState:
    history: list[dict[str, str]] = field(default_factory=list)


_SESSION_LOCK = threading.Lock()
_SESSIONS: dict[str, SessionState] = {}


@dataclass
class ActiveExecution:
    request_id: str
    session_id: str
    plan_path: str
    command: str
    pid: int
    pgid: int
    started_monotonic: float
    last_activity_monotonic: float
    phase: str = "starting"
    stdout_bytes: int = 0
    stderr_bytes: int = 0


_ACTIVE_LOCK = threading.Lock()
_ACTIVE_EXECUTIONS: dict[str, ActiveExecution] = {}


class RalphexTransport:
    """Thin subprocess transport. Command is configurable via CONSILIUM_RALPHEX_CMD."""

    def __init__(self) -> None:
        runtime = load_runtime_config()
        self.model = runtime.model_for("implementer").model
        self._adapter_bootstrap = RalphexAdapter(model=self.model)
        self.mode = (os.getenv("CONSILIUM_RALPHEX_MODE", "review") or "review").strip().lower()
        if self.mode not in {"review", "execute"}:
            self.mode = "review"
        configured = os.getenv("CONSILIUM_RALPHEX_CMD", "").strip()
        self.command_source = "env" if configured else "auto"
        self.binary_path: str | None = None
        if configured:
            self.command = configured
        else:
            binary = _resolve_ralphex_binary()
            if binary:
                self.binary_path = binary
                base = shlex.quote(binary)
                if self.mode == "review":
                    self.command = f'{base} --review "$CONSILIUM_PLAN_FILE"'
                else:
                    self.command = f'{base} "$CONSILIUM_PLAN_FILE"'
            else:
                self.command_source = "default"
                if self.mode == "review":
                    self.command = 'ralphex --review "$CONSILIUM_PLAN_FILE"'
                else:
                    self.command = 'ralphex "$CONSILIUM_PLAN_FILE"'
        self.timeout_sec = _env_int("CONSILIUM_RALPHEX_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC, minimum=1)
        self.idle_timeout_sec = _env_int("CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC", DEFAULT_IDLE_TIMEOUT_SEC, minimum=0)
        self.heartbeat_sec = _env_int("CONSILIUM_RALPHEX_HEARTBEAT_SEC", DEFAULT_HEARTBEAT_SEC, minimum=1)
        self.idle_warn_sec = _env_int("CONSILIUM_RALPHEX_IDLE_WARN_SEC", DEFAULT_IDLE_WARN_SEC, minimum=1)

    def execute(self, messages: list[dict[str, str]], session_id: str, request_id: str) -> str:
        plan_path = self._write_plan_file(messages)
        task_json = json.dumps(messages, ensure_ascii=False)
        env = os.environ.copy()
        env["CONSILIUM_TASK_JSON"] = task_json
        env["CONSILIUM_PLAN_FILE"] = str(plan_path.resolve())
        env["RALPHEX_CONFIG_DIR"] = str(_RALPHEX_CONFIG_DIR.resolve())
        env["CODEX_MODEL"] = self.model
        env["CODEX_SANDBOX"] = _CODEX_SANDBOX
        env.setdefault("CODEX_VERBOSE", "0")
        self._adapter_bootstrap._ensure_ralphex_codex_bridge()

        proc = subprocess.Popen(
            ["bash", "-lc", self.command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
        if proc.stdout is not None:
            os.set_blocking(proc.stdout.fileno(), False)
        if proc.stderr is not None:
            os.set_blocking(proc.stderr.fileno(), False)

        def _read_available(pipe) -> bytes:
            if pipe is None:
                return b""
            try:
                return os.read(pipe.fileno(), 4096)
            except BlockingIOError:
                return b""

        def _drain_pipe(pipe) -> bytes:
            chunks: list[bytes] = []
            while True:
                chunk = _read_available(pipe)
                if not chunk:
                    break
                chunks.append(chunk)
            return b"".join(chunks)

        pgid = os.getpgid(proc.pid)
        now = time.monotonic()
        state = ActiveExecution(
            request_id=request_id,
            session_id=session_id,
            plan_path=str(plan_path.resolve()),
            command=self.command,
            pid=proc.pid,
            pgid=pgid,
            started_monotonic=now,
            last_activity_monotonic=now,
            phase="running_waiting_output",
        )
        _register_active_run(state)
        LOGGER.info(
            "transport_started request_id=%s session_id=%s pid=%s pgid=%s timeout_sec=%s idle_timeout_sec=%s mode=%s",
            request_id,
            session_id,
            str(proc.pid),
            str(pgid),
            str(self.timeout_sec),
            str(self.idle_timeout_sec),
            self.mode,
        )
        heartbeat_deadline = now + self.heartbeat_sec
        stdout_chunks: list[bytes] = []
        stderr_chunks: list[bytes] = []

        try:
            while True:
                now = time.monotonic()
                if now >= heartbeat_deadline:
                    idle_sec = now - state.last_activity_monotonic
                    if idle_sec >= self.idle_warn_sec:
                        state.phase = "running_no_output"
                    _update_active_run(state, persist=True)
                    LOGGER.info(
                        "transport_heartbeat request_id=%s session_id=%s pid=%s pgid=%s phase=%s elapsed_sec=%.1f idle_sec=%.1f stdout_bytes=%d stderr_bytes=%d",
                        state.request_id,
                        state.session_id,
                        str(state.pid),
                        str(state.pgid),
                        state.phase,
                        now - state.started_monotonic,
                        idle_sec,
                        state.stdout_bytes,
                        state.stderr_bytes,
                    )
                    heartbeat_deadline = now + self.heartbeat_sec

                elapsed = now - state.started_monotonic
                idle = now - state.last_activity_monotonic
                if elapsed >= self.timeout_sec:
                    _terminate_process_group(pgid)
                    raise subprocess.TimeoutExpired(cmd=self.command, timeout=self.timeout_sec)
                if self.idle_timeout_sec > 0 and idle >= self.idle_timeout_sec:
                    _terminate_process_group(pgid)
                    raise RuntimeError(
                        f"ralphex stalled: no subprocess output for {int(idle)}s "
                        f"(idle timeout {self.idle_timeout_sec}s)"
                    )

                if proc.poll() is not None:
                    break

                chunk_read = False
                chunk = _read_available(proc.stdout)
                if chunk:
                    chunk_read = True
                    stdout_chunks.append(chunk)
                    state.stdout_bytes += len(chunk)

                chunk = _read_available(proc.stderr)
                if chunk:
                    chunk_read = True
                    stderr_chunks.append(chunk)
                    state.stderr_bytes += len(chunk)

                if chunk_read:
                    now = time.monotonic()
                    state.last_activity_monotonic = now
                    state.phase = "running_output_flow"
                    _update_active_run(state, persist=False)
                else:
                    time.sleep(0.1)

            remainder = _drain_pipe(proc.stdout)
            if remainder:
                stdout_chunks.append(remainder)
                state.stdout_bytes += len(remainder)

            remainder = _drain_pipe(proc.stderr)
            if remainder:
                stderr_chunks.append(remainder)
                state.stderr_bytes += len(remainder)
        finally:
            _clear_active_run(request_id)
            if proc.poll() is None:
                _terminate_process_group(pgid)
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                _terminate_process_group(pgid)
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            finally:
                if proc.stdout is not None:
                    proc.stdout.close()
                if proc.stderr is not None:
                    proc.stderr.close()

        stdout_text = b"".join(stdout_chunks).decode("utf-8", errors="replace")
        stderr_text = b"".join(stderr_chunks).decode("utf-8", errors="replace")

        LOGGER.info(
            "transport_finished request_id=%s session_id=%s pid=%s pgid=%s returncode=%s elapsed_sec=%.1f stdout_bytes=%d stderr_bytes=%d",
            request_id,
            session_id,
            str(proc.pid),
            str(pgid),
            str(proc.returncode),
            time.monotonic() - state.started_monotonic,
            len(stdout_text.encode("utf-8")),
            len(stderr_text.encode("utf-8")),
        )

        if proc.returncode != 0:
            stderr = stderr_text.strip()
            stdout = stdout_text.strip()
            details = stderr or stdout or f"exit code {proc.returncode}"
            if proc.returncode == 127 and "not found" in details.lower():
                raise RuntimeError(
                    "ralphex binary not found in runtime PATH. "
                    "Install ralphex in your user profile or set CONSILIUM_RALPHEX_CMD explicitly."
                )
            raise RuntimeError(f"ralphex command failed: {details}")

        text = self._extract_text(stdout_text)
        if not text.strip():
            text = stdout_text.strip()
        if not text.strip():
            raise RuntimeError("ralphex returned empty response")
        user_prompt = ""
        for item in reversed(messages):
            if (item.get("role") or "").strip().lower() == "user":
                user_prompt = (item.get("content") or "").strip()
                break
        return self._format_chat_response(text.strip(), user_prompt=user_prompt)

    @staticmethod
    def _write_plan_file(messages: list[dict[str, str]]) -> pathlib.Path:
        _GATEWAY_PLANS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        plan_path = _GATEWAY_PLANS_DIR / f"gateway-{ts}-{uuid.uuid4().hex[:8]}.md"

        # Keep recent context compact so Ralphex gets stable input and bounded size.
        tail = messages[-20:]
        lines = ["# Consilium Gateway Task", "", "## Conversation Context", ""]
        for item in tail:
            role = (item.get("role") or "user").strip().lower()
            content = (item.get("content") or "").strip()
            if not content:
                continue
            lines.append(f"### {role}")
            lines.append(content)
            lines.append("")
        lines.extend(
            [
                "## Instruction",
                "Use full Ralphex pipeline and provide final assistant response for the latest user request.",
                "",
            ]
        )
        plan_path.write_text("\n".join(lines), encoding="utf-8")
        return plan_path

    @staticmethod
    def _extract_text(stdout: str) -> str:
        chunks: list[str] = []
        for raw_line in stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            # Try OpenAI-like stream chunks first.
            if line.startswith("data:"):
                line = line[5:].strip()
                if line == "[DONE]":
                    continue
            if not (line.startswith("{") and line.endswith("}")):
                chunks.append(raw_line)
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                chunks.append(raw_line)
                continue
            if isinstance(payload, dict):
                delta = payload.get("delta") or {}
                if isinstance(delta, dict) and isinstance(delta.get("text"), str):
                    chunks.append(delta["text"])
                    continue
                choices = payload.get("choices")
                if isinstance(choices, list):
                    for choice in choices:
                        if not isinstance(choice, dict):
                            continue
                        delta_obj = choice.get("delta") or {}
                        if isinstance(delta_obj, dict) and isinstance(delta_obj.get("content"), str):
                            chunks.append(delta_obj["content"])
        return "".join(chunks)

    @staticmethod
    def _looks_like_ralphex_log(raw_text: str) -> bool:
        normalized = raw_text.lower()
        markers = (
            "starting ralphex loop",
            "starting task execution phase",
            "starting code review",
            "all tasks completed, starting code review",
            "task execution completed successfully",
            "--- task iteration",
            "--- claude review",
            "<<<ralphex:",
        )
        return any(marker in normalized for marker in markers)

    @staticmethod
    def _format_chat_response(raw_text: str, user_prompt: str) -> str:
        if not raw_text:
            return raw_text
        # If output is already concise/non-ralphex logs, keep as is.
        if not RalphexTransport._looks_like_ralphex_log(raw_text):
            return raw_text

        duration_match = re.search(r"completed in ([^\n]+)", raw_text, flags=re.IGNORECASE)
        duration = duration_match.group(1).strip() if duration_match else None

        branch_match = None
        for match in re.finditer(r"branch:\s*([^\n]+)", raw_text, flags=re.IGNORECASE):
            branch_match = match
        branch = branch_match.group(1).strip() if branch_match else None

        raw_upper = raw_text.upper()
        raw_lower = raw_text.lower()
        no_issues = "NO ISSUES FOUND" in raw_upper
        all_done = "ALL_TASKS_DONE" in raw_upper
        review_done = "REVIEW_DONE" in raw_upper
        codex_done = "CODEX_REVIEW_DONE" in raw_upper
        task_failed = "TASK_FAILED" in raw_upper
        success = (
            "all phases completed successfully" in raw_lower
            or "review phases completed successfully" in raw_lower
            or "task execution completed successfully" in raw_lower
            or "all tasks completed" in raw_lower
            or all_done
            or review_done
            or codex_done
            or no_issues
            or duration is not None
        ) and not task_failed

        # Targeted integration-status answer for direct health checks.
        normalized_user = (user_prompt or "").strip().lower()
        if ("интеграци" in normalized_user and "жив" in normalized_user) or (
            "integration" in normalized_user
            and ("alive" in normalized_user or "working" in normalized_user or "live" in normalized_user)
        ):
            return "Да, интеграция живая." if success else "Нет, интеграция не живая."

        lines: list[str] = []
        status = "успешно" if success else "с ошибками"
        lines.append(f"Ralphex завершил прогон {status}.")
        if duration:
            lines.append(f"Длительность: {duration}.")
        if branch:
            lines.append(f"Branch: `{branch}`.")
        signals: list[str] = []
        if all_done:
            signals.append("ALL_TASKS_DONE")
        if review_done:
            signals.append("REVIEW_DONE")
        if codex_done:
            signals.append("CODEX_REVIEW_DONE")
        if task_failed:
            signals.append("TASK_FAILED")
        if signals:
            lines.append(f"Сигналы: {', '.join(signals)}.")
        if no_issues:
            lines.append("Внешний Codex review: `NO ISSUES FOUND`.")
        lines.append("Технический лог скрыт; при необходимости включу полный вывод.")
        return " ".join(lines)


class RalphexProxyAgent(autogen.ConversableAgent):
    def __init__(self, transport: RalphexTransport, payload: dict, **kwargs):
        super().__init__(
            name="RalphexProxy",
            system_message="Single purpose proxy agent. Forwards payload to ralphex CLI and returns raw text.",
            llm_config=False,
            human_input_mode="NEVER",
            **kwargs,
        )
        self._transport = transport
        self._payload = payload

    def generate_reply(self, messages=None, sender=None, **kwargs) -> str:
        message_list = self._payload.get("messages") or []
        if not isinstance(message_list, list):
            return "ralphex proxy payload must contain messages list"
        session_id = str(self._payload.get("session_id") or "default")
        request_id = str(self._payload.get("request_id") or uuid.uuid4().hex)
        return self._transport.execute(message_list, session_id=session_id, request_id=request_id)


class AutoGenPipe:
    """MVP pipe: Cursor request -> AutoGen 1-agent GroupChat -> ralphex subprocess."""

    def __init__(self, transport: RalphexTransport) -> None:
        self._transport = transport

    def complete(self, session_id: str, messages: list[dict[str, str]], request_id: str) -> str:
        payload = {
            "session_id": session_id,
            "request_id": request_id,
            "messages": messages,
        }
        proxy = RalphexProxyAgent(transport=self._transport, payload=payload)
        supervisor = autogen.UserProxyAgent(
            name="ConsiliumGatewaySupervisor",
            human_input_mode="NEVER",
            max_consecutive_auto_reply=0,
            code_execution_config=False,
        )

        def _select(last_speaker, groupchat):
            if not groupchat.messages:
                return proxy
            if last_speaker and getattr(last_speaker, "name", "") == "RalphexProxy":
                return None
            return proxy

        groupchat = autogen.GroupChat(
            agents=[supervisor, proxy],
            messages=[],
            max_round=4,
            speaker_selection_method=_select,
        )
        manager = autogen.GroupChatManager(groupchat=groupchat, llm_config=False)

        supervisor.initiate_chat(manager, message=f"SESSION:{session_id}")

        for item in reversed(groupchat.messages):
            if item.get("name") == "RalphexProxy":
                return (item.get("content") or "").strip()
        raise RuntimeError("autogen pipeline produced no RalphexProxy reply")


def _normalize_content(content: str | list[dict] | None) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return str(content)


def _compact_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _to_internal_messages(messages: list[ChatMessage]) -> list[dict[str, str]]:
    internal: list[dict[str, str]] = []
    for msg in messages:
        role = (msg.role or "").strip().lower()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        internal.append(
            {
                "role": role,
                "content": _normalize_content(msg.content),
            }
        )
    return internal


def _now() -> int:
    return int(time.time())


def _make_completion_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex}"


def _split_for_stream(text: str, chunk_size: int = 120) -> Iterable[str]:
    normalized = text or ""
    if not normalized:
        return []
    return [normalized[i:i + chunk_size] for i in range(0, len(normalized), chunk_size)]


def _build_non_stream_response(model: str, completion_id: str, text: str) -> dict:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": _now(),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }


def _build_stream_generator(model: str, completion_id: str, text: str):
    def _event(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    def _iter():
        created = _now()
        yield _event(
            {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
            }
        )
        for piece in _split_for_stream(text):
            yield _event(
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}],
                }
            )
        yield _event(
            {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
        )
        yield "data: [DONE]\n\n"

    return _iter()


def _upsert_session_messages(session_id: str, incoming: list[dict[str, str]]) -> list[dict[str, str]]:
    with _SESSION_LOCK:
        state = _SESSIONS.setdefault(session_id, SessionState())
        if len(incoming) >= 2:
            state.history = incoming[-MAX_SESSION_MESSAGES:]
        else:
            state.history.extend(incoming)
            state.history = state.history[-MAX_SESSION_MESSAGES:]
        return list(state.history)


def _append_assistant_message(session_id: str, text: str) -> None:
    with _SESSION_LOCK:
        state = _SESSIONS.setdefault(session_id, SessionState())
        state.history.append({"role": "assistant", "content": text})
        state.history = state.history[-MAX_SESSION_MESSAGES:]


def _extract_session_id(req: ChatCompletionsRequest, x_session_id: str | None) -> str:
    if req.user and req.user.strip():
        return _compact_spaces(req.user)
    if x_session_id and x_session_id.strip():
        return _compact_spaces(x_session_id)
    return "default"


def _check_bearer_token(auth_header: str | None) -> None:
    api_key = os.getenv("CONSILIUM_API_KEY", DEFAULT_API_KEY)
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    scheme, _, token = auth_header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or token != api_key:
        LOGGER.warning(
            "auth_failed scheme=%r token_present=%s token_len=%d",
            scheme,
            str(bool(token)).lower(),
            len(token),
        )
        raise HTTPException(status_code=401, detail="Invalid API key")


app = FastAPI(title="Consilium Gateway", version="0.1.0-mvp")
_transport = RalphexTransport()
_pipe = AutoGenPipe(transport=_transport)


@app.on_event("startup")
def _startup_checks() -> None:
    if not pathlib.Path(".git").exists():
        raise RuntimeError(
            "ralphex requires repository root (.git missing). "
            "Run `git init` or use `make ensure-gateway` with CONSILIUM_AUTO_GIT_INIT=1."
        )
    strict = _env_bool("CONSILIUM_STRICT_API_KEY", default=False)
    current_key = os.getenv("CONSILIUM_API_KEY", DEFAULT_API_KEY)
    if strict and current_key == DEFAULT_API_KEY:
        raise RuntimeError(
            "CONSILIUM_STRICT_API_KEY is enabled but CONSILIUM_API_KEY uses default value. "
            "Set a strong non-default key before starting gateway."
        )
    LOGGER.info(
        "gateway_startup strict_api_key=%s transport_timeout_sec=%s transport_idle_timeout_sec=%s transport_heartbeat_sec=%s transport_mode=%s transport_source=%s transport_cmd=%s",
        str(strict).lower(),
        str(_transport.timeout_sec),
        str(_transport.idle_timeout_sec),
        str(_transport.heartbeat_sec),
        _transport.mode,
        _transport.command_source,
        _transport.command,
    )
    if _transport.command_source == "default":
        raise RuntimeError(
            "ralphex binary not found at startup. "
            "Install ralphex in user profile or set CONSILIUM_RALPHEX_CMD in .env."
        )
    if "--task" in _transport.command:
        raise RuntimeError(
            "Detected unsupported '--task' in CONSILIUM_RALPHEX_CMD for current ralphex CLI. "
            "Use plan-file mode, e.g. '/abs/path/to/ralphex \"$CONSILIUM_PLAN_FILE\"'."
        )


@app.get("/healthz")
def healthz() -> dict:
    active = _active_runs_snapshot()
    return {"status": "ok", "active_count": len(active), "active": active}


@app.post("/v1/chat/completions")
def chat_completions(
    payload: ChatCompletionsRequest,
    authorization: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
):
    _check_bearer_token(authorization)
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    session_id = _extract_session_id(payload, x_session_id)
    LOGGER.info(
        "chat_request session_id=%s model=%s stream=%s messages=%d",
        session_id,
        payload.model or DEFAULT_MODEL,
        str(payload.stream).lower(),
        len(payload.messages),
    )
    incoming = _to_internal_messages(payload.messages)
    history = _upsert_session_messages(session_id, incoming)
    completion_id = _make_completion_id()
    model = payload.model or DEFAULT_MODEL
    LOGGER.info("chat_request_dispatch completion_id=%s session_id=%s", completion_id, session_id)

    try:
        answer = _pipe.complete(session_id=session_id, messages=history, request_id=completion_id)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="ralphex timeout")
    except RuntimeError as exc:
        message = str(exc)
        if message.startswith("ralphex stalled:"):
            raise HTTPException(status_code=504, detail=message)
        raise HTTPException(status_code=500, detail=message)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"runtime dependency missing: {exc}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    _append_assistant_message(session_id, answer)

    if payload.stream:
        return StreamingResponse(
            _build_stream_generator(model=model, completion_id=completion_id, text=answer),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))

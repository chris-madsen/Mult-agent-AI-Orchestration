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


def _resolve_public_model_name() -> str:
    raw = os.getenv("CONSILIUM_PUBLIC_MODEL", "consilium-auto")
    normalized = (raw or "").strip()
    return normalized or "consilium-auto"


DEFAULT_API_KEY = "consilium-mvp-key"
DEFAULT_MODEL = _resolve_public_model_name()
LEGACY_MODEL_ALIAS = "ralphex-mcp"
MAX_SESSION_MESSAGES = 80
DEFAULT_TIMEOUT_SEC = 1200
DEFAULT_IDLE_TIMEOUT_SEC = 300
DEFAULT_HEARTBEAT_SEC = 15
DEFAULT_IDLE_WARN_SEC = 45
DEFAULT_CHAT_SESSION_TIMEOUT_SEC = 180
DEFAULT_CHAT_IDLE_TIMEOUT_SEC = 120
LOGGER = logging.getLogger("consilium.gateway")
logging.basicConfig(level=os.getenv("CONSILIUM_GATEWAY_LOG_LEVEL", "INFO"))
_GATEWAY_PLANS_DIR = pathlib.Path(".consilium/gateway/plans")
_RALPHEX_CONFIG_DIR = pathlib.Path(".consilium/ralphex")
_CODEX_SANDBOX = os.getenv("CONSILIUM_CODEX_SANDBOX", "danger-full-access")
_ACTIVE_RUNS_DIR = pathlib.Path(".consilium/gateway/active")
_LOCAL_TMP_DIR = pathlib.Path(".consilium/tmp")


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


def _is_env_assignment(token: str) -> bool:
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", token or ""))


def _extract_command_binary(command_template: str) -> str | None:
    try:
        parts = shlex.split(command_template or "")
    except ValueError:
        return None
    if not parts:
        return None

    idx = 0
    while idx < len(parts) and _is_env_assignment(parts[idx]):
        idx += 1

    if idx < len(parts) and parts[idx] == "env":
        idx += 1
        while idx < len(parts):
            token = parts[idx]
            if token.startswith("-") or _is_env_assignment(token):
                idx += 1
                continue
            return token
        return "env"

    if idx < len(parts):
        return parts[idx]
    return None


def _redacted_command_for_log(command_template: str) -> str:
    binary = _extract_command_binary(command_template)
    if not binary:
        return "<redacted>"
    return f"{binary} <args redacted>"


def _ensure_local_tmp_dir() -> pathlib.Path:
    _LOCAL_TMP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _LOCAL_TMP_DIR.chmod(0o700)
    except OSError:
        pass
    return _LOCAL_TMP_DIR.resolve()


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
        self.mode = (os.getenv("CONSILIUM_RALPHEX_MODE", "auto") or "auto").strip().lower()
        if self.mode not in {"auto", "review", "execute", "tasks"}:
            self.mode = "auto"
        configured = os.getenv("CONSILIUM_RALPHEX_CMD", "").strip()
        self.command_source = "env" if configured else "auto"
        self.binary_path: str | None = None
        if configured:
            self.command_template = configured
        else:
            binary = _resolve_ralphex_binary()
            if binary:
                self.binary_path = binary
                self.command_template = shlex.quote(binary)
            else:
                self.command_source = "default"
                self.command_template = "ralphex"
        self.timeout_sec = _env_int("CONSILIUM_RALPHEX_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC, minimum=1)
        self.idle_timeout_sec = _env_int("CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC", DEFAULT_IDLE_TIMEOUT_SEC, minimum=0)
        self.heartbeat_sec = _env_int("CONSILIUM_RALPHEX_HEARTBEAT_SEC", DEFAULT_HEARTBEAT_SEC, minimum=1)
        self.idle_warn_sec = _env_int("CONSILIUM_RALPHEX_IDLE_WARN_SEC", DEFAULT_IDLE_WARN_SEC, minimum=1)
        self.chat_session_timeout_sec = _env_int(
            "CONSILIUM_RALPHEX_CHAT_SESSION_TIMEOUT_SEC",
            DEFAULT_CHAT_SESSION_TIMEOUT_SEC,
            minimum=30,
        )
        self.chat_idle_timeout_sec = _env_int(
            "CONSILIUM_RALPHEX_CHAT_IDLE_TIMEOUT_SEC",
            DEFAULT_CHAT_IDLE_TIMEOUT_SEC,
            minimum=15,
        )

    @staticmethod
    def _latest_user_prompt(messages: list[dict[str, str]]) -> str:
        for item in reversed(messages):
            if (item.get("role") or "").strip().lower() == "user":
                return (item.get("content") or "").strip()
        return ""

    @staticmethod
    def _is_review_intent(user_prompt: str) -> bool:
        text = (user_prompt or "").lower()
        review_phrases = (
            "code review",
            "security review",
        )
        if any(marker in text for marker in review_phrases):
            return True

        review_word_patterns = (
            r"(?<!\w)review(?:s|ed|ing)?(?!\w)",
            r"(?<!\w)audit(?:s|ed|ing)?(?!\w)",
            r"(?<!\w)провер\w*(?!\w)",
            r"(?<!\w)ревью(?!\w)",
            r"(?<!\w)аудит\w*(?!\w)",
        )
        return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in review_word_patterns)

    def _review_command(self) -> str:
        return f'{self.command_template} --review "$CONSILIUM_PLAN_FILE"'

    def _execute_command(self) -> str:
        return f'{self.command_template} "$CONSILIUM_PLAN_FILE"'

    def _tasks_command(self) -> str:
        return (
            f'{self.command_template} --tasks-only --max-iterations=1 '
            f'--session-timeout={self.chat_session_timeout_sec}s '
            f'--idle-timeout={self.chat_idle_timeout_sec}s '
            '"$CONSILIUM_PLAN_FILE"'
        )

    def _resolve_command(self, messages: list[dict[str, str]]) -> str:
        if self.command_source == "env":
            return self.command_template
        if self.mode == "review":
            return self._review_command()
        if self.mode == "execute":
            return self._execute_command()
        if self.mode == "tasks":
            return self._tasks_command()
        latest_user = self._latest_user_prompt(messages)
        if self._is_review_intent(latest_user):
            return self._review_command()
        return self._execute_command()

    def quick_probe(self) -> str:
        version_cmd = self._probe_version_command()
        env = os.environ.copy()
        local_tmp = _ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)
        try:
            proc = subprocess.run(
                ["bash", "-lc", version_cmd],
                capture_output=True,
                text=True,
                timeout=10,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return "Связь с gateway есть, но быстрый probe ralphex не ответил за 10с."

        if proc.returncode != 0:
            details = (proc.stderr or proc.stdout or f"exit code {proc.returncode}").strip()
            return f"Gateway доступен, но ralphex probe завершился ошибкой: {details}"

        text = (proc.stdout or "").strip() or "ralphex available"
        return f"Связь есть. {text}"

    def _probe_version_command(self) -> str:
        if self.binary_path:
            return f"{shlex.quote(self.binary_path)} --version"
        binary = _extract_command_binary(self.command_template)
        if not binary:
            binary = self.command_template.strip()
        if not binary:
            binary = "ralphex"
        return f"{shlex.quote(binary)} --version"

    def execute(self, messages: list[dict[str, str]], session_id: str, request_id: str) -> str:
        plan_path = self._write_plan_file(messages)
        task_json = json.dumps(messages, ensure_ascii=False)
        command = self._resolve_command(messages)
        env = os.environ.copy()
        env["CONSILIUM_TASK_JSON"] = task_json
        env["CONSILIUM_PLAN_FILE"] = str(plan_path.resolve())
        env["RALPHEX_CONFIG_DIR"] = str(_RALPHEX_CONFIG_DIR.resolve())
        env["CODEX_MODEL"] = self.model
        env["CODEX_SANDBOX"] = _CODEX_SANDBOX
        env.setdefault("CODEX_VERBOSE", "0")
        local_tmp = _ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)
        self._adapter_bootstrap._ensure_ralphex_codex_bridge()

        proc = subprocess.Popen(
            ["bash", "-lc", command],
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
            command=command,
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
                    raise subprocess.TimeoutExpired(cmd=command, timeout=self.timeout_sec)
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

        latest_user = ""
        for item in reversed(messages):
            if (item.get("role") or "").strip().lower() == "user":
                latest_user = (item.get("content") or "").strip()
                break
        if not latest_user:
            latest_user = "No explicit user request was provided."

        latest_user_compact = re.sub(r"\s+", " ", latest_user).strip()[:500]
        tail = messages[-20:]
        lines = [
            "# Consilium Gateway Plan",
            "",
            "## Overview",
            f"- [ ] Resolve latest user request: {latest_user_compact}",
            "",
            "## Context",
            "",
            "Latest user request:",
            "",
            "```text",
            latest_user,
            "```",
            "",
            "Recent conversation tail:",
            "",
        ]
        for item in tail:
            role = (item.get("role") or "user").strip().lower()
            content = (item.get("content") or "").strip()
            if not content:
                continue
            compact = re.sub(r"\s+", " ", content).strip()
            lines.append(f"- {role}: {compact[:800]}")
        lines.extend(
            [
                "",
                "## Task 1: Deliver response for the latest request",
                "- [ ] Understand latest user request and relevant local context.",
                "- [ ] If coding changes are needed, implement minimal correct update and run relevant checks.",
                "- [ ] If no code changes are needed, provide direct concise answer.",
                "- [ ] Output final assistant answer text suitable for chat.",
                "- [ ] End with exact line format: Final answer: <one concise response for user>.",
                "",
                "## Success criteria",
                "- [ ] Latest user request is addressed directly.",
                "- [ ] Response is concise and actionable.",
                "",
            ]
        )
        plan_path.write_text("\n".join(lines), encoding="utf-8")
        return plan_path

    @staticmethod
    def _extract_latest_user_answer(raw_text: str) -> str:
        if not raw_text:
            return ""

        summary_markers = ("final answer:", "result:", "итог:", "ответ:")
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        for line in reversed(lines):
            low = line.lower()
            if any(low.startswith(marker) for marker in summary_markers):
                return line.split(":", 1)[-1].strip() or line
        return ""

    @staticmethod
    def _extract_text(stdout: str) -> str:
        chunks: list[str] = []
        saw_delta = False
        saw_raw = False
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
                saw_raw = True
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                chunks.append(raw_line)
                saw_raw = True
                continue
            if isinstance(payload, dict):
                delta = payload.get("delta") or {}
                if isinstance(delta, dict) and isinstance(delta.get("text"), str):
                    chunks.append(delta["text"])
                    saw_delta = True
                    continue
                choices = payload.get("choices")
                if isinstance(choices, list):
                    for choice in choices:
                        if not isinstance(choice, dict):
                            continue
                        delta_obj = choice.get("delta") or {}
                        if isinstance(delta_obj, dict) and isinstance(delta_obj.get("content"), str):
                            chunks.append(delta_obj["content"])
                            saw_delta = True
        if saw_delta and not saw_raw:
            return "".join(chunks)
        return "\n".join(chunks)

    @staticmethod
    def _looks_like_ralphex_log(raw_text: str) -> bool:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            return False

        normalized = raw_text.lower()
        structural_markers = (
            "starting ralphex loop",
            "starting task execution phase",
            "--- task iteration",
            "--- claude review",
        )
        if any(marker in normalized for marker in structural_markers):
            return True

        weak_markers = (
            "starting code review",
            "all tasks completed, starting code review",
            "task execution completed successfully",
            "review phases completed successfully",
            "all phases completed successfully",
        )
        weak_hits = sum(1 for marker in weak_markers if marker in normalized)

        # Treat Ralphex signals as log output only when they appear as standalone
        # signal lines and are accompanied by additional log structure.
        signal_line = re.compile(r"^(?:\[[^\]\n]+\]\s*)?<<<ralphex:[^>\n]+>>>\s*$", flags=re.IGNORECASE)
        timestamp_line = re.compile(r"^\[[^\]\n]+\]")
        signal_hits = sum(1 for line in lines if signal_line.match(line))
        timestamp_hits = sum(1 for line in lines if timestamp_line.match(line))
        if signal_hits and (weak_hits > 0 or timestamp_hits > 0):
            return True

        return weak_hits >= 2 and ("\n" in raw_text or "[" in raw_text)

    @staticmethod
    def _format_chat_response(raw_text: str, user_prompt: str) -> str:
        if not raw_text:
            return raw_text

        duration_match = re.search(r"completed in ([^\n]+)", raw_text, flags=re.IGNORECASE)
        duration = duration_match.group(1).strip() if duration_match else None

        raw_upper = raw_text.upper()
        raw_lower = raw_text.lower()
        no_issues = "NO ISSUES FOUND" in raw_upper
        all_done = re.search(r"\bALL_TASKS_DONE\b", raw_upper) is not None
        review_done = re.search(r"\bREVIEW_DONE\b", raw_upper) is not None
        codex_done = re.search(r"\bCODEX_REVIEW_DONE\b", raw_upper) is not None
        task_failed = re.search(r"\bTASK_FAILED\b", raw_upper) is not None
        positive_terminal_signal = (
            "all phases completed successfully" in raw_lower
            or "review phases completed successfully" in raw_lower
            or "task execution completed successfully" in raw_lower
            or "all tasks completed" in raw_lower
            or all_done
            or review_done
            or codex_done
            or no_issues
        )
        terminal_signal = positive_terminal_signal or task_failed
        success = positive_terminal_signal and not task_failed

        normalized_user = (user_prompt or "").strip().lower()
        integration_health_probe = ("интеграци" in normalized_user and "жив" in normalized_user) or (
            "integration" in normalized_user
            and ("alive" in normalized_user or "working" in normalized_user or "live" in normalized_user)
        )
        has_execution_signal = terminal_signal

        # Targeted integration-status answer for direct health checks.
        if integration_health_probe and has_execution_signal:
            return "Да, интеграция живая." if success else "Нет, интеграция не живая."

        extracted_answer = RalphexTransport._extract_latest_user_answer(raw_text)
        if extracted_answer:
            return extracted_answer

        looks_like_log = RalphexTransport._looks_like_ralphex_log(raw_text)
        if integration_health_probe and looks_like_log:
            return "Статус интеграции неизвестен."

        # If output is already concise/non-ralphex logs, keep as is.
        if not looks_like_log:
            return raw_text

        lines: list[str] = []
        if terminal_signal:
            status = "успешно" if success else "с ошибками"
        else:
            status = "без финального статуса"
        lines.append(f"Ralphex завершил прогон {status}.")
        if duration:
            lines.append(f"Длительность: {duration}.")
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


def _available_model_ids() -> list[str]:
    ids = [DEFAULT_MODEL]
    if LEGACY_MODEL_ALIAS not in ids:
        ids.append(LEGACY_MODEL_ALIAS)
    return ids


def _model_cards() -> list[dict]:
    return [
        {
            "id": model_id,
            "object": "model",
            "created": 0,
            "owned_by": "consilium",
        }
        for model_id in _available_model_ids()
    ]


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


def _latest_user_text(messages: list[dict[str, str]]) -> str:
    for item in reversed(messages):
        if (item.get("role") or "").strip().lower() == "user":
            return (item.get("content") or "").strip()
    return ""


def _is_connectivity_probe(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    if len(normalized) > 120:
        return False

    normalized_compact = re.sub(r"\s+", " ", normalized).strip()
    probe_candidate = normalized_compact.strip(" \t\r\n.,!?;:\"'`()[]{}")
    exact_probe_markers = {
        "ping",
        "пинг",
    }
    phrase_probe_markers = (
        "проверка связи",
        "check connection",
        "ты тут",
        "ты здесь",
        "живой",
        "живая",
        "integration alive",
        "интеграция живая",
    )
    greeting_markers = ("привет", "hello")
    coding_markers = (
        "add",
        "create",
        "write",
        "code",
        "fix",
        "implement",
        "refactor",
        "review",
        "audit",
        "endpoint",
        "api",
        "route",
        "handler",
        "service",
        "function",
        "test",
        "tests",
        "bug",
        "issue",
        "добав",
        "создай",
        "напиши",
        "код",
        "файл",
        "эндпоинт",
        "маршрут",
        "роут",
        "terraform",
        "tofu",
    )
    if any(marker in normalized for marker in coding_markers):
        return False
    if probe_candidate in exact_probe_markers:
        return True
    if any(marker in normalized for marker in phrase_probe_markers):
        return True
    # A plain greeting should not bypass the full execution path.
    return any(marker in normalized for marker in greeting_markers) and (
        "связ" in normalized or "connection" in normalized
    )


def _check_bearer_token(auth_header: str | None, x_api_key: str | None = None) -> None:
    api_key = os.getenv("CONSILIUM_API_KEY", DEFAULT_API_KEY)
    header_api_key = x_api_key if isinstance(x_api_key, str) else None
    if header_api_key and header_api_key.strip() == api_key:
        return
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


def _check_optional_discovery_auth(auth_header: str | None, x_api_key: str | None = None) -> None:
    has_bearer = isinstance(auth_header, str) and bool(auth_header.strip())
    has_x_api_key = isinstance(x_api_key, str) and bool(x_api_key.strip())
    if has_bearer or has_x_api_key:
        _check_bearer_token(auth_header, x_api_key=x_api_key)
        return
    LOGGER.info("models_discovery_without_auth accepted=true")


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
        "gateway_startup strict_api_key=%s transport_timeout_sec=%s transport_idle_timeout_sec=%s transport_heartbeat_sec=%s transport_mode=%s transport_source=%s transport_cmd_template=%s",
        str(strict).lower(),
        str(_transport.timeout_sec),
        str(_transport.idle_timeout_sec),
        str(_transport.heartbeat_sec),
        _transport.mode,
        _transport.command_source,
        _redacted_command_for_log(_transport.command_template),
    )
    if _transport.command_source == "default":
        raise RuntimeError(
            "ralphex binary not found at startup. "
            "Install ralphex in user profile or set CONSILIUM_RALPHEX_CMD in .env."
        )
    if _transport.command_source == "env" and "--task" in _transport.command_template:
        raise RuntimeError(
            "Detected unsupported '--task' in CONSILIUM_RALPHEX_CMD for current ralphex CLI. "
            "Use plan-file mode, e.g. '/abs/path/to/ralphex \"$CONSILIUM_PLAN_FILE\"'."
        )


@app.get("/healthz")
def healthz() -> dict:
    active = _active_runs_snapshot()
    return {"status": "ok", "active_count": len(active), "active": active}


@app.get("/v1/models")
def list_models(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> dict:
    _check_optional_discovery_auth(authorization, x_api_key=x_api_key)
    return {"object": "list", "data": _model_cards()}


@app.get("/v1/models/{model_id}")
def get_model(
    model_id: str,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> dict:
    _check_optional_discovery_auth(authorization, x_api_key=x_api_key)
    for card in _model_cards():
        if card["id"] == model_id:
            return card
    raise HTTPException(status_code=404, detail="Model not found")


@app.post("/v1/chat/completions")
def chat_completions(
    payload: ChatCompletionsRequest,
    authorization: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    _check_bearer_token(authorization, x_api_key=x_api_key)
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    session_id = _extract_session_id(payload, x_session_id)
    LOGGER.info(
        "chat_request session_id=%s requested_model=%s effective_model=%s stream=%s messages=%d",
        session_id,
        payload.model or DEFAULT_MODEL,
        DEFAULT_MODEL,
        str(payload.stream).lower(),
        len(payload.messages),
    )
    incoming = _to_internal_messages(payload.messages)
    history = _upsert_session_messages(session_id, incoming)
    completion_id = _make_completion_id()
    # Cursor-provided model is treated as a routing hint only.
    # Consilium always responds with the public gateway model alias.
    model = DEFAULT_MODEL
    LOGGER.info("chat_request_dispatch completion_id=%s session_id=%s", completion_id, session_id)

    latest_user = _latest_user_text(history)
    if _is_connectivity_probe(latest_user):
        LOGGER.info("chat_request_probe completion_id=%s session_id=%s", completion_id, session_id)
        answer = _transport.quick_probe()
        _append_assistant_message(session_id, answer)
        if payload.stream:
            return StreamingResponse(
                _build_stream_generator(model=model, completion_id=completion_id, text=answer),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))

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

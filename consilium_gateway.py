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
from typing import Any, Iterable

import autogen
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from execution_port import RalphexAdapter
from model_config import load_runtime_config


def _load_dotenv_if_present() -> None:
    """Best-effort local `.env` loader for gateway process.

    `make ensure-gateway` may start the gateway without exporting `.env`.
    We keep this lightweight and non-invasive: only set keys that are absent.
    """
    project_root = pathlib.Path(__file__).resolve().parent
    dotenv_path = project_root / ".env"
    if not dotenv_path.exists():
        return

    try:
        lines = dotenv_path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv_if_present()


def _resolve_public_model_name() -> str:
    raw = os.getenv("CONSILIUM_PUBLIC_MODEL", "consilium-auto")
    normalized = (raw or "").strip()
    return normalized or "consilium-auto"


DEFAULT_API_KEY = "consilium-mvp-key"
DEFAULT_MODEL = _resolve_public_model_name()
LEGACY_MODEL_ALIAS = "ralphex-mcp"
DEFAULT_PUBLIC_MODEL_ALIASES = ("gpt-5.3-codex",)
SOURCE_STAMP = "[source:consilium]"
MAX_SESSION_MESSAGES = 80
MAX_RALPHEX_MESSAGES = 10
MAX_RALPHEX_TOTAL_CHARS = 14000
MAX_USER_MESSAGE_CHARS = 4000
MAX_ASSISTANT_MESSAGE_CHARS = 2500
MAX_SYSTEM_MESSAGE_CHARS = 1200
DEFAULT_TIMEOUT_SEC = 1200
DEFAULT_IDLE_TIMEOUT_SEC = 300
DEFAULT_HEARTBEAT_SEC = 15
DEFAULT_IDLE_WARN_SEC = 45
DEFAULT_CHAT_SESSION_TIMEOUT_SEC = 60
DEFAULT_CHAT_IDLE_TIMEOUT_SEC = 30
DEFAULT_PLAN_MODE_MAX_ITERATIONS = 2
DEFAULT_STANDARD_MAX_ITERATIONS = 24
LOGGER = logging.getLogger("consilium.gateway")
logging.basicConfig(level=os.getenv("CONSILIUM_GATEWAY_LOG_LEVEL", "INFO"))
_GATEWAY_PLANS_DIR = pathlib.Path(".consilium/gateway/plans")
_RALPHEX_CONFIG_DIR = pathlib.Path(".consilium/ralphex")
_CODEX_SANDBOX = os.getenv("CONSILIUM_CODEX_SANDBOX", "danger-full-access")
_ACTIVE_RUNS_DIR = pathlib.Path(".consilium/gateway/active")
_LOCAL_TMP_DIR = pathlib.Path(".consilium/tmp")
_VERTEX_GEMINI_WRAPPER = pathlib.Path(".consilium/ralphex/scripts/vertex-gemini-as-claude.sh")
_VERTEX_ANTHROPIC_WRAPPER = pathlib.Path(".consilium/ralphex/scripts/vertex-anthropic-as-claude.sh")
_RALPHEX_CONFIG_FILE = _RALPHEX_CONFIG_DIR / "config"
_RALPHEX_CHAT_CONFIG_DIR = pathlib.Path(".consilium/ralphex-chat")
_RALPHEX_LIMIT_FALLBACK_CONFIG_DIR = pathlib.Path(".consilium/ralphex-limit-fallback")
_GATEWAY_GIT_SHIM_DIR = _LOCAL_TMP_DIR / "gateway-git-shim"
_GATEWAY_GIT_SHIM_FILE = _GATEWAY_GIT_SHIM_DIR / "git"
DEFAULT_DIRECT_QA_TIMEOUT_SEC = 300


def _resolve_public_model_aliases() -> list[str]:
    raw = os.getenv("CONSILIUM_PUBLIC_MODEL_ALIASES", "")
    candidates: list[str] = []
    if raw.strip():
        candidates.extend(re.split(r"[\s,]+", raw.strip()))
    candidates.extend(DEFAULT_PUBLIC_MODEL_ALIASES)

    aliases: list[str] = []
    for candidate in candidates:
        model_id = (candidate or "").strip()
        if not model_id or model_id == DEFAULT_MODEL:
            continue
        if model_id in aliases:
            continue
        aliases.append(model_id)
    return aliases

_RALPHEX_CHAT_TASK_PROMPT = """# task execution prompt (gateway chat/repo-read mode)
# this prompt is optimized for non-coding gateway chat traffic.
#
# available variables:
#   {{PLAN_FILE}} - path to the plan file being executed
#   {{PROGRESS_FILE}} - path to the progress log file
#   {{GOAL}} - human-readable goal description
#
# Read {{PLAN_FILE}} and execute the latest user request.
#
# HARD CONSTRAINTS:
# - NEVER create/scaffold new projects or services unless user explicitly asked for that.
# - NEVER run git commit/push/rebase/merge/cherry-pick.
# - NEVER claim actions that were not actually executed.
# - If plan task is "Answer User Request In Chat Mode": do NOT run shell commands.
# - If plan task is "Read Repository Context For User": run only lightweight READ-ONLY commands
#   (for example: pwd, ls, rg --files, sed -n, cat, git status, git diff). Do NOT edit files.
# - Do NOT run heavy builds/tests in chat or repo-read modes unless explicitly requested.
# - Do NOT invent results: report only actions you actually performed.
# - Keep scope limited to the user's request.
# - Prefer concise, factual status updates.
#
# REQUIRED OUTPUT:
# 1) One concise user-facing answer in the same language as the user.
# 2) Include what was done (or why it could not be done).
# 3) If checks/tests were run, mention the result briefly.
# 4) Final line exactly:
#    Final answer: <your concise answer>
# 5) Then emit exactly:
#    <<<RALPHEX:ALL_TASKS_DONE>>>
#
# If execution cannot be completed, return:
# Final answer: Не удалось выполнить запрос: <short reason>.
# <<<RALPHEX:TASK_FAILED>>>
"""

_RALPHEX_CHAT_REVIEW_PROMPT = """# gateway review prompt
# For gateway execution tasks, keep review lightweight and non-blocking.
#
# REQUIRED OUTPUT (exact line):
# <<<RALPHEX:REVIEW_DONE>>>
"""


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


def _prepare_gateway_git_shim_env(env: dict[str, str]) -> dict[str, str]:
    if not _env_bool("CONSILIUM_GATEWAY_BLOCK_GIT_COMMITS", default=True):
        return env

    real_git = shutil.which("git")
    if not real_git:
        return env

    _GATEWAY_GIT_SHIM_DIR.mkdir(parents=True, exist_ok=True)
    script = """#!/usr/bin/env bash
set -euo pipefail
real_git="${CONSILIUM_REAL_GIT_BIN:-git}"
args=("$@")
idx=0
while [[ "$idx" -lt "${#args[@]}" ]]; do
  token="${args[$idx]}"
  case "$token" in
    --)
      idx=$((idx + 1))
      break
      ;;
    -c|--config-env|-C|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix)
      idx=$((idx + 2))
      continue
      ;;
    --config-env=*|-c*|-C*|--exec-path=*|--git-dir=*|--work-tree=*|--namespace=*|--super-prefix=*)
      idx=$((idx + 1))
      continue
      ;;
    --no-pager|--no-optional-locks|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-replace-objects)
      idx=$((idx + 1))
      continue
      ;;
    -*)
      idx=$((idx + 1))
      continue
      ;;
    *)
      break
      ;;
  esac
done
sub="${args[$idx]:-}"
case "$sub" in
  commit|push|rebase|merge|cherry-pick|am)
    echo "error: git $sub is disabled in Consilium gateway chat runtime" >&2
    exit 2
    ;;
esac
exec "$real_git" "$@"
"""
    _GATEWAY_GIT_SHIM_FILE.write_text(script, encoding="utf-8")
    _GATEWAY_GIT_SHIM_FILE.chmod(0o755)

    env["CONSILIUM_REAL_GIT_BIN"] = real_git
    current_path = env.get("PATH", "")
    env["PATH"] = f"{_GATEWAY_GIT_SHIM_DIR.resolve()}:{current_path}" if current_path else str(
        _GATEWAY_GIT_SHIM_DIR.resolve()
    )
    return env


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


def _cleanup_stale_active_runs(
    max_elapsed_sec: float,
    reason: str,
    max_no_output_idle_sec: float | None = None,
) -> int:
    """Terminate and unregister stale active ralphex runs.

    This protects chat responsiveness when an old execution keeps streaming
    indefinitely and starves subsequent requests.
    """
    now = time.monotonic()
    stale: list[tuple[str, ActiveExecution, float]] = []
    with _ACTIVE_LOCK:
        for request_id, state in list(_ACTIVE_EXECUTIONS.items()):
            elapsed = now - state.started_monotonic
            idle = now - state.last_activity_monotonic
            no_output_stale = (
                max_no_output_idle_sec is not None
                and max_no_output_idle_sec > 0
                and state.phase == "running_no_output"
                and idle >= max_no_output_idle_sec
            )
            if elapsed >= max_elapsed_sec or no_output_stale:
                stale.append((request_id, state, elapsed))

    for request_id, state, elapsed in stale:
        LOGGER.warning(
            "transport_stale_terminate request_id=%s session_id=%s pid=%s pgid=%s elapsed_sec=%.1f reason=%s",
            request_id,
            state.session_id,
            str(state.pid),
            str(state.pgid),
            elapsed,
            reason,
        )
        _terminate_process_group(state.pgid, grace_sec=1.0)
        _clear_active_run(request_id)
    return len(stale)


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


class ResponsesRequest(BaseModel):
    model: str = DEFAULT_MODEL
    input: Any = None
    stream: bool = False
    instructions: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
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
        architect_cfg = runtime.model_for("architect")
        critic_cfg = runtime.model_for("critic")
        implementer_cfg = runtime.model_for("implementer")
        self.architect_model = architect_cfg.model
        self.critic_model = critic_cfg.model
        self.implementer_model = implementer_cfg.model
        # Gateway chat should stay responsive and operational even if the project's
        # implementer role is configured for a slower/less reliable provider.
        # Allow explicit gateway overrides (MVP safety valve).
        gateway_provider = (os.getenv("CONSILIUM_GATEWAY_PROVIDER", "") or "").strip().lower()
        gateway_model = (os.getenv("CONSILIUM_GATEWAY_MODEL", "") or "").strip()
        provider = gateway_provider or implementer_cfg.provider
        model = gateway_model or implementer_cfg.model
        self.model = model
        self._adapter_bootstrap = RalphexAdapter(
            provider=provider,
            model=model,
        )
        # Keep legacy mode parsing for backward compatibility; request-level routing
        # below decides Plan vs non-Plan execution profile.
        self.mode = (os.getenv("CONSILIUM_RALPHEX_MODE", "tasks") or "tasks").strip().lower()
        if self.mode not in {"auto", "review", "execute", "tasks"}:
            self.mode = "tasks"
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
        self.plan_mode_max_iterations = _env_int(
            "CONSILIUM_RALPHEX_PLAN_MAX_ITERATIONS",
            DEFAULT_PLAN_MODE_MAX_ITERATIONS,
            minimum=1,
        )
        self.chat_mode_max_iterations = _env_int(
            "CONSILIUM_RALPHEX_CHAT_MAX_ITERATIONS",
            default=1,
            minimum=1,
        )
        self.repo_read_max_iterations = _env_int(
            "CONSILIUM_RALPHEX_REPO_READ_MAX_ITERATIONS",
            default=2,
            minimum=1,
        )
        self.standard_max_iterations = _env_int(
            "CONSILIUM_RALPHEX_STANDARD_MAX_ITERATIONS",
            DEFAULT_STANDARD_MAX_ITERATIONS,
            minimum=1,
        )
        self.enable_direct_codex_fallback = _env_bool(
            "CONSILIUM_GATEWAY_ENABLE_DIRECT_CODEX_FALLBACK",
            default=False,
        )
        self.enable_limit_fallback_to_gemini = _env_bool(
            "CONSILIUM_GATEWAY_ENABLE_LIMIT_FALLBACK_TO_GEMINI",
            default=True,
        )
        self.limit_fallback_model = (
            os.getenv("CONSILIUM_GATEWAY_LIMIT_FALLBACK_MODEL", "gemini-2.5-pro") or ""
        ).strip() or "gemini-2.5-pro"
        self.limit_fallback_route = (
            os.getenv("CONSILIUM_GATEWAY_LIMIT_FALLBACK_ROUTE", "ralphex") or "ralphex"
        ).strip().lower()
        if self.limit_fallback_route not in {"ralphex", "direct"}:
            self.limit_fallback_route = "ralphex"
        self.limit_fallback_allow_direct_recovery = _env_bool(
            "CONSILIUM_GATEWAY_LIMIT_FALLBACK_ALLOW_DIRECT_RECOVERY",
            default=False,
        )
        self.strict_ralphex_only = _env_bool(
            "CONSILIUM_GATEWAY_STRICT_RALPHEX_ONLY",
            default=True,
        )

    @staticmethod
    def _latest_user_prompt(messages: list[dict[str, str]]) -> str:
        for item in reversed(messages):
            if (item.get("role") or "").strip().lower() == "user":
                return _extract_effective_user_prompt((item.get("content") or "").strip())
        return ""

    @staticmethod
    def _is_plan_mode_request(messages: list[dict[str, str]]) -> bool:
        detected_mode: str | None = None
        for item in messages:
            content = (item.get("content") or "").strip()
            if not content:
                continue
            mode = _extract_collaboration_mode_marker(content)
            if mode:
                detected_mode = mode
        return detected_mode == "plan"

    @staticmethod
    def _ensure_chat_config_dir() -> pathlib.Path:
        chat_dir = _RALPHEX_CHAT_CONFIG_DIR
        prompts_dir = chat_dir / "prompts"
        prompts_dir.mkdir(parents=True, exist_ok=True)

        # Reuse the same runtime bridge config (provider/model wrappers), but keep
        # a dedicated prompts directory for chat-oriented behavior.
        if _RALPHEX_CONFIG_FILE.exists():
            (chat_dir / "config").write_text(
                _RALPHEX_CONFIG_FILE.read_text(encoding="utf-8"),
                encoding="utf-8",
            )

        base_prompts_dir = _RALPHEX_CONFIG_DIR / "prompts"
        if base_prompts_dir.exists():
            for src in base_prompts_dir.glob("*.txt"):
                target = prompts_dir / src.name
                if not target.exists():
                    target.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

        # Override only task prompt for chat traffic to prevent code/task loops.
        (prompts_dir / "task.txt").write_text(_RALPHEX_CHAT_TASK_PROMPT, encoding="utf-8")
        (prompts_dir / "review_first.txt").write_text(_RALPHEX_CHAT_REVIEW_PROMPT, encoding="utf-8")
        (prompts_dir / "review_second.txt").write_text(_RALPHEX_CHAT_REVIEW_PROMPT, encoding="utf-8")
        return chat_dir.resolve()

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

    def _review_command(self, command_template: str | None = None) -> str:
        # Prefer explicit --config-dir; some environments don't reliably propagate $RALPHEX_CONFIG_DIR.
        base = (command_template or self.command_template).strip()
        return f'{base} --config-dir="$RALPHEX_CONFIG_DIR" --review "$CONSILIUM_PLAN_FILE"'

    def _execute_command(self, command_template: str | None = None, max_iterations: int | None = None) -> str:
        base = (command_template or self.command_template).strip()
        iterations = max_iterations if max_iterations is not None else self.standard_max_iterations
        return (
            f'{base} --config-dir="$RALPHEX_CONFIG_DIR" --max-iterations={iterations} '
            '"$CONSILIUM_PLAN_FILE"'
        )

    def _tasks_command(
        self,
        command_template: str | None = None,
        max_iterations: int | None = None,
        session_timeout_sec: int | None = None,
        idle_timeout_sec: int | None = None,
    ) -> str:
        base = (command_template or self.command_template).strip()
        iterations = max_iterations if max_iterations is not None else self.plan_mode_max_iterations
        session_timeout = (
            int(session_timeout_sec)
            if session_timeout_sec is not None
            else int(self.chat_session_timeout_sec)
        )
        idle_timeout = (
            int(idle_timeout_sec)
            if idle_timeout_sec is not None
            else int(self.chat_idle_timeout_sec)
        )
        return (
            f'{base} --config-dir="$RALPHEX_CONFIG_DIR" --tasks-only --max-iterations={iterations} '
            f'--session-timeout={session_timeout}s '
            f'--idle-timeout={idle_timeout}s '
            '"$CONSILIUM_PLAN_FILE"'
        )

    def _resolve_command(
        self,
        plan_mode: bool,
        chat_mode: bool = False,
        repo_read_mode: bool = False,
    ) -> str:
        if self.command_source == "env":
            template = (self.command_template or "").strip()
            if not template:
                template = "ralphex"
            if "CONSILIUM_PLAN_FILE" in template:
                return template
            if self.mode == "review":
                return self._review_command(command_template=template)
            if self.mode == "execute":
                return self._execute_command(command_template=template, max_iterations=self.standard_max_iterations)
            if plan_mode:
                return self._tasks_command(
                    command_template=template,
                    max_iterations=self.plan_mode_max_iterations,
                )
            if chat_mode:
                chat_iterations = self.repo_read_max_iterations if repo_read_mode else self.chat_mode_max_iterations
                return self._tasks_command(
                    command_template=template,
                    max_iterations=chat_iterations,
                )
            return self._execute_command(
                command_template=template,
                max_iterations=self.standard_max_iterations,
            )

        if self.mode == "review":
            return self._review_command()
        if self.mode == "execute":
            return self._execute_command(max_iterations=self.standard_max_iterations)
        if plan_mode:
            return self._tasks_command(max_iterations=self.plan_mode_max_iterations)
        if chat_mode:
            chat_iterations = self.repo_read_max_iterations if repo_read_mode else self.chat_mode_max_iterations
            return self._tasks_command(max_iterations=chat_iterations)
        return self._execute_command(max_iterations=self.standard_max_iterations)

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
        plan_mode = self._is_plan_mode_request(messages)
        latest_user_prompt = self._latest_user_prompt(messages)
        repo_read_mode = (not plan_mode) and _is_repo_read_request(latest_user_prompt)
        chat_mode = (not plan_mode) and (not _is_coding_request(latest_user_prompt))
        plan_path = self._write_plan_file(messages, plan_mode=plan_mode)
        task_json = json.dumps(messages, ensure_ascii=False)
        command = self._resolve_command(
            plan_mode=plan_mode,
            chat_mode=chat_mode,
            repo_read_mode=repo_read_mode,
        )
        env = os.environ.copy()
        env["CONSILIUM_TASK_JSON"] = task_json
        env["CONSILIUM_PLAN_FILE"] = str(plan_path.resolve())
        env["RALPHEX_CONFIG_DIR"] = str(_RALPHEX_CONFIG_DIR.resolve())
        env["CONSILIUM_PLAN_MODE"] = "1" if plan_mode else "0"
        # Per-project ralphex config chooses the wrapper (codex vs vertex).
        # Keep env aligned with implementer provider to avoid confusing wrappers.
        if self._adapter_bootstrap.provider == "codex-cli":
            env["CODEX_MODEL"] = self.model
            env["CODEX_SANDBOX"] = _CODEX_SANDBOX
            env["CONSILIUM_CODEX_MODEL_PROVIDER"] = self._adapter_bootstrap._resolve_codex_provider()
            env["CONSILIUM_CODEX_REASONING_EFFORT"] = self._adapter_bootstrap._resolve_codex_reasoning_effort()
            env["CODEX_HOME"] = str(self._adapter_bootstrap._prepare_local_codex_home(self.model))
            # For gateway chat, we prefer reliability over silence: some codex runs may emit
            # only tool/command events. If we drop those, ralphex may fail to detect progress.
            env.setdefault("CODEX_VERBOSE", "1")
        elif self._adapter_bootstrap.provider == "google":
            env["GEMINI_MODEL"] = self.architect_model if plan_mode else self.model
            env["CONSILIUM_ARCHITECT_MODEL"] = self.architect_model
            env["CONSILIUM_CRITIC_MODEL"] = self.critic_model
            env["CONSILIUM_IMPLEMENTER_MODEL"] = self.implementer_model
            env["VERTEX_PROJECT"] = env.get("GOOGLE_CLOUD_PROJECT", "")
            env["VERTEX_LOCATION"] = (
                (env.get("CONSILIUM_VERTEX_GEMINI_REGION", "") or "").strip()
                or (env.get("GOOGLE_CLOUD_LOCATION", "") or "").strip()
                or "global"
            )
            vertex_connect_timeout_raw = (
                os.getenv("CONSILIUM_VERTEX_HTTP_CONNECT_TIMEOUT_SEC", "") or ""
            ).strip()
            vertex_max_time_raw = (os.getenv("CONSILIUM_VERTEX_HTTP_MAX_TIME_SEC", "") or "").strip()
            try:
                vertex_connect_timeout = int(vertex_connect_timeout_raw) if vertex_connect_timeout_raw else 10
            except ValueError:
                vertex_connect_timeout = 10
            try:
                vertex_max_time = int(vertex_max_time_raw) if vertex_max_time_raw else 120
            except ValueError:
                vertex_max_time = 120

            # Chat path uses multi-location Vertex fallback in the wrapper.
            # Keep per-attempt HTTP timeout inside the Ralphex idle budget,
            # otherwise the wrapper can be killed before first model text arrives.
            enable_location_fallback = _env_bool(
                "CONSILIUM_VERTEX_ENABLE_LOCATION_FALLBACK",
                default=False,
            )
            max_location_attempts = 3 if enable_location_fallback else 1
            idle_budget = max(45, self.chat_idle_timeout_sec - 10)
            per_attempt_max = max(30, idle_budget // max_location_attempts)
            per_attempt_connect = max(5, min(vertex_connect_timeout, 15))
            effective_max_time = max(30, min(vertex_max_time, per_attempt_max))
            token_timeout_raw = (os.getenv("CONSILIUM_VERTEX_TOKEN_TIMEOUT_SEC", "") or "").strip()
            try:
                token_timeout = int(token_timeout_raw) if token_timeout_raw else 20
            except ValueError:
                token_timeout = 20
            token_timeout = max(10, min(token_timeout, 60))

            env["VERTEX_HTTP_CONNECT_TIMEOUT_SEC"] = str(per_attempt_connect)
            env["VERTEX_HTTP_MAX_TIME_SEC"] = str(effective_max_time)
            env["VERTEX_TOKEN_TIMEOUT_SEC"] = str(token_timeout)
            env["VERTEX_ENABLE_LOCATION_FALLBACK"] = "1" if enable_location_fallback else "0"
        local_tmp = _ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)
        env = _prepare_gateway_git_shim_env(env)
        self._adapter_bootstrap._ensure_ralphex_bridge()
        # Use chat-optimized prompts only for non-coding chat/repo-read traffic.
        if chat_mode:
            env["RALPHEX_CONFIG_DIR"] = str(self._ensure_chat_config_dir())

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
        effective_timeout_sec = self.timeout_sec
        effective_idle_timeout_sec = self.idle_timeout_sec
        if "--tasks-only" in command:
            # Task-mode can stay silent for a while while ralphex/codex are still
            # doing work. Use a wider envelope to avoid false stalled errors.
            effective_timeout_sec = max(90, min(self.timeout_sec, self.chat_session_timeout_sec * 2))
            effective_idle_timeout_sec = max(
                15,
                min(self.idle_timeout_sec, self.chat_idle_timeout_sec + 15),
            )
        else:
            # Execute profile can include long review/tool phases without frequent
            # subprocess writes. Keep idle timeout wider than task-mode defaults.
            effective_idle_timeout_sec = _env_int(
                "CONSILIUM_RALPHEX_EXECUTE_IDLE_TIMEOUT_SEC",
                default=max(self.idle_timeout_sec, 900),
                minimum=0,
            )
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
            "transport_started request_id=%s session_id=%s pid=%s pgid=%s timeout_sec=%s idle_timeout_sec=%s mode=%s plan_mode=%s command_profile=%s",
            request_id,
            session_id,
            str(proc.pid),
            str(pgid),
            str(effective_timeout_sec),
            str(effective_idle_timeout_sec),
            self.mode,
            str(plan_mode).lower(),
            (
                "plan_tasks"
                if plan_mode
                else ("repo_read_tasks" if repo_read_mode else ("chat_tasks" if chat_mode else "standard_tasks"))
            ),
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
                if elapsed >= effective_timeout_sec:
                    _terminate_process_group(pgid)
                    raise subprocess.TimeoutExpired(cmd=command, timeout=effective_timeout_sec)
                if effective_idle_timeout_sec > 0 and idle >= effective_idle_timeout_sec:
                    _terminate_process_group(pgid)
                    raise RuntimeError(
                        f"ralphex stalled: no subprocess output for {int(idle)}s "
                        f"(idle timeout {effective_idle_timeout_sec}s)"
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
            # MVP behavior: if ralphex produced any stdout, return a compacted/normalized
            # status instead of hard-failing the HTTP request. This prevents chat from
            # hanging on benign runner exits like "max iterations reached".
            if stdout_text.strip():
                user_prompt = self._latest_user_prompt(messages)
                combined = stdout_text.strip()
                if stderr_text.strip():
                    combined = f"{combined}\n{stderr_text.strip()}"
                formatted = self._format_chat_response(combined, user_prompt=user_prompt)
                fallback = self._maybe_direct_codex_fallback(
                    formatted,
                    user_prompt,
                    trace_raw=combined,
                )
                if fallback:
                    return fallback
                return formatted

            stderr = stderr_text.strip()
            details = stderr or f"exit code {proc.returncode}"
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
        user_prompt = self._latest_user_prompt(messages)
        formatted = self._format_chat_response(text.strip(), user_prompt=user_prompt)
        raw_for_trace = stdout_text.strip()
        if stderr_text.strip():
            raw_for_trace = f"{raw_for_trace}\n{stderr_text.strip()}" if raw_for_trace else stderr_text.strip()
        if _env_bool("CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS", default=True):
            if "Технический трейс выполнения:" not in formatted:
                if raw_for_trace:
                    formatted = self._with_progress_trace(formatted, raw_for_trace)
        fallback = self._maybe_direct_codex_fallback(
            formatted,
            user_prompt,
            trace_raw=raw_for_trace,
        )
        if fallback:
            return fallback
        return formatted

    @staticmethod
    def _write_plan_file(messages: list[dict[str, str]], plan_mode: bool = False) -> pathlib.Path:
        _GATEWAY_PLANS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        plan_path = _GATEWAY_PLANS_DIR / f"gateway-{ts}-{uuid.uuid4().hex[:8]}.md"

        latest_user = ""
        for item in reversed(messages):
            if (item.get("role") or "").strip().lower() == "user":
                latest_user = _extract_effective_user_prompt((item.get("content") or "").strip())
                break
        if not latest_user:
            latest_user = "No explicit user request was provided."

        latest_user_compact = re.sub(r"\s+", " ", latest_user).strip()[:500]
        recent_context_lines: list[str] = []
        for item in messages[-4:]:
            role = (item.get("role") or "user").strip().lower()
            if role not in {"user", "assistant", "system"}:
                continue
            content = (item.get("content") or "").strip()
            if not content:
                continue
            compact = _compact_spaces(content)
            if not compact:
                continue
            recent_context_lines.append(f"- {role}: {_truncate_text(compact, 300)}")
        lines = [
            "# Consilium Gateway Chat Plan",
            "",
            "## Overview",
            f"- [ ] Answer latest user request: {latest_user_compact}",
            "",
            "## Context",
            "",
            "Latest user request:",
            "",
            "```text",
            latest_user,
            "```",
            "",
        ]
        if recent_context_lines:
            lines.extend(
                [
                    "Recent compact context:",
                    "",
                    *recent_context_lines,
                    "",
                ]
            )
        include_context_excerpts = plan_mode or _is_coding_request(latest_user)
        incremental_context = _build_incremental_git_context(
            include_diff_excerpt=include_context_excerpts,
            include_untracked_excerpt=include_context_excerpts,
        )
        if incremental_context:
            lines.extend(
                [
                    "Incremental repository context (git-based):",
                    "",
                    "```text",
                    incremental_context,
                    "```",
                    "",
                ]
            )
        if plan_mode:
            lines.extend(
                [
                    "",
                    "### Task 1: Prepare Plan-Mode Answer",
                    "- [ ] Understand latest user request.",
                    "- [ ] Build a concrete implementation plan for this repository.",
                    "- [ ] If needed, inspect repository context with shell commands.",
                    "- [ ] Do NOT claim code/file changes were applied in this mode.",
                    "- [ ] Mark all remaining [ ] checkboxes in this plan as [x].",
                    "- [ ] End with exact line: Final answer: <one concise response for user>.",
                    "- [ ] Emit exact signal line: <<<RALPHEX:ALL_TASKS_DONE>>>.",
                    "",
                    "## Success criteria",
                    "- [ ] The latest user request is answered directly.",
                    "- [ ] The response contains an actionable plan aligned to project context.",
                    "",
                ]
            )
        elif _is_coding_request(latest_user):
            lines.extend(
                [
                    "",
                    "### Task 1: Execute User Request In Repository",
                    "- [ ] Understand latest user request.",
                    "- [ ] Use shell commands as needed to inspect project state (files, git, tests, etc.).",
                    "- [ ] Edit project files when required by the request.",
                    "- [ ] Run relevant checks/tests when feasible.",
                    "- [ ] Mark all remaining [ ] checkboxes in this plan as [x].",
                    "- [ ] End with exact line: Final answer: <one concise response for user>.",
                    "- [ ] Emit exact signal line: <<<RALPHEX:ALL_TASKS_DONE>>>.",
                    "",
                    "## Success criteria",
                    "- [ ] The latest user request is addressed using real project context.",
                    "- [ ] Reported actions/checks reflect what was actually done.",
                    "",
                ]
            )
        elif _is_repo_read_request(latest_user):
            lines.extend(
                [
                    "",
                    "### Task 1: Read Repository Context For User",
                    "- [ ] Understand latest user request.",
                    "- [ ] Use shell commands as needed to inspect project structure/files.",
                    "- [ ] Do NOT edit files or claim edits were made.",
                    "- [ ] Do NOT run heavy test suites; keep commands lightweight.",
                    "- [ ] Mark all remaining [ ] checkboxes in this plan as [x].",
                    "- [ ] End with exact line: Final answer: <one concise response for user>.",
                    "- [ ] Emit exact signal line: <<<RALPHEX:ALL_TASKS_DONE>>>.",
                    "",
                    "## Success criteria",
                    "- [ ] The latest user request is answered using real repository context.",
                    "- [ ] Reported shell observations match actual command output.",
                    "",
                ]
            )
        else:
            lines.extend(
                [
                    "",
                    "### Task 1: Answer User Request In Chat Mode",
                    "- [ ] Understand latest user request.",
                    "- [ ] Do NOT run shell commands.",
                    "- [ ] Do NOT claim code/file edits or test execution.",
                    "- [ ] Produce concise direct answer in user's language.",
                    "- [ ] Mark all remaining [ ] checkboxes in this plan as [x].",
                    "- [ ] End with exact line: Final answer: <one concise response for user>.",
                    "- [ ] Emit exact signal line: <<<RALPHEX:ALL_TASKS_DONE>>>.",
                    "",
                    "## Success criteria",
                    "- [ ] The latest user request is answered directly without repository actions.",
                    "- [ ] The response remains concise and actionable.",
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
        cleaned_lines = [re.sub(r"^\[[^\]\n]+\]\s*", "", line).strip() for line in lines]
        for idx in range(len(cleaned_lines) - 1, -1, -1):
            line = cleaned_lines[idx]
            low = line.lower()
            if not any(low.startswith(marker) for marker in summary_markers):
                continue
            first_part = line.split(":", 1)[-1].strip()
            chunks = [first_part] if first_part else []
            for follow in cleaned_lines[idx + 1 :]:
                follow_low = follow.lower()
                if not follow:
                    break
                if follow.startswith("<<<"):
                    break
                if "all_tasks_done" in follow_low:
                    break
                if any(follow_low.startswith(marker) for marker in summary_markers):
                    break
                if "all tasks completed" in follow_low:
                    break
                if follow_low.startswith("task execution completed"):
                    break
                if follow_low.startswith("diffstats:"):
                    break
                if follow_low.startswith("warning:"):
                    break
                if follow_low.startswith("error:"):
                    break
                chunks.append(follow)
            answer = " ".join(chunk for chunk in chunks if chunk).strip()
            if answer:
                return answer
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
    def _progress_trace_enabled() -> bool:
        return _env_bool("CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE", default=True)

    @staticmethod
    def _progress_trace_success_enabled() -> bool:
        return _env_bool("CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS", default=True)

    @staticmethod
    def _render_progress_trace(raw_text: str) -> str:
        lines = [line.rstrip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            return ""

        max_lines = _env_int("CONSILIUM_GATEWAY_PROGRESS_TRACE_MAX_LINES", 140, minimum=20)
        max_chars = _env_int("CONSILIUM_GATEWAY_PROGRESS_TRACE_MAX_CHARS", 14000, minimum=1000)
        was_truncated = len(lines) > max_lines
        if len(lines) > max_lines:
            lines = lines[-max_lines:]
        trace = "\n".join(lines).strip()
        if len(trace) > max_chars:
            trace = trace[-max_chars:]
            was_truncated = True
        if was_truncated:
            trace = f"[trace truncated]\n{trace}"
        return trace

    @staticmethod
    def _with_progress_trace(summary: str, raw_text: str) -> str:
        if not RalphexTransport._progress_trace_enabled():
            return summary
        trace = RalphexTransport._render_progress_trace(raw_text)
        if not trace:
            return summary
        return f"{summary}\n\nТехнический трейс выполнения:\n{trace}"

    @staticmethod
    def _format_chat_response(raw_text: str, user_prompt: str) -> str:
        if not raw_text:
            return ""

        extracted_answer = RalphexTransport._extract_latest_user_answer(raw_text)
        if extracted_answer:
            if RalphexTransport._progress_trace_success_enabled():
                return RalphexTransport._with_progress_trace(extracted_answer, raw_text)
            return extracted_answer

        lines = raw_text.splitlines()
        error_line_re = re.compile(r"^(?:\[[^\]\n]+\]\s*)?error:\s*(.+?)\s*$", flags=re.IGNORECASE)
        ts_prefix_re = re.compile(r"^\[[^\]\n]+\]\s*")
        for idx, line in enumerate(lines):
            match = error_line_re.match(line.strip())
            if not match:
                continue
            details_parts = [match.group(1).strip()]
            for follow in lines[idx + 1 :]:
                follow_stripped = follow.strip()
                if not follow_stripped:
                    break
                cleaned = ts_prefix_re.sub("", follow_stripped).strip()
                cleaned_low = cleaned.lower()
                if not cleaned:
                    break
                if cleaned.startswith("$ "):
                    break
                if cleaned_low.startswith("error:"):
                    break
                if cleaned.startswith("---"):
                    break
                if cleaned_low.startswith("starting "):
                    break
                if cleaned_low.startswith("task execution completed"):
                    break
                if cleaned_low.startswith("all tasks completed"):
                    break
                if cleaned_low.startswith("review phases completed"):
                    break
                if cleaned_low.startswith("moved plan to"):
                    break
                if cleaned_low.startswith("completed in"):
                    break
                if cleaned_low.startswith("plan:"):
                    break
                if cleaned_low.startswith("branch:"):
                    break
                if cleaned_low.startswith("progress log:"):
                    break
                details_parts.append(cleaned)
            details = _compact_spaces(" ".join(part for part in details_parts if part))
            if details:
                return RalphexTransport._with_progress_trace(
                    f"Ошибка выполнения через ralphex: {details}",
                    raw_text,
                )

        if RalphexTransport._looks_like_ralphex_log(raw_text):
            progress_match = re.search(r"progress log:\s*(\S+)", raw_text, flags=re.IGNORECASE)
            progress_log = progress_match.group(1).strip() if progress_match else ""
            lowered = raw_text.lower()
            if "all_tasks_done" in lowered or "all tasks completed" in lowered:
                if progress_log:
                    return RalphexTransport._with_progress_trace(
                        "Ralphex завершил внутренний цикл, но не вернул `Final answer`. "
                        f"Проверьте progress log: {progress_log}",
                        raw_text,
                    )
                return RalphexTransport._with_progress_trace(
                    "Ralphex завершил внутренний цикл, но не вернул `Final answer`.",
                    raw_text,
                )
            if progress_log:
                return RalphexTransport._with_progress_trace(
                    f"Ralphex вернул только технический лог. Проверьте progress log: {progress_log}",
                    raw_text,
                )
            return RalphexTransport._with_progress_trace(
                "Ralphex вернул технический лог без пользовательского ответа.",
                raw_text,
            )

        return raw_text.strip()

    @staticmethod
    def _needs_direct_codex_fallback(text: str) -> bool:
        normalized = (text or "").strip().lower()
        if not normalized:
            return False
        markers = (
            "не вернул `final answer`",
            "did not return `final answer`",
            "вернул только технический лог",
            "вернул технический лог без пользовательского ответа",
            "ошибка выполнения через ralphex:",
            "codex exec failed:",
            "ralphex command failed:",
            "context canceled",
        )
        return any(marker in normalized for marker in markers)

    @staticmethod
    def _looks_like_provider_limit_error(text: str) -> bool:
        normalized = (text or "").strip().lower()
        if not normalized:
            return False
        markers = (
            "rate limit",
            "too many requests",
            "429",
            "insufficient_quota",
            "quota exceeded",
            "quota",
            "usage limit",
            "resource_exhausted",
            "лимит",
            "квота",
            "превышен лимит",
            "исчерпан",
        )
        return any(marker in normalized for marker in markers)

    @staticmethod
    def _looks_like_provider_stall_error(text: str) -> bool:
        normalized = (text or "").strip().lower()
        if not normalized:
            return False
        markers = (
            "max iterations",
            "without completion",
            "idle timed out",
            "no output activity detected",
            "running_no_output",
            "runner: task phase: max iterations",
        )
        return any(marker in normalized for marker in markers)

    @staticmethod
    def _attach_success_trace_if_needed(text: str, trace_raw: str, formatted_text: str) -> str:
        marker = "Технический трейс выполнения:"
        if not RalphexTransport._progress_trace_success_enabled():
            return text
        if marker in (text or ""):
            return text

        raw = (trace_raw or "").strip()
        if raw:
            return RalphexTransport._with_progress_trace(text, raw)

        formatted = (formatted_text or "").strip()
        if marker not in formatted:
            return text
        _, trace_tail = formatted.split(marker, 1)
        trace_tail = trace_tail.strip()
        if not trace_tail:
            return text
        return f"{text}\n\n{marker}\n{trace_tail}"

    def _maybe_direct_codex_fallback(
        self,
        formatted_text: str,
        user_prompt: str,
        trace_raw: str = "",
    ) -> str | None:
        if not self._needs_direct_codex_fallback(formatted_text):
            return None
        if self.enable_direct_codex_fallback:
            direct = self._complete_with_direct_codex(user_prompt)
            if direct:
                return self._attach_success_trace_if_needed(direct, trace_raw, formatted_text)
        else:
            LOGGER.warning("gateway_direct_codex_fallback_needed_but_disabled")
        local_repo_read = _build_repo_read_local_answer(user_prompt)
        if local_repo_read:
            LOGGER.warning("gateway_repo_read_local_recovery_used=true")
            return self._attach_success_trace_if_needed(local_repo_read, trace_raw, formatted_text)
        if self.enable_limit_fallback_to_gemini and (
            self._looks_like_provider_limit_error(formatted_text)
            or self._looks_like_provider_stall_error(formatted_text)
        ):
            vertex = self._complete_with_vertex_limit_fallback(user_prompt)
            if vertex:
                return self._attach_success_trace_if_needed(vertex, trace_raw, formatted_text)
        return None

    def _complete_with_vertex_limit_fallback(self, user_prompt: str) -> str | None:
        prompt = (user_prompt or "").strip()
        if not prompt:
            return None
        model = (self.limit_fallback_model or "").strip() or "gemini-2.5-pro"
        should_try_direct = False
        direct_prompt = prompt
        text = self._complete_with_vertex_limit_fallback_via_ralphex(
            prompt=prompt,
            model=model,
        )
        if text and text.strip():
            normalized = text.strip()
            if not self._needs_direct_codex_fallback(normalized):
                LOGGER.info("gateway_vertex_limit_fallback_ok model=%s route=ralphex", model)
                return normalized
            LOGGER.warning(
                "gateway_vertex_limit_fallback_ralphex_technical_only model=%s strict_ralphex_only=%s direct_recovery_enabled=%s",
                model,
                str(self.strict_ralphex_only).lower(),
                str(self.limit_fallback_allow_direct_recovery).lower(),
            )
            if self.strict_ralphex_only or not self.limit_fallback_allow_direct_recovery:
                return normalized
            should_try_direct = True
            if _is_repo_read_request(prompt):
                direct_prompt = _build_repo_read_direct_prompt(prompt)
        elif self.limit_fallback_route == "direct":
            should_try_direct = True

        if not should_try_direct:
            return None

        if self.strict_ralphex_only:
            LOGGER.warning("gateway_vertex_limit_fallback_direct_blocked strict_ralphex_only=true")
            return None

        try:
            direct = _run_direct_vertex_qa(direct_prompt, requested_model=model)
        except Exception as exc:
            LOGGER.warning(
                "gateway_vertex_limit_fallback_failed model=%s route=direct error=%s",
                model,
                _truncate_text(_compact_spaces(str(exc)), 400),
            )
            return None
        if direct and direct.strip():
            LOGGER.info("gateway_vertex_limit_fallback_ok model=%s route=direct", model)
            return direct.strip()
        return None

    def _complete_with_vertex_limit_fallback_via_ralphex(self, prompt: str, model: str) -> str | None:
        clean_prompt = (prompt or "").strip()
        if not clean_prompt:
            return None

        try:
            config_dir = self._ensure_vertex_limit_fallback_config_dir()
        except Exception as exc:
            LOGGER.warning(
                "gateway_vertex_limit_fallback_config_failed error=%s",
                _truncate_text(_compact_spaces(str(exc)), 300),
            )
            return None

        plan_path = self._write_plan_file([{"role": "user", "content": clean_prompt}], plan_mode=False)
        fallback_session_timeout_sec = _env_int(
            "CONSILIUM_GATEWAY_LIMIT_FALLBACK_CHAT_SESSION_TIMEOUT_SEC",
            default=max(90, self.chat_session_timeout_sec),
            minimum=30,
        )
        fallback_idle_timeout_sec = _env_int(
            "CONSILIUM_GATEWAY_LIMIT_FALLBACK_CHAT_IDLE_TIMEOUT_SEC",
            default=max(60, self.chat_idle_timeout_sec),
            minimum=20,
        )
        fallback_iterations = max(1, self.repo_read_max_iterations)
        command = self._tasks_command(
            max_iterations=fallback_iterations,
            session_timeout_sec=fallback_session_timeout_sec,
            idle_timeout_sec=fallback_idle_timeout_sec,
        )
        env = os.environ.copy()
        env["CONSILIUM_TASK_JSON"] = json.dumps([{"role": "user", "content": clean_prompt}], ensure_ascii=False)
        env["CONSILIUM_PLAN_FILE"] = str(plan_path.resolve())
        env["RALPHEX_CONFIG_DIR"] = str(config_dir)
        env["CONSILIUM_PLAN_MODE"] = "0"
        env["GEMINI_MODEL"] = model
        # Disable chat-shortcut here: it can degrade to plain QA phrasing and lose toolful behavior.
        env["CONSILIUM_VERTEX_CHAT_SHORTCUT"] = "0"
        local_tmp = _ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)

        timeout_sec = max(90, min(self.timeout_sec, fallback_session_timeout_sec + 60))
        try:
            proc = subprocess.run(
                ["bash", "-lc", command],
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                env=env,
            )
        except subprocess.TimeoutExpired:
            LOGGER.warning("gateway_vertex_limit_fallback_timeout route=ralphex timeout_sec=%s", str(timeout_sec))
            return None
        except Exception as exc:  # pragma: no cover - defensive runtime path
            LOGGER.warning("gateway_vertex_limit_fallback_error route=ralphex error=%s", str(exc))
            return None

        stdout_text = (proc.stdout or "").strip()
        stderr_text = (proc.stderr or "").strip()
        if proc.returncode != 0 and not stdout_text:
            details = stderr_text or f"exit code {proc.returncode}"
            LOGGER.warning(
                "gateway_vertex_limit_fallback_failed route=ralphex returncode=%s details=%s",
                str(proc.returncode),
                _truncate_text(_compact_spaces(details), 300),
            )
            return None

        extracted = self._extract_text(stdout_text).strip() if stdout_text else ""
        raw_text = extracted or stdout_text
        if not raw_text:
            return None
        formatted = self._format_chat_response(raw_text, user_prompt=clean_prompt).strip()
        if not formatted:
            return None
        if _env_bool("CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS", default=True):
            if "Технический трейс выполнения:" not in formatted and stdout_text:
                formatted = self._with_progress_trace(formatted, stdout_text)
        return formatted

    @staticmethod
    def _ensure_vertex_limit_fallback_config_dir() -> pathlib.Path:
        source_dir = RalphexTransport._ensure_chat_config_dir()
        fallback_dir = _RALPHEX_LIMIT_FALLBACK_CONFIG_DIR
        prompts_dir = fallback_dir / "prompts"
        prompts_dir.mkdir(parents=True, exist_ok=True)

        source_prompts = source_dir / "prompts"
        if source_prompts.exists():
            for src in source_prompts.glob("*.txt"):
                (prompts_dir / src.name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        # Force gateway chat prompts for limit-fallback route as well.
        # This avoids inheriting generic task-loop prompts from base ralphex config.
        (prompts_dir / "task.txt").write_text(_RALPHEX_CHAT_TASK_PROMPT, encoding="utf-8")
        (prompts_dir / "review_first.txt").write_text(_RALPHEX_CHAT_REVIEW_PROMPT, encoding="utf-8")
        (prompts_dir / "review_second.txt").write_text(_RALPHEX_CHAT_REVIEW_PROMPT, encoding="utf-8")

        source_config = source_dir / "config"
        if source_config.exists():
            cfg_text = source_config.read_text(encoding="utf-8")
        elif _RALPHEX_CONFIG_FILE.exists():
            cfg_text = _RALPHEX_CONFIG_FILE.read_text(encoding="utf-8")
        else:
            cfg_text = ""

        vertex_wrapper = str(_VERTEX_GEMINI_WRAPPER.resolve())
        lines = cfg_text.splitlines()
        updated: list[str] = []
        replaced = False
        for raw_line in lines:
            stripped = raw_line.strip()
            if stripped.startswith("claude_command"):
                updated.append(f"claude_command = {vertex_wrapper}")
                replaced = True
                continue
            updated.append(raw_line)
        if not replaced:
            updated.insert(0, f"claude_command = {vertex_wrapper}")

        (fallback_dir / "config").write_text("\n".join(updated).strip() + "\n", encoding="utf-8")
        return fallback_dir.resolve()

    def _complete_with_direct_codex(self, user_prompt: str) -> str | None:
        prompt = (user_prompt or "").strip()
        if not prompt:
            return None

        codex_command_raw = (os.getenv("CONSILIUM_CODEX_COMMAND") or "codex").strip()
        codex_command = codex_command_raw if os.path.isabs(codex_command_raw) else (shutil.which(codex_command_raw) or "")
        if not codex_command:
            LOGGER.warning("gateway_direct_codex_fallback_skipped reason=no_codex_binary")
            return None

        provider = (os.getenv("CONSILIUM_CODEX_MODEL_PROVIDER") or "openai").strip().lower()
        if not provider or provider == "consilium":
            provider = "openai"
        reasoning = (os.getenv("CONSILIUM_CODEX_REASONING_EFFORT") or "high").strip().lower() or "high"
        timeout_sec = _env_int("CONSILIUM_GATEWAY_DIRECT_CODEX_TIMEOUT_SEC", 90, minimum=15)

        env = os.environ.copy()
        env["CODEX_HOME"] = str(self._adapter_bootstrap._prepare_local_codex_home(self.model))
        local_tmp = _ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)

        args = [
            codex_command,
            "exec",
            "--json",
            "--dangerously-bypass-approvals-and-sandbox",
            "-s",
            _CODEX_SANDBOX,
            "-c",
            f"model_provider='{provider}'",
            "-c",
            f"model_reasoning_effort='{reasoning}'",
        ]
        if self.model:
            args.extend(["-m", self.model])

        try:
            proc = subprocess.run(
                args,
                input=prompt,
                text=True,
                capture_output=True,
                timeout=timeout_sec,
                env=env,
            )
        except subprocess.TimeoutExpired:
            LOGGER.warning("gateway_direct_codex_fallback_timeout timeout_sec=%s", str(timeout_sec))
            return None
        except Exception as exc:  # pragma: no cover - defensive runtime path
            LOGGER.warning("gateway_direct_codex_fallback_error error=%s", str(exc))
            return None

        message_text = ""
        error_text = ""
        for raw_line in (proc.stdout or "").splitlines():
            line = raw_line.strip()
            if not line or not (line.startswith("{") and line.endswith("}")):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            p_type = str(payload.get("type") or "").strip().lower()
            if p_type == "item.completed":
                item = payload.get("item") or {}
                if isinstance(item, dict) and (item.get("type") or "").strip() == "agent_message":
                    text = item.get("text")
                    if isinstance(text, str) and text.strip():
                        message_text = text.strip()
            elif p_type == "error":
                msg = payload.get("message")
                if isinstance(msg, str) and msg.strip():
                    error_text = msg.strip()
            elif p_type == "turn.failed":
                err = payload.get("error") or {}
                if isinstance(err, dict):
                    msg = err.get("message")
                    if isinstance(msg, str) and msg.strip():
                        error_text = msg.strip()

        if proc.returncode != 0:
            details = error_text or (proc.stderr or "").strip() or f"exit code {proc.returncode}"
            failure_blob = "\n".join(
                part for part in [error_text, proc.stderr or "", proc.stdout or ""] if isinstance(part, str) and part.strip()
            )
            LOGGER.warning(
                "gateway_direct_codex_fallback_failed returncode=%s details=%s",
                str(proc.returncode),
                _truncate_text(_compact_spaces(details), 400),
            )
            if self.enable_limit_fallback_to_gemini and self._looks_like_provider_limit_error(
                failure_blob or details
            ):
                LOGGER.warning("gateway_direct_codex_limit_detected switching_to_vertex_fallback=true")
                fallback = self._complete_with_vertex_limit_fallback(prompt)
                if fallback:
                    return fallback
            return None

        if self.enable_limit_fallback_to_gemini and self._looks_like_provider_limit_error(message_text):
            LOGGER.warning("gateway_direct_codex_limit_in_message switching_to_vertex_fallback=true")
            fallback = self._complete_with_vertex_limit_fallback(prompt)
            if fallback:
                return fallback

        if not message_text:
            LOGGER.warning("gateway_direct_codex_fallback_empty_output")
            if self.enable_limit_fallback_to_gemini and self._looks_like_provider_limit_error(
                "\n".join(part for part in [error_text, proc.stderr or "", proc.stdout or ""] if isinstance(part, str))
            ):
                LOGGER.warning("gateway_direct_codex_limit_without_message switching_to_vertex_fallback=true")
                fallback = self._complete_with_vertex_limit_fallback(prompt)
                if fallback:
                    return fallback
            return None

        if _env_bool("CONSILIUM_GATEWAY_EXPOSE_PROGRESS_TRACE_SUCCESS", default=True):
            trace_blob = "\n".join(
                part for part in [proc.stdout or "", proc.stderr or ""] if isinstance(part, str) and part.strip()
            )
            if trace_blob:
                message_text = self._with_progress_trace(message_text, trace_blob)

        LOGGER.info("gateway_direct_codex_fallback_ok")
        return message_text


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


def _truncate_text(text: str, limit: int) -> str:
    normalized = (text or "").strip()
    if limit <= 0 or len(normalized) <= limit:
        return normalized
    if limit <= 3:
        return normalized[:limit]
    return f"{normalized[: limit - 3]}..."


def _run_git_capture(args: list[str], timeout_sec: int = 4) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
    except Exception:
        return ""
    if proc.returncode != 0:
        return ""
    return (proc.stdout or "").strip()


def _build_incremental_git_context(
    max_files: int = 24,
    max_diff_chars: int = 10000,
    max_untracked_chars: int = 2000,
    include_diff_excerpt: bool = True,
    include_untracked_excerpt: bool = True,
) -> str:
    if not pathlib.Path(".git").exists():
        return ""

    head = _run_git_capture(["rev-parse", "--short", "HEAD"]) or "unknown"
    status = _run_git_capture(["status", "--porcelain=v1"])
    if not status:
        return f"head={head}; local_changes=none"

    changed_files: list[tuple[str, str]] = []
    untracked_files: list[str] = []
    for raw in status.splitlines():
        if len(raw) < 4:
            continue
        code = raw[:2]
        path_raw = raw[3:]
        path = path_raw.split(" -> ")[-1].strip()
        if not path:
            continue
        if code == "??":
            untracked_files.append(path)
        else:
            changed_files.append((code.strip() or "M", path))

    lines: list[str] = [f"head={head}"]
    if changed_files:
        lines.append("tracked_changes:")
        for code, path in changed_files[:max_files]:
            lines.append(f"- {code} {path}")

        if include_diff_excerpt:
            diff_targets = [path for _, path in changed_files[:max_files]]
            diff_text = _run_git_capture(["diff", "--no-color", "--unified=0", "HEAD", "--", *diff_targets], timeout_sec=8)
            if diff_text:
                clipped = _truncate_text(diff_text, max_diff_chars)
                lines.append("tracked_diff_excerpt:")
                lines.append(clipped)

    if untracked_files:
        lines.append("untracked_files:")
        for path in untracked_files[:max_files]:
            lines.append(f"- ?? {path}")
        if include_untracked_excerpt:
            preview_chunks: list[str] = []
            budget = max_untracked_chars
            for path in untracked_files[:4]:
                if budget <= 0:
                    break
                p = pathlib.Path(path)
                if not p.exists() or not p.is_file():
                    continue
                try:
                    snippet = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                snippet = _truncate_text(snippet, min(600, budget))
                preview_chunks.append(f"# {path}\n{snippet}")
                budget -= len(snippet)
            if preview_chunks:
                lines.append("untracked_excerpt:")
                lines.append("\n\n".join(preview_chunks))

    return "\n".join(lines).strip()


def _extract_effective_user_prompt(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    marker_patterns = (
        r"(?is)(?:^|\n)\s*##\s*My request for Codex:\s*(.+)$",
        r"(?is)(?:^|\n)\s*My request for Codex:\s*(.+)$",
        r"(?is)(?:^|\n)\s*##\s*Мой запрос к Codex:\s*(.+)$",
        r"(?is)(?:^|\n)\s*Мой запрос к Codex:\s*(.+)$",
    )

    extracted = raw
    for pattern in marker_patterns:
        matches = list(re.finditer(pattern, raw))
        if not matches:
            continue
        candidate = (matches[-1].group(1) or "").strip()
        if candidate:
            extracted = candidate
            break

    extracted = re.sub(r"(?s)\A```[a-zA-Z0-9_-]*\s*", "", extracted).strip()
    extracted = re.sub(r"(?s)\s*```\Z", "", extracted).strip()
    extracted = re.split(r"\n\s*##\s+", extracted, maxsplit=1)[0].strip()
    return extracted or raw


def _extract_collaboration_mode_marker(text: str) -> str | None:
    raw = (text or "").strip()
    if not raw:
        return None
    match = re.search(r"(?i)\bcollaboration\s+mode\s*:\s*(plan|default)\b", raw)
    if match:
        return match.group(1).lower()
    match = re.search(r"(?i)\bmode\s*=\s*(plan|default)\b", raw)
    if match:
        return match.group(1).lower()
    return None


def _stamp_source(text: str) -> str:
    normalized = (text or "").strip()
    if not normalized:
        return SOURCE_STAMP
    if SOURCE_STAMP in normalized:
        return normalized
    return f"{normalized}\n\n{SOURCE_STAMP}"


def _normalize_user_content_for_history(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    mode = _extract_collaboration_mode_marker(raw)
    effective = _extract_effective_user_prompt(raw)
    if not effective:
        effective = raw
    if mode:
        marker = f"Collaboration Mode: {mode.capitalize()}"
        if marker.lower() not in effective.lower():
            effective = f"{marker}\n{effective}"
    return _truncate_text(effective, MAX_USER_MESSAGE_CHARS)


def _normalize_message_for_history(role: str, content: str) -> str:
    normalized_role = (role or "").strip().lower()
    if normalized_role == "user":
        return _normalize_user_content_for_history(content)
    if normalized_role == "assistant":
        return _truncate_text(_compact_spaces(content), MAX_ASSISTANT_MESSAGE_CHARS)
    return _truncate_text(_compact_spaces(content), MAX_SYSTEM_MESSAGE_CHARS)


def _build_ralphex_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    if not messages:
        return []

    normalized: list[dict[str, str]] = []
    latest_system: dict[str, str] | None = None
    for item in messages:
        role = (item.get("role") or "user").strip().lower()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        content = _normalize_message_for_history(role, item.get("content") or "")
        if not content:
            continue
        entry = {"role": role, "content": content}
        if role == "system":
            latest_system = entry
            continue
        normalized.append(entry)

    if latest_system is not None:
        normalized.insert(0, latest_system)

    if len(normalized) > MAX_RALPHEX_MESSAGES:
        head: list[dict[str, str]] = []
        tail = normalized
        if normalized and normalized[0]["role"] == "system":
            head = [normalized[0]]
            tail = normalized[1:]
        remaining = max(0, MAX_RALPHEX_MESSAGES - len(head))
        if remaining == 0:
            normalized = head
        else:
            normalized = head + tail[-remaining:]

    total_chars = sum(len(item["content"]) for item in normalized)
    if total_chars <= MAX_RALPHEX_TOTAL_CHARS:
        return normalized

    compacted: list[dict[str, str]] = []
    budget = MAX_RALPHEX_TOTAL_CHARS
    for item in reversed(normalized):
        if budget <= 0:
            break
        role = item["role"]
        reserve = 150 if role == "user" else 80
        allowed = max(reserve, min(len(item["content"]), budget))
        content = _truncate_text(item["content"], allowed)
        compacted.append({"role": role, "content": content})
        budget -= len(content)
    compacted.reverse()
    return compacted[-MAX_RALPHEX_MESSAGES:]


def _to_internal_messages(messages: list[ChatMessage]) -> list[dict[str, str]]:
    internal: list[dict[str, str]] = []
    for msg in messages:
        role = (msg.role or "").strip().lower()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        content = _normalize_content(msg.content)
        normalized = _normalize_message_for_history(role, content)
        if not normalized:
            continue
        internal.append(
            {
                "role": role,
                "content": normalized,
            }
        )
    return internal


def _now() -> int:
    return int(time.time())


def _make_completion_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex}"


def _make_response_id() -> str:
    return f"resp-{uuid.uuid4().hex}"


def _make_response_output_item_id() -> str:
    return f"msg_{uuid.uuid4().hex}"


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


def _to_responses_content_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if isinstance(content.get("text"), str):
            return content["text"]
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
                continue
            nested = item.get("content")
            if isinstance(nested, str):
                parts.append(nested)
        return "".join(parts)
    return str(content)


def _responses_input_to_chat_messages(input_payload: Any) -> list[ChatMessage]:
    if input_payload is None:
        return []
    if isinstance(input_payload, str):
        return [ChatMessage(role="user", content=input_payload)]

    entries: list[Any]
    if isinstance(input_payload, dict):
        entries = [input_payload]
    elif isinstance(input_payload, list):
        entries = list(input_payload)
    else:
        return [ChatMessage(role="user", content=str(input_payload))]

    result: list[ChatMessage] = []
    for entry in entries:
        if isinstance(entry, str):
            if entry.strip():
                result.append(ChatMessage(role="user", content=entry))
            continue
        if not isinstance(entry, dict):
            continue
        role = (entry.get("role") or "").strip().lower()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        if "content" in entry:
            content = _to_responses_content_text(entry.get("content"))
        else:
            content = _to_responses_content_text(entry.get("text"))
        if content.strip():
            result.append(ChatMessage(role=role, content=content))
    return result


def _extract_chat_text(body: dict) -> str:
    try:
        message = body["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    return _normalize_content(content)


def _responses_usage_from_chat_usage(chat_usage: dict | None) -> dict:
    usage = chat_usage or {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (input_tokens + output_tokens))
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def _build_responses_non_stream_response(
    model: str,
    response_id: str,
    text: str,
    usage: dict | None = None,
) -> dict:
    output_item_id = _make_response_output_item_id()
    return {
        "id": response_id,
        "object": "response",
        "created_at": _now(),
        "status": "completed",
        "model": model,
        "output": [
            {
                "id": output_item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": text,
                        "annotations": [],
                    }
                ],
            }
        ],
        "usage": _responses_usage_from_chat_usage(usage),
        "output_text": text,
    }


def _build_responses_stream_generator(model: str, response_id: str, text: str):
    def _event(event: str, data: dict) -> str:
        payload = json.dumps(data, ensure_ascii=False)
        return f"event: {event}\ndata: {payload}\n\n"

    def _iter():
        created_at = _now()
        output_item_id = _make_response_output_item_id()
        output_text_part = {"type": "output_text", "text": "", "annotations": []}
        yield _event(
            "response.created",
            {
                "type": "response.created",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "created_at": created_at,
                    "status": "in_progress",
                    "model": model,
                    "output": [],
                },
            },
        )
        yield _event(
            "response.in_progress",
            {
                "type": "response.in_progress",
                "response": {
                    "id": response_id,
                    "object": "response",
                    "created_at": created_at,
                    "status": "in_progress",
                    "model": model,
                    "output": [],
                },
            },
        )
        yield _event(
            "response.output_item.added",
            {
                "type": "response.output_item.added",
                "response_id": response_id,
                "output_index": 0,
                "item": {
                    "id": output_item_id,
                    "type": "message",
                    "status": "in_progress",
                    "role": "assistant",
                    "content": [output_text_part],
                },
            },
        )
        yield _event(
            "response.content_part.added",
            {
                "type": "response.content_part.added",
                "response_id": response_id,
                "item_id": output_item_id,
                "output_index": 0,
                "content_index": 0,
                "part": output_text_part,
            },
        )
        for piece in _split_for_stream(text):
            yield _event(
                "response.output_text.delta",
                {
                    "type": "response.output_text.delta",
                    "response_id": response_id,
                    "item_id": output_item_id,
                    "output_index": 0,
                    "content_index": 0,
                    "delta": piece,
                },
            )
        yield _event(
            "response.output_text.done",
            {
                "type": "response.output_text.done",
                "response_id": response_id,
                "item_id": output_item_id,
                "output_index": 0,
                "content_index": 0,
                "text": text,
            },
        )
        completed_part = {"type": "output_text", "text": text, "annotations": []}
        completed_item = {
            "id": output_item_id,
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [completed_part],
        }
        yield _event(
            "response.content_part.done",
            {
                "type": "response.content_part.done",
                "response_id": response_id,
                "item_id": output_item_id,
                "output_index": 0,
                "content_index": 0,
                "part": completed_part,
            },
        )
        yield _event(
            "response.output_item.done",
            {
                "type": "response.output_item.done",
                "response_id": response_id,
                "output_index": 0,
                "item": completed_item,
            },
        )
        yield _event(
            "response.completed",
            {
                "type": "response.completed",
                "response": _build_responses_non_stream_response(
                    model=model,
                    response_id=response_id,
                    text=text,
                    usage=None,
                ),
            },
        )
        yield "data: [DONE]\n\n"

    return _iter()


def _available_model_ids() -> list[str]:
    ids = [DEFAULT_MODEL]
    for alias in _resolve_public_model_aliases():
        if alias not in ids:
            ids.append(alias)
    if LEGACY_MODEL_ALIAS not in ids:
        ids.append(LEGACY_MODEL_ALIAS)
    return ids


def _resolve_response_model(requested_model: str | None) -> str:
    requested = (requested_model or "").strip()
    if requested and requested in _available_model_ids():
        return requested
    return DEFAULT_MODEL


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
    # Avoid accidental cross-talk between unrelated chats when client does not
    # provide a stable session identifier.
    return f"ephemeral-{uuid.uuid4().hex[:12]}"


def _latest_user_text(messages: list[dict[str, str]]) -> str:
    for item in reversed(messages):
        if (item.get("role") or "").strip().lower() == "user":
            return _extract_effective_user_prompt((item.get("content") or "").strip())
    return ""


def _is_integration_health_probe(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    return ("интеграци" in normalized and "жив" in normalized) or (
        "integration" in normalized and ("alive" in normalized or "working" in normalized or "live" in normalized)
    )


def _is_coding_request(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    if normalized in {"тест", "test"}:
        return False
    capability_or_meta_markers = (
        "видишь файлы",
        "видишь файл",
        "видишь проект",
        "помнишь историю",
        "контекст на одно сообщение",
        "роль критика",
        "consult",
        "консультир",
        "через ральф",
        "через ralph",
    )
    if any(marker in normalized for marker in capability_or_meta_markers):
        return False
    quick_reply_markers = (
        "ответь словом",
        "просто ответь",
        "just answer",
        "проверка",
        "check:",
    )
    if any(marker in normalized for marker in quick_reply_markers):
        explicit_code_context = (
            "в код",
            "в файле",
            "в проекте",
            "repository",
            "repo",
            "commit",
            "git",
            "endpoint",
            "api",
            "миграц",
            "тест",
            "test",
        )
        if not any(marker in normalized for marker in explicit_code_context):
            return False
    non_coding_error_explain_markers = (
        "что за ошибка",
        "что это за ошибка",
        "что значит ошибка",
        "что означает ошибка",
        "почему ошибка",
        "чё это за ошибка",
    )
    if any(marker in normalized for marker in non_coding_error_explain_markers):
        return False
    non_coding_chat_markers = (
        "какая модель",
        "какая сейчас модель",
        "через ральф",
        "через ralph",
        "подключен к ральф",
        "подключена к ральф",
        "жив ли ральф",
        "жив ли ralph",
    )
    if any(marker in normalized for marker in non_coding_chat_markers):
        return False
    strong_coding_markers = (
        "add",
        "create",
        "write",
        "fix",
        "implement",
        "refactor",
        "patch",
        "debug",
        "compile",
        "build",
        "migrate",
        "добав",
        "создай",
        "напиши",
        "почини",
        "исправ",
        "пофикс",
        "рефактор",
        "миграц",
        "депло",
        "сборк",
        "terraform",
        "tofu",
    )
    if any(marker in normalized for marker in strong_coding_markers):
        return True

    weak_code_context_markers = (
        "code",
        "код",
        "endpoint",
        "эндпоинт",
        "api",
        "route",
        "роут",
        "маршрут",
        "handler",
        "service",
        "function",
        "bug",
        "issue",
        "test",
        "tests",
        "тест",
        "файл",
        "файлы",
        "repo",
        "repository",
        "миграц",
    )
    intent_markers = (
        "please",
        "сделай",
        "сможешь",
        "нужно",
        "надо",
        "нужен",
        "пожалуйста",
        "can you",
        "could you",
    )
    return any(marker in normalized for marker in weak_code_context_markers) and any(
        marker in normalized for marker in intent_markers
    )


def _is_repo_read_request(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    if _is_coding_request(normalized):
        return False
    meta_or_capability_markers = (
        "видишь файлы",
        "видишь файл",
        "не видишь файлы",
        "помнишь историю",
    )
    if any(marker in normalized for marker in meta_or_capability_markers):
        return False
    repo_read_markers = (
        "структуру проекта",
        "структура проекта",
        "структуру репозитория",
        "структура репозитория",
        "посмотри структуру",
        "покажи структуру",
        "проанализируй структуру",
        "проанализировать структуру",
        "анализ структуры",
        "текущую директорию",
        "текущий каталог",
        "рабочую директорию",
        "рабочий каталог",
        "какие файлы",
        "покажи файлы",
        "список файлов",
        "файлы проекта",
        "файлы в проекте",
        "назови файлы",
        "назови 3 файла",
        "назови три файла",
        "key directories",
        "project structure",
        "repo structure",
        "repository structure",
        "working directory",
        "current directory",
        "current working directory",
        "list files",
        "project files",
        "files in project",
        "name 3 project files",
        "three project files",
        "pwd",
    )
    if any(marker in normalized for marker in repo_read_markers):
        return True

    list_request_markers = (
        "назови",
        "покажи",
        "выведи",
        "list",
        "show",
        "print",
        "name",
    )
    repo_context_markers = (
        "файл",
        "files",
        "директор",
        "каталог",
        "directory",
        "project",
        "repo",
        "repository",
    )
    if any(marker in normalized for marker in list_request_markers) and any(
        marker in normalized for marker in repo_context_markers
    ):
        return True

    return False


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
    if _is_coding_request(normalized):
        return False
    if _is_integration_health_probe(normalized):
        return False
    if probe_candidate in exact_probe_markers:
        return True
    if any(marker in normalized for marker in phrase_probe_markers):
        return True
    # A plain greeting should not bypass the full execution path.
    return any(marker in normalized for marker in greeting_markers) and (
        "связ" in normalized or "connection" in normalized
    )


def _looks_like_ralphex_claude_exit_error(text: str) -> bool:
    normalized = (text or "").lower()
    if not normalized:
        return False
    return (
        "runner: task phase: claude execution" in normalized
        and "command wait: exit status 1" in normalized
    )


def _looks_like_ralphex_context_error(text: str) -> bool:
    normalized = (text or "").lower()
    if not normalized:
        return False
    markers = (
        "contextwindowexceeded",
        "context window",
        "maximum context length",
        "too many tokens",
        "token limit",
        "input is too long",
        "request too large",
    )
    return any(marker in normalized for marker in markers)


def _looks_like_ralphex_stall_error(text: str) -> bool:
    normalized = (text or "").lower()
    if not normalized:
        return False
    return "ralphex stalled:" in normalized and "idle timeout" in normalized


def _build_repo_read_direct_prompt(user_prompt: str) -> str:
    prompt = (user_prompt or "").strip()
    if not prompt:
        return prompt

    root = pathlib.Path.cwd().resolve()
    root_entries: list[str] = []
    try:
        for entry in sorted(root.iterdir(), key=lambda item: item.name.lower()):
            name = entry.name
            if name in {".git", ".venv", ".cache", "__pycache__", ".ruff_cache", ".pytest_cache"}:
                continue
            root_entries.append(f"{name}/" if entry.is_dir() else name)
            if len(root_entries) >= 24:
                break
    except OSError:
        root_entries = []

    sample_files: list[str] = []
    skip_dirs = {
        ".git",
        ".venv",
        ".cache",
        "__pycache__",
        ".ruff_cache",
        ".pytest_cache",
        "node_modules",
    }
    try:
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = pathlib.Path(dirpath).resolve().relative_to(root)
            depth = len(rel_dir.parts)
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            if depth >= 3:
                dirnames[:] = []
            for filename in sorted(filenames):
                if filename.startswith("."):
                    continue
                full = pathlib.Path(dirpath) / filename
                try:
                    rel = full.resolve().relative_to(root)
                except Exception:
                    continue
                sample_files.append(str(rel))
                if len(sample_files) >= 24:
                    break
            if len(sample_files) >= 24:
                break
    except OSError:
        sample_files = []

    snapshot_lines = [f"- cwd: {root}"]
    if root_entries:
        snapshot_lines.append(f"- top_level: {', '.join(root_entries)}")
    if sample_files:
        snapshot_lines.append(f"- sample_files: {', '.join(sample_files)}")

    snapshot_block = "\n".join(snapshot_lines)
    return (
        "You are answering a repository-read request. Use ONLY the trusted snapshot below.\n"
        "Do not claim you cannot access files. If info is insufficient, say exactly what is missing.\n\n"
        f"User request:\n{prompt}\n\n"
        f"Trusted repository snapshot:\n{snapshot_block}\n\n"
        "Return a concise user-facing answer in the same language as the user."
    )


def _build_repo_read_local_answer(user_prompt: str, max_files: int = 3) -> str | None:
    if not _is_repo_read_request(user_prompt):
        return None

    root = pathlib.Path.cwd().resolve()
    sample_files: list[str] = []
    tracked = _run_git_capture(["ls-files"])
    if tracked:
        for raw in tracked.splitlines():
            path = raw.strip()
            if not path or path.startswith("."):
                continue
            sample_files.append(path)
            if len(sample_files) >= max_files:
                break

    if sample_files:
        files_block = "\n".join(f"- `{path}`" for path in sample_files[:max_files])
        return (
            f"Текущая директория: `{root}`\n"
            f"Примеры файлов проекта:\n{files_block}"
        )

    skip_dirs = {
        ".git",
        ".venv",
        ".cache",
        "__pycache__",
        ".ruff_cache",
        ".pytest_cache",
        "node_modules",
    }
    try:
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = pathlib.Path(dirpath).resolve().relative_to(root)
            depth = len(rel_dir.parts)
            dirnames[:] = [d for d in sorted(dirnames) if d not in skip_dirs and not d.startswith(".")]
            if depth >= 3:
                dirnames[:] = []
            for filename in sorted(filenames):
                if filename.startswith("."):
                    continue
                full = pathlib.Path(dirpath) / filename
                try:
                    rel = full.resolve().relative_to(root)
                except Exception:
                    continue
                sample_files.append(str(rel))
                if len(sample_files) >= max_files:
                    break
            if len(sample_files) >= max_files:
                break
    except OSError:
        return None

    if not sample_files:
        return f"Текущая директория: {root}\nФайлы в проекте не найдены."

    files_block = "\n".join(f"- `{path}`" for path in sample_files[:max_files])
    return (
        f"Текущая директория: `{root}`\n"
        f"Примеры файлов проекта:\n{files_block}"
    )


def _should_retry_ralphex_chat_failure(text: str) -> bool:
    return (
        _looks_like_ralphex_claude_exit_error(text)
        or _looks_like_ralphex_max_iterations_error(text)
        or _looks_like_ralphex_context_error(text)
        or _looks_like_ralphex_stall_error(text)
    )


def _should_route_direct_qa(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    if _is_connectivity_probe(normalized):
        return False
    if _is_integration_health_probe(normalized):
        return False
    if _is_coding_request(normalized):
        return False
    question_markers = (
        "?",
        "что ",
        "как ",
        "почему ",
        "зачем ",
        "какие ",
        "какой ",
        "расскажи",
        "explain ",
        "what ",
        "how ",
        "why ",
        "tell ",
    )
    if any(marker in normalized for marker in question_markers):
        return True
    # Cursor users often send short colloquial checks; keep them on the fast direct QA path.
    conversational_markers = (
        "работает",
        "поменял",
        "изменил",
        "жив",
        "отвеча",
        "че",
        "чё",
        "что-нибудь",
        "что нибудь",
        "anything",
        "changed",
        "works",
        "working",
    )
    return len(normalized) <= 180 and any(marker in normalized for marker in conversational_markers)


def _is_direct_qa_enabled() -> bool:
    if _env_bool("CONSILIUM_RALPHEX_ONLY", default=False):
        return False
    # Default is enabled for non-coding prompts: ralphex task loop expects tool-capable agent output
    # and can stall on plain text wrappers.
    return _env_bool("CONSILIUM_DIRECT_QA_ENABLED", default=True)


def _select_direct_qa_model(
    requested_model: str | None,
    configured_provider: str,
    configured_model: str,
) -> tuple[str, str]:
    requested = (requested_model or "").strip()
    req_lower = requested.lower()
    cfg_provider = (configured_provider or "").strip().lower()
    cfg_model = (configured_model or "").strip()

    if "gemini" in req_lower:
        return "google", requested
    if "claude" in req_lower:
        return "vertex-anthropic", requested

    model_lower = cfg_model.lower()
    if "claude" in model_lower:
        return "vertex-anthropic", cfg_model
    if "gemini" in model_lower:
        return "google", cfg_model
    return cfg_provider, cfg_model


def _run_direct_vertex_qa(prompt: str, requested_model: str | None = None) -> str:
    runtime = load_runtime_config()
    implementer_cfg = runtime.model_for("implementer")
    gateway_provider = (os.getenv("CONSILIUM_GATEWAY_PROVIDER", "") or "").strip().lower()
    gateway_model = (os.getenv("CONSILIUM_GATEWAY_MODEL", "") or "").strip()
    configured_provider = gateway_provider or implementer_cfg.provider
    configured_model = gateway_model or implementer_cfg.model
    provider, model = _select_direct_qa_model(
        requested_model=requested_model,
        configured_provider=configured_provider,
        configured_model=configured_model,
    )

    try:
        _transport._adapter_bootstrap._ensure_ralphex_bridge()
    except Exception:
        pass

    if provider == "google":
        wrapper = _VERTEX_GEMINI_WRAPPER.resolve()
    elif provider in {"vertex-anthropic", "anthropic"}:
        wrapper = _VERTEX_ANTHROPIC_WRAPPER.resolve()
    else:
        raise RuntimeError(
            f"direct QA route supports only google/vertex-anthropic providers, got: {provider}"
        )
    if not wrapper.exists():
        raise RuntimeError(f"vertex wrapper not found: {wrapper}")

    env = os.environ.copy()
    env["VERTEX_PROJECT"] = env.get("GOOGLE_CLOUD_PROJECT", "")
    if provider == "google":
        vertex_location = (
            (env.get("CONSILIUM_VERTEX_GEMINI_REGION", "") or "").strip()
            or (env.get("GOOGLE_CLOUD_LOCATION", "") or "").strip()
            or "global"
        )
    else:
        vertex_location = (
            (env.get("CONSILIUM_VERTEX_ANTHROPIC_REGION", "") or "").strip()
            or (env.get("GOOGLE_CLOUD_LOCATION", "") or "").strip()
            or "us-east5"
        )
    env["VERTEX_LOCATION"] = vertex_location
    vertex_connect_timeout_cfg = _env_int("CONSILIUM_VERTEX_HTTP_CONNECT_TIMEOUT_SEC", 10, minimum=3)
    vertex_max_time_cfg = _env_int("CONSILIUM_VERTEX_HTTP_MAX_TIME_SEC", 90, minimum=15)
    # Direct QA path should stay conversationally fast even on provider issues.
    vertex_connect_timeout = max(3, min(vertex_connect_timeout_cfg, 5))
    vertex_max_time = max(15, min(vertex_max_time_cfg, 45))
    env["VERTEX_HTTP_CONNECT_TIMEOUT_SEC"] = str(vertex_connect_timeout)
    env["VERTEX_HTTP_MAX_TIME_SEC"] = str(vertex_max_time)
    if provider == "google":
        env["GEMINI_MODEL"] = model
    else:
        env["ANTHROPIC_VERTEX_MODEL"] = model
    if not env["VERTEX_PROJECT"]:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for direct Vertex QA route")
    local_tmp = _ensure_local_tmp_dir()
    env["TMPDIR"] = str(local_tmp)
    env["TMP"] = str(local_tmp)
    env["TEMP"] = str(local_tmp)
    timeout_sec = _env_int(
        "CONSILIUM_GATEWAY_DIRECT_TIMEOUT_SEC",
        DEFAULT_DIRECT_QA_TIMEOUT_SEC,
        minimum=30,
    )
    proc = subprocess.run(
        [str(wrapper), "-p", prompt],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        env=env,
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        details = stderr or stdout or f"exit code {proc.returncode}"
        details = re.sub(r"\s+", " ", details).strip()
        if len(details) > 600:
            details = details[:600].rstrip() + "..."
        raise RuntimeError(f"direct Vertex QA failed: {details}")
    text = RalphexTransport._extract_text(stdout).strip()
    if not text:
        text = stdout
    lowered = text.strip().lower()
    if lowered.startswith("vertex transport error") or lowered.startswith("vertex error"):
        raise RuntimeError(text.strip())
    if not text.strip():
        raise RuntimeError("direct Vertex QA returned empty response")
    return text.strip()


def _looks_like_vertex_model_access_issue(error: Exception) -> bool:
    message = (str(error) or "").strip().lower()
    if not message:
        return False
    markers = (
        "not found",
        "does not have access",
        "resource has been exhausted",
        "resource_exhausted",
        "permission denied",
        "unauthenticated",
        "error code: 404",
        "error code: 401",
        "error code: 403",
        "error code: 429",
    )
    return any(marker in message for marker in markers)


def _looks_like_ralphex_max_iterations_error(message: str) -> bool:
    normalized = (message or "").strip().lower()
    if not normalized:
        return False
    return "max iterations" in normalized and "without completion" in normalized


def _check_bearer_token(auth_header: str | None, x_api_key: str | None = None) -> None:
    api_key = os.getenv("CONSILIUM_API_KEY", DEFAULT_API_KEY)
    header_api_key = x_api_key if isinstance(x_api_key, str) else None
    if header_api_key and header_api_key.strip() == api_key:
        return
    has_bearer = isinstance(auth_header, str) and bool(auth_header.strip())
    if header_api_key and header_api_key.strip() != api_key and not has_bearer:
        LOGGER.warning(
            "auth_failed scheme=%r token_present=%s token_len=%d",
            "x-api-key",
            "true",
            len(header_api_key.strip()),
        )
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not has_bearer:
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
        _resolve_response_model(payload.model),
        str(payload.stream).lower(),
        len(payload.messages),
    )
    incoming = _to_internal_messages(payload.messages)
    history = _upsert_session_messages(session_id, incoming)
    ralphex_messages = _build_ralphex_messages(history)
    completion_id = _make_completion_id()
    model = _resolve_response_model(payload.model)
    LOGGER.info("chat_request_dispatch completion_id=%s session_id=%s", completion_id, session_id)

    latest_user = _latest_user_text(incoming) or _latest_user_text(history)
    stale_global_limit_sec = _env_int(
        "CONSILIUM_RALPHEX_STALE_MAX_SEC",
        default=max(_transport.chat_session_timeout_sec + 60, 300),
        minimum=60,
    )
    stale_no_output_idle_sec = _env_int(
        "CONSILIUM_RALPHEX_NO_OUTPUT_STALE_MAX_SEC",
        default=max(_transport.chat_idle_timeout_sec + 10, 45),
        minimum=15,
    )
    _cleanup_stale_active_runs(
        max_elapsed_sec=stale_global_limit_sec,
        reason="preflight_global",
        max_no_output_idle_sec=stale_no_output_idle_sec,
    )
    primary_messages = ralphex_messages
    LOGGER.info(
        "chat_request_context session_id=%s incoming=%d history=%d ralphex=%d",
        session_id,
        len(incoming),
        len(history),
        len(ralphex_messages),
    )
    LOGGER.info(
        "chat_request_route completion_id=%s session_id=%s latest_user_len=%d route=ralphex_pipe",
        completion_id,
        session_id,
        len(latest_user),
    )

    try:
        pipe_text = _pipe.complete(session_id=session_id, messages=primary_messages, request_id=completion_id)
        answer = _stamp_source(pipe_text)
    except subprocess.TimeoutExpired:
        answer = _stamp_source("Ошибка: ralphex timeout")
        _append_assistant_message(session_id, answer)
        if payload.stream:
            return StreamingResponse(
                _build_stream_generator(model=model, completion_id=completion_id, text=answer),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))
    except RuntimeError as exc:
        message = str(exc)
        if message.startswith("ralphex stalled:"):
            answer = _stamp_source(f"Ошибка: {message}")
        else:
            answer = _stamp_source(f"Ошибка: {message}")
        _append_assistant_message(session_id, answer)
        if payload.stream:
            return StreamingResponse(
                _build_stream_generator(model=model, completion_id=completion_id, text=answer),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))
    except FileNotFoundError as exc:
        answer = _stamp_source(f"Ошибка: runtime dependency missing: {exc}")
        _append_assistant_message(session_id, answer)
        if payload.stream:
            return StreamingResponse(
                _build_stream_generator(model=model, completion_id=completion_id, text=answer),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))
    except HTTPException:
        raise
    except Exception as exc:
        answer = _stamp_source(f"Ошибка: {exc}")
        _append_assistant_message(session_id, answer)
        if payload.stream:
            return StreamingResponse(
                _build_stream_generator(model=model, completion_id=completion_id, text=answer),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))

    _append_assistant_message(session_id, answer)

    if payload.stream:
        return StreamingResponse(
            _build_stream_generator(model=model, completion_id=completion_id, text=answer),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    return JSONResponse(_build_non_stream_response(model=model, completion_id=completion_id, text=answer))


@app.post("/v1/responses")
def responses(
    payload: ResponsesRequest,
    authorization: str | None = Header(default=None),
    x_session_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    LOGGER.info(
        "responses_request requested_model=%s stream=%s input_type=%s",
        payload.model or DEFAULT_MODEL,
        str(payload.stream).lower(),
        type(payload.input).__name__,
    )
    chat_messages = _responses_input_to_chat_messages(payload.input)
    if payload.instructions and payload.instructions.strip():
        chat_messages.insert(0, ChatMessage(role="system", content=payload.instructions.strip()))
    if not chat_messages:
        raise HTTPException(status_code=400, detail="input must contain at least one message")

    chat_payload = ChatCompletionsRequest(
        model=payload.model or DEFAULT_MODEL,
        messages=chat_messages,
        stream=False,
        temperature=payload.temperature,
        max_tokens=payload.max_output_tokens,
        user=payload.user,
    )
    chat_response = chat_completions(
        chat_payload,
        authorization=authorization,
        x_session_id=x_session_id,
        x_api_key=x_api_key,
    )
    if not isinstance(chat_response, JSONResponse):
        raise HTTPException(status_code=500, detail="internal gateway error")

    chat_body = json.loads(chat_response.body.decode("utf-8"))
    response_id = _make_response_id()
    text = _extract_chat_text(chat_body)
    model = (chat_body.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    usage = chat_body.get("usage") if isinstance(chat_body.get("usage"), dict) else {}

    if payload.stream:
        return StreamingResponse(
            _build_responses_stream_generator(model=model, response_id=response_id, text=text),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    return JSONResponse(
        _build_responses_non_stream_response(
            model=model,
            response_id=response_id,
            text=text,
            usage=usage,
        )
    )

from __future__ import annotations

import json
import logging
import os
import pathlib
import re
import shlex
import shutil
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
LOGGER = logging.getLogger("consilium.gateway")
logging.basicConfig(level=os.getenv("CONSILIUM_GATEWAY_LOG_LEVEL", "INFO"))
_GATEWAY_PLANS_DIR = pathlib.Path(".consilium/gateway/plans")
_RALPHEX_CONFIG_DIR = pathlib.Path(".consilium/ralphex")
_CODEX_SANDBOX = os.getenv("CONSILIUM_CODEX_SANDBOX", "danger-full-access")


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
        self.timeout_sec = int(os.getenv("CONSILIUM_RALPHEX_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))

    def execute(self, messages: list[dict[str, str]]) -> str:
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

        proc = subprocess.run(
            ["bash", "-lc", self.command],
            capture_output=True,
            text=True,
            env=env,
            timeout=self.timeout_sec,
        )

        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip()
            stdout = (proc.stdout or "").strip()
            details = stderr or stdout or f"exit code {proc.returncode}"
            if proc.returncode == 127 and "not found" in details.lower():
                raise RuntimeError(
                    "ralphex binary not found in runtime PATH. "
                    "Install ralphex in your user profile or set CONSILIUM_RALPHEX_CMD explicitly."
                )
            raise RuntimeError(f"ralphex command failed: {details}")

        text = self._extract_text(proc.stdout or "")
        if not text.strip():
            text = (proc.stdout or "").strip()
        if not text.strip():
            raise RuntimeError("ralphex returned empty response")
        return text.strip()

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
        return self._transport.execute(message_list)


class AutoGenPipe:
    """MVP pipe: Cursor request -> AutoGen 1-agent GroupChat -> ralphex subprocess."""

    def __init__(self, transport: RalphexTransport) -> None:
        self._transport = transport

    def complete(self, session_id: str, messages: list[dict[str, str]]) -> str:
        payload = {
            "session_id": session_id,
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
            "auth_failed scheme=%r token_len=%d api_key_len=%d token_repr=%r api_key_repr=%r",
            scheme,
            len(token),
            len(api_key or ""),
            token,
            api_key,
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
        "gateway_startup strict_api_key=%s transport_timeout_sec=%s transport_mode=%s transport_source=%s transport_cmd=%s",
        str(strict).lower(),
        str(_transport.timeout_sec),
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
    return {"status": "ok"}


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

    try:
        answer = _pipe.complete(session_id=session_id, messages=history)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="ralphex timeout")
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

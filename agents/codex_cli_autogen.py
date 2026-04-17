"""AutoGen ModelClient that calls the local `codex` CLI (OpenAI Codex) in JSON mode."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Union

from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import ChatCompletionMessage, Choice
from openai.types.completion_usage import CompletionUsage

SANDBOX_DEFAULT = "danger-full-access"


def _flatten_messages(messages: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for m in messages:
        role = str(m.get("role", "")).upper()
        content = m.get("content", "")
        if isinstance(content, list):
            content = json.dumps(content, ensure_ascii=False)
        else:
            content = str(content)
        blocks.append(f"{role}:\n{content}")
    return "\n\n".join(blocks)


class CodexCLIClient:
    """Minimal chat.completions-compatible client for `codex exec --json` (agent line protocol)."""

    def __init__(self, config: Dict[str, Any], **kwargs: Any) -> None:
        self._config: Dict[str, Any] = {**config, **kwargs}
        exe = (os.getenv("CONSILIUM_CODEX_COMMAND") or "codex").strip()
        self._codex = exe if os.path.isabs(exe) else (shutil.which(exe) or exe)

    def create(self, params: Dict[str, Any]) -> ChatCompletion:
        model = params.get("model") or self._config.get("model")
        if not model:
            raise ValueError("codex-cli: model is required in params or config_list.")
        timeout = float(
            params.get("request_timeout_sec")
            or self._config.get("request_timeout_sec")
            or 600.0
        )
        sandbox = (os.getenv("CONSILIUM_CODEX_SANDBOX") or SANDBOX_DEFAULT).strip()
        verbose = (os.getenv("CODEX_VERBOSE") or "0").strip()

        messages = params.get("messages") or []
        prompt = _flatten_messages(messages)

        cmd = [
            self._codex,
            "exec",
            "--json",
            "--dangerously-bypass-approvals-and-sandbox",
            "-s",
            sandbox,
            "-m",
            str(model),
        ]
        env = os.environ.copy()
        if verbose:
            env["CODEX_VERBOSE"] = verbose

        proc = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        text_out: list[str] = []
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue
            if evt.get("type") != "item.completed":
                continue
            item = evt.get("item") or {}
            if item.get("type") == "agent_message":
                t = item.get("text")
                if t:
                    text_out.append(str(t))

        body = "\n".join(text_out).strip()
        if not body and proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
            body = f"[codex-cli error] {err}"

        msg = ChatCompletionMessage(role="assistant", content=body)
        usage = CompletionUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0)
        return ChatCompletion(
            id="codex-cli",
            model=str(model),
            choices=[Choice(finish_reason="stop", index=0, message=msg)],
            usage=usage,
            object="chat.completion",
            created=0,
        )

    def message_retrieval(self, response: ChatCompletion) -> Union[List[str], List[Any]]:
        return [choice.message for choice in response.choices]

    def cost(self, response: ChatCompletion) -> float:
        return float(getattr(response, "cost", 0.0))

    @staticmethod
    def get_usage(response: ChatCompletion) -> Dict[str, Any]:
        return {
            "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
            "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            "total_tokens": response.usage.total_tokens if response.usage else 0,
            "cost": float(getattr(response, "cost", 0.0)),
            "model": response.model,
        }

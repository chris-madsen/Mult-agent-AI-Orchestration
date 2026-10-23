"""Harbor Hermes adapter using ChatGPT/Codex subscription OAuth.

Harbor 0.24.0's built-in Hermes adapter supports MCP but routes OpenAI through
API keys or OpenRouter. This adapter preserves Harbor's Hermes runtime and
session/ATIF behavior while selecting Hermes's native openai-codex provider and
importing the authenticated host ~/.codex/auth.json into the ephemeral task
container. Credential bytes are never written to Harbor logs.
"""

from __future__ import annotations

import os
import shlex
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal, override

import yaml
from pydantic import Field

from harbor.agents.installed.base import with_prompt_template
from harbor.agents.installed.hermes import Hermes, HermesOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class HermesCodexOAuthOptions(HermesOptions):
    reasoning_effort: Literal["low", "medium", "high"] = Field(
        default="high",
        description="Reasoning effort forwarded to Hermes openai-codex.",
    )


class HermesCodexOAuth(Hermes):
    options_model = HermesCodexOAuthOptions
    options: HermesCodexOAuthOptions

    def __init__(self, *args: Any, version: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, version=version, **kwargs)
        if version is not None:
            self._version = version
            self._version_was_pinned = True

    @staticmethod
    def _default_auth_path() -> Path:
        configured = os.environ.get("HERMES_CODEX_AUTH_JSON_PATH")
        return Path(configured).expanduser() if configured else Path.home() / ".codex" / "auth.json"

    @classmethod
    @override
    def preflight(cls, kwargs: dict[str, Any] | None = None, env: Mapping[str, str] | None = None) -> None:
        super().preflight(kwargs, env)
        configured = (env or {}).get("HERMES_CODEX_AUTH_JSON_PATH") or os.environ.get("HERMES_CODEX_AUTH_JSON_PATH")
        auth_path = Path(configured).expanduser() if configured else Path.home() / ".codex" / "auth.json"
        if not auth_path.is_file():
            raise ValueError(f"Hermes openai-codex requires an existing ChatGPT OAuth file: {auth_path}")

    def _host_auth_path(self) -> Path:
        configured = self._extra_env.get("HERMES_CODEX_AUTH_JSON_PATH") or os.environ.get("HERMES_CODEX_AUTH_JSON_PATH")
        return Path(configured).expanduser() if configured else self._default_auth_path()

    async def _stage_codex_auth(self, environment: BaseEnvironment) -> None:
        source = self._host_auth_path()
        if not source.is_file():
            raise RuntimeError(f"Hermes openai-codex auth file is unavailable: {source}")
        staged = "/tmp/hermes-codex-auth.json"
        await self._upload_agent_owned_file(environment, source, staged)
        await self.exec_as_agent(
            environment,
            command=(
                'mkdir -p "$HOME/.codex" && '
                f"cp {shlex.quote(staged)} \"$HOME/.codex/auth.json\" && "
                'chmod 600 "$HOME/.codex/auth.json"'
            ),
            timeout_sec=10,
        )

    @staticmethod
    def _provider_config(base_yaml: str, reasoning_effort: str) -> str:
        config = yaml.safe_load(base_yaml)
        if not isinstance(config, dict):
            raise RuntimeError("Hermes generated an invalid base config")
        config["provider"] = "openai-codex"
        agent = config.get("agent")
        if not isinstance(agent, dict):
            agent = {}
        agent["reasoning_effort"] = reasoning_effort
        config["agent"] = agent
        return yaml.dump(config, default_flow_style=False)

    @with_prompt_template
    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        self._last_run_was_resume = self._resume
        if not self.model_name or not self.model_name.startswith("openai-codex/"):
            raise ValueError("Hermes feedback runs require model_name=openai-codex/<model>")
        model = self.model_name.split("/", 1)[1]
        if not model:
            raise ValueError("Hermes openai-codex model name is empty")

        await self._stage_codex_auth(environment)
        env = {"HERMES_HOME": "/tmp/hermes", "TERMINAL_ENV": "local", "HARBOR_INSTRUCTION": instruction}
        config_yaml = self._provider_config(
            self._build_config_yaml(model, self.options.max_turns),
            self.options.reasoning_effort,
        )
        await self.exec_as_agent(
            environment,
            command=("mkdir -p /tmp/hermes && " + f"cat > /tmp/hermes/config.yaml << 'EOF'\n{config_yaml}EOF"),
            env=env,
            timeout_sec=10,
        )
        mcp_command = self._build_register_mcp_servers_command()
        if mcp_command:
            await self.exec_as_agent(environment, command=mcp_command, env=env, timeout_sec=10)
        skills_command = self._build_register_skills_command()
        if skills_command:
            await self.exec_as_agent(environment, command=skills_command, env=env, timeout_sec=10)

        cli_parts = ['export PATH="$HOME/.local/bin:$PATH"', "hermes --yolo chat"]
        if self._resume:
            native_session_id = getattr(self, "_native_session_id", None)
            if native_session_id is None and self._version_was_pinned:
                raise RuntimeError("Cannot resume pinned Hermes because the previous run exported no native session ID.")
            cli_parts.extend(["--resume", shlex.quote(native_session_id or "latest")])
        cli_parts.extend(['-q "$HARBOR_INSTRUCTION"', "-Q", f"--model {shlex.quote(model)}", "--provider openai-codex"])
        if self.options.toolsets:
            cli_parts.append(f"--toolsets {shlex.quote(str(self.options.toolsets))}")
        run_cmd = f"{cli_parts[0]} && {' '.join(cli_parts[1:])} 2>&1 | stdbuf -oL tee /logs/agent/hermes.txt"

        try:
            await self.exec_as_agent(environment, command=run_cmd, env=env)
        finally:
            try:
                export_result = await self.exec_as_agent(
                    environment,
                    command=(
                        'export PATH="$HOME/.local/bin:$PATH" && '
                        "(hermes sessions export /logs/agent/hermes-session.jsonl --source oneshot 2>/dev/null; "
                        "[ -s /logs/agent/hermes-session.jsonl ] || "
                        "hermes sessions export /logs/agent/hermes-session.jsonl --source cli 2>/dev/null) && "
                        "head -n 1 /logs/agent/hermes-session.jsonl || true"
                    ),
                    env={"HERMES_HOME": "/tmp/hermes"},
                    timeout_sec=30,
                )
                native_session_id = self._extract_native_session_id(export_result.stdout)
                if native_session_id:
                    self._native_session_id = native_session_id
            finally:
                await self.exec_as_agent(
                    environment,
                    command='rm -f "$HOME/.codex/auth.json" /tmp/hermes-codex-auth.json',
                    timeout_sec=10,
                )

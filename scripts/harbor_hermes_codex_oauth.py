"""Harbor Hermes adapter using ChatGPT/Codex subscription OAuth.

Harbor 0.24.0's built-in Hermes adapter supports MCP but routes OpenAI through
API keys or OpenRouter. This adapter preserves Harbor's Hermes runtime and
session/ATIF behavior while selecting Hermes's native openai-codex provider and
staging a dedicated host Hermes auth store into the ephemeral task container.
Hermes owns the refresh-token chain; Codex CLI / VS Code credentials are never
borrowed. Credential bytes are never written to Harbor logs or artifacts.
"""

from __future__ import annotations

import json
import os
import shlex
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal, override

import yaml
from pydantic import Field

from harbor.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from harbor.agents.installed.hermes import Hermes, HermesOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class HermesCodexOAuthOptions(HermesOptions):
    reasoning_effort: Literal["low", "medium", "high"] = Field(
        default="high",
        description="Reasoning effort forwarded to Hermes openai-codex.",
    )
    ace_context_enabled: bool = Field(
        default=False,
        description="Enable the direct ACE Hermes ContextEngine plugin.",
    )
    ace_context_bridge_sha256: str = ""
    context_plugin_sha256: str = ""


class HermesCodexOAuth(Hermes):
    options_model = HermesCodexOAuthOptions
    options: HermesCodexOAuthOptions

    def __init__(self, *args: Any, version: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, version=version, **kwargs)
        if version is not None:
            self._version = version
            self._version_was_pinned = True

    def get_version_command(self) -> str | None:
        return 'export PATH="$HOME/.local/bin:$PATH"; hermes --version'

    async def install(self, environment: BaseEnvironment) -> None:
        try:
            await self.exec_as_agent(
                environment,
                command='export PATH="$HOME/.local/bin:$PATH"; hermes --version',
                timeout_sec=30,
            )
            return
        except NonZeroAgentExitCodeError:
            pass
        try:
            await self.exec_as_agent(
                environment,
                command='export PATH="$HOME/.local/bin:$PATH"; hermes pm repair && hermes --version',
                timeout_sec=180,
            )
            return
        except NonZeroAgentExitCodeError:
            pass
        await self.exec_as_agent(
            environment,
            command='export PATH="$HOME/.local/bin:$PATH"; hermes pm repair && hermes --version',
            timeout_sec=180,
        )

    @staticmethod
    def _default_auth_path() -> Path:
        configured = os.environ.get("HERMES_AUTH_JSON_PATH")
        if configured:
            return Path(configured).expanduser()
        hermes_home = os.environ.get("HERMES_HOME")
        return (Path(hermes_home).expanduser() if hermes_home else Path.home() / ".hermes") / "auth.json"

    @classmethod
    @override
    def preflight(cls, kwargs: dict[str, Any] | None = None, env: Mapping[str, str] | None = None) -> None:
        super().preflight(kwargs, env)
        configured = (env or {}).get("HERMES_AUTH_JSON_PATH") or os.environ.get("HERMES_AUTH_JSON_PATH")
        auth_path = Path(configured).expanduser() if configured else cls._default_auth_path()
        if not auth_path.is_file():
            raise ValueError(
                f"Hermes openai-codex requires a dedicated Hermes OAuth store: {auth_path}. "
                "Run hermes auth add openai-codex; do not share ~/.codex/auth.json."
            )

    def _host_auth_path(self) -> Path:
        configured = self._extra_env.get("HERMES_AUTH_JSON_PATH") or os.environ.get("HERMES_AUTH_JSON_PATH")
        return Path(configured).expanduser() if configured else self._default_auth_path()

    @staticmethod
    def _validate_auth_store(path: Path) -> None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            providers = value.get("providers") if isinstance(value, dict) else None
            legacy = providers.get("openai-codex") if isinstance(providers, dict) else None
            tokens = legacy.get("tokens") if isinstance(legacy, dict) else None
            pool = value.get("credential_pool") if isinstance(value, dict) else None
            entries = pool.get("openai-codex") if isinstance(pool, dict) else None
            current = entries[0] if isinstance(entries, list) and entries and isinstance(entries[0], dict) else None
            legacy_valid = isinstance(legacy, dict) and legacy.get("auth_mode") == "chatgpt" \
                and isinstance(tokens, dict) and tokens.get("access_token") and tokens.get("refresh_token")
            current_valid = isinstance(current, dict) and current.get("auth_type") == "oauth" \
                and current.get("access_token") and current.get("refresh_token")
            if not (legacy_valid or current_valid):
                raise ValueError("missing openai-codex ChatGPT OAuth state")
        except Exception as exc:
            raise RuntimeError(f"Hermes OAuth store is malformed: {path}") from exc

    async def _stage_hermes_auth(self, environment: BaseEnvironment) -> None:
        source = self._host_auth_path()
        if not source.is_file():
            raise RuntimeError(f"Hermes openai-codex auth file is unavailable: {source}")
        self._validate_auth_store(source)
        await self.exec_as_agent(environment, command="mkdir -p /tmp/hermes", timeout_sec=10)
        await self._upload_agent_owned_file(environment, source, "/tmp/hermes/auth.json")
        await self.exec_as_agent(environment, command="chmod 600 /tmp/hermes/auth.json", timeout_sec=10)

    async def _sync_hermes_auth(self, environment: BaseEnvironment) -> None:
        source = self._host_auth_path()
        source.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=".auth.", suffix=".json", dir=source.parent)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            await environment.download_file("/tmp/hermes/auth.json", temp_path)
            self._validate_auth_store(temp_path)
            temp_path.chmod(0o600)
            os.replace(temp_path, source)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    @staticmethod
    def _provider_config(base_yaml: str, reasoning_effort: str, ace_context_enabled: bool) -> str:
        config = yaml.safe_load(base_yaml)
        if not isinstance(config, dict):
            raise RuntimeError("Hermes generated an invalid base config")
        config["provider"] = "openai-codex"
        agent = config.get("agent")
        if not isinstance(agent, dict):
            agent = {}
        agent["reasoning_effort"] = reasoning_effort
        config["agent"] = agent
        if ace_context_enabled:
            config["context"] = {"engine": "ace_context_engine"}
            raw_model_config = config.get("model")
            if isinstance(raw_model_config, str):
                model_config: dict[str, Any] = {"default": raw_model_config}
            elif isinstance(raw_model_config, dict):
                model_config = raw_model_config
            else:
                model_config = {}
            model_config["context_length"] = 128000
            config["model"] = model_config
            plugins = config.get("plugins")
            if not isinstance(plugins, dict):
                plugins = {}
            enabled = plugins.get("enabled")
            if not isinstance(enabled, list):
                enabled = []
            plugins["enabled"] = sorted({*(str(item) for item in enabled), "ace_context_engine"})
            config["plugins"] = plugins
        return yaml.dump(config, default_flow_style=False)

    async def _stage_context_engine(self, environment: BaseEnvironment) -> None:
        await self.exec_as_agent(
            environment,
            command=(
                "rm -rf /tmp/hermes/plugins/ace_context_engine && "
                "mkdir -p /tmp/hermes/plugins/ace_context_engine && "
                "cp -r /ace/integrations/hermes/ace_context_engine/. /tmp/hermes/plugins/ace_context_engine/"
            ),
            timeout_sec=10,
        )

    @with_prompt_template
    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        self._last_run_was_resume = self._resume
        if not self.model_name or not self.model_name.startswith("openai-codex/"):
            raise ValueError("Hermes feedback runs require model_name=openai-codex/<model>")
        model = self.model_name.split("/", 1)[1]
        if not model:
            raise ValueError("Hermes openai-codex model name is empty")

        await self._stage_hermes_auth(environment)
        env = {"HERMES_HOME": "/tmp/hermes", "TERMINAL_ENV": "local", "HARBOR_INSTRUCTION": instruction}
        if self.options.ace_context_enabled:
            await self._stage_context_engine(environment)
            env.update({
                "ACE_WORKSPACE_ROOT": "/workspace",
                "ACE_ALLOWED_ROOTS": "/workspace",
                "ACE_CONTEXT_WORKSPACE_ID": "00000000-0000-4000-8000-000000000001",
                "ACE_CONTEXT_BRIDGE_COMMAND": "/ace/scripts/harbor-ace-context-bridge.sh",
                "ACE_CONTEXT_RECEIPT_FILE": "/logs/artifacts/hermes-context-receipts.jsonl",
                "ACE_CONTEXT_BRIDGE_SHA256": self.options.ace_context_bridge_sha256,
                "ACE_CONTEXT_PLUGIN_SHA256": self.options.context_plugin_sha256,
            })
        config_yaml = self._provider_config(
            self._build_config_yaml(model, self.options.max_turns),
            self.options.reasoning_effort,
            self.options.ace_context_enabled,
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
        # Do not pipe Hermes directly into tee: without a guaranteed pipefail
        # shell, tee can turn a blocked/non-zero Hermes exit into apparent success.
        # Capture the agent status first, replay the log, then return that exact code.
        run_cmd = (
            f"{cli_parts[0]} && {' '.join(cli_parts[1:])} > /logs/agent/hermes.txt 2>&1; "
            'status=$?; cat /logs/agent/hermes.txt; exit "$status"'
        )

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
                try:
                    await self._sync_hermes_auth(environment)
                finally:
                    await self.exec_as_agent(
                        environment,
                        command="rm -f /tmp/hermes/auth.json",
                        timeout_sec=10,
                    )

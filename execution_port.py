from __future__ import annotations

import json
import os
import pathlib
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from model_config import RuntimeConfig

_RUNS_DIR = pathlib.Path(".consilium/runs")
_RALPHEX_CONFIG_DIR = pathlib.Path(".consilium/ralphex")
_RALPHEX_CONFIG_FILE = _RALPHEX_CONFIG_DIR / "config"
_RALPHEX_WRAPPER = _RALPHEX_CONFIG_DIR / "scripts" / "codex-as-claude.sh"
_VERTEX_GEMINI_WRAPPER = _RALPHEX_CONFIG_DIR / "scripts" / "vertex-gemini-as-claude.sh"
_CODEX_SANDBOX = os.getenv("CONSILIUM_CODEX_SANDBOX", "danger-full-access")
_LOCAL_TMP_DIR = pathlib.Path(".consilium/tmp")

_CODEX_AS_CLAUDE_SCRIPT = """#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }

prompt=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p)
      prompt="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$prompt" && ! -t 0 ]]; then
  prompt=$(cat)
fi
if [[ -z "$prompt" ]]; then
  echo "error: no prompt provided" >&2
  exit 1
fi

CODEX_MODEL="${CODEX_MODEL:-}"
CODEX_SANDBOX="${CODEX_SANDBOX:-danger-full-access}"
CODEX_VERBOSE="${CODEX_VERBOSE:-0}"

codex_args=(exec --json --dangerously-bypass-approvals-and-sandbox -s "$CODEX_SANDBOX")
if [[ -n "$CODEX_MODEL" ]]; then
  codex_args+=(-m "$CODEX_MODEL")
fi

printf '%s' "$prompt" | codex "${codex_args[@]}" 2>/dev/null | while IFS= read -r line; do
  echo "$line" | jq -c --argjson verbose "$CODEX_VERBOSE" '
    if .type == "item.completed" then
      if .item.type == "agent_message" then
        {type: "content_block_delta", delta: {type: "text_delta", text: (.item.text + "\\n")}}
      elif .item.type == "command_execution" and $verbose == 1 then
        {type: "content_block_delta", delta: {type: "text_delta", text: ("$ " + .item.command + "\\n" + (.item.aggregated_output // "") + "\\n")}}
      else
        empty
      end
    elif .type == "turn.completed" then
      {type: "result", result: ""}
    else
      empty
    end
  ' 2>/dev/null || true
done || true

echo '{"type":"result","result":""}'
"""


@dataclass(frozen=True)
class ExecutionResult:
    returncode: int
    success: bool
    run_dir: str
    runner: str
    model: str
    stderr_path: str
    stdout_path: str
    metadata: dict[str, str] = field(default_factory=dict)


class ExecutionPort(Protocol):
    def execute(self, task_id: str, plan_path: pathlib.Path) -> ExecutionResult:
        ...


class RalphexAdapter:
    def __init__(self, provider: str, model: str):
        self.provider = (provider or "").strip().lower()
        self.model = (model or "").strip()
        if not self.model:
            raise ValueError("RalphexAdapter requires non-empty model")

    def execute(self, task_id: str, plan_path: pathlib.Path) -> ExecutionResult:
        run_dir = _RUNS_DIR / task_id / datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%S")
        run_dir.mkdir(parents=True, exist_ok=True)
        stdout_path = run_dir / "stdout.log"
        stderr_path = run_dir / "stderr.log"
        metrics_path = run_dir / "metrics.json"

        if not plan_path.exists():
            result = ExecutionResult(
                returncode=2,
                success=False,
                run_dir=str(run_dir),
                runner="ralphex",
                model=self.model,
                stderr_path=str(stderr_path),
                stdout_path=str(stdout_path),
                metadata={"error": f"Plan file not found: {plan_path}"},
            )
            stdout_path.write_text("", encoding="utf-8")
            stderr_path.write_text(result.metadata["error"], encoding="utf-8")
            metrics_path.write_text(json.dumps(asdict(result), indent=2), encoding="utf-8")
            return result

        self._ensure_ralphex_bridge()

        env = os.environ.copy()
        env["RALPHEX_CONFIG_DIR"] = str(_RALPHEX_CONFIG_DIR.resolve())
        if self.provider == "codex-cli":
            env["CODEX_MODEL"] = self.model
            env["CODEX_SANDBOX"] = _CODEX_SANDBOX
            env.setdefault("CODEX_VERBOSE", "0")
        elif self.provider == "google":
            env["GEMINI_MODEL"] = self.model
            env["VERTEX_PROJECT"] = env.get("GOOGLE_CLOUD_PROJECT", "")
            env["VERTEX_LOCATION"] = env.get("GOOGLE_CLOUD_LOCATION", "global")
        else:
            raise ValueError(f"Unsupported implementer provider for ralphex: {self.provider}")
        local_tmp = self._ensure_local_tmp_dir()
        env["TMPDIR"] = str(local_tmp)
        env["TMP"] = str(local_tmp)
        env["TEMP"] = str(local_tmp)

        proc = subprocess.run(
            ["ralphex", str(plan_path)],
            capture_output=True,
            text=True,
            timeout=1200,
            env=env,
        )

        stdout_path.write_text(proc.stdout, encoding="utf-8")
        stderr_path.write_text(proc.stderr, encoding="utf-8")

        result = ExecutionResult(
            returncode=proc.returncode,
            success=proc.returncode == 0,
            run_dir=str(run_dir),
            runner="ralphex",
            model=self.model,
            stderr_path=str(stderr_path),
            stdout_path=str(stdout_path),
            metadata={
                "codex_sandbox": _CODEX_SANDBOX,
                "ralphex_config_dir": str(_RALPHEX_CONFIG_DIR.resolve()),
                "implementer_provider": self.provider,
            },
        )
        metrics_path.write_text(json.dumps(asdict(result), indent=2), encoding="utf-8")
        return result

    def _ensure_ralphex_bridge(self) -> None:
        _RALPHEX_WRAPPER.parent.mkdir(parents=True, exist_ok=True)
        _RALPHEX_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

        if self.provider == "codex-cli":
            _RALPHEX_WRAPPER.write_text(_CODEX_AS_CLAUDE_SCRIPT, encoding="utf-8")
            _RALPHEX_WRAPPER.chmod(0o755)
            cfg = (
                f"claude_command = {_RALPHEX_WRAPPER.resolve()}\n"
                "claude_args =\n"
                "external_review_tool = codex\n"
                "codex_enabled = true\n"
                "codex_command = codex\n"
                f"codex_model = {self.model}\n"
                "codex_reasoning_effort = xhigh\n"
                "codex_timeout_ms = 3600000\n"
            )
        elif self.provider == "google":
            _VERTEX_GEMINI_WRAPPER.chmod(0o755)
            cfg = (
                f"claude_command = {_VERTEX_GEMINI_WRAPPER.resolve()}\n"
                "claude_args =\n"
            )
        else:
            raise ValueError(f"Unsupported implementer provider for ralphex: {self.provider}")
        _RALPHEX_CONFIG_FILE.write_text(cfg, encoding="utf-8")

    def _ensure_local_tmp_dir(self) -> pathlib.Path:
        _LOCAL_TMP_DIR.mkdir(parents=True, exist_ok=True)
        try:
            _LOCAL_TMP_DIR.chmod(0o700)
        except OSError:
            pass
        return _LOCAL_TMP_DIR.resolve()


def make_execution_port(config: RuntimeConfig) -> ExecutionPort:
    adapter = config.execution_adapter
    if adapter == "ralphex":
        impl = config.model_for("implementer")
        return RalphexAdapter(provider=impl.provider, model=impl.model)
    raise ValueError(f"Unsupported execution adapter: {adapter}")

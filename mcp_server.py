from __future__ import annotations

import json
import sys
import pathlib
import warnings

# Ensure consilium package root is on sys.path when launched by Cursor
sys.path.insert(0, str(pathlib.Path(__file__).parent))

# Suppress optional FLAML AutoML warning noise in runtime logs.
warnings.filterwarnings(
    "ignore",
    message=r"flaml\.automl is not available\..*",
)

from mcp.server.fastmcp import FastMCP
from consilium_core import run_task

mcp = FastMCP(
    name="Consilium",
    instructions=(
        "Multi-agent development consilium. "
        "Use `consilium_chat` as the primary tool for all workspace requests. "
        "Use `execute_task` when structured task metadata is required. "
        "Consilium plans, reviews, and implements autonomously."
    ),
)


@mcp.tool()
def execute_task(task_description: str, task_id: str = "", mode: str = "auto") -> str:
    """
    Runs the full Consilium pipeline:
      Architect (Gemini 3.1 Pro) → Critic review → Implementer (Ralphex + Codex CLI).

    Args:
        task_description: What needs to be built, fixed, or refactored.
        task_id:          Optional stable ID (e.g. TASK-AUTH-001). Auto-generated if empty.
        mode:             `auto` (default), `consult`, or `execute`.

    Returns:
        Structured result payload (JSON string).
    """
    tid = task_id.strip() or None
    payload = run_task(task_description=task_description, task_id=tid, mode=mode)
    return json.dumps(payload, ensure_ascii=False, indent=2)


@mcp.tool()
def consilium_chat(message: str, task_id: str = "") -> str:
    """
    Consilium-first chat entrypoint for all workspace requests.
    Automatically routes CONSULT vs EXECUTE and returns assistant-grade text.
    """
    tid = task_id.strip() or None
    payload = run_task(task_description=message, task_id=tid, mode="auto")
    answer = (payload.get("assistant_response") or "").strip()
    if answer:
        return answer
    return json.dumps(payload, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()

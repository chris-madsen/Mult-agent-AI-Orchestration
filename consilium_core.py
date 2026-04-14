from __future__ import annotations

import re
import uuid
import pathlib
from typing import Callable

import autogen
from autogen.agentchat.contrib.capabilities.transform_messages import TransformMessages
from autogen.agentchat.contrib.capabilities.transforms import (
    MessageHistoryLimiter,
    MessageTokenLimiter,
)

from fsm import ConsiliumFSM, State
from agents.architect import make_architect, LLM_CONFIG as ARCHITECT_LLM
from agents.critic import make_critic
from agents.implementer import ImplementerAgent


# ---------------------------------------------------------------------------
# Signal dispatch table  (no if-elif anywhere)
# ---------------------------------------------------------------------------

SIGNAL_TO_EVENT: dict[str, str] = {
    "PLAN_READY":       "plan_ready",
    "APPROVED":         "approved",
    "APPROVED_NO_EXEC": "approved_no_exec",
    "REJECTED":         "rejected",
    "IMPL_COMPLETE":    "impl_complete",
    "IMPL_FAILED":      "impl_failed",
    "NEEDS_REWORK":     "needs_rework",
    "MINOR_FIX":        "minor_fix",
    "UNRESOLVABLE":     "unresolvable",
}

_SIGNAL_RE = re.compile(r"\b([A-Z_]{4,}):([A-Za-z0-9_-]+)", re.MULTILINE)


def _parse_signal(text: str) -> tuple[str, str] | None:
    """Return (SIGNAL_TYPE, task_id) from the last matching signal in text."""
    matches = _SIGNAL_RE.findall(text)
    return matches[-1] if matches else None


# ---------------------------------------------------------------------------
# FSM-driven speaker selector  (closure over fsm + agent registry)
# ---------------------------------------------------------------------------

def _make_selector(
    fsm: ConsiliumFSM,
    agents: dict[str, autogen.ConversableAgent],
) -> Callable:

    def selector(last_speaker, groupchat) -> autogen.ConversableAgent | None:
        if not groupchat.messages:
            return agents.get(fsm.current_role())

        last_content = groupchat.messages[-1].get("content", "") or ""
        parsed = _parse_signal(last_content)

        if parsed:
            signal, _ = parsed
            event = SIGNAL_TO_EVENT.get(signal)
            if event:
                try:
                    fsm.fire(event)
                except ValueError:
                    pass   # unknown transition → stay, let agent retry

        if fsm.is_terminal():
            return None    # terminates GroupChat

        return agents.get(fsm.current_role())

    return selector


# ---------------------------------------------------------------------------
# Context compression  (per-agent, stateless middleware)
# ---------------------------------------------------------------------------

def _apply_compression(agents_list: list[autogen.ConversableAgent]) -> None:
    compressor = TransformMessages(transforms=[
        MessageHistoryLimiter(max_messages=6),
        MessageTokenLimiter(max_tokens=4096, max_tokens_per_message=1024),
    ])
    for agent in agents_list:
        compressor.add_to_agent(agent)


_EXECUTE_HINTS = re.compile(
    r"\b(implement|write code|code|refactor|fix|bug|add|feature|endpoint|migration|test|tests|lint|build)\b",
    re.IGNORECASE,
)


def infer_mode(task_description: str) -> str:
    return "EXECUTE" if _EXECUTE_HINTS.search(task_description or "") else "CONSULT"


def _read_if_exists(path: pathlib.Path) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


def _latest_metrics(task_id: str) -> dict:
    task_runs_dir = pathlib.Path(".consilium/runs") / task_id
    if not task_runs_dir.exists():
        return {}
    run_dirs = sorted([p for p in task_runs_dir.iterdir() if p.is_dir()])
    if not run_dirs:
        return {}
    metrics_path = run_dirs[-1] / "metrics.json"
    if not metrics_path.exists():
        return {}
    try:
        import json
        return json.loads(metrics_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_task(
    task_description: str,
    task_id: str | None = None,
    mode: str = "auto",
) -> dict:
    task_id = task_id or f"TASK-{uuid.uuid4().hex[:8].upper()}"
    selected_mode = infer_mode(task_description) if mode.lower() == "auto" else mode.strip().upper()
    if selected_mode not in {"EXECUTE", "CONSULT"}:
        selected_mode = "CONSULT"

    fsm         = ConsiliumFSM(task_id)
    fsm.fire("task_received")

    architect   = make_architect()
    critic      = make_critic()
    implementer = ImplementerAgent(task_id=task_id)

    _apply_compression([architect, critic])

    agents = {
        "Architect":   architect,
        "Critic":      critic,
        "Implementer": implementer,
    }

    supervisor = autogen.UserProxyAgent(
        name="Supervisor",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=0,
        code_execution_config=False,
    )

    groupchat = autogen.GroupChat(
        agents=[supervisor, architect, critic, implementer],
        messages=[],
        max_round=30,
        speaker_selection_method=_make_selector(fsm, agents),
    )

    manager = autogen.GroupChatManager(
        groupchat=groupchat,
        llm_config=ARCHITECT_LLM,  # used only if selector returns None unexpectedly
    )

    supervisor.initiate_chat(
        manager,
        message=(
            f"TASK_ID:{task_id}\n"
            f"CONSILIUM_MODE:{selected_mode}\n\n"
            f"{task_description}"
        ),
    )

    review_path = pathlib.Path(f".consilium/reviews/{task_id}.md")
    plan_path = pathlib.Path(f".consilium/plans/{task_id}.md")
    assistant_response = _read_if_exists(review_path) or _read_if_exists(plan_path)

    payload = {
        "task_id": task_id,
        "mode": selected_mode,
        "state": fsm.state.value,
        "assistant_response": assistant_response,
        "artifacts": {
            "plan": str(plan_path),
            "review": str(review_path),
            "state": f".consilium/state/{task_id}.json",
        },
        "execution": _latest_metrics(task_id),
    }
    return payload

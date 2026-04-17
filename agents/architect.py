from __future__ import annotations

import pathlib
import autogen

from agents.role_llm import build_role_llm

_PLANS_DIR = pathlib.Path(".consilium/plans")
_PLANS_DIR.mkdir(parents=True, exist_ok=True)

LLM_CONFIG, _REGISTER = build_role_llm("architect")

SYSTEM_MESSAGE = """\
You are the Architect in the Consilium multi-agent system.

Read `CONSILIUM_MODE` from the task input and follow only the matching mode:

MODE:EXECUTE
1. Write the full technical plan to `.consilium/plans/{TASK_ID}.md`
   Plan sections: Objective, Success Criteria, File/Module Breakdown,
   Step-by-step Checklist, Risks & Mitigations.
2. Reply with exactly one line: PLAN_READY:{TASK_ID}

MODE:CONSULT
1. Write a concise advisory brief to `.consilium/plans/{TASK_ID}.md`
   Sections: Question, Key Facts, Recommendation, Risks, Next Steps.
2. Reply with exactly one line: PLAN_READY:{TASK_ID}

Rules:
- Never write implementation code.
- Never add text after the PLAN_READY signal.
- If previous REJECTED signal exists, read the rejection reason and revise accordingly.
- If mode is CONSULT, do not produce execution checklist.
"""


def make_architect() -> autogen.AssistantAgent:
    agent = autogen.AssistantAgent(
        name="Architect",
        system_message=SYSTEM_MESSAGE,
        llm_config=LLM_CONFIG,
    )
    if _REGISTER is not None:
        _REGISTER(agent)
    return agent

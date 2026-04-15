from __future__ import annotations

import pathlib
import autogen

from agents.env_config import get_google_cloud_location, get_google_cloud_project
from model_config import load_runtime_config

_PLANS_DIR = pathlib.Path(".consilium/plans")
_PLANS_DIR.mkdir(parents=True, exist_ok=True)

GOOGLE_CLOUD_PROJECT = get_google_cloud_project()
GOOGLE_CLOUD_LOCATION = get_google_cloud_location()
_ROLE_CFG = load_runtime_config().model_for("architect")

_CONFIG_LIST = []
for model in _ROLE_CFG.models:
    entry = {
        "model": model,
        "api_type": _ROLE_CFG.provider,
    }
    if _ROLE_CFG.provider == "google":
        entry["project"] = GOOGLE_CLOUD_PROJECT
        entry["location"] = GOOGLE_CLOUD_LOCATION
    _CONFIG_LIST.append(entry)

LLM_CONFIG = {
    "config_list": _CONFIG_LIST,
    "temperature": _ROLE_CFG.temperature,
}

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
    return autogen.AssistantAgent(
        name="Architect",
        system_message=SYSTEM_MESSAGE,
        llm_config=LLM_CONFIG,
    )

from __future__ import annotations

import pathlib
import autogen

from agents.env_config import get_google_cloud_location, get_google_cloud_project
from model_config import load_runtime_config

_REVIEWS_DIR = pathlib.Path(".consilium/reviews")
_REVIEWS_DIR.mkdir(parents=True, exist_ok=True)

GOOGLE_CLOUD_PROJECT = get_google_cloud_project()
GOOGLE_CLOUD_LOCATION = get_google_cloud_location()
_ROLE_CFG = load_runtime_config().model_for("critic")

LLM_CONFIG = {
    "config_list": [{
        "model":    _ROLE_CFG.model,
        "api_type": _ROLE_CFG.provider,
        # TODO: set GOOGLE_CLOUD_PROJECT in .env (or env var) for Vertex AI calls.
        "project":  GOOGLE_CLOUD_PROJECT,
        "location": GOOGLE_CLOUD_LOCATION,
    }],
    "temperature": _ROLE_CFG.temperature,
}

SYSTEM_MESSAGE = """\
You are the Critic in the Consilium multi-agent system.

Read `CONSILIUM_MODE` from the task input and follow only the matching mode:

MODE:EXECUTE
1. Read `.consilium/plans/{TASK_ID}.md`
2. Write concise review to `.consilium/reviews/{TASK_ID}.md`
   Sections: Critical Issues, Risk Assessment, Verdict
3. Reply with exactly one line:
   - APPROVED:{TASK_ID}               — plan is sound, proceed
   - REJECTED:{TASK_ID}:{short reason} — critical issues found, Architect must revise

MODE:CONSULT
1. Read `.consilium/plans/{TASK_ID}.md`
2. Write final answer to `.consilium/reviews/{TASK_ID}.md`
   Sections: Final Answer, Trade-offs, Confidence, Follow-up.
3. Reply with exactly one line:
   - APPROVED_NO_EXEC:{TASK_ID}
   - REJECTED:{TASK_ID}:{short reason}

When investigating a failure (IMPL_FAILED signal received):
1. Read `.consilium/runs/{TASK_ID}/*/stderr.log` for root cause
2. Write findings to `.consilium/reviews/{TASK_ID}-investigation.md`
3. Reply with exactly one line:
   - NEEDS_REWORK:{TASK_ID}  — plan was flawed, Architect must redesign
   - MINOR_FIX:{TASK_ID}     — implementation error only, retry is sufficient
   - UNRESOLVABLE:{TASK_ID}  — cannot proceed, escalate to human

Rules:
- Be terse. One critical issue per bullet.
- Never rewrite the plan yourself.
- Never add text after the signal line.
- If mode is CONSULT, do not emit APPROVED:{TASK_ID}.
"""


def make_critic() -> autogen.AssistantAgent:
    return autogen.AssistantAgent(
        name="Critic",
        system_message=SYSTEM_MESSAGE,
        llm_config=LLM_CONFIG,
    )

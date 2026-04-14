from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable
import json
import pathlib


class State(str, Enum):
    INTAKE      = "INTAKE"
    PROPOSAL    = "PROPOSAL"
    REVIEW      = "REVIEW"
    IMPLEMENT   = "IMPLEMENT"
    INVESTIGATE = "INVESTIGATE"
    DONE        = "DONE"
    ROLLBACK    = "ROLLBACK"


@dataclass(frozen=True)
class Transition:
    target: State
    guard: Callable[[], bool] = field(default=lambda: True, compare=False)


FSM_TABLE: dict[State, dict[str, Transition]] = {
    State.INTAKE: {
        "task_received":  Transition(State.PROPOSAL),
    },
    State.PROPOSAL: {
        "plan_ready":     Transition(State.REVIEW),
    },
    State.REVIEW: {
        "approved":       Transition(State.IMPLEMENT),
        "approved_no_exec": Transition(State.DONE),
        "rejected":       Transition(State.PROPOSAL),
    },
    State.IMPLEMENT: {
        "impl_complete":  Transition(State.DONE),
        "impl_failed":    Transition(State.INVESTIGATE),
    },
    State.INVESTIGATE: {
        "needs_rework":   Transition(State.PROPOSAL),
        "minor_fix":      Transition(State.IMPLEMENT),
        "unresolvable":   Transition(State.ROLLBACK),
    },
}

STATE_TO_ROLE: dict[State, str] = {
    State.PROPOSAL:    "Architect",
    State.REVIEW:      "Critic",
    State.IMPLEMENT:   "Implementer",
    State.INVESTIGATE: "Critic",
}

_STATE_DIR = pathlib.Path(".consilium/state")


class ConsiliumFSM:
    def __init__(self, task_id: str, initial: State = State.INTAKE):
        self.task_id = task_id
        self.state   = initial
        _STATE_DIR.mkdir(parents=True, exist_ok=True)

    def fire(self, event: str) -> State:
        transitions = FSM_TABLE.get(self.state, {})
        t = transitions.get(event)
        if t is None:
            raise ValueError(
                f"No transition from {self.state!r} on event {event!r}. "
                f"Valid events: {list(transitions.keys())}"
            )
        if not t.guard():
            raise RuntimeError(
                f"Guard blocked: {self.state!r} --[{event}]--> {t.target!r}"
            )
        self.state = t.target
        self._persist()
        return self.state

    def current_role(self) -> str | None:
        return STATE_TO_ROLE.get(self.state)

    def is_terminal(self) -> bool:
        return self.state in (State.DONE, State.ROLLBACK)

    def _persist(self) -> None:
        path = _STATE_DIR / f"{self.task_id}.json"
        path.write_text(json.dumps({
            "task_id": self.task_id,
            "state":   self.state.value,
        }))

    @classmethod
    def load(cls, task_id: str) -> ConsiliumFSM:
        path = _STATE_DIR / f"{task_id}.json"
        data = json.loads(path.read_text())
        return cls(task_id, initial=State(data["state"]))

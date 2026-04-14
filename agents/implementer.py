from __future__ import annotations

import pathlib

import autogen

from execution_port import make_execution_port
from model_config import load_runtime_config


class ImplementerAgent(autogen.ConversableAgent):
    """
    Subprocess executor: receives control from FSM, runs ExecutionPort adapter, returns signal.
    """

    def __init__(self, task_id: str, **kwargs):
        super().__init__(
            name="Implementer",
            system_message="Executes plans via ExecutionPort adapter.",
            llm_config=False,
            human_input_mode="NEVER",
            **kwargs,
        )
        self.task_id = task_id
        self._runtime_cfg = load_runtime_config()
        self._port = make_execution_port(self._runtime_cfg)

    def generate_reply(self, messages=None, sender=None, **kwargs) -> str:
        plan_path = pathlib.Path(f".consilium/plans/{self.task_id}.md")
        result = self._port.execute(task_id=self.task_id, plan_path=plan_path)
        if result.success:
            return f"IMPL_COMPLETE:{self.task_id}"
        return f"IMPL_FAILED:{self.task_id}:stderr at {result.stderr_path}"

from __future__ import annotations

import copy
import os
import uuid
from typing import Any

from agent.context_engine import ContextEngine

from .bridge import BridgeClient
from .receipt import ReceiptWriter


def _text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


def _append_context(message: dict[str, Any], context: str) -> None:
    content = message.get("content")
    marker = "\n\n[ACE verified context]\n" + context + "\n[/ACE verified context]"
    if isinstance(content, str):
        message["content"] = content + marker
    elif isinstance(content, list):
        content.append({"type": "text", "text": marker})
    else:
        message["content"] = marker


class AceContextEngine(ContextEngine):
    def __init__(
        self,
        *,
        bridge: Any | None = None,
        workspace_id: str | None = None,
        session_id: str | None = None,
        receipt_path: str | os.PathLike[str] | None = None,
    ) -> None:
        self._bridge = bridge or BridgeClient()
        self._workspace_id = workspace_id or os.environ.get("ACE_CONTEXT_WORKSPACE_ID") or os.environ.get("ACE_WORKSPACE_ID", "")
        self._session_id = session_id or os.environ.get("HERMES_SESSION_ID", "unknown")
        self._receipts = ReceiptWriter(receipt_path)
        self.last_prompt_tokens = 0
        self.last_completion_tokens = 0
        self.last_total_tokens = 0
        self.threshold_tokens = 0
        self.context_length = 0
        self.compression_count = 0

    @property
    def name(self) -> str:
        return "ace_context_engine"

    def update_from_response(self, usage: dict[str, Any]) -> None:
        self.last_prompt_tokens = int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0)
        self.last_completion_tokens = int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0)
        self.last_total_tokens = int(usage.get("total_tokens", self.last_prompt_tokens + self.last_completion_tokens) or 0)

    def should_compress(self, prompt_tokens: int | None = None) -> bool:
        return False

    def compress(self, messages: list[dict[str, Any]], current_tokens: int | None = None, **kwargs: Any) -> list[dict[str, Any]]:
        return messages

    def select_context(
        self,
        request_messages: list[dict[str, Any]],
        *,
        conversation_messages: list[dict[str, Any]] | None = None,
        incoming_message: dict[str, Any] | None = None,
        budget_tokens: int = 0,
    ) -> list[dict[str, Any]]:
        projected = copy.deepcopy(request_messages)
        current = incoming_message if incoming_message in request_messages else next(
            (message for message in reversed(request_messages) if message.get("role") == "user"),
            None,
        )
        query = _text_content(current.get("content")) if isinstance(current, dict) else ""
        if not query or not self._workspace_id:
            return projected
        request_id = str(uuid.uuid4())
        effective_budget = budget_tokens or int(os.environ.get("ACE_CONTEXT_BUDGET_TOKENS", "12000"))
        bridge_request = {
            "type": "transform",
            "schemaVersion": 1,
            "requestId": request_id,
            "sessionId": self._session_id,
            "workspaceId": self._workspace_id,
            "query": query,
            "budgetTokens": effective_budget,
        }
        try:
            response = self._bridge.transform(bridge_request)
            if not response.get("ok"):
                error = response.get("error") if isinstance(response.get("error"), dict) else {}
                self._receipts.write({
                    "requestId": request_id,
                    "sessionId": self._session_id,
                    "status": "blocked",
                    "errorCode": error.get("code", "BRIDGE_ERROR"),
                })
                return projected
            result = response.get("result")
            if not isinstance(result, dict) or result.get("status") not in {"ready", "partial"}:
                self._receipts.write({
                    "requestId": request_id,
                    "sessionId": self._session_id,
                    "status": "blocked",
                })
                return projected
            context_text = result.get("contextText")
            if not isinstance(context_text, str) or not context_text.strip():
                self._receipts.write({
                    "requestId": request_id,
                    "sessionId": self._session_id,
                    "status": "blocked",
                })
                return projected
            if isinstance(current, dict):
                current_index = request_messages.index(current)
                _append_context(projected[current_index], context_text)
            self._receipts.write({
                "requestId": request_id,
                "sessionId": self._session_id,
                "status": result.get("status"),
                "receiptId": result.get("receiptId"),
                "selectedEvidenceIds": result.get("selectedEvidenceIds", []),
                "omittedEvidenceIds": result.get("omittedEvidenceIds", []),
                "estimatedTokens": result.get("estimatedTokens"),
                "sourceCommit": result.get("sourceCommit"),
                "sourceManifestSha256": result.get("sourceManifestSha256"),
                "providerIdentities": result.get("providerIdentities", {}),
            })
            return projected
        except Exception:
            self._receipts.write({
                "requestId": request_id,
                "sessionId": self._session_id,
                "status": "blocked",
            })
            return projected

    def close(self) -> None:
        close = getattr(self._bridge, "close", None)
        if callable(close):
            close()

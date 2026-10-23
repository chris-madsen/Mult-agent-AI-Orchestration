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
        bridge_digest: str | None = None,
        plugin_digest: str | None = None,
    ) -> None:
        self._bridge = bridge or BridgeClient()
        self._workspace_id = workspace_id or os.environ.get("ACE_CONTEXT_WORKSPACE_ID") or os.environ.get("ACE_WORKSPACE_ID", "")
        self._session_id = session_id or os.environ.get("HERMES_SESSION_ID", "unknown")
        self._receipts = ReceiptWriter(receipt_path)
        self._bridge_digest = bridge_digest or os.environ.get("ACE_CONTEXT_BRIDGE_SHA256", "")
        self._plugin_digest = plugin_digest or os.environ.get("ACE_CONTEXT_PLUGIN_SHA256", "")
        self.last_prompt_tokens = 0
        self.last_completion_tokens = 0
        self.last_total_tokens = 0
        self.threshold_tokens = 0
        # A conservative, explicit cap is needed: Hermes forwards this entire
        # model-window value as budget_tokens, not the available ACE allowance.
        self.context_length = int(os.environ.get("ACE_CONTEXT_WINDOW_TOKENS", "32768"))
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

    def _abort(self, request_id: str, code: str) -> None:
        """Abort BEFORE provider send, even on Hermes v0.22.3.

        Hermes's _apply_context_engine_selection catches Exception and
        deliberately falls back to the original transcript. SystemExit is
        required for strict ACE trials and is not caught by that handler.
        """
        self._receipts.write({
            "schemaVersion": 1,
            "requestId": request_id,
            "sessionId": self._session_id,
            "status": "blocked",
            "receiptId": "blocked-" + request_id,
            "selectedEvidenceIds": [],
            "omittedEvidenceIds": [],
            "bridgeDigest": self._bridge_digest,
            "pluginDigest": self._plugin_digest,
            "limitations": [code],
        })
        raise SystemExit("ACE_CONTEXT_BLOCKED: " + code)

    def select_context(
        self,
        request_messages: list[dict[str, Any]],
        *,
        conversation_messages: list[dict[str, Any]] | None = None,
        incoming_message: dict[str, Any] | None = None,
        budget_tokens: int = 0,
    ) -> list[dict[str, Any]]:
        projected = copy.deepcopy(request_messages)
        request_id = str(uuid.uuid4())
        if not self._workspace_id:
            self._abort(request_id, "WORKSPACE_ID_MISSING")
        if not all(
            len(value) == 64 and all(char in "0123456789abcdef" for char in value)
            for value in (self._bridge_digest, self._plugin_digest)
        ):
            self._abort(request_id, "UNPINNED_BRIDGE_OR_PLUGIN")
        current_index = next(
            (i for i in range(len(request_messages) - 1, -1, -1)
             if request_messages[i].get("role") == "user"), None
        )
        if current_index is None:
            self._abort(request_id, "NO_USER_QUERY")
        query = _text_content(request_messages[current_index].get("content"))
        if not query.strip():
            self._abort(request_id, "EMPTY_USER_QUERY")

        # budget_tokens is the model's WHOLE context window. Leave space for
        # the pre-existing request, tool schemas, and the model's response.
        original_estimate = sum(
            (len(str(message.get("content", ""))) + 3) // 4
            for message in request_messages
        )
        requested_limit = int(os.environ.get("ACE_CONTEXT_BUDGET_TOKENS", "12000"))
        total_budget = budget_tokens or self.context_length
        effective_budget = min(requested_limit, total_budget - original_estimate - 4096)
        if effective_budget <= 0:
            self._abort(request_id, "INSUFFICIENT_CONTEXT_BUDGET")

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
        except Exception:
            self._abort(request_id, "BRIDGE_EXCEPTION")

        if not isinstance(response, dict) or response.get("ok") is not True:
            self._abort(request_id, "BRIDGE_ERROR")
        result = response.get("result")
        if not isinstance(result, dict) or response.get("requestId") != request_id:
            self._abort(request_id, "BRIDGE_RESPONSE_ID_MISMATCH")
        if (result.get("requestId") != request_id
                or result.get("sessionId") != self._session_id
                or result.get("workspaceId") != self._workspace_id):
            self._abort(request_id, "TRANSFORM_IDENTITY_MISMATCH")
        if result.get("status") not in {"ready", "partial"}:
            self._abort(request_id, "TRANSFORM_NOT_READY")
        context_text = result.get("contextText")
        receipt_id = result.get("receiptId")
        provider_request_id = result.get("providerRequestId")
        selected = result.get("selectedEvidenceIds")
        omitted = result.get("omittedEvidenceIds")
        limitations = result.get("limitations")
        estimated = result.get("estimatedTokens")
        if (not isinstance(context_text, str) or not context_text.strip()
                or not isinstance(receipt_id, str) or not receipt_id
                or not isinstance(provider_request_id, str) or not provider_request_id
                or not isinstance(selected, list) or not selected
                or not all(isinstance(x, str) and x for x in selected)
                or not isinstance(omitted, list)
                or not all(isinstance(x, str) and x for x in omitted)
                or not isinstance(limitations, list)
                or not all(isinstance(x, str) and x for x in limitations)
                or not isinstance(estimated, int) or estimated <= 0
                or estimated > effective_budget):
            self._abort(request_id, "MALFORMED_TRANSFORM_RECEIPT")
        if set(selected) & set(omitted):
            self._abort(request_id, "OVERLAPPING_EVIDENCE_IDS")

        _append_context(projected[current_index], context_text)
        self._receipts.write({
            "schemaVersion": 1,
            "requestId": request_id,
            "sessionId": self._session_id,
            "status": result["status"],
            "receiptId": receipt_id,
            "providerRequestId": provider_request_id,
            "selectedEvidenceIds": selected,
            "omittedEvidenceIds": omitted,
            "bridgeDigest": self._bridge_digest,
            "pluginDigest": self._plugin_digest,
            "estimatedTokens": estimated,
            "limitations": limitations,
            **({"sourceCommit": result["sourceCommit"]}
               if isinstance(result.get("sourceCommit"), str) else {}),
            **({"sourceManifestSha256": result["sourceManifestSha256"]}
               if isinstance(result.get("sourceManifestSha256"), str) else {}),
        })
        return projected

    def close(self) -> None:
        close = getattr(self._bridge, "close", None)
        if callable(close):
            close()

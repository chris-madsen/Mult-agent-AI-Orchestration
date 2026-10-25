from __future__ import annotations

import copy
import hashlib
import json
import os
import uuid
from typing import Any, NoReturn

from agent.context_compressor import ContextCompressor

from .bridge import BridgeClient
from .ownership import host_ownership_from_environment, validate_host_ownership
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


def _estimated_tokens(messages: list[dict[str, Any]]) -> int:
    """Diagnostic content-only estimate, NOT provider-measured token usage.

    It deliberately uses the same heuristic as the input budget estimate, so
    the difference represents request-local context growth consistently.
    Provider tool schemas, prompt wrappers and caching are not included.
    """
    return sum((len(str(message.get("content", ""))) + 3) // 4 for message in messages)


def _request_digest(messages: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(
        messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str,
    ).encode("utf-8")).hexdigest()


def _deduplicate_historical_tools(
    messages: list[dict[str, Any]], protected_user_index: int,
) -> int:
    """Replace only exact duplicate old tool payloads; retain the later copy.

    Keep every tool response and call ID in place. No heuristic summaries,
    partial source matches or model-authored claims may authorize deletion.
    The latest user turn, recent tool results and system/control stay intact.
    """
    seen: set[str] = set()
    replaced = 0
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if message.get("role") != "tool":
            continue
        content = message.get("content")
        if not isinstance(content, str) or len(content) < 1024:
            continue
        if content in seen and 3 <= index < protected_user_index and index < len(messages) - 6:
            message["content"] = "[Repeated tool output; identical full text is preserved in a later tool response.]"
            replaced += 1
        else:
            seen.add(content)
    return replaced


def _append_context(message: dict[str, Any], context: str) -> None:
    content = message.get("content")
    marker = "\n\n[ACE verified context]\n" + context + "\n[/ACE verified context]"
    if isinstance(content, str):
        message["content"] = content + marker
    elif isinstance(content, list):
        content.append({"type": "text", "text": marker})
    else:
        message["content"] = marker


class AceContextEngine(ContextCompressor):
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
        # Inherit Hermes's real compactor, including preflight, durable-session
        # summary, anti-thrashing logic and proactive tool-result pruning.
        # This must match the compression settings pinned in both benchmark arms.
        super().__init__(
            model="gpt-5.5",
            threshold_percent=0.50,
            protect_first_n=3,
            protect_last_n=20,
            summary_target_ratio=0.20,
            config_context_length=128000,
            threshold_tokens_cap=None,
            proactive_prune_tokens=0,
        )
        self._bridge = bridge or BridgeClient()
        self._workspace_id = workspace_id or os.environ.get("ACE_CONTEXT_WORKSPACE_ID") or os.environ.get("ACE_WORKSPACE_ID", "")
        self._session_id = session_id or os.environ.get("HERMES_SESSION_ID", "unknown")
        self._receipts = ReceiptWriter(receipt_path)
        self._bridge_digest = bridge_digest or os.environ.get("ACE_CONTEXT_BRIDGE_SHA256", "")
        self._plugin_digest = plugin_digest or os.environ.get("ACE_CONTEXT_PLUGIN_SHA256", "")
        self._ownership_required = os.environ.get("ACE_CONTEXT_REQUIRE_HOST_ATTESTATION", "false").lower() == "true"
        self._ownership = host_ownership_from_environment() if self._ownership_required else None
        self._ownership_failures = validate_host_ownership(self._ownership, self._session_id) if self._ownership is not None else []
        # Hermes calls ContextCompressor.update_model() with the actual model and
        # resolved window before the first provider request.
        # One successful provider-bound projection is memoized for an exact
        # request retry. Hermes v0.22.3 invokes select_context() again on
        # provider retries; a retry must not issue a second retrieval with a
        # new identity or receive different context.
        self._last_request_key: str | None = None
        self._last_projection: list[dict[str, Any]] | None = None
        self._turn_id: str | None = None

    @property
    def name(self) -> str:
        return "ace_context_engine"

    def clone_for_agent(self) -> "AceContextEngine":
        """Return a per-agent engine without deepcopying lock/process state.

        Hermes v0.22.3 clones plugin context engines before attaching them to
        an agent. BridgeClient and ReceiptWriter contain threading locks, so
        ContextEngine's default deepcopy implementation cannot be used safely.
        """
        bridge = (
            BridgeClient(
                command=list(self._bridge.command),
                startup_timeout_seconds=self._bridge.startup_timeout_seconds,
                request_timeout_seconds=self._bridge.request_timeout_seconds,
            )
            if isinstance(self._bridge, BridgeClient)
            else self._bridge
        )
        return AceContextEngine(
            bridge=bridge,
            workspace_id=self._workspace_id,
            session_id=self._session_id,
            receipt_path=self._receipts.path,
            bridge_digest=self._bridge_digest,
            plugin_digest=self._plugin_digest,
        )

    def on_session_start(self, session_id: str, **kwargs: Any) -> None:
        """Keep native compaction state and ACE request IDs in sync."""
        super().on_session_start(session_id, **kwargs)
        if isinstance(session_id, str) and session_id.strip():
            self._session_id = session_id.strip()
        if self._ownership is not None:
            self._ownership_failures = validate_host_ownership(self._ownership, self._session_id)
        self._last_request_key = None
        self._last_projection = None
        self._turn_id = None

    def on_turn_complete(self, messages: list[dict[str, Any]], **kwargs: Any) -> None:
        """Never reuse a retry projection across completed user turns."""
        self._last_request_key = None
        self._last_projection = None
        self._turn_id = None

    # All compression, native usage bookkeeping and tool-result pruning
    # methods are inherited verbatim from Hermes ContextCompressor.

    def _abort(self, request_id: str, code: str) -> NoReturn:
        """Abort BEFORE provider send, even on Hermes v0.22.3.

        Hermes's _apply_context_engine_selection catches Exception and
        deliberately falls back to the original transcript. SystemExit is
        required for strict ACE trials and is not caught by that handler.
        """
        try:
            self._receipts.write({
                "schemaVersion": 1,
                "requestId": request_id,
                "sessionId": self._session_id,
                "turnId": self._turn_id or "unknown",
                "status": "blocked",
                "receiptId": "blocked-" + request_id,
                "selectedEvidenceIds": [],
                "omittedEvidenceIds": [],
                "bridgeDigest": self._bridge_digest,
                "pluginDigest": self._plugin_digest,
                **({"ownership": self._ownership} if self._ownership is not None else {}),
                "limitations": [code],
            })
        finally:
            # Receipt persistence is evidence, not permission to fail open. Even
            # a disk/logging failure must still prevent the provider request.
            raise SystemExit("ACE_CONTEXT_BLOCKED: " + code)

    def select_context(
        self,
        request_messages: list[dict[str, Any]],
        *,
        conversation_messages: list[dict[str, Any]] | None = None,
        incoming_message: dict[str, Any] | None = None,
        budget_tokens: int = 0,
    ) -> list[dict[str, Any]]:
        request_id = str(uuid.uuid4())
        if self._turn_id is None:
            self._turn_id = str(uuid.uuid4())
        try:
            return self._select_context_strict(
                request_id,
                request_messages,
                conversation_messages=conversation_messages,
                incoming_message=incoming_message,
                budget_tokens=budget_tokens,
            )
        except SystemExit:
            raise
        except Exception:
            # Hermes v0.22.3 catches Exception from select_context() and sends
            # the original transcript. Convert every unexpected plugin failure
            # to BaseException/SystemExit so strict ACE trials cannot fail open.
            self._abort(request_id, "CONTEXT_ENGINE_EXCEPTION")

    def _select_context_strict(
        self,
        request_id: str,
        request_messages: list[dict[str, Any]],
        *,
        conversation_messages: list[dict[str, Any]] | None = None,
        incoming_message: dict[str, Any] | None = None,
        budget_tokens: int = 0,
    ) -> list[dict[str, Any]]:
        projected = copy.deepcopy(request_messages)
        if not self._workspace_id:
            self._abort(request_id, "WORKSPACE_ID_MISSING")
        if self._ownership_failures:
            self._abort(request_id, "HOST_OWNERSHIP_UNVERIFIED")
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
        original_estimate = _estimated_tokens(request_messages)
        requested_limit = int(os.environ.get("ACE_CONTEXT_BUDGET_TOKENS", "12000"))
        total_budget = budget_tokens or self.context_length
        effective_budget = min(requested_limit, total_budget - original_estimate - 4096)
        if effective_budget <= 0:
            self._abort(request_id, "INSUFFICIENT_CONTEXT_BUDGET")

        request_key = hashlib.sha256(json.dumps(
            {
                "sessionId": self._session_id,
                "turnId": self._turn_id,
                "workspaceId": self._workspace_id,
                "budgetTokens": effective_budget,
                "messages": request_messages,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")).hexdigest()
        if request_key == self._last_request_key and self._last_projection is not None:
            return copy.deepcopy(self._last_projection)

        bridge_request = {
            "type": "transform",
            "schemaVersion": 1,
            "requestId": request_id,
            "sessionId": self._session_id,
            "turnId": self._turn_id,
            "workspaceId": self._workspace_id,
            "query": query,
            "budgetTokens": effective_budget,
            "sourceObligations": {"required": ["code"]},
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
                or result.get("turnId") != self._turn_id
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

        replaced_tool_outputs = _deduplicate_historical_tools(projected, current_index)
        _append_context(projected[current_index], context_text)
        projected_estimate = _estimated_tokens(projected)
        estimated_added = projected_estimate - original_estimate
        # A positive measured savings claim is NEVER inferred from this
        # character heuristic. This is just a request-local admission gate:
        # discard all additions that do not demonstrably shrink the request.
        useful = replaced_tool_outputs > 0 and estimated_added < 0
        if not useful:
            projected = copy.deepcopy(request_messages)
            projected_estimate = original_estimate
            estimated_added = 0
        self._receipts.write({
            "schemaVersion": 1,
            "requestId": request_id,
            "sessionId": self._session_id,
            "turnId": self._turn_id,
            "status": result["status"] if useful else "not_beneficial",
            "receiptId": receipt_id,
            "providerRequestId": provider_request_id,
            "selectedEvidenceIds": selected,
            "omittedEvidenceIds": omitted,
            "bridgeDigest": self._bridge_digest,
            "pluginDigest": self._plugin_digest,
            "estimatedTokens": estimated,
            "deliveryMode": "replacement" if useful else "no_op",
            "originalEstimatedTokens": original_estimate,
            "projectedEstimatedTokens": projected_estimate,
            "estimatedAddedTokens": estimated_added,
            "replacedToolOutputs": replaced_tool_outputs if useful else 0,
            "originalRequestSha256": _request_digest(request_messages),
            "projectedRequestSha256": _request_digest(projected),
            "limitations": limitations,
            **({
                "ownership": {
                    "activeEngineId": self._ownership["activeEngineId"],
                    "hostCompactionEpoch": self._ownership["hostCompactionEpoch"],
                    "durableActiveTranscriptRevision": self._ownership["durableActiveTranscriptRevision"],
                    "attestorId": self._ownership["attestorId"],
                },
            } if self._ownership is not None else {}),
            **({"sourceCommit": result["sourceCommit"]}
               if isinstance(result.get("sourceCommit"), str) else {}),
            **({"sourceManifestSha256": result["sourceManifestSha256"]}
               if isinstance(result.get("sourceManifestSha256"), str) else {}),
        })
        self._last_request_key = request_key
        self._last_projection = copy.deepcopy(projected)
        return projected

    def close(self) -> None:
        close = getattr(self._bridge, "close", None)
        if callable(close):
            close()

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

# Direct script execution sets sys.path[0] to this package directory rather than
# the repository root. Add the root explicitly before importing integrations.*.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Allow the plugin's own CI tests to run without a separately installed Hermes
# package. Production imports the real agent.context_engine.ContextEngine.
try:
    from agent.context_engine import ContextEngine as _HermesContextEngine  # noqa: F401
except ModuleNotFoundError:
    agent_module = types.ModuleType("agent")
    context_module = types.ModuleType("agent.context_engine")

    class _HermesContextEngine:
        pass

    context_module.ContextEngine = _HermesContextEngine
    sys.modules.setdefault("agent", agent_module)
    sys.modules["agent.context_engine"] = context_module

from integrations.hermes.ace_context_engine.engine import AceContextEngine


class FakeBridge:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.requests = []

    def transform(self, request):
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        reply = json.loads(json.dumps(self.response))
        if isinstance(reply, dict) and isinstance(reply.get("result"), dict):
            reply["requestId"] = request["requestId"]
            reply["result"]["requestId"] = request["requestId"]
            reply["result"]["sessionId"] = request["sessionId"]
            reply["result"]["turnId"] = request["turnId"]
            reply["result"]["workspaceId"] = request["workspaceId"]
            reply["result"]["providerRequestId"] = "retrieval-1"
        return reply


class ContextEngineTests(unittest.TestCase):
    def test_select_context_keeps_history_unchanged_and_adds_request_only_context(self):
        bridge = FakeBridge({
            "type": "transform_result",
            "requestId": "request-1",
            "ok": True,
            "result": {
                "schemaVersion": 1,
                "requestId": "request-1",
                "sessionId": "session-1",
                "workspaceId": "workspace-1",
                "status": "ready",
                "contextText": "ACE verified context",
                "evidence": [],
                "selectedEvidenceIds": ["evidence-1"],
                "omittedEvidenceIds": [],
                "estimatedTokens": 3,
                "providerIdentities": {},
                "receiptId": "receipt-1",
                "limitations": [],
            },
        })
        with tempfile.TemporaryDirectory() as directory:
            engine = AceContextEngine(
                bridge=bridge,
                workspace_id="workspace-1",
                session_id="session-1",
                receipt_path=Path(directory) / "receipts.jsonl",
                bridge_digest="a" * 64,
                plugin_digest="b" * 64,
            )
            history = [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "old question"},
                {"role": "assistant", "content": "old answer"},
            ]
            request = [*history, {"role": "user", "content": "current question"}]
            result = engine.select_context(
                request,
                conversation_messages=history,
                incoming_message=request[-1],
                budget_tokens=10000,
            )

            self.assertIsNotNone(result)
            self.assertEqual(history[-1]["content"], "old answer")
            self.assertEqual(request[-1]["content"], "current question")
            self.assertIn("ACE verified context", result[-1]["content"])
            self.assertEqual(bridge.requests[0]["query"], "current question")
            receipt = json.loads((Path(directory) / "receipts.jsonl").read_text().strip())
            self.assertEqual(receipt["status"], "ready")
            self.assertEqual(receipt["receiptId"], "receipt-1")
            self.assertEqual(receipt["deliveryMode"], "augmentation")
            self.assertGreater(receipt["estimatedAddedTokens"], 0)
            self.assertEqual(
                receipt["projectedEstimatedTokens"] - receipt["originalEstimatedTokens"],
                receipt["estimatedAddedTokens"],
            )
            self.assertRegex(receipt["originalRequestSha256"], r"^[a-f0-9]{64}$")
            self.assertRegex(receipt["projectedRequestSha256"], r"^[a-f0-9]{64}$")
            self.assertNotEqual(receipt["originalRequestSha256"], receipt["projectedRequestSha256"])

    def test_select_context_handles_multimodal_user_content(self):
        bridge = FakeBridge({
            "type": "transform_result",
            "requestId": "request-1",
            "ok": True,
            "result": {
                "schemaVersion": 1,
                "requestId": "request-1",
                "sessionId": "session-1",
                "workspaceId": "workspace-1",
                "status": "ready",
                "contextText": "ACE context",
                "evidence": [],
                "selectedEvidenceIds": ["evidence-2"],
                "omittedEvidenceIds": [],
                "estimatedTokens": 2,
                "providerIdentities": {},
                "receiptId": "receipt-1",
                "limitations": [],
            },
        })
        engine = AceContextEngine(bridge=bridge, workspace_id="workspace-1", session_id="session-1", bridge_digest="a" * 64, plugin_digest="b" * 64)
        request = [{
            "role": "user",
            "content": [{"type": "text", "text": "find this"}],
        }]

        result = engine.select_context(request, incoming_message=request[-1], budget_tokens=10000)

        self.assertEqual(bridge.requests[0]["query"], "find this")
        self.assertIn("ACE context", result[0]["content"][-1]["text"])
        self.assertEqual(request[0]["content"], [{"type": "text", "text": "find this"}])

    def test_exact_provider_retry_reuses_projection_and_receipt_identity(self):
        bridge = FakeBridge({
            "type": "transform_result",
            "ok": True,
            "result": {
                "status": "ready",
                "contextText": "stable ACE context",
                "receiptId": "receipt-stable",
                "selectedEvidenceIds": ["ev-1"],
                "omittedEvidenceIds": [],
                "estimatedTokens": 4,
                "limitations": [],
            },
        })
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "receipts.jsonl"
            engine = AceContextEngine(
                bridge=bridge,
                workspace_id="workspace-1",
                session_id="session-1",
                receipt_path=receipt_path,
                bridge_digest="a" * 64,
                plugin_digest="b" * 64,
            )
            request = [{"role": "user", "content": "same provider request"}]
            first = engine.select_context(request, budget_tokens=10000)
            second = engine.select_context(request, budget_tokens=10000)

            self.assertEqual(first, second)
            self.assertIsNot(first, second)
            self.assertEqual(len(bridge.requests), 1)
            receipts = receipt_path.read_text().strip().splitlines()
            self.assertEqual(len(receipts), 1)
            self.assertEqual(json.loads(receipts[0])["receiptId"], "receipt-stable")

            changed = [{"role": "user", "content": "next request after a tool/result change"}]
            engine.select_context(changed, budget_tokens=10000)
            self.assertEqual(len(bridge.requests), 2)

    def test_clone_for_agent_avoids_deepcopying_lock_state(self):
        engine = AceContextEngine(
            bridge=FakeBridge({"ok": False}),
            workspace_id="workspace-1",
            session_id="seed-session",
            bridge_digest="a" * 64,
            plugin_digest="b" * 64,
        )
        clone = engine.clone_for_agent()
        self.assertIsNot(clone, engine)
        self.assertEqual(clone._workspace_id, "workspace-1")
        self.assertEqual(clone._session_id, "seed-session")
        self.assertEqual(clone._bridge_digest, "a" * 64)
        self.assertEqual(clone._plugin_digest, "b" * 64)

    def test_on_session_start_replaces_placeholder_session_identity(self):
        engine = AceContextEngine(
            bridge=FakeBridge({"ok": False}),
            workspace_id="workspace-1",
            session_id="unknown",
            bridge_digest="a" * 64,
            plugin_digest="b" * 64,
        )
        # An attestation issued for the placeholder session cannot authorize
        # a real session after Hermes emits on_session_start.
        engine._ownership = {"sessionId": "unknown"}
        engine._ownership_failures = []
        engine.on_session_start("hermes-session-123")
        self.assertEqual(engine._session_id, "hermes-session-123")
        self.assertIn("sessionId", engine._ownership_failures)

    def test_bridge_failure_returns_original_request_and_blocked_receipt(self):
        bridge = FakeBridge(error=RuntimeError("bridge unavailable"))
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "receipts.jsonl"
            engine = AceContextEngine(
                bridge=bridge,
                workspace_id="workspace-1",
                session_id="session-1",
                receipt_path=receipt_path,
                bridge_digest="a" * 64,
                plugin_digest="b" * 64,
            )
            request = [{"role": "user", "content": "current question"}]
            with self.assertRaises(SystemExit):
                engine.select_context(request, incoming_message=request[-1], budget_tokens=100000)

            self.assertEqual(request[0]["content"], "current question")
            receipt = json.loads(receipt_path.read_text().strip())
            self.assertEqual(receipt["status"], "blocked")
            self.assertNotIn("bridge unavailable", receipt.get("contextText", ""))



    def test_unexpected_configuration_error_cannot_fall_back_to_original_request(self):
        bridge = FakeBridge({"ok": False})
        engine = AceContextEngine(
            bridge=bridge,
            workspace_id="workspace-1",
            session_id="session-1",
            bridge_digest="a" * 64,
            plugin_digest="b" * 64,
        )
        old = __import__("os").environ.get("ACE_CONTEXT_BUDGET_TOKENS")
        __import__("os").environ["ACE_CONTEXT_BUDGET_TOKENS"] = "not-an-integer"
        try:
            with self.assertRaises(SystemExit):
                engine.select_context([{"role": "user", "content": "question"}], budget_tokens=10000)
        finally:
            if old is None:
                __import__("os").environ.pop("ACE_CONTEXT_BUDGET_TOKENS", None)
            else:
                __import__("os").environ["ACE_CONTEXT_BUDGET_TOKENS"] = old

    def test_receipt_write_failure_still_aborts_instead_of_failing_open(self):
        bridge = FakeBridge(error=RuntimeError("bridge unavailable"))
        with tempfile.TemporaryDirectory() as directory:
            engine = AceContextEngine(
                bridge=bridge,
                workspace_id="workspace-1",
                session_id="session-1",
                # Opening a directory as an append-only file raises, exercising
                # _abort's final SystemExit guarantee.
                receipt_path=Path(directory),
                bridge_digest="a" * 64,
                plugin_digest="b" * 64,
            )
            with self.assertRaises(SystemExit):
                engine.select_context([{"role": "user", "content": "question"}], budget_tokens=10000)

    def test_stale_response_identity_aborts_before_model_call(self):
        class StaleBridge(FakeBridge):
            def transform(self, request):
                result = super().transform(request)
                result["requestId"] = "another-request"
                return result

        bridge = StaleBridge({
            "ok": True, "result": {
                "status": "ready", "contextText": "wrong context", "receiptId": "receipt-1",
                "selectedEvidenceIds": ["ev-1"], "omittedEvidenceIds": [],
                "estimatedTokens": 2, "limitations": [],
            },
        })
        engine = AceContextEngine(
            bridge=bridge, workspace_id="workspace-1", session_id="session-1",
            bridge_digest="a" * 64, plugin_digest="b" * 64,
        )
        request = [{"role": "user", "content": "question"}]
        with self.assertRaises(SystemExit):
            engine.select_context(request, budget_tokens=10000)
        self.assertEqual(request, [{"role": "user", "content": "question"}])

if __name__ == "__main__":
    unittest.main()

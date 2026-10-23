import json
import tempfile
import unittest
from pathlib import Path

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
        return self.response


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
                budget_tokens=1000,
            )

            self.assertIsNotNone(result)
            self.assertEqual(history[-1]["content"], "old answer")
            self.assertEqual(request[-1]["content"], "current question")
            self.assertIn("ACE verified context", result[-1]["content"])
            self.assertEqual(bridge.requests[0]["query"], "current question")
            receipt = json.loads((Path(directory) / "receipts.jsonl").read_text().strip())
            self.assertEqual(receipt["status"], "ready")
            self.assertEqual(receipt["receiptId"], "receipt-1")

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
                "selectedEvidenceIds": [],
                "omittedEvidenceIds": [],
                "estimatedTokens": 2,
                "providerIdentities": {},
                "receiptId": "receipt-1",
                "limitations": [],
            },
        })
        engine = AceContextEngine(bridge=bridge, workspace_id="workspace-1", session_id="session-1")
        request = [{
            "role": "user",
            "content": [{"type": "text", "text": "find this"}],
        }]

        result = engine.select_context(request, incoming_message=request[-1], budget_tokens=1000)

        self.assertEqual(bridge.requests[0]["query"], "find this")
        self.assertIn("ACE context", result[0]["content"][-1]["text"])
        self.assertEqual(request[0]["content"], [{"type": "text", "text": "find this"}])

    def test_bridge_failure_returns_original_request_and_blocked_receipt(self):
        bridge = FakeBridge(error=RuntimeError("bridge unavailable"))
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "receipts.jsonl"
            engine = AceContextEngine(
                bridge=bridge,
                workspace_id="workspace-1",
                session_id="session-1",
                receipt_path=receipt_path,
            )
            request = [{"role": "user", "content": "current question"}]
            result = engine.select_context(request, incoming_message=request[-1], budget_tokens=1000)

            self.assertEqual(result, request)
            receipt = json.loads(receipt_path.read_text().strip())
            self.assertEqual(receipt["status"], "blocked")
            self.assertNotIn("bridge unavailable", receipt.get("contextText", ""))


if __name__ == "__main__":
    unittest.main()

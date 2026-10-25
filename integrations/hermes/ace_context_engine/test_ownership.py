from __future__ import annotations

import hashlib
import unittest

from integrations.hermes.ace_context_engine.ownership import (
    STRICT_COMPACTION_CONTROLS,
    controls_digest,
    strict_controls_digest,
    validate_host_ownership,
)


class OwnershipTests(unittest.TestCase):
    def attestation(self) -> dict[str, object]:
        return {
            "hostBuildDigest": hashlib.sha256(b"host").hexdigest(),
            "sessionId": "session-1",
            "activeEngineId": "ace_context_engine",
            "effectiveCompressionControlsDigest": strict_controls_digest(),
            "durableActiveTranscriptRevision": "row-7",
            "durableActiveTranscriptDigest": hashlib.sha256(b"rows").hexdigest(),
            "hostCompactionEpoch": 3,
            "attestorId": "hermes-attestor",
            "providerManagedHistoryCapability": "visible",
            "hostTranscriptAttested": True,
            "compactionEnabled": False,
        }

    def test_strict_controls_are_stable_and_digestable(self) -> None:
        self.assertEqual(STRICT_COMPACTION_CONTROLS["compression.enabled"], False)
        self.assertEqual(len(strict_controls_digest()), 64)
        self.assertEqual(strict_controls_digest(), controls_digest(dict(STRICT_COMPACTION_CONTROLS)))

    def test_valid_attestation_is_accepted(self) -> None:
        self.assertEqual(validate_host_ownership(self.attestation()), [])

    def test_zero_epoch_is_valid_and_wrong_session_is_rejected(self) -> None:
        value = self.attestation()
        value["hostCompactionEpoch"] = 0
        self.assertEqual(validate_host_ownership(value, "session-1"), [])
        self.assertIn("sessionId", validate_host_ownership(value, "other-session"))
        value["hostCompactionEpoch"] = -1
        self.assertIn("hostCompactionEpoch", validate_host_ownership(value))
        value["hostCompactionEpoch"] = True
        self.assertIn("hostCompactionEpoch", validate_host_ownership(value))

    def test_unknown_epoch_or_compaction_is_not_strictly_usable(self) -> None:
        unknown = self.attestation()
        unknown["hostCompactionEpoch"] = "unknown"
        self.assertIn("hostCompactionEpoch", validate_host_ownership(unknown))
        active = self.attestation()
        active["compactionEnabled"] = True
        self.assertIn("compactionEnabled", validate_host_ownership(active))

    def test_wrong_controls_digest_is_rejected(self) -> None:
        value = self.attestation()
        value["effectiveCompressionControlsDigest"] = hashlib.sha256(b"different").hexdigest()
        self.assertIn("effectiveCompressionControlsDigest", validate_host_ownership(value))


if __name__ == "__main__":
    unittest.main()

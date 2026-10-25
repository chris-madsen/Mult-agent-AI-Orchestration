from __future__ import annotations

import hashlib
import json
import os
from typing import Any

STRICT_COMPACTION_CONTROLS = {
    "compression.enabled": False,
    "compression.micro_compact": False,
    "compression.proactive_prune_tokens": 0,
    "compression.idle_compact_after_seconds": 0,
    "compression.codex_responses_native": False,
    "compression.codex_app_server_auto": "off",
}


def controls_digest(controls: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(controls, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def strict_controls_digest() -> str:
    return controls_digest(STRICT_COMPACTION_CONTROLS)


def validate_host_ownership(attestation: dict[str, Any], expected_session_id: str | None = None) -> list[str]:
    required = (
        "hostBuildDigest",
        "sessionId",
        "activeEngineId",
        "effectiveCompressionControlsDigest",
        "durableActiveTranscriptRevision",
        "durableActiveTranscriptDigest",
        "attestorId",
        "hostCompactionEpoch",
    )
    failures = [
        name for name in required
        if name not in attestation or attestation[name] is None
        or (isinstance(attestation[name], str) and not attestation[name])
    ]
    epoch = attestation.get("hostCompactionEpoch")
    if isinstance(epoch, bool) or not isinstance(epoch, int) or epoch < 0:
        failures.append("hostCompactionEpoch")
    if expected_session_id is not None and attestation.get("sessionId") != expected_session_id:
        failures.append("sessionId")
    if attestation.get("hostCompactionEpoch") == "unknown":
        failures.append("hostCompactionEpoch")
    if attestation.get("hostTranscriptAttested") is not True:
        failures.append("hostTranscriptAttested")
    if attestation.get("compactionEnabled") is not False:
        failures.append("compactionEnabled")
    if attestation.get("providerManagedHistoryCapability") != "visible":
        failures.append("providerManagedHistoryCapability")
    if attestation.get("effectiveCompressionControlsDigest") != strict_controls_digest():
        failures.append("effectiveCompressionControlsDigest")
    for name in ("hostBuildDigest", "effectiveCompressionControlsDigest", "durableActiveTranscriptDigest"):
        value = attestation.get(name)
        if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            failures.append(name)
    return sorted(set(failures))


def host_ownership_from_environment() -> dict[str, Any]:
    raw_epoch = os.environ.get("ACE_CONTEXT_HOST_COMPACTION_EPOCH", "unknown")
    epoch: int | str
    try:
        epoch = int(raw_epoch)
    except ValueError:
        epoch = "unknown"
    controls = {
        "compression.enabled": os.environ.get("ACE_HERMES_COMPRESSION_ENABLED", "false").lower() == "true",
        "compression.micro_compact": os.environ.get("ACE_HERMES_MICRO_COMPACT", "false").lower() == "true",
        "compression.proactive_prune_tokens": int(os.environ.get("ACE_HERMES_PROACTIVE_PRUNE_TOKENS", "0")),
        "compression.idle_compact_after_seconds": int(os.environ.get("ACE_HERMES_IDLE_COMPACT_AFTER_SECONDS", "0")),
        "compression.codex_responses_native": os.environ.get("ACE_HERMES_CODEX_RESPONSES_NATIVE", "false").lower() == "true",
        "compression.codex_app_server_auto": os.environ.get("ACE_HERMES_CODEX_APP_SERVER_AUTO", "off"),
    }
    return {
        "hostBuildDigest": os.environ.get("ACE_CONTEXT_HOST_BUILD_SHA256", ""),
        "sessionId": os.environ.get("HERMES_SESSION_ID", ""),
        "activeEngineId": os.environ.get("ACE_CONTEXT_ACTIVE_ENGINE_ID", "ace_context_engine"),
        "effectiveCompressionControlsDigest": controls_digest(controls),
        "durableActiveTranscriptRevision": os.environ.get("ACE_CONTEXT_TRANSCRIPT_REVISION", ""),
        "durableActiveTranscriptDigest": os.environ.get("ACE_CONTEXT_TRANSCRIPT_SHA256", ""),
        "hostCompactionEpoch": epoch,
        "attestorId": os.environ.get("ACE_CONTEXT_ATTESTOR_ID", ""),
        "providerManagedHistoryCapability": os.environ.get("ACE_CONTEXT_PROVIDER_HISTORY", "unknown"),
        "hostTranscriptAttested": os.environ.get("ACE_CONTEXT_HOST_TRANSCRIPT_ATTESTED", "false").lower() == "true",
        "compactionEnabled": any((
            controls["compression.enabled"],
            controls["compression.micro_compact"],
            controls["compression.proactive_prune_tokens"] > 0,
            controls["compression.idle_compact_after_seconds"] > 0,
            controls["compression.codex_responses_native"],
            controls["compression.codex_app_server_auto"] != "off",
        )),
    }

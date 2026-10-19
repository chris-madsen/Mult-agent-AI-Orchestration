#!/usr/bin/env python3
"""Long-lived FastEmbed boundary used by the TypeScript runtime."""
from __future__ import annotations

import importlib.metadata
import hashlib
import json
import os
import platform
import sys
import time

from fastembed import TextEmbedding
from embedding_artifact_verifier import verify_loaded_artifact


def _version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _runtime_build() -> str:
    digest = hashlib.sha256()
    with open(__file__, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"{os.path.basename(__file__)}#{digest.hexdigest()}"


def main() -> int:
    model_name = sys.argv[1]
    os.environ.setdefault("ACE_EMBEDDING_MODEL", model_name)
    model = TextEmbedding(model_name=model_name)
    artifact_digest = verify_loaded_artifact(model)
    probe = next(iter(model.embed(["ace_embedding_identity_probe"]))).tolist()
    execution_mode = os.environ.get("ACE_EMBEDDING_EXECUTION_MODE", "experimental-unpinned")
    pinned = os.environ.get("ACE_EMBEDDING_PINNED", "false") == "true"
    if execution_mode not in {"pinned", "experimental-unpinned"} or pinned != (execution_mode == "pinned"):
        raise RuntimeError("embedding execution mode and pinned flag are inconsistent")
    identity = {
        "provider": os.environ.get("ACE_EMBEDDING_PROVIDER", "fastembed/onnx"),
        "model": model_name,
        "modelRevision": os.environ.get("ACE_EMBEDDING_MODEL_REVISION", "unknown"),
        "artifactModel": os.environ.get("ACE_EMBEDDING_ARTIFACT_MODEL", model_name),
        "artifactRevision": os.environ.get("ACE_EMBEDDING_ARTIFACT_REVISION", "unknown"),
        "artifactDigest": artifact_digest,
        "dimension": len(probe),
        "preprocessing": os.environ.get("ACE_EMBEDDING_PREPROCESSING", "raw_text_v1"),
        "executionMode": execution_mode,
        "pinned": pinned,
        "runtimeBuild": _runtime_build(),
        "runtimeVersion": f"python/{platform.python_version()}|fastembed/{_version('fastembed')}|onnxruntime/{_version('onnxruntime')}",
    }
    print(json.dumps({"type": "ready", "identity": identity}, separators=(",", ":")), flush=True)
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            texts = request["texts"]
            if not isinstance(texts, list) or not texts or not all(isinstance(text, str) and text.strip() for text in texts):
                raise ValueError("texts must be a non-empty list of non-empty strings")
            delay_ms = float(os.environ.get("ACE_EMBEDDING_DELAY_MS", "0"))
            if delay_ms > 0:
                time.sleep(delay_ms / 1000)
            vectors = [vector.tolist() for vector in model.embed(texts)]
            print(json.dumps({"id": request_id, "vectors": vectors}, separators=(",", ":")), flush=True)
        except Exception as error:
            request_id = request.get("id") if isinstance(request, dict) else None
            print(json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

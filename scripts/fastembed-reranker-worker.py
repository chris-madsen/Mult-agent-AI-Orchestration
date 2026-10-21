#!/usr/bin/env python3
"""Long-lived FastEmbed cross-encoder boundary for ACE reranker evaluation."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import sys

from fastembed.rerank.cross_encoder import TextCrossEncoder


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
    threads = int(os.environ.get("ACE_RERANKER_THREADS", "0"))
    model = TextCrossEncoder(
        model_name=model_name,
        **({"threads": threads} if threads > 0 else {}),
    )
    identity = {
        "provider": "fastembed/cross-encoder",
        "model": model_name,
        "runtimeBuild": _runtime_build(),
        "runtimeVersion": (
            f"python/{platform.python_version()}|"
            f"fastembed/{_version('fastembed')}|"
            f"onnxruntime/{_version('onnxruntime')}"
        ),
    }
    print(json.dumps({"type": "ready", "identity": identity}, separators=(",", ":")), flush=True)

    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            query = request["query"]
            documents = request["documents"]
            if not isinstance(query, str) or not query.strip():
                raise ValueError("query must be a non-empty string")
            if (
                not isinstance(documents, list)
                or not documents
                or not all(isinstance(document, str) and document.strip() for document in documents)
            ):
                raise ValueError("documents must be a non-empty list of non-empty strings")
            scores = [float(score) for score in model.rerank(query, documents)]
            print(
                json.dumps({"id": request_id, "scores": scores}, separators=(",", ":")),
                flush=True,
            )
        except Exception as error:
            request_id = request.get("id") if isinstance(request, dict) else None
            print(
                json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")),
                flush=True,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

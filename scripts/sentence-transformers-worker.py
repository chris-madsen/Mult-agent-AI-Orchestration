#!/usr/bin/env python3
"""Long-lived Sentence-Transformers boundary using the shared worker protocol."""
from __future__ import annotations

import json
import os
import sys
import time

from huggingface_hub import snapshot_download
from sentence_transformers import SentenceTransformer
from embedding_artifact_verifier import verify_loaded_artifact


def main() -> int:
    model_name = sys.argv[1]
    os.environ.setdefault("ACE_EMBEDDING_MODEL", model_name)
    revision = os.environ.get("ACE_EMBEDDING_MODEL_REVISION")
    # Resolve once, then load AND hash the same local snapshot. Resolving a
    # different cache entry after loading does not prove inference identity.
    loaded_path = snapshot_download(model_name, revision=revision, local_files_only=True)
    model = SentenceTransformer(loaded_path, local_files_only=True)
    verify_loaded_artifact(model, loaded_path=loaded_path)
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
            vectors = model.encode(texts, normalize_embeddings=False).tolist()
            print(json.dumps({"id": request_id, "vectors": vectors}, separators=(",", ":")), flush=True)
        except Exception as error:
            request_id = request.get("id") if isinstance(request, dict) else None
            print(json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

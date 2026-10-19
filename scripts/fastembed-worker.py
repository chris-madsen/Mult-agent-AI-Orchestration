#!/usr/bin/env python3
"""Long-lived FastEmbed boundary used by the TypeScript runtime."""

from __future__ import annotations

import json
import os
import sys
import time

from fastembed import TextEmbedding


def main() -> int:
    model_name = sys.argv[1]
    model = TextEmbedding(model_name=model_name)
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            texts = request["texts"]
            if not isinstance(texts, list) or not all(isinstance(text, str) and text.strip() for text in texts):
                raise ValueError("texts must be a non-empty list of non-empty strings")
            delay_ms = float(os.environ.get("ACE_EMBEDDING_DELAY_MS", "0"))
            if delay_ms > 0:
                time.sleep(delay_ms / 1000)
            vectors = [vector.tolist() for vector in model.embed(texts)]
            print(json.dumps({"id": request_id, "vectors": vectors}, separators=(",", ":")), flush=True)
        except Exception as error:  # provider boundary: serialize failure, never fake vectors
            request_id = request.get("id") if isinstance(request, dict) else None
            print(json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

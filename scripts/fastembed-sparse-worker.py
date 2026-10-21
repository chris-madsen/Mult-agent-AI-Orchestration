#!/usr/bin/env python3
"""Long-lived local FastEmbed BM25 boundary for self-hosted Qdrant."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys

from fastembed import SparseTextEmbedding


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


def _artifact_digest(model: SparseTextEmbedding) -> str:
    model_dir = getattr(model.model, "_model_dir", None)
    if model_dir is None:
        raise RuntimeError("sparse embedding model did not expose a local artifact directory")
    root = Path(model_dir)
    if not root.is_dir():
        raise RuntimeError("sparse embedding artifact directory does not exist")
    digest = hashlib.sha256()
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if not files:
        raise RuntimeError("sparse embedding artifact directory is empty")
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _serialized(embedding) -> dict[str, list[float] | list[int]]:
    indices = [int(value) for value in embedding.indices.tolist()]
    values = [float(value) for value in embedding.values.tolist()]
    if not indices or len(indices) != len(values):
        raise RuntimeError("FastEmbed returned an empty or malformed sparse vector")
    return {"indices": indices, "values": values}


def main() -> int:
    model_name = sys.argv[1] if len(sys.argv) > 1 else "Qdrant/bm25"
    threads = int(os.environ.get("ACE_SPARSE_EMBEDDING_THREADS", "0")) or None
    # Language-neutral processing is deliberate for source identifiers plus RU/EN
    # queries. Python's Unicode-aware \w tokenizer is retained by FastEmbed BM25.
    model = SparseTextEmbedding(
        model_name=model_name,
        threads=threads,
        disable_stemmer=True,
        stopwords=set(),
    )
    identity = {
        "provider": "fastembed/sparse",
        "model": model_name,
        "preprocessing": "bm25_unicode_no_stem_no_stopwords_v1",
        "artifactDigest": _artifact_digest(model),
        "runtimeBuild": _runtime_build(),
        "runtimeVersion": (
            f"python/{platform.python_version()}|"
            f"fastembed/{_version('fastembed')}"
        ),
    }
    print(json.dumps({"type": "ready", "identity": identity}, separators=(",", ":")), flush=True)

    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            mode = request["mode"]
            texts = request["texts"]
            if mode not in {"document", "query"}:
                raise ValueError("mode must be document or query")
            if not isinstance(texts, list) or not texts or not all(
                isinstance(text, str) and text.strip() for text in texts
            ):
                raise ValueError("texts must be a non-empty list of non-empty strings")
            generated = model.embed(texts) if mode == "document" else model.query_embed(texts)
            vectors = [_serialized(vector) for vector in generated]
            print(json.dumps({"id": request_id, "vectors": vectors}, separators=(",", ":")), flush=True)
        except Exception as error:
            request_id = request.get("id") if isinstance(request, dict) else None
            print(json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

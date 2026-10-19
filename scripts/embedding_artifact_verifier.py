#!/usr/bin/env python3
"""Verify a loaded local embedding artifact without reading source payloads."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path


def tree_sha256(root: Path) -> str:
    if not root.is_dir():
        raise RuntimeError(f"embedding artifact directory is missing: {root}")
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if not files:
        raise RuntimeError(f"embedding artifact directory is empty: {root}")
    digest = hashlib.sha256()
    for path in files:
        if path.name.endswith(".incomplete") or path.stat().st_size == 0:
            raise RuntimeError(f"incomplete embedding artifact: {path}")
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(path.stat().st_size).encode("ascii"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def verify_loaded_artifact(model: object) -> str:
    model_dir = getattr(model, "_model_dir", None)
    if model_dir is None:
        nested_model = getattr(model, "model", None)
        model_dir = getattr(nested_model, "_model_dir", None)
    if model_dir is None:
        model_name = os.environ.get("ACE_EMBEDDING_MODEL", "").strip()
        revision = os.environ.get("ACE_EMBEDDING_MODEL_REVISION", "").strip()
        if not model_name or not revision:
            raise RuntimeError("embedding provider did not expose its loaded artifact directory")
        from huggingface_hub import snapshot_download
        model_dir = snapshot_download(model_name, revision=revision, local_files_only=True)
    digest = tree_sha256(Path(model_dir))
    expected = os.environ.get("ACE_EMBEDDING_ARTIFACT_DIGEST", "").strip()
    if expected and digest != expected:
        raise RuntimeError(f"embedding artifact digest mismatch: expected {expected}, got {digest}")
    return digest

#!/usr/bin/env python3
"""Verify the artifact actually selected by the local embedding worker."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path


def tree_sha256(root: Path) -> str:
    if not root.is_dir():
        raise RuntimeError(f"embedding artifact directory is missing: {root}")
    entries = sorted(root.rglob("*"))
    for path in entries:
        if path.is_symlink() and not path.exists():
            raise RuntimeError(f"broken embedding artifact link: {path}")
        if path.name.endswith(".incomplete"):
            raise RuntimeError(f"incomplete embedding artifact: {path}")
    files = [path for path in entries if path.is_file()]
    if not files:
        raise RuntimeError(f"embedding artifact directory is empty: {root}")
    digest = hashlib.sha256()
    for path in files:
        size = path.stat().st_size
        if size == 0:
            raise RuntimeError(f"incomplete embedding artifact: {path}")
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def verify_loaded_artifact(model: object, *, loaded_path: str | Path | None = None) -> str:
    # loaded_path is allowed only when the caller loaded the model from that
    # exact local directory. Never infer a loaded artifact from a cache lookup.
    model_dir = loaded_path if loaded_path is not None else getattr(model, "_model_dir", None)
    if model_dir is None:
        nested_model = getattr(model, "model", None)
        model_dir = getattr(nested_model, "_model_dir", None)
    if model_dir is None:
        raise RuntimeError("embedding provider did not expose its loaded artifact directory")
    resolved = Path(model_dir).resolve()
    expected_model = os.environ.get("ACE_EMBEDDING_ARTIFACT_MODEL", "").strip()
    if expected_model:
        if "\\" in expected_model or any(part in {"", ".", ".."} for part in expected_model.split("/")):
            raise RuntimeError("embedding artifact model label is invalid")
        model_marker = f"models--{expected_model.replace('/', '--')}"
        if model_marker not in {path.name for path in (resolved, *resolved.parents)}:
            raise RuntimeError(
                f"embedding artifact model mismatch: expected {expected_model}, loaded {resolved}"
            )
    expected_revision = os.environ.get("ACE_EMBEDDING_ARTIFACT_REVISION", "").strip()
    if expected_revision and expected_revision not in resolved.parts:
        raise RuntimeError(
            f"embedding artifact revision mismatch: expected {expected_revision}, loaded {resolved}"
        )
    digest = tree_sha256(resolved)
    expected = os.environ.get("ACE_EMBEDDING_ARTIFACT_DIGEST", "").strip()
    if expected and digest != expected:
        raise RuntimeError(f"embedding artifact digest mismatch: expected {expected}, got {digest}")
    return digest

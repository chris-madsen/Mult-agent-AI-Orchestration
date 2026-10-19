#!/usr/bin/env python3
"""Compare approved local embedding runtimes in isolated pinned processes."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = ROOT / "benchmarks/retrieval/embedding-provider-comparison-labels.json"
OUTPUT = ROOT / "benchmarks/reports/embedding-provider-comparison-rerun.json"
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
FASTEMBED_ARTIFACT_ID = "qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q"
FASTEMBED_CACHE = ROOT / ".cache/ace-fastembed"


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(float(a) * float(b) for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(float(a) * float(a) for a in left))
    right_norm = math.sqrt(sum(float(b) * float(b) for b in right))
    if left_norm == 0 or right_norm == 0:
        raise ValueError("zero-length embedding norm")
    return dot / (left_norm * right_norm)


def package_version(name: str) -> str:
    try:
        from importlib.metadata import version
        return version(name)
    except Exception:
        return "unknown"


def artifact_digest(model_id: str, revision: str | None) -> dict[str, object]:
    """Hash the complete local snapshot and reject incomplete HF cache entries."""
    if Path(model_id).is_dir():
        root = Path(model_id)
        candidates = sorted(root.glob("models--*/snapshots/*"))
        if not candidates:
            candidates = [root]
        snapshot = candidates[-1]
    else:
        from huggingface_hub import snapshot_download

        arguments = {"repo_id": model_id, "local_files_only": True}
        if revision is not None:
            arguments["revision"] = revision
        snapshot = Path(snapshot_download(**arguments))
    if not snapshot.is_dir():
        raise RuntimeError(f"model snapshot is not a directory: {snapshot}")
    files = sorted(path for path in snapshot.rglob("*") if path.is_file())
    if not files:
        raise RuntimeError(f"model snapshot is empty: {snapshot}")
    digest = hashlib.sha256()
    total_bytes = 0
    for path in files:
        if path.name.endswith(".incomplete"):
            raise RuntimeError(f"incomplete model artifact: {path}")
        if path.is_symlink() and not path.exists():
            raise RuntimeError(f"broken model artifact link: {path}")
        relative = path.relative_to(snapshot).as_posix()
        size = path.stat().st_size
        if size == 0:
            raise RuntimeError(f"empty model artifact: {path}")
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        total_bytes += size
    try:
        display_snapshot = snapshot.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        display_snapshot = f"<external-cache>/{snapshot.name}"
    return {
        "model_id": model_id,
        "revision": revision or snapshot.name,
        "snapshot": display_snapshot,
        "tree_sha256": digest.hexdigest(),
        "file_count": len(files),
        "total_bytes": total_bytes,
    }


def evaluate(
    provider: str,
    model_id: str,
    revision: str,
    artifact_model_id: str,
    artifact_revision: str | None,
    encode,
    runtime: dict[str, object],
    dataset_path: Path,
) -> dict[str, object]:
    dataset_bytes = dataset_path.read_bytes()
    dataset = json.loads(dataset_bytes.decode("utf-8"))
    dataset_sha256 = hashlib.sha256(dataset_bytes).hexdigest()
    candidate_ids = list(dataset["candidates"].keys())
    candidate_texts = [dataset["candidates"][key] for key in candidate_ids]
    started = time.perf_counter()
    candidate_vectors = encode(candidate_texts)
    index_ms = (time.perf_counter() - started) * 1000
    if not candidate_vectors or not candidate_vectors[0]:
        raise RuntimeError("embedding provider returned no vectors")
    dimensions = len(candidate_vectors[0])
    if any(len(vector) != dimensions for vector in candidate_vectors):
        raise RuntimeError("embedding provider returned inconsistent dimensions")
    query_ms: list[float] = []
    observations = []
    for case in dataset["queries"]:
        started = time.perf_counter()
        query_vector = encode([case["query"]])[0]
        query_ms.append((time.perf_counter() - started) * 1000)
        ranked = sorted(
            ((candidate_id, cosine(query_vector, vector)) for candidate_id, vector in zip(candidate_ids, candidate_vectors, strict=True)),
            key=lambda item: item[1], reverse=True,
        )
        relevant_rank = next(
            (index + 1 for index, item in enumerate(ranked) if item[0] == case["relevant"]),
            None,
        )
        if relevant_rank is None:
            raise RuntimeError(f"relevant candidate is absent from ranking: {case['relevant']}")
        observations.append({
            "query": case["query"],
            "relevant": case["relevant"],
            "relevant_rank": relevant_rank,
            "top1": ranked[0][0],
            "top3": [item[0] for item in ranked[:3]],
            "top5": [item[0] for item in ranked[:5]],
            "scores": ranked[:5],
        })
    relevant_count = len(observations)
    sorted_query_ms = sorted(query_ms)
    artifact = artifact_digest(artifact_model_id, artifact_revision)
    if Path(artifact_model_id).is_dir():
        artifact["model_id"] = FASTEMBED_ARTIFACT_ID
    return {
        "provider": provider, "model": model_id, "revision": revision,
        "dimensions": dimensions,
        "case_count": relevant_count,
        "dataset_sha256": dataset_sha256,
        "index_ms": index_ms,
        "index_candidates_per_second": (
            len(candidate_texts) / (index_ms / 1000)
            if index_ms > 0
            else None
        ),
        "query_ms_median": statistics.median(query_ms),
        "query_ms_p95": sorted_query_ms[max(0, math.ceil(len(query_ms) * 0.95) - 1)],
        "query_ms_max": max(query_ms),
        "recall_at_1": sum(row["relevant_rank"] <= 1 for row in observations) / relevant_count,
        "recall_at_3": sum(row["relevant_rank"] <= 3 for row in observations) / relevant_count,
        "recall_at_5": sum(row["relevant_rank"] <= 5 for row in observations) / relevant_count,
        "mrr": sum(1.0 / row["relevant_rank"] for row in observations) / relevant_count,
        "ndcg_at_5": sum(
            (1.0 / math.log2(row["relevant_rank"] + 1))
            if row["relevant_rank"] <= 5
            else 0.0
            for row in observations
        ) / relevant_count,
        "results": observations,
        "artifact": artifact,
        "source_model": model_id,
        "similarity": "cosine-normalized-at-scoring",
        "preprocessing": "raw_text_v1; no provider-side normalization", "runtime": runtime,
    }


def current_memory_bytes() -> int | None:
    try:
        import resource
        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value * (1024 if sys.platform != "darwin" else 1))
    except (ImportError, AttributeError):
        return None


def run_provider(provider: str, dataset_path: Path) -> dict[str, object]:
    if provider == "fastembed/onnx":
        from fastembed import TextEmbedding
        os.environ.setdefault("FASTEMBED_CACHE_PATH", str(FASTEMBED_CACHE))
        started = time.perf_counter()
        model = TextEmbedding(model_name=MODEL_ID)
        load_ms = (time.perf_counter() - started) * 1000
        result = evaluate(
            provider, MODEL_ID, MODEL_REVISION, str(FASTEMBED_CACHE), None,
            lambda texts: [vector.tolist() for vector in model.embed(texts)],
            {"python": platform.python_version(), "fastembed": package_version("fastembed"),
             "onnxruntime": package_version("onnxruntime"), "numpy": package_version("numpy"),
             "preprocessing": "raw_text_v1; fastembed model defaults"},
            dataset_path,
        )
    elif provider == "sentence-transformers/pytorch":
        from sentence_transformers import SentenceTransformer
        started = time.perf_counter()
        model = SentenceTransformer(MODEL_ID, revision=MODEL_REVISION)
        load_ms = (time.perf_counter() - started) * 1000
        result = evaluate(
            provider, MODEL_ID, MODEL_REVISION, MODEL_ID, MODEL_REVISION,
            lambda texts: model.encode(texts, normalize_embeddings=False, convert_to_numpy=True).tolist(),
            {"python": platform.python_version(), "sentence-transformers": package_version("sentence-transformers"),
             "torch": package_version("torch"), "transformers": package_version("transformers"),
             "numpy": package_version("numpy"), "preprocessing": "raw_text_v1; normalize_embeddings=false"},
            dataset_path,
        )
    else:
        raise ValueError(f"unsupported provider: {provider}")
    result["model_load_ms"] = load_ms
    result["max_rss_bytes"] = current_memory_bytes()
    return result


def run_candidate(provider: str, python_command: str, dataset_path: Path) -> dict[str, object]:
    command = [
        python_command,
        str(Path(__file__).resolve()),
        "--provider",
        provider,
        "--dataset",
        str(dataset_path),
    ]
    environment = os.environ.copy()
    environment["HF_HUB_OFFLINE"] = "1"
    started = time.perf_counter()
    completed = subprocess.run(command, capture_output=True, text=True, check=False, env=environment)
    wall_ms = (time.perf_counter() - started) * 1000
    if completed.returncode != 0:
        return {"provider": provider, "status": "failed", "wall_ms": wall_ms,
                "error": completed.stderr[-4000:], "stdout": completed.stdout[-2000:]}
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        return {"provider": provider, "status": "failed", "wall_ms": wall_ms,
                "error": f"runner emitted invalid JSON: {error}", "stdout": completed.stdout[-4000:]}
    result["status"] = "success"
    result["wall_ms"] = wall_ms
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["fastembed/onnx", "sentence-transformers/pytorch"])
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument(
        "--evidence-stage",
        choices=["development_spike", "frozen_holdout"],
        default="development_spike",
    )
    args = parser.parse_args()
    dataset_path = Path(args.dataset).resolve()
    try:
        relative_dataset = dataset_path.relative_to(ROOT).as_posix()
    except ValueError as error:
        raise ValueError("embedding comparison dataset must be repository-contained") from error
    if not dataset_path.is_file():
        raise FileNotFoundError(f"embedding comparison dataset does not exist: {dataset_path}")
    if args.provider:
        print(json.dumps(run_provider(args.provider, dataset_path), ensure_ascii=False))
        return
    fast_python = os.environ.get("ACE_EMBEDDING_FAST_PYTHON", str(ROOT / ".venv-embedding-fast/bin/python"))
    st_python = os.environ.get("ACE_EMBEDDING_ST_PYTHON", str(ROOT / ".venv-embedding-st/bin/python"))
    candidates = [
        run_candidate("fastembed/onnx", fast_python, dataset_path),
        run_candidate("sentence-transformers/pytorch", st_python, dataset_path),
    ]
    successful = [candidate for candidate in candidates if candidate["status"] == "success"]
    winner = None
    if successful:
        winner = min(successful, key=lambda candidate: (
            -float(candidate["recall_at_5"]),
            -float(candidate["ndcg_at_5"]),
            -float(candidate["mrr"]),
            -float(candidate["recall_at_3"]),
            -float(candidate["recall_at_1"]),
            float(candidate["query_ms_p95"]),
            float(candidate["model_load_ms"]),
            int(candidate.get("max_rss_bytes") or 2**63),
            str(candidate["provider"]),
        ))["provider"]
    output = {
        "status": "comparison-complete" if len(successful) == 2 else "comparison-incomplete",
        "evidence_stage": args.evidence_stage,
        "production_approved": False,
        "selection_policy": [
            "recall_at_5",
            "ndcg_at_5",
            "mrr",
            "recall_at_3",
            "recall_at_1",
            "query_ms_p95",
            "model_load_ms",
            "max_rss_bytes",
            "provider_name",
        ],
        "dataset": relative_dataset,
        "dataset_sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "candidates": candidates,
        "winner": winner,
        "winner_meaning": "best measured candidate on this development fixture only; not production approval",
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "status": output["status"], "winner": winner}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"embedding comparison failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise

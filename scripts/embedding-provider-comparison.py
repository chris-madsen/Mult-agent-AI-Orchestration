#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "benchmarks/retrieval/embedding-provider-comparison-labels.json"
OUTPUT = ROOT / "benchmarks/reports/embedding-provider-comparison-rerun.json"


def cosine(left, right):
    dot = sum(float(a) * float(b) for a, b in zip(left, right, strict=True))
    ln = math.sqrt(sum(float(a) * float(a) for a in left))
    rn = math.sqrt(sum(float(b) * float(b) for b in right))
    if ln == 0 or rn == 0:
        raise ValueError("zero-length embedding norm")
    return dot / (ln * rn)


def artifact_digest(model_id):
    try:
        from huggingface_hub import snapshot_download
        path = Path(snapshot_download(model_id, local_files_only=True))
        digest = hashlib.sha256()
        for file in sorted(p for p in path.rglob("*") if p.is_file()):
            rel = file.relative_to(path).as_posix()
            digest.update(rel.encode())
            digest.update(b"\0")
            with file.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        return {"revision": path.name, "tree_sha256": digest.hexdigest()}
    except Exception as error:
        return {"revision": "not-captured", "tree_sha256": "not-captured", "digest_error": type(error).__name__}


def evaluate(name, model_id, encode):
    dataset = json.loads(DATASET.read_text())
    ids = list(dataset["candidates"].keys())
    texts = [dataset["candidates"][key] for key in ids]
    started = time.perf_counter()
    candidate_vectors = encode(texts)
    index_ms = (time.perf_counter() - started) * 1000
    query_ms = []
    observations = []
    for case in dataset["queries"]:
        started = time.perf_counter()
        query_vector = encode([case["query"]])[0]
        query_ms.append((time.perf_counter() - started) * 1000)
        ranked = sorted(
            ((candidate_id, cosine(query_vector, vector)) for candidate_id, vector in zip(ids, candidate_vectors, strict=True)),
            key=lambda item: item[1],
            reverse=True,
        )
        observations.append({
            "query": case["query"],
            "relevant": case["relevant"],
            "top1": ranked[0][0],
            "top3": [item[0] for item in ranked[:3]],
            "scores": ranked[:5],
        })
    return {
        "provider": name,
        "model": model_id,
        "dimensions": len(candidate_vectors[0]),
        "case_count": len(observations),
        "index_ms": index_ms,
        "query_ms_median": statistics.median(query_ms),
        "query_ms_max": max(query_ms),
        "recall_at_1": sum(row["top1"] == row["relevant"] for row in observations) / len(observations),
        "recall_at_3": sum(row["relevant"] in row["top3"] for row in observations) / len(observations),
        "results": observations,
        "artifact": artifact_digest(model_id),
        "similarity": "cosine-normalized-at-scoring",
    }


def main():
    from fastembed import TextEmbedding
    from sentence_transformers import SentenceTransformer

    results = []
    for model_id in ["BAAI/bge-small-en-v1.5", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"]:
        started = time.perf_counter()
        model = TextEmbedding(model_name=model_id)
        load_ms = (time.perf_counter() - started) * 1000
        row = evaluate("fastembed/onnx", model_id, lambda texts, m=model: [v.tolist() for v in m.embed(texts)])
        row["model_load_ms"] = load_ms
        results.append(row)

    model_id = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    started = time.perf_counter()
    model = SentenceTransformer(model_id)
    load_ms = (time.perf_counter() - started) * 1000
    row = evaluate("sentence-transformers/pytorch", model_id, lambda texts: model.encode(texts, normalize_embeddings=False).tolist())
    row["model_load_ms"] = load_ms
    results.append(row)

    output = {
        "status": "reproducible-exploratory-comparison",
        "dataset": DATASET.relative_to(ROOT).as_posix(),
        "metric": "cosine",
        "results": results,
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(OUTPUT), "providers": len(results), "cases": len(json.loads(DATASET.read_text())["queries"])}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"embedding comparison failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise

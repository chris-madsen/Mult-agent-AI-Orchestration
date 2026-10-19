# Exploratory embedding provider comparison

**Date:** 2026-10-19
**Status:** historical exploratory candidate evidence; **not suitable for production selection until rerun** with the committed normalized benchmark.
**Reproduction:** `npm run compare:embeddings` writes `benchmarks/reports/embedding-provider-comparison-rerun.json`.
**Raw data:** [`2026-10-19-embedding-provider-comparison.json`](2026-10-19-embedding-provider-comparison.json)

The original run was not fully reproducible from the repository and its FastEmbed raw similarity values exceeded 1, indicating unnormalized dot-product scoring rather than cosine. Preserve it as historical evidence only. The replacement script normalizes cosine at scoring time, records a fixed nine-query dataset and attempts to capture a local model artifact tree digest.

Nine synthetic labeled cases covered behavior-not-name retrieval, duplicate and
similar symbol names, RU↔EN technical requests and read/write semantics. All
models produced 384-dimensional vectors on CPU.

| Candidate | Runtime | Recall@1 | Recall@3 | Median query | P95 query | Index time |
|---|---|---:|---:|---:|---:|---:|
| `BAAI/bge-small-en-v1.5` | FastEmbed/ONNX | 0.333 | 1.000 | 6.63 ms | 11.05 ms | 309.51 ms |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | FastEmbed/ONNX | 0.667 | 1.000 | 6.27 ms | 7.39 ms | 332.23 ms |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Sentence-Transformers/PyTorch CPU | 0.778 | 1.000 | 16.65 ms | 18.42 ms | 237.78 ms |

Environment: Python 3.13.11, FastEmbed 0.7.4, ONNX Runtime 1.31.0,
Sentence-Transformers 5.1.1, PyTorch `2.14.1+cpu`. The FastEmbed multilingual
candidate is wired for exploratory E2E because it is local, multilingual and
does not require Ollama; it is not silently promoted to production. The
deterministic SHA-256 projection remains a test double only.

The holdout is intentionally small. A larger frozen code corpus, artifact/model
digest capture, license review, resource measurements and paired agent quality
run are required before owner selection.

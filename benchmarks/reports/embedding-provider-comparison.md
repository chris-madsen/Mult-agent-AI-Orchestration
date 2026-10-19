# Exploratory embedding provider comparison

**Date:** 2026-10-19
**Status:** completed exploratory candidate comparison; FastEmbed/ONNX is the
deterministic experiment winner. Owner approval and a larger frozen holdout are
still required before calling the model production-approved.
**Reproduction:** `npm run compare:embeddings` writes `benchmarks/reports/embedding-provider-comparison-rerun.json`.
**Raw data:** [`2026-10-19-embedding-provider-comparison.json`](2026-10-19-embedding-provider-comparison.json)

The original run is preserved as historical evidence because it was not fully
reproducible and used unnormalized similarity. The replacement script records a
fixed nine-query dataset, normalizes cosine at scoring time, runs FastEmbed and
Sentence-Transformers in separate pinned virtual environments, and captures a
local model artifact tree digest. Full machine-readable evidence is in
`benchmarks/reports/embedding-provider-comparison-rerun.json`.

Nine synthetic labeled cases covered behavior-not-name retrieval, duplicate and
similar symbol names, RU↔EN technical requests and read/write semantics. All
models produced 384-dimensional vectors on CPU.

| Candidate | Runtime | Recall@1 | Recall@3 | Median query | P95 query | Index time |
|---|---|---:|---:|---:|---:|---:|
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | FastEmbed/ONNX | 0.667 | 0.889 | 6.14 ms | 7.32 ms | 157.87 ms |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Sentence-Transformers/PyTorch CPU | 0.667 | 0.889 | 15.79 ms | 25.15 ms | 137.02 ms |

Environment: Python 3.13.11; FastEmbed 0.7.4; ONNX Runtime 1.31.0;
Sentence-Transformers 5.1.1; PyTorch `2.6.0+cpu`; NumPy 2.5.4. The upstream
Sentence-Transformers model is recorded at
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, 384 dimensions and `raw_text_v1`
preprocessing. FastEmbed actually loads the separate ONNX artifact
`qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q` at revision
`faf4aa4225822f3bc6376869cb1164e8e3feedd0`, with artifact SHA-256
`4bb74885d054d77b15c33520114d7edc19c31699bdab813d893e4f58c3afb4a1`.
The Sentence-Transformers runtime artifact remains at revision
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, SHA-256
`158d654c92d05bc1cd9996d46197de45bee615f20a06c4a99cb12efb21690088`.

Selection is deterministic: recall@3, recall@1, p95 query latency, model-load
latency, RSS, then provider name. FastEmbed wins on latency and RSS while
matching Sentence-Transformers recall. It is wired for the local retrieval
path; no Ollama and no cloud API key are required. The deterministic SHA-256
projection remains a test double only.

The holdout is intentionally small and the model remains owner-gated for
production approval. A larger frozen code corpus and license review are still
required.

# ADR-013 — Genuine embeddings without a mandatory model-serving wrapper

**Status: Proposed — production model/runtime selection remains open.** Date: 2026-10-19. The owner explicitly rejected adding Ollama as a selected or mandatory ACE dependency.

## Context

ADR-003 selects Qdrant for local code retrieval, but intentionally leaves the embedding model open. The earlier Ollama proposal confused three separate things: the **embedding model**, the **inference runtime/wrapper**, and **Qdrant as vector store**. Qdrant does not require Ollama. A code retrieval pipeline needs real vectors, not a particular local inference server.

## Decision for the evaluation stage

1. **Do not install, require, or secretly restore Ollama** as an ACE architecture dependency. Preserve the neutral `VectorEmbeddingPort`. Other serving runtimes also require evidence before selection.
2. Codex **may immediately implement and evaluate real local embeddings**, without waiting for final owner approval of the production model. First candidate: ready-made **Qdrant FastEmbed (ONNX Runtime)**; other established in-process ONNX / Transformers solutions may be compared where justified. This is a candidate list, NOT a final selection.
3. Compare combinations of concrete **model ID + version + artifact digest + runtime + preprocessing**. Do not equate wrapper choice with semantic retrieval quality.
4. Evaluate on labeled code and multilingual/behavior-described queries, including same-name symbol distractors, lexical/hybrid baseline, source truth checks and dirty worktree; report recall@k, latency, startup, indexing and full agent quality/token/cost impacts. Preserve failures.
5. Pin embedding vector size and normalization, query/document prefixes and collection generation. A new embedding model or preprocessing pipeline must use a fresh Qdrant collection/version and reindex; never mix incompatible vectors.
6. No model-generated hash vectors pretending to be semantic embeddings. Cloud embeddings for private source are **not** authorized by this decision: ADR-007 per-project opt-in is still mandatory.

## Approval and progress rule

- **Now:** Codex runs meaningful local provider experiments, Qdrant real-E2E and exploratory Harbor paired benchmarks with public or synthetic fixtures.
- **After evidence:** Codex recommends specific production model and runtime, including version, license and measured trade-offs; owner explicitly approves final promotion.
- **Until promotion:** Label candidates `experimental` / `not_approved`, but do not block their development or evaluation.

## Rejected shortcuts

A mandatory Ollama server; custom embeddings; fake SHA-256 semantic vectors; declaration of production-readiness from isolated mocks; replacing real evaluation with model marketing claims.

## References

ADR-003, ADR-004, ADR-007, ADR-009, ADR-012 (Proposed).
- https://qdrant.tech/documentation/tutorials-basics/generate-embeddings-fastembed/
- https://qdrant.github.io/fastembed/

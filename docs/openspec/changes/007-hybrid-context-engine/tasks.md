# Tasks — Hybrid Context Engine completion

## Already present on main

- [x] Agent-neutral MCP facade.
- [x] ast-grep structural provider.
- [x] Generic maintained LSP adapter.
- [x] Qdrant immutable collections + atomic current alias.
- [x] Content-addressed dense vector reuse.
- [x] Request-time workspace reconciliation.
- [x] Explicit source obligations/coverage.
- [x] Progressive ContextBundle delivery + exact ace_expand.

## H1 Hybrid retrieval

- [ ] Add sparse BM25 generation/provider identity.
- [ ] Store dense + sparse representations for structural chunks.
- [ ] Add native Qdrant dense+sparse prefetch + RRF fusion.
- [ ] Retain dense/sparse/fused rank telemetry.
- [ ] Add frozen exact-symbol/config-key/behavior/multilingual fixtures.

## H2 Reranking

- [ ] Add generic RerankerPort.
- [ ] Benchmark maintained CPU cross-encoder candidates for quality/latency/license.
- [ ] Select/approve a reranker only if measured benefit is material.
- [ ] Add truthful optional/required failure semantics.

## H3 Working context

- [ ] Add branch + staged/unstaged/untracked/deleted path observation.
- [ ] Extend ace_context with optional focused/open path/range hints.
- [ ] Add ranking priors without weakening freshness.
- [ ] Add Git-history evidence only for explicit history/why requests.

## H4 Context receipts

- [ ] Add bundle_id and stable evidence receipts.
- [ ] Accept known bundle/evidence identities.
- [ ] Suppress unchanged repeated bodies.
- [ ] Add new/reused/duplicate-avoided/expanded byte metrics.
- [ ] Prove stateless portability between MCP clients.

## H5 Context assembly

- [ ] Use ast-grep outlines as compact locate-mode navigation evidence.
- [ ] Tune source-aware dedupe/selection.
- [ ] Preserve current-code/docs/memory conflict semantics.

## H6 Evaluation

- [ ] Freeze multi-repository retrieval holdout before final tuning.
- [ ] Run lexical-only vs dense-only vs hybrid vs hybrid+rerank ablation.
- [ ] Run native vs current ACE vs hybrid ACE vs hybrid+delta Harbor arms.
- [ ] Require task-quality non-inferiority before token-savings acceptance.
- [ ] Report duplicate context avoided separately from embedding/index reuse.

## Production track remains separate

- [ ] Qwen3:14b local Graphiti lifecycle/recovery.
- [ ] Vertex synthetic citation DBC-14.
- [ ] k3s/PVC/backup evidence.
- [ ] exact provider/model approvals.
- [ ] resource/supply-chain/exact-release evidence.

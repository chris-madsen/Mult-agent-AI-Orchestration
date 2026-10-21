# Tasks — Hybrid Context Engine completion

**Current implementation baseline:** `main@5ad3649dc9696761a6f443ce2d2248e9a0fa26f7` after merged PRs #103, #106, #108, #109, #110, #111 and #112.

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

- [x] Add local sparse BM25 generation/provider identity.
- [x] Store dense + sparse representations for structural chunks.
- [x] Add native Qdrant dense+sparse prefetch + RRF fusion.
- [x] Retain dense/sparse/hybrid rank + latency telemetry in the evaluation path without triple-querying production ace_context.
- [ ] Freeze the final exact-symbol/config-key/behavior/multilingual **multi-repository holdout** before final tuning.

**Implemented evidence boundary:** runtime and controlled ablation plumbing exist. This does **not** mean the hybrid strategy has won the final holdout.

## H2 Reranking

- [x] Add generic RerankerPort and maintained FastEmbed cross-encoder process boundary.
- [x] Compose reranking after configured retrieval with explicit disabled/optional/required failure semantics.
- [x] Add reproducible RU/EN/mixed reranker evaluation harness with quality, latency, provider identity and license-reference evidence.
- [ ] Run maintained CPU cross-encoder candidates on the separately frozen final holdout.
- [ ] Select/approve a reranker only if measured quality/context-size benefit is material.

**Current production policy:** no reranker model is approved merely because the port exists.

## H3 Working context

- [x] Add branch + staged/unstaged/untracked/deleted path observation.
- [x] Extend ace_context with optional focused/open path/range hints.
- [x] Add ranking priors without weakening current-source verification.
- [ ] Add Git-history evidence only for explicit history/why requests.  
  **In progress:** PR #116; do not mark complete until merged green.

## H4 Context receipts

- [x] Add bundle_id and stable evidence receipts.
- [x] Accept known bundle/evidence identities.
- [x] Suppress unchanged repeated bodies while retaining exact expansion.
- [x] Add new/reused/duplicate-avoided/expanded byte metrics.
- [ ] Prove receipt portability across two independent MCP clients/processes, not only repeated calls within one test client.

## H5 Context assembly

- [x] Use ast-grep structural metadata/outlines as compact locate-mode navigation evidence.
- [ ] Add source-aware evidence dedupe/selection so overlapping code snippets are not repeatedly delivered.
- [x] Preserve explicit code/docs/memory conflict semantics and required-source completeness.

## H6 Evaluation

- [ ] Freeze multi-repository retrieval holdout before final tuning.
- [ ] Run lexical-only vs dense-only vs hybrid vs hybrid+rerank ablation on the frozen holdout.
- [ ] Run native vs current ACE vs hybrid ACE vs hybrid+delta Harbor arms.
- [ ] Require task-quality non-inferiority before token-savings acceptance.
- [ ] Publish duplicate context avoided separately from embedding/index reuse in benchmark reports.

## Production track remains separate

- [ ] Qwen3:14b local Graphiti lifecycle/recovery.
- [ ] Vertex synthetic citation DBC-14.
- [ ] k3s/PVC/backup evidence.
- [ ] exact embedding/semantic/reranker/model approvals.
- [ ] resource/supply-chain/exact-release evidence.

## Do not redo

The following are already implementation-complete and must not be reopened without a failing observable contract:

- custom parser replacement (ast-grep path);
- generic LSP boundary;
- Qdrant atomic alias publication;
- dense content-addressed vector reuse;
- local sparse BM25 provider wiring;
- dense/sparse/hybrid strategy controls;
- RerankerPort/process boundary;
- working-tree ranking priors;
- context receipts/delta body suppression;
- locate-mode structural outline delivery.

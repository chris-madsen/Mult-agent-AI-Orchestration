# Tasks — Hybrid Context Engine completion

**Current implementation baseline:** `main@935185a7c1f45be9b81fc379c19af8800fda2d79` after merged PRs #103, #106, #108, #109, #110, #111, #112, #116 and #118–#121.

**Evidence update 2026-10-21:** H3 history, H4 portability and H5 source-aware delivery are backed by the current contract suite. The local follow-up changes are still uncommitted; the exact evidence commit must be refreshed after they are committed. H6 retrieval/agent measurements and production-provider evidence remain open.

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
- [x] Add Git-history evidence only for explicit history/why requests.

## H4 Context receipts

- [x] Add bundle_id and stable evidence receipts.
- [x] Accept known bundle/evidence identities.
- [x] Suppress unchanged repeated bodies while retaining exact expansion.
- [x] Add new/reused/duplicate-avoided/expanded byte metrics.
- [x] Prove receipt portability across two independent MCP clients/processes, including unchanged, changed, unknown and stale receipts; exact expansion remains covered by the MCP contract suite.

## H5 Context assembly

- [x] Use ast-grep structural metadata/outlines as compact locate-mode navigation evidence.
- [x] Add one source-aware delivery dedupe path for identical digest-verified code spans; preserve aliases/provenance, source classes, conflicts, freshness and completeness.
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

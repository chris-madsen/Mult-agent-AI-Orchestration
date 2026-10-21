# Tasks — Hybrid Context Engine completion

**Implementation/current main (reviewed 2026-10-21):** `main@2fe96a88968fb393dd57cf3771d08efbcfa251fa`; PRs #123–#134 are merged. **Separate pinned external H6 evidence sources:** ACE `b20646c966575e8280ea792e4f851ab1e28ec867` and Chess `23a7bb6b27023e8520941841d69745dd623d0933`. These are not interchangeable commits; merged code and external evidence do not imply a completed scored five-strategy/Harbor gate. See the [new post-merge review](../../../reviews/2026-10-21-h6-postmerge-source-review.md).

**Evidence update 2026-10-21:** H4/H5 correctness, per-evidence receipts, durable benchmark traces, the current external holdout freeze, the reranker rejection and the external Harbor job bundle are backed by current artifacts. The five-strategy H6 retrieval gate and agent measurements remain open; Harbor execution is blocked by unavailable external runtimes.

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
- [x] Freeze the final exact-symbol/config-key/behavior/multilingual **multi-repository holdout** before final tuning in the external v3 evidence workspace.

**Implemented evidence boundary:** runtime and controlled ablation plumbing exist. This does **not** mean the hybrid strategy has won the final holdout.

## H2 Reranking

- [x] Add generic RerankerPort and maintained FastEmbed cross-encoder process boundary.
- [x] Compose reranking after configured retrieval with explicit disabled/optional/required failure semantics.
- [x] Add reproducible RU/EN/mixed reranker evaluation harness with quality, latency, provider identity and license-reference evidence.
- [x] Run maintained CPU cross-encoder candidates on the separately frozen reranker holdout; all tested candidates regressed against the hybrid baseline.
- [ ] Select/approve a reranker only if measured quality/context-size benefit is material.

**Current production policy:** no reranker model is approved merely because the port exists.

## H3 Working context

- [x] Add branch + staged/unstaged/untracked/deleted path observation.
- [x] Extend ace_context with optional focused/open path/range hints.
- [x] Add ranking priors without weakening current-source verification.
- [x] Add Git-history evidence only for explicit history/why requests.

## H4 Context receipts

- [x] Add bundle_id and versioned workspace-scoped per-evidence receipts.
- [x] Accept known bundle/evidence identities, including evidence-only reuse without a bundle ID.
- [x] Suppress unchanged repeated bodies while retaining exact expansion.
- [x] Add new/reused/duplicate-avoided/expanded byte metrics.
- [x] Prove receipt portability across independent MCP clients and actual process restart, including unchanged, changed, unknown and stale receipts; exact expansion remains covered by the MCP contract suite.

## H5 Context assembly

- [x] Use ast-grep structural metadata/outlines as compact locate-mode navigation evidence.
- [x] Add one source-aware delivery dedupe path for identical digest-verified code spans; preserve aliases/provenance, source classes, conflicts, freshness and completeness.
- [x] Preserve explicit code/docs/memory conflict semantics and required-source completeness.

## H6 Evaluation

- [x] Freeze the multi-repository retrieval holdout and exact source manifests in an external evidence workspace before scored tuning; do not vendor source repositories or generated holdout fixtures into ACE.
- [x] Add benchmark-only stage-rank/provider trace boundary, canonical candidate IDs, durable JSONL/terminal receipts and frozen-run identity validation without adding MCP tools.
- [ ] Run sparse/BM25-only vs dense-only vs hybrid RRF vs hybrid+reranker vs hybrid+reranker+Working Context ablation on the frozen holdout.
- [ ] Run Native Codex vs dense ACE vs hybrid ACE vs hybrid+receipt/delta Harbor arms.
- [x] Run the separate frozen CPU reranker holdout and record a rejection verdict for the current candidate set; no concrete model identity is approved.
- [ ] Require task-quality non-inferiority before token-savings acceptance.
- [ ] Publish duplicate context avoided separately from receipt reuse, projection savings and embedding/index reuse in benchmark reports.

## Post-merge H6 correctness/evidence contracts (static findings; open)

These are new cases in the existing H6 acceptance track, not a rollback of implementation-complete H1–H5 functionality. Details and exact code citations: [post-merge code review](../../../reviews/2026-10-21-h6-postmerge-source-review.md).

- [ ] H6-CR-01: ensure a frozen-repository run rejects dirty/untracked changed source and an executable compiled from a different commit; bind actual executable digest and source manifest to the run.
- [ ] H6-CR-02: reranker selection must not treat absent delivered-payload measurements as zero or award a compactness win from missing data; reject tied-quality unmeasured candidates.
- [ ] H6-CR-03: frozen four-arm Harbor jobs must verify the actual SHA-256 of task bytes, config bytes, repository/runtime identities and per-trial evidence at execution/report verification.
- [ ] H6-CR-04: native-file-read duplication is measured from real instrumentation or explicitly `unknown`; invented zero cannot satisfy release/quality criteria.
- [ ] H6-CR-05: Unicode-aware exact source byte extraction for newly frozen reranker cases preserves UTF-8 ranges and original digests.
- [ ] Re-run applicable deterministic RED/contract tests, source/runtime E2E and H6 scored gates after fixes; preserve the existing external v3 and reranker holdouts unchanged.

## Production track remains separate

- [ ] Qwen3:14b local Graphiti lifecycle/recovery.
- [ ] Vertex synthetic citation DBC-14.
- [ ] k3s/PVC/backup evidence.
- [ ] exact embedding/semantic/reranker/model approvals.
- [ ] resource-budget, package/model license, SBOM/provenance/signature and exact-release owner evidence.
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

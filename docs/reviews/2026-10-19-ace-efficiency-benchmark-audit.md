# Critical review: ACE efficiency and Harbor attribution

**Date:** 2026-10-19  
**Scope:** merged `main` through PR #6, open PR #7, stacked PR #8.  
**Disposition:** PR #8's 3×3 measurement is **diagnostic-only**. Do not close DBC-12 or approve production on this evidence.

## Reproducible observations (not a new benchmark)

Original immutable historical report:
`benchmarks/reports/ace-retrieval-paired-3x3-final-indexkey.json`

- Native Codex: 9/9 task verifiers; 891,950 reported input+output tokens, 789,760 cached input tokens, $0.0569132 Codex-reported cost.
- Codex+ACE: 9/9; 1,571,768 reported input+output tokens, 1,389,952 cached input tokens, $0.08538924 Codex-reported cost.
- Ratio native/ACE: 0.567482× raw tokens; 0.666515× Codex-reported dollar costs.
- Uncached input: native 81,510; ACE 160,589. *Uncached input is not the same as total new useful context*, and cached tokens still count in the published raw metric.
- Arithmetic is consistent. **No evidence of positive savings on this test set**.
- Local inference/Qdrant/indexing hardware consumption was **not metered**. The old gate's `externalProviderCostUsd: 0` was not a measurement and has been changed to `null` (unknown) for future reports.

## Findings by severity

### P0: forced usage is not a natural ACE-vs-native comparison

The ACE job contains an extra instruction: *before editing, call `ace_context`*. The native arm does not get an equivalent required extra action. This is an intentionally forced-use instrumentation/control test, not a natural tool-choice efficiency test. It answers *what happens when Codex is required to invoke ACE*, not *whether Codex saves context by voluntarily replacing expensive native exploration with precise ACE evidence*. Preserving these numbers is correct; promoting them to DBC-12 acceptance is not.

A valid follow-up needs separate arms:

- **Native natural:** Codex with ordinary native exploration, no ACE server.
- **ACE optional natural:** same task/instruction/model/reasoning budget, ACE configured and available, **no must-call instruction**.
- **ACE forced diagnostic:** optional additional instrumentation arm to validate provider route, not to prove savings.

Keep setup context, Codex version, state/caching policy, task verifier and time budget pinned and document all differences.

### P0: provider operations are not request-correlated

The gate previously looked for *any successful operation* for each of `embedding`, `qdrant`, `tree_sitter`, and `typescript_language_service` anywhere in the trial's `provider-trace.jsonl`. These events may be emitted during startup/indexing or diagnostics and are **not linked to individual Codex MCP request IDs**.

The corrected gate checks actual operation names, including `qdrant:query_points` and `typescript_language_service:definition`, but it **does not invent correlation proof**. `providerOperationsObserved` may be true while `providerCorrelationVerified=false`. Normative DBC-12 remains open for the historical run. The corrected runtime now propagates the ACE ContextBundle `requestId` into query-time embedding, Qdrant and TypeScript-LS trace events, and the Harbor gate verifies those operations per successful request. A **new** Harbor run is required; historical traces cannot be retroactively correlated.

### P0: repeated cold reconstruction was masking a non-existent warm path

`observeWorkspace` increments its observation epoch **on every scan**, including an unchanged checkout. The old startup always built the AST index and **re-embedded every indexed symbol**, then upserted all points. Initial attempts to reuse `generation` as the cache key could therefore never hit on restart.

The change in this PR now checks exact Qdrant point counts for `workspace_id + index_key` (content-derived source snapshot) and reuses vectors when the exact snapshot is already indexed. A changed snapshot/count mismatch causes re-embedding and rebuild. Qdrant endpoint remains local-policy-validated; unexpected count responses fail closed. Every delivered snippet continues to be reread and verified against current source bytes.

**Important:** the observation epoch remains monotonic. On a warm snapshot, query is scoped by exact `index_key`, not falsely relabelled to the new observation epoch. This is a correctness fix and potential speed/cost improvement; it does **not** itself prove token reduction. Real cold/warm performance and failure-recovery E2E still need measurement.

### P1: tiny repeated tasks do not test long-horizon return on indexing

There are only three small code-fix tasks repeated three times. A short native search may already be almost optimal. The ACE workflow adds MCP setup, extra instruction/context, model thinking and potentially duplicate reads. That overhead can dominate a trivial job and does not extrapolate to multi-hour, multi-module code investigations.

A real holdout should contain large pinned repositories, cross-file symbol/dataflow cases, behavior-not-identifier queries, same-name symbols, successive questions against the **same warm index**, changed files, user-visible exact-source citations and a quality oracle.

### P1: token totals and reported dollars have limited scope

The ratio uses Harbor/Codex reported input+output totals including cached input; the dollar values are Codex provider-reported usage. The local embedding worker, Qdrant resources, Tree-sitter setup and model-cache IO were not instrumented as monetary costs. Future reports must preserve total tokens, cached vs uncached, output, agent call count, setup vs steady-state latency and measured or explicitly **unknown** local infrastructure cost. Do not default unknown to zero.

### P1: the production contract was checked off from a sub-gate

OpenSpec PR #8 marked DBC-12 and full external-cost acceptance as complete based on forced-use evidence. That checkbox has been reopened. A valid fail-closed `diagnostic-only` classification is now tested independently. Historical JSON numbers are not rewritten or fabricated; the new gate and rendering make the limitations explicit.

### P2: remaining retrieval-quality weaknesses

- A six-candidate response cap is configurable, but no per-query token-budget/novelty/reranking experiment has yet demonstrated the best evidence payload.
- No fair comparison measures *native file-reading avoided*, duplicate source reads after ACE, or the fraction of successful ACE citations actually used in the agent's solution.
- The initial same-name/AST/LSP fixtures show useful progress, but provider choice/Serena comparison and DBC-03 holdout remain open.
- Code symbol lookup still relies on a first-line string search of `symbolName` for the TypeScript LS query, which is not a general AST-identity proof for decorators, aliases, misleading string/comment occurrences, or Unicode byte/UTF-16 offset boundaries. Must not claim blanket LSP semantic certainty until this is fixed/tested.

## Corrected mandatory next experiment

1. Run the same fully pinned tasks under **native natural / ACE optional natural / ACE forced diagnostic**, with three distinct reported outcomes. The first two determine real-world value.
2. Include warm reuse and startup cost as separate measurements: cold-index once, then multiple context queries within a persistent workspace, followed by a deliberate dirty-tree edit.
3. Save per-trial actual Codex JSONL, ACE request IDs, provider-operation correlation, citation/digest evidence, duplicate native-tool-read counts, model/revision, fixtures, and SHA-256 hashes. Protect source/secret payloads in logs.
4. Report quality outcomes plus total/cached/uncached/output tokens, agent cost, **local hardware cost or unknown**, p50/p95 end-to-end latency, per-stage latency, index build time, and source-evidence bytes/token budgets.
5. Do not alter holdout tasks based on their benchmark scores. Do not infer 5× from any one synthetic fixture or from forced use.
6. Production promotion requires completion of DBC-03/04/09/12/14 and owner approval; other graph/Vertex acceptance remains separately open.

## Immediate execution advice for Codex

Do not wait for another owner decision. First rerun typecheck/lint/contracts and the new Qdrant warm-cache tests, then real local Qdrant restart E2E including unchanged-worktree reuse and dirty-worktree invalidation. After that rerun Harbor using the implemented request-correlated provider traces and precise context delivery, then run the frozen three-arm experiment. Preserve the negative 3×3 numbers as historical evidence.

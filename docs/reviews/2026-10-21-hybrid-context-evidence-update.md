# ACE Hybrid Context evidence update — 2026-10-21

This update records the post-merge H3–H5 review without rewriting the earlier
historical evidence documents.

## Source identity

- Main checkout before the follow-up changes: `935185a7c1f45be9b81fc379c19af8800fda2d79`.
- Merged main history includes PRs #118, #119, #120 and #121.
- H4/H5 evidence commit: `4c1d6aa218bccf5dcd7ed33e32599aa79030c880`.

## Implemented and locally verified

| Area | State | Evidence |
|---|---|---|
| H3 Git history | implemented + contracted | `ea6ca3f` is present in current `main`; history evidence is routed as an explicit source |
| H4 receipt portability | implemented + contract-tested | independent MCP client/server instances; unchanged, changed digest/range/content, unknown/stale receipts; exact UTF-8/base64 expansion |
| H5 source-aware delivery dedupe | implemented + contract-tested | one canonical path in `context-delivery.ts`; exact digest-verified code span only; aliases preserve suppressed evidence IDs; docs/memory and conflicting claims remain separate |
| Retrieval quality gate | implemented + contract-tested | optional same-holdout baseline comparison; dense-only baseline can fail candidate critical Recall@5, MRR or nDCG@5 regressions before compactness/latency is considered |
| Frozen retrieval holdout | frozen artifact prepared, not scored | `benchmarks/retrieval/frozen-multi-repository-v1.json`; ACE `4c1d6aa`, Chess `23a7bb6b`; 24 cases, 12 per repository; holdout SHA-256 `e147d03f626acedcb311b55ecf7604db13d9e5ebd3ff3bedbcd492823fe00a23` |
| Benchmark telemetry and strategy selector | implemented + contract-tested | internal dense/sparse/fused/Working Context/reranked/delivered trace boundary, raw/canonical IDs, provider identities and dense non-inferiority tie-break selector |
| Four-arm Harbor gate | implemented + contract-tested, not executed | native/dense/hybrid/hybrid+receipt-delta design requires identical 6-task workload, 5 serial repeats, real ACE calls and observed reused bytes |
| Frozen reranker gate | fixture and identity contract prepared, not scored | `benchmarks/retrieval/reranker-frozen-v1.json` SHA-256 `be795c6a08a0937d2f59e3add9426daca75ad6a8b958334c2c3b1ccd148a0b6f`; separate ACE/Chess cases; model/artifact/license/startup/RSS evidence required for frozen runs |

The retrieval merge path intentionally retains all source claims for conflict
calculation. Source-aware compacting happens once during delivery, so dedupe
cannot hide a cross-source contradiction or change completeness.

## Checks

Using the isolated Linux Node runtime with the repository lockfile:

- `npm run check` — PASS.
- Targeted H4/H5, progressive delivery and retrieval regression tests — 39/39
  PASS.
- Retrieval evaluator, H4/H5 regression and new benchmark/Harbor contracts — targeted suites PASS (15 retrieval plus four-arm/reranker/telemetry coverage).
- `npm exec -- eslint src/domain/context-delivery.ts src/domain/retrieval.ts test/context-receipt-portability.contracts.test.ts test/evidence-dedupe.contracts.test.ts --max-warnings=0` — PASS.
- Full `npm run test` — 355 PASS, 5 FAIL. The failures are existing
  environment/provider-process checks involving TypeScript language-server
  subprocess availability and MCP readiness provider startup; no H4/H5 test
  failed. The full suite is therefore not a release-green result.

## Still open

- The holdout is now frozen and validated, but has not been scored.
- No five-strategy retrieval ablation, reranker approval/rejection, or natural-use
  agent benchmark is claimed.
- Graphiti, Vertex, k3s, backup/restore, provider selection and release-owner
  evidence remain on the separate production track.

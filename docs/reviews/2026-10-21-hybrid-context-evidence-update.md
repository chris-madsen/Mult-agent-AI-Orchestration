# ACE Hybrid Context evidence update — 2026-10-21

This update records the post-merge H3–H5 review without rewriting the earlier
historical evidence documents.

## Source identity

- Main checkout before the follow-up changes: `935185a7c1f45be9b81fc379c19af8800fda2d79`.
- Merged main history includes PRs #118, #119, #120 and #121.
- The H4/H5 follow-up changes in this checkout are currently uncommitted. A
  release-grade evidence receipt must bind the final commit after commit/CI.

## Implemented and locally verified

| Area | State | Evidence |
|---|---|---|
| H3 Git history | implemented + contracted | `ea6ca3f` is present in current `main`; history evidence is routed as an explicit source |
| H4 receipt portability | implemented + contract-tested | independent MCP client/server instances; unchanged, changed digest/range/content, unknown/stale receipts; exact UTF-8/base64 expansion |
| H5 source-aware delivery dedupe | implemented + contract-tested | one canonical path in `context-delivery.ts`; exact digest-verified code span only; aliases preserve suppressed evidence IDs; docs/memory and conflicting claims remain separate |
| Retrieval quality gate | implemented + contract-tested | optional same-holdout baseline comparison; dense-only baseline can fail candidate critical Recall@5, MRR or nDCG@5 regressions before compactness/latency is considered |

The retrieval merge path intentionally retains all source claims for conflict
calculation. Source-aware compacting happens once during delivery, so dedupe
cannot hide a cross-source contradiction or change completeness.

## Checks

Using the isolated Linux Node runtime with the repository lockfile:

- `npm run check` — PASS.
- Targeted H4/H5, progressive delivery and retrieval regression tests — 39/39
  PASS.
- Retrieval evaluator, H4 and H5 regression subset after the baseline-gate
  extension — 15/15 PASS.
- `npm exec -- eslint src/domain/context-delivery.ts src/domain/retrieval.ts test/context-receipt-portability.contracts.test.ts test/evidence-dedupe.contracts.test.ts --max-warnings=0` — PASS.
- Full `npm run test` — 353 PASS, 5 FAIL. The failures are existing
  environment/provider-process checks involving TypeScript language-server
  subprocess availability and MCP readiness provider startup; no H4/H5 test
  failed. The full suite is therefore not a release-green result.

## Still open

- No final multi-repository holdout has been frozen or measured in this update.
- No five-arm retrieval ablation, reranker approval/rejection, or natural-use
  agent benchmark is claimed.
- Graphiti, Vertex, k3s, backup/restore, provider selection and release-owner
  evidence remain on the separate production track.

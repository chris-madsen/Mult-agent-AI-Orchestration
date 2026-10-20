# Follow-up 2: unified ACE plan evidence after PRs #78–#81

**Date:** 2026-10-20  
**Reviewed implementation:** `main` @ `59a0f38c512e73860f6b5e4f324b36c64209fc0c`  
**Exact-main W00 receipt:** `8ab84f9c86ef84ea4e47ac3c673bf3d401bdea0d`, retained manifest SHA-256 `cc9075a1e05565a7498eff8b105a15113de7b727ffc2b03209fbe86337e0385e`  
**Prior follow-up:** [`2026-10-20-unified-plan-progress-followup.md`](./2026-10-20-unified-plan-progress-followup.md)  
**Normative plan:** [`2026-10-19-unified-ace-correctness-and-production-plan.md`](../plans/2026-10-19-unified-ace-correctness-and-production-plan.md)  
**Current ledger:** [`2026-10-20-implementation-evidence-ledger.md`](./2026-10-20-implementation-evidence-ledger.md)

This document records newly retained evidence and its limits. It does not
rewrite the original static review and does not claim full ACE production
readiness.

## New disposition

| Area | Current evidence | Remaining boundary |
|---|---|---|
| **C-A snapshot lifecycle** | PR #78 corrected the real runner's assertion so expected partial coverage is checked as `complete: false`, not falsely required to be complete. The retained Qdrant run passes all 8 lifecycle checks: interrupted S2 stays unpublished, reader S1 survives writer SIGKILL and S2 publication, state owners are distinct, and shared explicit-collection GC is skipped. | The plan's full C-A list remains open: repeated/target-storage runs, same-snapshot writers, cancellation/timeouts, stale-count/membership failures, and k3s/storage semantics. |
| **F2 maintenance scope** | PR #67 remains the implementation fix: maintenance scrolls request only consumed payload fields. | Real provider crash/race matrix is still required; narrow payload contracts are not a full provider acceptance. |
| **W04 scale** | A pinned local Qdrant/FastEmbed/Tree-sitter/TS-LS run is retained for 1k and 10k fixtures. Every successful phase reports `complete=true` and zero coverage failures; change-only reports `1/1/1/1` changed/added/deleted/renamed and warm runs reuse all vectors. | One host/image/run is not a performance or provider-selection decision. Repeats, selected-host budgets, concurrent lifecycle cases and exact-release DBC-13 evidence remain open. |
| **W06/W07 Graphiti** | PR #79 adds the production-shaped crash worker/runner, reconciliation/delete trace handling, release validation and fail-closed preflight requirements; contracts pass. | No real local LLM/embedder/reranker + FalkorDB provider run is retained yet. The runner's existence and deterministic contracts cannot close W06/W07. |
| **F3/F4/F5/F6** | The earlier fixes remain merged: verified embedding namespace/readiness behavior (#71/#72), all-decision valid-time semantics (#69/#70), and ledger corrections (#74/#81). | Provider selection, deployment evidence and owner approval remain separate gates. |

## Retained W04 evidence

The raw artifacts and report are tracked under `benchmarks/reports/`:

- [`2026-10-20-index-scale-real-provider.md`](../../benchmarks/reports/2026-10-20-index-scale-real-provider.md)
- [`index-scale-2026-10-20-1000.json`](../../benchmarks/reports/index-scale-2026-10-20-1000.json), SHA-256 `be7d2fa1f77b54178daaa579233d57bb53d332d85e47206705c9d99408e6c0c5`
- [`index-scale-2026-10-20-10000.json`](../../benchmarks/reports/index-scale-2026-10-20-10000.json), SHA-256 `0fb51c7aa06c8a75f047294d53bf12065a0245fa93065ab918c43afc1216fa8e`
- [`2026-10-20-qdrant-snapshot-crash-real-provider.md`](../../benchmarks/reports/2026-10-20-qdrant-snapshot-crash-real-provider.md)
- [`qdrant-snapshot-crash-2026-10-20.json`](../../benchmarks/reports/qdrant-snapshot-crash-2026-10-20.json), SHA-256 `197ed18ea52f86c4b2f18f3ef2236a40c76cf3727f61d267493b66b843d8d456`

The scale timings are wall-clock milliseconds:

| Fixture | Cold | Warm | Change-only | Warm vector reuse |
|---:|---:|---:|---:|---:|
| 1,000 files | 102,625 ms | 8,402 ms | 10,183 ms | 1,000 |
| 10,000 files | 983,239 ms | 24,814 ms | 33,162 ms | 10,000 |

The Qdrant crash evidence was generated on source commit `07b143b` with
Qdrant `qdrant/1.19.2` image digest
`sha256:b7b0444c4c351c970b98e90a6f89c2ee4287c65b44e52b4cb503fa5b2aa927ad`.
Its provider traces are retained separately and contain safe trace metadata,
not source/query payloads.

## Exact-main verification boundary

The W00 receipt on `8ab84f9` reports:

```text
status=PASS
mandatory=PASS
openspec=PASS
workspaceClean=true
```

It proves the locked repository baseline, deterministic contracts and strict
OpenSpec validation only. The documentation-only merge #81 is reflected in the
review commit, but this receipt must not be reused as a release receipt for a
later code or provider commit.

## Remaining execution order

1. Run matched W01 embedding and W02 semantic-provider comparisons on frozen
   fixtures and obtain the explicit owner decisions.
2. Repeat W04 scale/lifecycle runs on the selected host/provider and close the
   remaining C-A failure and storage matrix.
3. Run authorized Vertex and real local-only Graphiti/FalkorDB provider gates,
   including W07 crash/reconcile/purge and backup/restore evidence.
4. Run W08–W10 unified Codex/provider-counter/admission/routing evidence.
5. Run W11 k3s, W12 provider-failure/security, W13 natural Harbor, W14 DBC and
   W15 exact-release/resource/owner gates.

Until those gates are retained and approved, `main` is not full-scope
production-ready and no 5x token-saving claim is supported.

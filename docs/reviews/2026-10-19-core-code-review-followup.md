# Core review follow-up — verified against main on 2026-10-19

This document reconciles [core-code-review.md](2026-10-19-core-code-review.md) against actual merged code. It distinguishes shipped fixes, false-positive historical concerns, and deferred work rather than declaring all 18 findings closed.

## Addressed in this PR

| Original finding | Remedy |
|---|---|
| 1. Completeness conflates warnings and failed sources | Only missing/failed/stale sources contribute to `complete=false`; conflicts/warnings remain separately visible. |
| 2, 7. Local fallback has only per-read race detection | Selected files are revalidated after all candidates; a mismatch is `changed_during_request`, `uncertain`, and incomplete. This does not imply atomic global-worktree consistency. |
| 5, 6. Git error silently accepted | Distinguish a verified non-repository directory (`gitStatus=not_repository`) from corrupt/unavailable Git metadata (explicit `SNAPSHOT_FAILED`). Git subcommand failure is not collapsed to empty tracked/deleted sets. |
| 12. One-character and Unicode tokens discarded | Unicode property-aware tokenization retains meaningful one-character identifiers and Russian text. Still lexical fallback, not semantic ranking. |
| 14. Evidence deduplication erases distinct proof | Deduplicate only complete identical evidence records, preserving proofClass, freshness, handles, conflict metadata and evidence identity. |
| 15. Conflict detection only code vs documentation | Contradictory claims among any two distinct source categories remain reported, without assuming a single source's revisions constitute two independent sources. |
| 16. Domain episode content digest unchecked | Domain enforces SHA-256 shape; the byte binding remains enforced by archive persistence adapter as mandated by the domain's no-platform-I/O contract (BTC-09). |
| 17. Self-supersession | Reject self/empty successor; existence and acyclicity need a repository-level graph consistency check and remain open. |
| 11. Completion vs quality | Quality rate over fully graded/recorded runs; separate completion, aborted, incomplete ratios. |

## Already mitigated by merged code before this PR

- **4. Archive import/delete race, local multi-process:** `file-memory-archive.ts` already has a cross-process `mkdir` mutex guarding both import and delete. The original review's claim that the lock protects only a single instance is now out of date for processes using the same filesystem and root. **Distributed hosts or network file systems remain unproven**. No second mutex is implemented.
- Some real Qdrant request paths already perform end-of-request read validation; the fix above closes the **local lexical fallback** path.

## Still open, not hidden

- **3. Freshness-aware ranking:** lexical fallback ranks before selected-path revalidation, a deliberate latency/quality tradeoff. No production freshness-ranking claim.
- **8. Symlinks:** snapshot skips symlinks while exact reads allow internal links. Need a unified policy and race-resistant path opening.
- **9. Artifact digest binding:** handles are UUIDs, readRange reports digest but doesn't accept an expected digest. Need a versioned API change and corrupt-blob negative E2E.
- **10. Missing cumulative usage samples:** unknown must not be presented as an exact known total. Preserve partial interval sums and a completeness flag in a future versioned telemetry schema; no dishonest replacement with a partial number.
- **13. Lexical ranking:** simple term boost, not BM25/reranking. Compare on frozen holdout rather than claiming production relevance.
- **17. Decision successor graph:** need persistent service graph acyclicity and existence checks.
- **18. Evidence hash:** `comparisonEvidenceSource` deliberately excludes `evidenceHash`; add a pinned-schema invariant test as reporting evolves.

## Guardrails

A green contract suite establishes only that these regressions are tested. It is not a real Qdrant/Graphiti/Vertex E2E and does not establish a 2× or 5× token reduction. Production claims remain evidence-gated.

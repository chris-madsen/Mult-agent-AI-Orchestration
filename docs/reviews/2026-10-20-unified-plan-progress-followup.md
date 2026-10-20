# Follow-up: unified ACE plan progress review

**Date:** 2026-10-20  
**Reviewed baseline:** `main` @ `6a410f2434c4175d57f932efb8d291372b931636`  
**Prior review:** [`2026-10-20-unified-plan-progress-review.md`](./2026-10-20-unified-plan-progress-review.md)  
**Evidence ledger:** [`2026-10-20-implementation-evidence-ledger.md`](./2026-10-20-implementation-evidence-ledger.md)

This is a follow-up to the historical static review. It records which findings
were fixed on merged `main`; it does not rewrite the original observations or
claim production readiness.

## Finding disposition

| Finding | Current disposition on `main` | Evidence and residual work |
|---|---|---|
| **F1 — Qdrant lease/state ownership** | **Fixed in implementation** | PR #66 isolates default collections by state owner, makes lease reaping conservative by default, and tests independent state roots. A real concurrent reader/writer test with different hosts/PID namespaces is still pending. |
| **F2 — full Qdrant maintenance payloads** | **Fixed in implementation** | PR #67 restricts maintenance scrolls to the payload fields they consume. W04 scale measurements and real interrupted-reader evidence are still pending. |
| **F3 — namespace from requested embedding config** | **Fixed in implementation** | PR #71 binds the default namespace to the verified worker identity fingerprint, after Qdrant reachability and embedding preflight. The actual selected model/artifact comparison, target-host measurements and owner approval remain pending. |
| **F4 — inconsistent startup failure disposition** | **Fixed/documented** | PR #72 defines the startup disposition table; PR #71 keeps the actual MCP executable alive with structured `not_ready` when embedding preflight fails, with a real executable regression test. Other provider-specific failure dispositions still require real deployment/readiness evidence. |
| **F5 — incomplete temporal decision result** | **Fixed in domain contract** | PRs #69/#70 preserve all linked decision states and define valid-time `as_of` semantics, including late import, tombstones and legacy uncertainty. Real Graphiti extraction/search and crash-recovery evidence remain pending. |
| **F6 — stale evidence ledger** | **Fixed in documentation** | The ledger now targets exact-main `6a410f2`, records merged PRs #65–#73, and records the W00 receipt digest. |

## Exact-main verification

The repository W00 runner was executed from a clean checkout of `6a410f2`:

```text
node scripts/baseline-verification.mjs artifacts/baseline
status=PASS
mandatory=PASS
openspec=PASS
workspaceClean=true
manifest sha256=322c7a53144677c217f50770f73af62d8837bc93265c3e3381f56d99539205fd
```

The receipt proves the locked repository baseline and strict OpenSpec
validation only. It does not prove a real embedding selection, Serena
comparison, Vertex/Graphiti acceptance, k3s deployment, Harbor natural-use
benefit or owner approval.

## Current unfinished plan work

The following remain explicitly open in the unified plan and ledger:

- W01: frozen unseen embedding comparison, license/host measurements and owner approval;
- W02: matched Serena versus TypeScript-LS run and semantic-provider approval;
- W03: real frozen retrieval-quality/compactness runs;
- W04: execute and retain the new 1k/10k cold/warm/change-only runner, plus concurrent/restart/interrupted-writer evidence;
- W05/W06/W07: authorized Vertex and local-only Graphiti/FalkorDB provider runs with provenance, temporal and recovery evidence;
- W08–W10: real unified Codex session, provider counters and admission/routing evidence;
- W11/W12: actual k3s live-worktree and provider failure/security matrix;
- W13: natural-use paired Harbor runs with complete correlated cost telemetry;
- W14/W15: exact-release DBC evidence, resource budget, owner sign-off and release/OpenSpec reconciliation.

Therefore `main` is **not** full-scope production-ready. The W00 receipt and
green deterministic contracts are necessary evidence, not a substitute for
the remaining real-provider, agent-E2E, benchmark and owner-approval gates.

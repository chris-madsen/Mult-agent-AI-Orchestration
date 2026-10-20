# Codex branch progress follow-up 3 — current provider evidence

**Date:** 2026-10-20  
**Reviewed branch:** `codex/fix-unified-plan-1227`  
**Reviewed commit before this document:** `1de3bca`  
**Remote:** `origin/codex/fix-unified-plan-1227`

This is an evidence update for the unified ACE plan. It does not promote an
experimental provider, replace an owner decision, or claim full production
readiness or 5x token savings.

## Newly retained evidence

| Area | Receipt | Observed result | Boundary |
|---|---|---|---|
| W01 embedding comparison | `embedding-provider-comparison-current-2026-10-20.json` (`a55e35e2…`) | FastEmbed/ONNX and Sentence-Transformers/PyTorch both use 384 dimensions and have identical metrics on the committed development fixture; FastEmbed is smaller and faster in this run (`p95 7.728 ms` vs `21.423 ms`) | Development fixture only; no frozen unseen multi-repository holdout, license review, repeated-host budget, or owner selection |
| W02 semantic comparison | `serena-semantic-provider-comparison-current-2026-10-20.json` (`58234a20…`) and `typescript-ls-provider-comparison-v1.json` (`633c0cb4…`) | Direct TypeScript LS passes the shared 9/9 oracle; Serena is 7/9, with alias-source-reference and write-reference mismatches | No approved production semantic provider decision; Serena remains partial |
| W04 scale, 1k | `index-scale-real-provider-current-1000-2026-10-20.json` (`d1a64d05…`) | Qdrant 1.19.2 + FastEmbed + Tree-sitter + TS-LS: cold `100834.9 ms`, warm `8277.6 ms`, change-only `9586.0 ms`; all phases complete, coverage failures `0`, warm reuse `1000`, delta `1/1/1/1` | One local host/provider run; not a production performance budget or target-storage result |
| W04 scale, 10k | `index-scale-real-provider-current-10000-2026-10-20.json` (`0337278f…`) | Cold `938615.9 ms`, warm `22310.0 ms`, change-only `31709.7 ms`; all phases complete, coverage failures `0`, warm reuse `10000`, delta `1/1/1/1` | One local host/provider run; no repeated selected-host budget/concurrency/k3s evidence |
| C-A bounded crash lifecycle | `qdrant-snapshot-crash-current-2026-10-20.json` (`b63bbdfe…`) plus three safe provider traces | 8/8 checks pass: interrupted S2 stays unpublished, reader S1 survives writer SIGKILL and S2 publication, state owners are distinct, shared explicit-collection GC is skipped | Same-snapshot writers, cancellation/timeouts, stale-count/membership fault injection, target storage and k3s semantics remain open |
| W05 Vertex prerequisite | `vertex-synthetic-conflict-prerequisite-2026-10-20.json` (`61852585…`) | Read-only metadata found `ace-europe-stage2`; its `ragFiles` list is empty | No upload/import was attempted; synthetic conflict retrieval, citation and server revision evidence remain blocked pending explicitly authorized synthetic import scope |
| Graphiti/k3s/provider availability | `provider-capability-current-2026-10-20.json` (`f297b511…`) | Local Qdrant health and k3s node are available; Graphiti/Falkor driver health is not; no Graphiti MCP executable/local LLM endpoint is installed | FalkorDB locality alone is not extraction evidence; W06/W07/W08 remain blocked |
| Code-only runtime | `runtime-config-code-only-host-current-2026-10-20.json` (`558e0bb0…`) | `runtime-config-accepted`: pinned FastEmbed, direct TS-LS, Qdrant enabled, fallback/docs/memory/cloud/worktree helper disabled | Configuration receipt only; no code-only release approval without selection, holdout, Harbor, resource, supply-chain and owner gates |
| Supply chain inputs | `supply-chain-availability-current-2026-10-20.json` (`af7b553c…`) plus current SBOM/audit | Production npm audit reports `high=0`, `critical=0`, `total=0` | Image provenance/signature and independent license review are still absent; this is not release evidence |
| W13 Harbor | `harbor-current-run-blocked-2026-10-20.json` (`973044af…`) | Natural 3-arm run stopped before task completion because the pinned Codex route had invalid authentication; loopback gateway did not support the pinned model route | No quality/cost result; do not count this as ACE benefit or baseline evidence |

## What is now done in this continuation

- Current 1k and 10k real-provider scale receipts were generated from the
  current branch and pushed.
- The current Qdrant crash/restart receipt and safe provider traces were
  generated and pushed.
- Current code-only runtime, npm SBOM/audit inputs and provider capability
  snapshot were generated and pushed.
- Vertex read-only corpus/file metadata was checked; the empty corpus is
  retained as a blocker rather than being treated as a successful E2E.
- No cloud document/session bytes were uploaded and no Graphiti cloud inference
  was used.

## Remaining work, in execution order

1. Obtain owner decisions for W01/W02 and freeze an unseen multi-repository W03
   retrieval-quality holdout; rerun comparisons on that holdout.
2. Extend C-A/W04 with same-snapshot writers, cancellation/timeouts,
   membership/count fault cases, repeated runs, target-storage/PVC and k3s
   semantics.
3. Provide explicit authorization and GCS scope for the committed synthetic
   Vertex fixture, then run import, retrieval, citation/version and code-doc
   conflict evidence.
4. Supply a supported Graphiti MCP server plus local-only LLM/embedder/reranker
   endpoint; run W06 lifecycle and W07 crash/reconcile/purge/backup/restore
   against the actual FalkorDB.
5. Run unified code+docs+memory Codex E2E and admission/routing/cost evidence.
6. Add authenticated host-helper/k3s live-worktree race/restart evidence and
   the real provider security/failure matrix.
7. Rerun natural three-arm Harbor with valid pinned model access and complete
   cost/provider attribution; retain raw trials and independent holdouts.
8. Generate exact-commit DBC-01…14, resource-budget, image provenance/license
   evidence and obtain explicit owner approval for the exact release commit.

Until these items are retained and approved, the branch remains evidence-rich
but not full-scope production-ready.

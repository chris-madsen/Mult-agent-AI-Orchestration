# Codex branch progress follow-up — 2026-10-20

**Reviewed branch:** `codex/fix-unified-plan-1227`
**Branch commit at review:** `a3fa6d6`
**Remote:** `origin/codex/fix-unified-plan-1227`

This review records the evidence retained on the working branch after the
semantic-bug fixes. It does not promote experimental providers or claim a
production release.

## Newly retained evidence

| Area | Receipt | Result | Boundary |
|---|---|---|---|
| W04 real retrieval scale | `benchmarks/reports/index-scale-real-provider-current-100-2026-10-20.json` (SHA-256 `2f8529b45d4dc4efe4c7af67d88f82850942b4352396d1823fa35772a176eed6`) | Qdrant 1.19.2 + FastEmbed + Tree-sitter + TypeScript LS; cold `16615.032371 ms`, warm `7224.952393 ms`, change-only `7907.094154 ms`; all phases complete; coverage failures `0`; warm reuse `100`; change delta `1/1/1/1` | One 100-file local run; not a host budget, provider approval, k3s/storage matrix, or DBC-13 closure |
| W07 local archive operations | `benchmarks/reports/backup-restore-evidence-2026-10-20.json` | `OPS-01` and `OPS-06` pass; overall evidence remains incomplete because `OPS-02…05` are blocked | No Graphiti/FalkorDB or Qdrant/PVC restore run was available |
| Code-only runtime configuration | `benchmarks/reports/runtime-config-code-only-host-2026-10-20.json` | `runtime-config-accepted`; pinned embedding, TS-LS, no fallback/cloud/docs/memory | Configuration capture only; not provider E2E or release approval |
| npm supply-chain inputs | `benchmarks/reports/supply-chain-availability-2026-10-20.json` | CycloneDX SBOM retained; production audit `high=0`, `critical=0` | Image provenance/signature and independent license review are missing |

## Current disposition

- Semantic review SB-01…SB-06 are fixed in implementation and covered by the
  contract tests. The fixes are not reclassified as provider acceptance.
- W01 remains development-only: FastEmbed/ONNX and Sentence-Transformers
  comparison exists, but no frozen unseen multi-repository holdout or owner
  approval exists.
- W02 remains partial: direct TypeScript LS passes the shared oracle; Serena's
  retained comparison is `7/9`, with alias-reference and write-reference
  mismatches. No semantic provider decision is approved.
- W03 has no frozen multi-repository retrieval-quality holdout.
- W05 has only Vertex read-only capability evidence; authorized ingestion,
  citations/version provenance and conflict E2E remain open.
- W06/W08 remain blocked by the absence of a supported local-only Graphiti MCP
  command plus local inference stack in this environment. FalkorDB being up is
  not Graphiti inference evidence.
- W11 has no retained authenticated host-helper/k3s live-worktree race and
  restart evidence.
- W13 has no accepted natural-use three-arm Harbor result. Existing natural
  smoke evidence includes zero ACE calls; forced-use results remain diagnostic.
- W14/W15 remain open: no all-PASS DBC-01…14 manifest, exact-release resource
  budget, image provenance/license review, or owner sign-off exists.

## Verification on this branch

- `npm run check`
- `npm run lint`
- `npm run build`
- `npm test` — 306 passed
- Historical pre-root-migration invocation: `(cd docs/openspec && openspec validate --all --strict --no-interactive --report full)` — 6 passed
- `pytest -q scripts/test_embedding_artifact_verifier.py scripts/test_embedding_provider_comparison_metrics.py` — 7 passed
- `git diff --check`

## Next executable work

1. Repeat W04 on the selected provider/host and run the remaining Qdrant
   same-snapshot, cancellation, membership and target-storage cases.
2. Obtain owner decisions for W01/W02 and freeze the retrieval holdout for W03.
3. Run W05/W06/W07/W08 only after the authorized Vertex and local Graphiti
   provider prerequisites are supplied.
4. Run k3s, natural Harbor, exact-commit DBC, resource-budget,
   supply-chain and owner-approval gates on one final release commit.

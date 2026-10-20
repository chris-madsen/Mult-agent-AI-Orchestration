# Unified ACE production release preflight

This gate is for the **full code + documentation + memory** production claim. It intentionally stays BLOCKED until real external evidence and owner approval exist.

It does not prove or require a 5× token reduction. Harbor ratios are reported evidence; the release requirement is natural ACE use, non-inferior quality, request correlation and complete cost telemetry.

## Required evidence

The release policy points to repository-contained JSON artifacts for:

1. DBC-01…14 evidence manifest generated on the exact release commit.
2. Production-approved embedding selection verdict.
3. Production-approved semantic-provider selection verdict.
4. Retrieval-quality verdict on a `frozen_holdout`.
5. Three-arm Harbor report with observed natural ACE use and complete cost telemetry.
6. Exact-commit full-unified resource-budget evidence (`evidence = resource-budget-accepted`) using an owner-approved budget policy.
7. Exact-commit runtime configuration evidence (`evidence = runtime-config-accepted`) proving k3s+mTLS, pinned semantic retrieval, Vertex project-document-only cloud scope and local-only memory.
8. Real Graphiti lifecycle evidence (`evidence = real-graphiti-lifecycle`).
9. Real Vertex synthetic conflict evidence (`evidence = real-vertex-synthetic-code-doc-conflict`).
10. Real k3s live-worktree evidence (`evidence = real-k3s-live-worktree`).
11. Backup/restore evidence (`evidence = operations-backup-restore`).
12. Supply-chain evidence covering license/SBOM/image provenance (`evidence = supply-chain-provenance`).
13. Explicit owner approval for the **exact release commit** and all three capabilities: code, documentation, memory.

The preflight re-validates the DBC manifest and re-hashes every artifact referenced by every DBC record. A retained artifact changed after the acceptance run blocks the release.

## Policy shape

Keep the policy free of credentials. Paths must stay inside the repository.

```json
{
  "schemaVersion": 1,
  "ownerApproval": {
    "status": "pending",
    "releaseCommit": "<exact git sha>",
    "reference": "<approval record/reference>",
    "approvedCapabilities": []
  },
  "artifacts": {
    "dbc": "artifacts/release/dbc-evidence.json",
    "embeddingSelection": "artifacts/release/embedding-selection.json",
    "semanticSelection": "artifacts/release/semantic-selection.json",
    "retrievalQuality": "artifacts/release/retrieval-quality.json",
    "harborThreeArm": "artifacts/release/harbor-three-arm.json",
    "resourceBudget": "artifacts/release/resource-budget.json",
    "runtimeConfig": "artifacts/release/runtime-config.json"
  },
  "externalEvidence": [
    { "name": "graphiti", "path": "artifacts/graphiti-real-lifecycle/evidence.json" },
    { "name": "vertex", "path": "artifacts/vertex-synthetic-conflict/evidence.json" },
    { "name": "k3s-worktree", "path": "artifacts/k3s-worktree/evidence.json" },
    { "name": "backup-restore", "path": "artifacts/operations/backup-restore.json" },
    { "name": "supply-chain", "path": "artifacts/release/supply-chain.json" }
  ]
}
```

The example is deliberately `pending`; never commit an invented approval or placeholder PASS evidence.

## Run

```bash
npm run release:preflight -- \
  /path/to/release-policy.json \
  artifacts/release/preflight.json
```

The command always writes a structured READY/BLOCKED verdict when the supplied files are structurally usable.

For a hard release gate:

```bash
ACE_REQUIRE_RELEASE_READY=true npm run release:preflight -- \
  /path/to/release-policy.json \
  artifacts/release/preflight.json
```

That mode exits non-zero unless every mandatory gate is satisfied.

## What Codex must still produce in real environments

Codex must run and retain the actual Serena comparison, Graphiti lifecycle, Vertex conflict retrieval, k3s live-worktree/race/restart checks, backup/restore procedure, supply-chain/SBOM/image checks, resource-budget measurements against the owner-approved policy, a runtime-config capture from the exact deployment, and the natural-use Harbor benchmark. Then regenerate DBC-01…14 on the final commit and obtain owner approval for that exact commit.

A limited code-only release is allowed by the project plan, but **this full-unified preflight must not be weakened to represent that narrower scope**. The separate profile is documented in `docs/plans/code-only-production-release-preflight.md` and emits only `READY_CODE_ONLY`; it cannot approve documentation or memory.

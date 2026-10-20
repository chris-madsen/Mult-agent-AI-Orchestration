# ACE code-only production release preflight

This profile is intentionally narrower than the full unified code + documentation + memory release gate.

A `READY_CODE_ONLY` verdict means only the ACE **code retrieval capability** is approved for the exact commit and deployment named in the evidence. It must never be presented as documentation readiness, memory readiness, full ACE production readiness, or proof of the 5× token-reduction hypothesis.

## Required evidence

The code-only gate requires:

1. PASS on the code-scope DBC set: DBC-01…09, DBC-12 and DBC-13.
2. Production-approved embedding selection.
3. Production-approved semantic-provider selection.
4. Retrieval-quality acceptance on a `frozen_holdout`.
5. Natural-use Harbor evidence with non-inferior quality, request correlation and complete cost telemetry.
6. Supply-chain provenance evidence.
7. Exact-commit owner approval whose approved capability set is **exactly** `["code"]`.
8. For `deployment: "k3s"`, real k3s live-worktree evidence is also mandatory.

DBC-10/11 belong to memory. DBC-14 requires documentation conflict evidence. They are not silently marked PASS by this profile; they are simply outside this narrower release claim.

## Policy

Example:

```json
{
  "schemaVersion": 1,
  "scope": "code-only",
  "deployment": "host",
  "ownerApproval": {
    "status": "pending",
    "releaseCommit": "<exact git sha>",
    "reference": "<approval record>",
    "approvedCapabilities": ["code"]
  },
  "artifacts": {
    "dbc": "artifacts/release/dbc-evidence.json",
    "embeddingSelection": "artifacts/release/embedding-selection.json",
    "semanticSelection": "artifacts/release/semantic-selection.json",
    "retrievalQuality": "artifacts/release/retrieval-quality.json",
    "harborThreeArm": "artifacts/release/harbor-three-arm.json"
  },
  "externalEvidence": [
    {
      "name": "supply-chain",
      "path": "artifacts/release/supply-chain.json"
    }
  ]
}
```

For a k3s deployment add:

```json
{
  "name": "k3s-worktree",
  "path": "artifacts/k3s-worktree/evidence.json"
}
```

## Run

```bash
npm run release:preflight-code -- \
  /path/to/code-release-policy.json \
  artifacts/release/code-preflight.json
```

Hard gate:

```bash
ACE_REQUIRE_CODE_RELEASE_READY=true npm run release:preflight-code -- ...
```

The command re-hashes every DBC artifact referenced by the supplied manifest before evaluating readiness.

## Claim boundary

Allowed when the gate is green:

> ACE code retrieval is production-approved for commit X under the host/k3s deployment profile recorded in the retained evidence.

Not allowed from this gate:

- “ACE code + docs + memory is production-ready.”
- “Graphiti/Vertex are production-ready.”
- “ACE saves 5× tokens.”
- any claim for a different commit or deployment target.

For the full product claim use `npm run release:preflight`; that gate remains strictly stronger and is not weakened by this profile.

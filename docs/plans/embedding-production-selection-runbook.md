# Embedding production-selection runbook

This runbook closes the **code/evidence format** part of W01. It does not select or approve a provider by itself.

## 1. Freeze a holdout before tuning

The dataset must live inside the repository and remain unchanged after the first scored run. Run both maintained candidates through the same evaluator:

```bash
bash scripts/embedding-provider-comparison.sh \
  --dataset benchmarks/retrieval/<frozen-holdout>.json \
  --evidence-stage frozen_holdout
```

The comparison report records the exact dataset SHA-256, model revision, artifact-tree SHA-256, runtime versions, preprocessing, Recall@1/3/5, MRR, nDCG@5, p95 query latency, model load time, RSS and indexing throughput.

The report deliberately writes `production_approved: false`. A benchmark is not owner approval.

## 2. Create a selection policy before inspecting the final holdout result

Create an uncommitted policy JSON with the selected candidate, the already-frozen dataset digest, quality/performance thresholds, license evidence and owner state:

```json
{
  "selectedProvider": "fastembed/onnx",
  "requiredDatasetSha256": "<64 lowercase hex>",
  "thresholds": {
    "minRecallAt1": 0.0,
    "minRecallAt3": 0.0,
    "minRecallAt5": 0.0,
    "minMrr": 0.0,
    "minNdcgAt5": 0.0,
    "maxQueryP95Ms": 1
  },
  "licenses": {
    "fastembed/onnx": {
      "spdxId": "<verified SPDX identifier>",
      "evidence": "<source used for license verification>",
      "verified": true
    }
  },
  "ownerApproval": {
    "status": "pending"
  }
}
```

The numeric values above are schema examples only, **not ACE acceptance thresholds**. Choose real thresholds before looking at holdout outcomes and retain the policy file/digest with benchmark evidence.

Do not set `verified: true` from memory. Retain the actual model/runtime license source used for the decision.

## 3. Evaluate

```bash
npm run gate:embedding-selection -- \
  benchmarks/reports/<comparison>.json \
  /path/to/predeclared-policy.json \
  benchmarks/reports/<selection-verdict>.json
```

The gate fails measurement when any required identity, holdout, metric, threshold or license condition is missing.

The retained verdict includes the comparison `reportPath` and policy `policyPath` together with their SHA-256 digests. Release preflight re-reads both repository-contained files and re-runs the selection evaluator; editing the source report or forging only the verdict artifact therefore cannot satisfy the release gate.

A measurement can return `MEASUREMENT_PASS_APPROVAL_PENDING`; this is expected before owner review.

## 4. Owner approval is a separate event

Only after reviewing retained evidence should the policy change to:

```json
{
  "ownerApproval": {
    "status": "approved",
    "provider": "<exact selected provider>",
    "note": "<approval reference>"
  }
}
```

For a release gate, set:

```bash
ACE_REQUIRE_EMBEDDING_PRODUCTION_APPROVAL=true npm run gate:embedding-selection -- ...
```

That mode exits non-zero unless the same provider both passes the frozen evidence gate and has explicit owner approval.

## Still external

Codex still needs to build the multi-repository hidden TS/JS holdout, run the two real pinned runtimes, verify licenses from authoritative sources, measure CPU/RSS/latency on the target host, and obtain owner approval. Until then W01 remains open and the current FastEmbed configuration is experimental.

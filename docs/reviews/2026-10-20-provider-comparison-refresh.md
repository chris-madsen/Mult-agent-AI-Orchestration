# Provider comparison refresh — frozen W01/W02 evidence

**Date:** 2026-10-20
**Status:** reproducible exploratory evidence; production provider approval remains pending.

## Frozen identities

- embedding dataset: `benchmarks/retrieval/embedding-provider-comparison-labels.json`, SHA-256 `e54d6ee835faaf7d597e0e44f7f4ac00f254f29043a4054c35edd577b95301a5`;
- semantic fixture: `benchmarks/semantic/provider-comparison-v1`, SHA-256 `a797557e7a7dc451d395f786a7d675a517a573ee2aa1d6bf4486ae55f4f64459`;
- semantic oracle: SHA-256 `2937a609f896df4470c86f1010b6602a9c8ed056e1f726f6dbd6837f89fd73f7`;
- runner source commit: `06dcd8504a3ab1cb99af0e114495ce0b2dd86516`.

No frozen fixture or oracle was changed.

## W01 embeddings

Command: `npm run compare:embeddings -- --evidence-stage frozen_holdout --output artifacts/comparisons/embedding-provider-comparison.json`.

Both real local candidates completed all 9 cases using the same model family and
revision:

| Candidate | Recall@1 | Recall@3 | Recall@5 | MRR | query p95 | model load | result |
|---|---:|---:|---:|---:|---:|---:|---|
| FastEmbed/ONNX | 0.6667 | 0.8889 | 1.0000 | 0.7870 | 7.89 ms | 1505 ms | measured winner by declared tie-break policy |
| Sentence-Transformers/PyTorch | 0.6667 | 0.8889 | 1.0000 | 0.7870 | 20.62 ms | 1279 ms | measured candidate |

FastEmbed used the pinned ONNX artifact and the PyTorch arm used the pinned
Sentence-Transformers snapshot; both returned 384-dimensional genuine vectors.
This is a frozen measurement, not an owner-approved production selection.

## W02 semantic providers

Commands:

```bash
npm run compare:semantic-tsls -- benchmarks/semantic/provider-comparison-v1 \
  artifacts/comparisons/typescript-ls-provider-comparison.json
npm run compare:semantic-serena -- benchmarks/semantic/provider-comparison-v1 \
  artifacts/comparisons/serena-semantic-provider-comparison.json \
  artifacts/comparisons/serena-semantic-provider-comparison.raw.json
```

Direct TypeScript Language Service passed 9/9 frozen oracle cases with
TypeScript `5.9.3`; cold start was about `792 ms` and warm query p95 about
`62.9 ms`.

Serena `2.0.0` ran against the same fixture and oracle and passed 7/9 cases.
The failed cases are retained, not hidden:

- `alias-source-references`: Serena's public API calls the language server with
  `include_imports=false` and `include_self=false`, so the frozen declaration,
  import and call-site references are not returned;
- `write-references`: the exposed symbol resolver does not provide the local
  variable reference target expected by the oracle and resolves the enclosing
  function instead.

Serena warm query p95 was about `462 ms`. These results make Serena a measured
candidate with a semantic contract gap, not an approved fallback. The direct
TS-LS result is eligible for the selection gate, but the committed policy keeps
`ownerApproval.status=pending`; no production semantic provider has been
promoted.

## Gate boundary and next work

The machine-readable reports are retained under `benchmarks/reports/` with raw
Serena evidence. `benchmarks/policies/semantic-provider-selection-v1.json`
binds the comparison to the exact fixture/oracle and records verified license
metadata, but intentionally has no owner approval. Run the selection gate with
the refreshed reports before any provider promotion.

These measurements do not prove agent-level task success, Graphiti readiness,
local-only inference, or 5x token savings. W02 still needs owner selection and
the dirty-tree/snapshot transition E2E; W01 still needs the runtime composition
to consume the selected genuine embedding artifact and the separate retrieval
quality gate.

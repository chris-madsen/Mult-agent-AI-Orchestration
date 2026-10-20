# W01/W02 current provider comparisons — 2026-10-20

The following measurements were run from exact branch commit
`58b571c6108a10b7abf19a30aebe7432f90eac1e` on committed synthetic fixtures.
They are comparison evidence only; neither provider decision is promoted to
production.

## W01 embedding comparison

Receipt: `benchmarks/reports/embedding-provider-comparison-current-58b571c.json`.
The runner measured both pinned local candidates against
`benchmarks/retrieval/embedding-provider-comparison-labels.json` with dataset
SHA-256 `e54d6ee835faaf7d597e0e44f7f4ac00f254f29043a4054c35edd577b95301a5`.

| Provider | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | Query p95 | RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| `fastembed/onnx` | 0.6667 | 0.8889 | 1.0000 | 0.7870 | 0.8402 | 10.14 ms | 699,314,176 B |
| `sentence-transformers/pytorch` | 0.6667 | 0.8889 | 1.0000 | 0.7870 | 0.8402 | 20.49 ms | 852,606,976 B |

The run is complete and records model/runtime/artifact-tree identities. No
embedding selection gate was run because the repository has no owner-supplied
embedding selection policy with predeclared thresholds and authoritative
license evidence. Creating thresholds after seeing this result would not be a
valid selection. W01 therefore remains measurement-complete but
production-selection pending; the fixture is not the required unseen
multi-repository holdout.

## W02 semantic comparison

Receipts:

- `benchmarks/reports/typescript-ls-provider-comparison-58b571c.json`;
- `benchmarks/reports/serena-semantic-provider-comparison-58b571c.json`;
- `benchmarks/reports/serena-semantic-provider-comparison-58b571c.raw.json`;
- `benchmarks/reports/semantic-provider-selection-58b571c.json`.

Both providers used fixture SHA-256
`a797557e7a7dc451d395f786a7d675a517a573ee2aa1d6bf4486ae55f4f64459` and oracle
SHA-256 `2937a609f896df4470c86f1010b6602a9c8ed056e1f726f6dbd6837f89fd73f7`.
TypeScript Language Service passed all 9/9 cases. Serena passed 7/9 and failed
`alias-source-references` and `write-references`. The matched gate returned
`MEASUREMENT_PASS_APPROVAL_PENDING` with `measurementAccepted=true` and
`productionApproved=false` because owner approval is still pending.

This does not authorize changing the production semantic provider: the direct
TS-LS implementation remains the current runtime path, while the owner choice,
target-host performance/license review, and broader worktree E2E remain open.

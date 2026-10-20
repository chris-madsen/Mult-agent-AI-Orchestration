# W04 same-snapshot concurrency refresh

**Date:** 2026-10-20  
**Status:** real-provider bounded evidence; production concurrency and C-A
closure remain open.

## Run

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333 npm run test:real-qdrant-concurrency -- \
  --output artifacts/w04/qdrant-concurrency-b98af68.json
```

Source commit: `b98af68682486a9dba7d537c158b4d0baeeaa5ae`. The run used two
independent MCP stdio clients against the same workspace, state directory and
unique explicit Qdrant collection. It used Qdrant `1.19.2`, the real FastEmbed
worker, Tree-sitter helper and TypeScript language service. The fixture was
synthetic and local-only; no private dialogue or cloud provider was used.

## Observed result

The two writers both returned `complete=true` with current citations carrying
the same D1 source digest. They converged on one content-derived `index_key`,
one retrieval fingerprint and one persistent state-owner identity. The shared
manifest ended in `published` with no duplicate snapshot manifest. Writer A
performed the rebuild and writer B observed the same snapshot as
`warm_reused`.

The run also reproduced and fixed a real collection-creation race: both
writers could observe `404`; one Qdrant create returned `409`, followed by a
brief metadata `500`. ACE now retries only that post-409 verification for a
bounded interval and accepts the result only after the collection schema is
re-read as the expected dimension and `Cosine` distance. The contract suite
covers `404 → 409 → 500 → 200` and rejects schema mismatch.

The retained machine-readable receipt is
`benchmarks/reports/qdrant-snapshot-concurrency-b98af68.json`.

## Boundary

This closes only the bounded same-snapshot multi-writer sub-gate for this
single local host/provider run. It does not prove repeated-run performance,
embedding cancellation/timeout during a batch, stale membership/count fault
handling, target PVC/RWX or restart semantics, k3s live-worktree behavior,
Graphiti lifecycle, OAuth, Vertex, Harbor or production approval. The receipt
keeps `productionApproved`, `tokenSavings5x` and `graphitiLocalOnly` false.

# W04 stale snapshot count refresh

**Date:** 2026-10-20  
**Status:** real-provider bounded evidence; equal-count membership and
production C-A/PVC/k3s closure remain open.

## Run

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333 npm run test:real-qdrant-stale-count -- \
  --output artifacts/w04/qdrant-stale-count-b1a6d62.json
```

Source commit: `b1a6d62bec1162002067c9235303a8286d87885d`. The run used two
real ACE MCP starts, one shared state root, Qdrant `1.19.2`, the real
FastEmbed worker, Tree-sitter helper and TypeScript language service.

## Observed result

The first start built and published one snapshot. The runner then deleted one
real Qdrant point from that snapshot through the local Qdrant API. The second
start saw the stale point count, did not warm-reuse the snapshot, rebuilt the
same content-derived `index_key`, and returned a current citation with the
exact fixture digest. The retained receipt records the deleted point ID,
generation transition and all checks.

The machine-readable receipt is
`benchmarks/reports/qdrant-stale-count-b1a6d62.json`.

## Boundary

This closes only the real stale-count recovery sub-gate. Equal-count wrong
membership remains covered by the provider contract tests but is not claimed
as a real-provider mutation here; no point payload was fabricated or swapped.
Repeated selected-provider measurements, cancellation during indexing, target
PVC/RWX and k3s behavior, Graphiti/OAuth/Vertex/Harbor evidence and production
approval remain open. The receipt keeps all production claims false.

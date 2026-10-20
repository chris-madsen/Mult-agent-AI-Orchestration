# W04 real index-scale refresh

**Date:** 2026-10-20
**Status:** real-provider bounded evidence; production performance and C-A closure remain open.

## Run

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333 npm run test:real-index-scale -- \
  --files 1000 --changed 10 \
  --output artifacts/w04/index-scale-current-1000.json
```

Source commit: `fb76e9002f78df4547153bab0c39c8255f5502d4`. The run used the
official MCP stdio client boundary, Qdrant `1.19.2`, the real FastEmbed worker,
Tree-sitter helper and TypeScript language service. The generated fixture was
isolated and contained a real dirty-tree mutation, rename, deletion and
untracked file.

| Phase | elapsed | index mode | reused vectors | delta | coverage failures |
|---|---:|---|---:|---|---:|
| cold | 100,566 ms | rebuilt | 0 | added 1000 | 0 |
| warm | 8,194 ms | warm_reused | 1000 | unchanged 1000 | 0 |
| change-only | 10,311 ms | rebuilt | 988 | changed 10, added 1, deleted 1, renamed 1 | 0 |

The cold/warm phases retained the same content-derived index key and current
D1 digest. The change-only phase published a different key, returned the exact
D2 digest as `freshness=current`, and preserved current citations. The receipt
is `benchmarks/reports/index-scale-real-provider-refresh-1000-2026-10-20.json`.

## Boundary

This closes only the bounded 1k scale sub-gate for this host/provider run. It
does not prove a production resource budget, repeated selected-provider
performance, concurrent same-snapshot writers, cancellation/timeout during a
batch, stale membership/count fault handling, target PVC/RWX semantics, or
k3s live-worktree behavior. Those remain W04/C-A/W11 evidence requirements.

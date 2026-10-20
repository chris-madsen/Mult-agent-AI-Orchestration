# W14 final exact-current DBC baseline — 2026-10-20

The final DBC baseline was regenerated from commit
`11283d0b4f1a80dcfde8b50e475d505a89ecf2a8` after the pinned-upstream
preflight evidence was retained.

- Ignored manifest: `artifacts/dbc-evidence-11283d0/evidence.json`.
- Retained report: `benchmarks/reports/dbc-current-release-blocked-11283d0.json`.
- Manifest SHA-256: `ca4adbf95d2d6265f3e48b927e0f269857a9fc801c76b2197b5ede2cfa223685`.
- Summary: `0 PASS`, `0 FAIL`, `6 NOT_RUN`, `8 BLOCKED`, `allPassed=false`.

The pinned Graphiti checkout/source/config preflight now has independent PASS
checks for official command, exact source ref, structured JSON mode, and
loopback database configuration. It still does not prove local embedding,
local reranking, Amplifier OAuth/catalog, or any Graphiti lifecycle. The DBC
baseline therefore remains blocked and makes no production-readiness,
Graphiti-local-only, or 5x token-savings claim.

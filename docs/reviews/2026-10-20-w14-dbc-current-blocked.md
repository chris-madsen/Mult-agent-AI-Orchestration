# W14 exact-current DBC manifest

**Date:** 2026-10-20T14:17:57.623Z  
**Exact source commit:** `5f81b6645bbb1a5895f7f8d941fcf1044b5d8821`  
**Status:** BLOCKED

Generated `artifacts/dbc-evidence-current/evidence.json` with exactly one
record for DBC-01 through DBC-14. No PASS is fabricated: the summary is
`{'pass': 0, 'fail': 0, 'notRun': 6, 'blocked': 8, 'allPassed': False}`. Real blockers are retained for Vertex, Graphiti, Harbor and
k3s containment; other records remain NOT_RUN until the exact release bundle is
regenerated.

The tracked receipt is
`benchmarks/reports/dbc-current-release-blocked-5f81b66.json`. This manifest is a
truth baseline only and cannot satisfy W14/W15 production acceptance.

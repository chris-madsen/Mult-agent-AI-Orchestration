# Stage 0 Baseline — ACE real-provider closure

**Date:** 2026-10-19
**Source revision:** `d4c8411` (`main`)
**Plan:** `docs/openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md`
**Status:** baseline complete; real-provider stages remain explicitly not ready where dependencies are absent.

## Reproducibility

| Check | Result |
|---|---|
| Node | `v24.15.0` |
| npm | `11.12.1` |
| Rust | `1.95.0` |
| Cargo | `1.95.0` |
| `npm ci` | Passed; npm reported 11 high-severity development-tree advisories |
| `make verify` | Passed: lint, Rust check, TypeScript check, 63 tests, build |
| `npm audit --omit=dev --audit-level=high` | Passed: 0 production vulnerabilities |
| `git diff --check` | Passed |
| OpenSpec strict validation | Passed for changes 001–006 |

The development-only npm advisories are retained as a baseline finding; no forced upgrade was applied without a dependency compatibility decision.

## Vertex read-only probe

The authenticated local `gcloud` session was used only for the repository read-only probe. The project identifier is intentionally omitted from this committed report. One active authentication account was detected; identity and access tokens were not recorded.

| Region | HTTP | Corpus count | Verdict |
|---|---:|---:|---|
| `us-central1` | 200 | 0 | `not_ready: empty_corpus` |
| `europe-west4` | 200 | 0 | `not_ready: empty_corpus` |

No corpus was created or imported, and no private or synthetic document was uploaded.

## Local capability and service probe

Machine-readable output is in [`benchmarks/reports/2026-10-19-stage0-provider-capability.json`](../../benchmarks/reports/2026-10-19-stage0-provider-capability.json).

- Harbor CLI is available (`0.24.0`).
- Codex CLI is available (`0.148.0-alpha.9`) with JSON execution help.
- The local k3s kubeconfig is `/etc/rancher/k3s/k3s.yaml`; node `xmg` is `Ready` on `v1.35.5+k3s1`.
- Tree-sitter, ast-grep Python bindings, pygls and `graphiti_core` are importable in `.venv-system`.
- Qdrant CLI is unavailable and `http://127.0.0.1:6333/healthz` refused the connection.
- The k3s cluster has no Qdrant, Graphiti or FalkorDB service/workload; only system and monitoring workloads were present.
- Graphiti/FalkorDB health did not pass; no local database service was found.
- `tb` and `terminal-bench` commands are unavailable; Harbor remains the available evaluation CLI.

## Explicit blockers and next actions

1. Do not select Ollama or any other embedding provider by default. Run the ADR-013 candidate comparison only with maintained genuine local runtimes, preserving failed candidates and the deterministic hash vector as a test double only.
2. Provision or obtain owner-approved access to a real local Qdrant and embedding runtime before restoring experimental provider wiring.
3. Compare Serena with direct TypeScript Language Service on identical fixtures before making a production LSP recommendation.
4. Keep Vertex at `not_ready: empty_corpus` until the owner authorizes a corpus/resource and a real citation probe.
5. Check Graphiti/FalkorDB and inference configuration separately; health of a database alone is not Graphiti extraction evidence.
6. Begin Harbor exploratory paired runs only after the actual MCP/provider composition and trace parser are available.

No production-readiness or 5× claim is made by this baseline.

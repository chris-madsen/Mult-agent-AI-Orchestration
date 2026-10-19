# Stage 0 Baseline — ACE real-provider closure

**Date:** 2026-10-19
**Source revision:** `d4c8411` (`main`)
**Plan:** `docs/openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md`
**Status:** baseline complete; local backends are provisioned and an exploratory real-provider retrieval slice is evidenced. Production selection and real-data gates remain open.

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

## Vertex probe and owner-authorized Europe test corpus

The authenticated local `gcloud` session was used for the probe and for creation of the Europe test corpus **with explicit owner authorization**. The creation is in-scope and the corpus must be retained. One active authentication account was detected; identity and access tokens were not recorded.

| Region | HTTP | Corpus count | Verdict |
|---|---:|---:|---|
| `us-central1` | 200 | 0 | `not_ready: empty_corpus` |
| `europe-west4` | 200 | 1 | Corpus `ace-europe-stage2` created; empty |

The Europe corpus resource is `projects/258931953910/locations/europe-west4/ragCorpora/2305843009213693952`. A real `retrieveContexts` request against it returned `{}` for a synthetic readiness query, as expected for an empty corpus. No private or synthetic document was uploaded or imported.

## Local capability and service probe

Machine-readable output is in [`benchmarks/reports/2026-10-19-stage0-provider-capability.json`](../../benchmarks/reports/2026-10-19-stage0-provider-capability.json).

- Harbor CLI is available (`0.24.0`).
- Codex CLI is available (`0.148.0-alpha.9`) with JSON execution help.
- The local k3s kubeconfig is `/etc/rancher/k3s/k3s.yaml`; node `xmg` is `Ready` on `v1.35.5+k3s1`.
- Tree-sitter, ast-grep Python bindings, pygls and `graphiti_core` are importable in `.venv-system`.
- Qdrant CLI is not installed, but official Qdrant Helm chart `1.19.2` is running in k3s namespace `ace`; pod `qdrant-0` is Ready with a 10Gi local-path PVC and `healthz` passed.
- Official FalkorDB image `v4.20.4-alpine` is running as the `ace/falkordb-0` StatefulSet with a 5Gi local-path PVC; Redis `PONG`, `GRAPH.QUERY`, and Graphiti `FalkorDriver.health_check()` passed.
- Serena `2.0.0` is installed with the LSP backend; its project health-check installed TypeScript Language Server `5.1.3`, used workspace TypeScript `5.9.3`, and passed symbol/reference checks.
- `tb` and `terminal-bench` commands are unavailable; Harbor remains the available evaluation CLI.


## Exploratory embedding comparison

The raw machine-readable comparison is [`benchmarks/reports/2026-10-19-embedding-provider-comparison.json`](../../benchmarks/reports/2026-10-19-embedding-provider-comparison.json). It uses nine synthetic labeled cases covering behavior-not-name queries, duplicate/similar symbols, RU↔EN technical requests, and read/write semantics. It is exploratory evidence only; no model is production-approved.

| Candidate | Dimensions | Recall@1 | Recall@3 | Median query latency |
|---|---:|---:|---:|---:|
| FastEmbed/ONNX + BGE small English v1.5 | 384 | 0.333 | 1.000 | 6.63 ms |
| FastEmbed/ONNX + multilingual MiniLM | 384 | 0.667 | 1.000 | 6.27 ms |
| Sentence-Transformers/PyTorch + multilingual MiniLM | 384 | 0.778 | 1.000 | 16.65 ms |

The PyTorch result is the strongest result on this tiny holdout but is slower and must be repeated on a larger frozen holdout with model/license/digest verification before any provider selection. The deterministic SHA-256 projection remains a test double only.

## Explicit blockers and next actions

1. Do not select Ollama or any other embedding provider by default. The exploratory comparison is recorded separately; preserve failed candidates and the deterministic hash vector as a test double only.
2. The measured FastEmbed multilingual candidate is wired for exploratory Qdrant E2E in a model-versioned collection. Production selection still requires the larger holdout, model/license/digest review and owner approval.
3. Compare Serena with direct TypeScript Language Service on identical fixtures before making a production LSP recommendation.
4. The Vertex Europe corpus is intentionally empty and owner-authorized. The authenticated corpus/retrieveContexts validation is recorded in `2026-10-19-vertex-gcloud-corpus-validation.md`; keep the corpus. Private-document upload remains separately permissioned.
5. Continue Graphiti MCP extraction immediately with a supported **local-only experimental** LLM/inference configuration selected by Codex; no additional owner model choice is required for the experiment. FalkorDB health alone is not Graphiti extraction evidence.
6. Begin Harbor exploratory paired runs only after the actual MCP/provider composition and trace parser are available.

No production-readiness or 5× claim is made by this baseline.

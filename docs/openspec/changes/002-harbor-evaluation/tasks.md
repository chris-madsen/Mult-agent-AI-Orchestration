# Implementation Tasks — Harbor evaluation and provider-reported token ledger

**State: PARTIALLY IMPLEMENTED.** The provider-independent evaluation core and
usage ledger are implemented; Harbor installation and external adapter verification
remain open and are documented in `docs/docs/spikes/SPIKE-HARBOR.md`.

## Tooling spike
- [x] Pin observed Harbor `0.24.0` and Codex `0.148.0-alpha.9`; environment provider and evaluation suite versions remain smoke-run dependent.
- [x] Run an isolated smoke task using ordinary Codex; document permissions, cache settings and toolset. OAuth-authenticated run passed with reward `1.0`; raw artifacts are retained under `artifacts/harbor-oauth/`.
- [x] Verify the installed Codex CLI version and JSONL capability (`codex-cli 0.148.0-alpha.9` on host; Harbor container Codex `0.163.0`; captured `thread.started`, item events and `turn.completed` usage).

## Domain and adapter
- [x] Create `EvaluationSuite`, `BenchmarkRun`, `UsageSample` and `ComparisonReport` roots/value objects.
- [x] Implement Harbor adapter for pinned TypeScript/DevOps tasks, isolated worktree reset and content-addressed artifact retention manifest.
- [x] Implement typed Harbor CLI runner that preserves failed exit codes and JSONL events; pinned dataset/worktree/artifact smoke remains Harbor-dependent.
- [x] Implement provider-reported Codex JSONL boundary adapter and usage normalizer; preserve raw events and unknown fields.
- [x] Include external Vertex/embedding/Graphiti/Jev usage ledger with explicit unsupported markers.

## Quality and comparison
- [x] Implement task-level quality outcomes and acceptance gating independent of token counts.
- [x] Build paired baseline vs instrumented configurations and fixed holdout manifests; five native and five ACE serial trials completed on the same holdout with raw artifacts retained in `artifacts/harbor-native-natural-repeat5-serial/` and `artifacts/harbor-ace-natural-repeat5-serial/`.
- [x] Produce deterministic Markdown/JSONL/CSV comparison summaries with quality, usage/cost measurements, unknown markers and evidence hashes; the natural paired report is `benchmarks/reports/ace-local-smoke-natural-paired-repeat5.{md,json,csv}` and Harbor latency/p50/p90 remains provider-dependent.

## Validation
- [x] Contract tests for cumulative vs delta normalization and cached/reasoning subsets.
- [x] Negative tests for timeout/failed runs, missing usage and wrong patch; hidden-patch leakage remains Harbor-dependent.
- [x] Publish baseline reports honestly without claiming achieved 5x; generated artifacts are `benchmarks/reports/ace-local-smoke-baseline.{md,jsonl,csv}` and retain one incomplete failed run.

## Exit criteria

- [x] All provider-independent scenarios have executable test coverage or a documented controlled exception.
- [x] Provider-independent failure tests pass; no fabricated usage, quality success or external provider success is produced.
- [x] Domain and adapter dependencies comply with module boundaries and accepted ADRs.
- [ ] Review the change with the owner; do not archive until completed and verified.

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

---

## Mandatory outstanding production gates (2026-10-18)

**Architecture correction:** existing successful smoke results establish only test harness mechanics. They cannot establish ACE retrieval savings when no ACE calls occur or when forced calls address a trivial replacement task.
- [ ] Retrieval-demanding paired Codex trials with traced ACE calls and real-provider attribution (DBC-12); keep all failed runs and external costs.


---

## Hermes migration gates — owner decision 2026-10-23

Historical completed Codex tasks above remain historical evidence and are not relabeled.

- [x] Replace current feedback-loop job identity with pinned Hermes `v0.22.3` and `openai-codex/<model>`.
- [x] Add a narrow Harbor 0.24.0 Hermes adapter that imports existing ChatGPT/Codex OAuth from host `~/.codex/auth.json` without requiring OpenAI/OpenRouter API keys.
- [x] Expose ACE only on the optional arm through Hermes native stdio MCP; move the container-specific ACE environment into the pinned MCP wrapper.
- [x] Update collector compatibility so Hermes `hermes-session.jsonl` MCP calls can be correlated while legacy Codex evidence remains readable.
- [x] Pin adapter and MCP entrypoint digests in experiment/preflight provenance.
- [ ] Run a one-task real Hermes native vs Hermes+ACE smoke with the same GPT model/reasoning and retain raw Hermes session/provider evidence.
- [ ] Require successful verifier outcomes and correlated ACE calls before starting the 10-task paired run.
- [ ] Run repeats and untouched holdout only after the Hermes smoke gate passes.

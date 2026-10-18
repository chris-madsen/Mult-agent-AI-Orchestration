# SPIKE-HARBOR — Provider and runner contract verification

**Status:** Local smoke and native Codex MCP verified; forced integration and natural paired smoke measured; retrieval benefit remains open
**Scope:** `002-harbor-evaluation`

## Observed environment

- Host `codex --version`: `codex-cli 0.148.0-alpha.9`
- `codex exec --help`: exposes `--json` for JSONL event output
- Harbor CLI: installed via `uv tool install harbor`, version `0.24.0`; `harbor run --help` is available.
- `tb` and `terminal-bench`: not installed; Harbor is the installed benchmark CLI.
- Harbor's isolated container installed Codex `0.163.0` and completed a real task.
- The first run using Harbor's default `OPENAI_API_KEY` path failed with
  `AgentAuthenticationError`; no reward was claimed for that run.
- The repeatable OAuth run used the existing local `~/.codex/auth.json` via
  `CODEX_FORCE_AUTH_JSON=1`; no API key was required or copied into the job.
- Successful smoke result: `artifacts/harbor-oauth/ace-local-smoke-oauth/result.json`.
  One trial completed with reward `1.0`, no exceptions, and the verifier confirmed
  the exact fixture edit. The trial artifact also contains the raw JSONL stream and
  Harbor's usage ledger (`59,674` input, `50,048` cached input, `624` output tokens).
- The repeatable read-only probe is `npm run probe:providers`; it records command
  availability and JSON capability without sending benchmark payloads.

The benchmark domain and provider-reported usage ledger are implemented locally.
The captured JSONL verifies the installed Codex event boundary (`thread.started`,
`turn.started`, item lifecycle events and `turn.completed` usage). This is one
provider smoke task, not a baseline/holdout comparison and not evidence for a 5× gain.

The typed Harbor CLI runner is implemented and preserves non-zero exit status,
stdout/stderr and JSONL events. It returns `UNSUPPORTED_PROVIDER` when the executable
is absent; it never drops failed runs or converts them into successful evaluations.

The typed Harbor task adapter now validates pinned TypeScript/DevOps task manifests,
builds isolated Docker job configuration, performs reset/clean only in a dedicated
child worktree using non-shell Git arguments, and writes SHA-256 artifact-retention
manifests. Paired native-vs-ACE configurations and a fixed holdout manifest live in
`benchmarks/harbor/ace-suite/`. The verified paired result is documented below.

The ACE-instrumented local task is `benchmarks/harbor/ace-local-smoke-instrumented-job.json`.
Its read-only bind mount exposes only the built harness at `/ace`, and it injects
`ACE_WORKSPACE_ROOT`, `ACE_ALLOWED_ROOTS` and a deterministic test-only
`ACE_WORKSPACE_ID`. The Codex native config is
`benchmarks/harbor/ace-codex-config.toml`: it sets `required=true`,
`startup_timeout_sec=30`, `cwd=/workspace`, and the ACE environment.
A non-Git workspace is supported by the local snapshot port; the fallback records
`headRevision=unavailable` and all file states as `unknown`.

The native Codex MCP path was verified in Harbor `0.24.0` with container Codex
`0.163.0` and OAuth authentication: the retained JSONL contains a completed
`mcp_tool_call(server=ace, tool=ace_context)`, and the exact-byte verifier passed.
The successful retained run is
`artifacts/harbor-native-required/ace-local-smoke-instrumented/result.json`
(`1/1`, reward `1.0`, no exceptions). The repeated paired result is retained
separately and does not claim a 5× gain.

The repeatable paired holdout is implemented by
`benchmarks/harbor/ace-suite/native-repeat5-job.json` and
`benchmarks/harbor/ace-suite/ace-repeat5-job.json`. Both configurations use five
serial trials of the same deterministic fixture, the same Codex model and reasoning
effort, and retain every raw trial. The native configuration has no ACE MCP server;
the ACE configuration exposes ACE MCP but does not force a call. The environment
Dockerfiles preinstall Harbor agent dependencies and the Codex CLI so trials do not
depend on a fresh per-container `apt-get` setup race. Parallel ACE startup also
exhibited a provider-side workspace-routing timeout, so the checked-in comparison is
serial (`n_concurrent_trials=1`).

The natural paired report is
`benchmarks/reports/ace-local-smoke-natural-paired-repeat5.{md,json,csv}`. Both
configurations completed `5/5` trials with reward `1.0` and pass@5 `1.0`. Native
Codex used `362,152` provider-reported total tokens and cost `0.0152608`;
Codex+ACE used `300,432` tokens and cost `0.0124782`, a measured ratio of `0.818x`
on this fixture. Neither arm called ACE MCP, so this is only a no-regression smoke,
not evidence of retrieval quality or a general cost reduction.

The forced MCP integration report remains
`benchmarks/reports/ace-local-smoke-paired-repeat5.{md,json,csv}`. It measured
`2.819x` ACE/native cost on the same tiny task because the forced MCP round-trip
caused an additional model pass while returning no useful evidence. That is measured
overhead/regression, not an optimization result, and is retained as a warning against
forcing context retrieval when the task does not need it.

The honest baseline-only smoke report is generated with
`npm run report:harbor-smoke` and written to
`benchmarks/reports/ace-local-smoke-baseline.{md,jsonl,csv}`. It contains two
retained runs: one OAuth-successful trial (`quality=passed`, `reward=1.0`) and one
authentication-failed trial (`RecordedIncomplete`, usage unknown). It reports
`60,298` total tokens and provider-reported cost `0.00367496` for the successful
run; the native ACE MCP trial is retained separately and is not mixed into this
baseline aggregate. No 5x claim is made. The repeated native-vs-ACE report is kept
separately because the single fixture is not a general benchmark.

## Controlled exception

No baseline or fivefold claim is published from this single smoke task. The local
core records failed/aborted runs, preserves raw usage events, distinguishes delta
and cumulative counters, and represents missing provider usage as `unknown`.
External Vertex, embedding, Graphiti and Jev usage is represented as explicit
`unsupported` records until each provider contract is verified. The typed CLI runner
is ready, but installation alone is not a benchmark result.

## Reproducible next probe

The reproducible local smoke command is:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run --config benchmarks/harbor/ace-local-smoke-job.json
```

The probe used Harbor `0.24.0`, Docker, network-enabled environment setup, the
Codex agent with `gpt-5.6-luna` and `reasoning_effort=high`, and a disposable
environment with delete enabled. For a fresh installation, first run:

```bash
harbor --version
python3 -c 'import harbor, terminal_bench; print(harbor.__file__, terminal_bench.__file__)'
codex --version
codex exec --json --help
```

Retain the successful and failed JSONL/event artifacts, task manifest, environment
fingerprint and exact versions before implementing the external adapter. Do not
estimate tokens or discard failed runs.

For the verified paired smoke, run:

```bash
CODEX_FORCE_AUTH_JSON=1 harbor run --config benchmarks/harbor/ace-suite/native-repeat5-job.json
CODEX_FORCE_AUTH_JSON=1 harbor run --config benchmarks/harbor/ace-suite/ace-repeat5-job.json
npm run report:harbor-paired
```

Serena, independent MCP and long-horizon memory extraction remain outside this
report and require separate provider decisions and tasks.

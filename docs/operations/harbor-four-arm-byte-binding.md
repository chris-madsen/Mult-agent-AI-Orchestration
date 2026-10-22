# Harbor four-arm byte binding

The external four-arm workload is accepted only when the task manifest, task
payloads, effective Codex/MCP configuration, model/provider identity and
runtime image identity are bound to the jobs.

## Freeze

Run from the ACE checkout with outputs outside the checkout:

```bash
ACE_HARBOR_MODEL_IDENTITY='<pinned-model>' ACE_HARBOR_PROVIDER_IDENTITY='<provider-and-runtime-version>' ACE_HARBOR_RUNTIME_IMAGE_IDENTITY='<immutable-image-digest>' npm run freeze:harbor-four-arm -- <frozen-task-manifest.json> <external-output-dir> <dense.toml> <hybrid.toml> <delta.toml>
```

Freeze reads every task file/directory and TOML byte payload. A declared SHA
that differs from the bytes, a missing path, or a missing identity stops the
operation. The generated `.sha256` files and `binding.json` are receipts, not
the source of truth.

## Before each Harbor run

From the same workspace that contains the frozen task/config paths, run:

```bash
ACE_HARBOR_REPOSITORY_IDS='repo-a,repo-b' ACE_HARBOR_WORKSPACE_ROOT="$PWD" ACE_HARBOR_MODEL_IDENTITY='<same-pinned-model>' ACE_HARBOR_PROVIDER_IDENTITY='<same-provider-and-runtime-version>' ACE_HARBOR_RUNTIME_IMAGE_IDENTITY='<same-immutable-image-digest>' npm run verify:harbor-four-arm-binding -- <native-job.json> <dense-job.json> <hybrid-job.json> <hybrid-delta-job.json>
```

The command must return `verified-before-run`. Otherwise the run is
`BLOCKED`; do not substitute a sidecar hash or a path-pattern check.

## Report gate

`gate:harbor-four-arm` repeats the byte/manifest/identity verification and
reads and hashes the referenced raw trace, usage and failure artifacts before
writing its output. Missing or empty artifacts are `BLOCKED`. A report boolean
or declared counter is not independent provider evidence, and a successful
synthetic contract smoke is not an agent-E2E or benchmark result.

When the four raw Harbor aggregate paths are available, pass them after the
normal output path:

```bash
ACE_HARBOR_REPOSITORY_IDS='repo-a,repo-b' ACE_HARBOR_WORKSPACE_ROOT="$PWD" ACE_HARBOR_MODEL_IDENTITY='<same-pinned-model>' ACE_HARBOR_PROVIDER_IDENTITY='<same-provider-and-runtime-version>' ACE_HARBOR_RUNTIME_IMAGE_IDENTITY='<same-immutable-image-digest>' npm run gate:harbor-four-arm -- <native-job.json> <dense-job.json> <hybrid-job.json> <hybrid-delta-job.json> <report.json> <output.json> <native-result.json> <dense-result.json> <hybrid-result.json> <hybrid-delta-result.json>
```

The gate then parses each trial's `result.json` and `agent/codex.txt`, counts
terminal ACE calls and correlated successful request IDs, reads per-trial
usage/timestamps, and extracts returned evidence receipt/delivery metrics.
It reconciles those observations against the declared aggregate. Forged
success/token counters, missing verifier outcomes, missing request
correlation, task-order drift, or unsupported receipt reuse are `BLOCKED`.
The parser deliberately leaves timeout and native-read telemetry `unknown`
when the raw runtime did not emit those facts; absence of `ace_expand` is not
evidence of zero native reads.

Without all four raw result paths the output remains
`rawTrialEvidenceVerified=false` and
`fiveXBlocker=raw_trial_evidence_not_independently_reconciled`. Even with raw
paths, unknown required telemetry keeps the release gate closed. Byte hashes
alone cannot justify a release claim.

The four-arm result remains `NOT_RUN`/`BLOCKED` until real Harbor, Codex/OAuth,
Docker/Linux execution supplies correlated MCP calls, per-trial task success,
raw usage, latency and failure evidence. This binding workflow does not claim
5× savings, production readiness or owner approval.

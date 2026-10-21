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

The four-arm result remains `NOT_RUN`/`BLOCKED` until real Harbor, Codex/OAuth,
Docker/Linux execution supplies correlated MCP calls, per-trial task success,
raw usage, latency and failure evidence. This binding workflow does not claim
5× savings, production readiness or owner approval.

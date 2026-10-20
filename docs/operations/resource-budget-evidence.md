# ACE resource-budget release evidence

This gate exists to make W15 resource budgets explicit and machine-checkable. It deliberately does **not** invent product limits.

The owner/release policy supplies the maximum values and minimum sample counts. Codex supplies measured values from the exact release commit/environment. The gate only verifies identity, completeness and `observed <= maximum`.

## Required metrics

For a **code-only** release:

- `process_peak_rss_bytes`
- `startup_ready_ms`
- `cold_index_ms`
- `code_query_p95_ms`

For a **full-unified** release the same four plus:

- `documentation_query_p95_ms`
- `memory_query_p95_ms`

Units are fixed: RSS is `bytes`; all other required metrics are `ms`.

## Input shape

Example only; the numeric budgets below are placeholders and **must not** be reused as policy without owner approval.

```json
{
  "schemaVersion": 1,
  "scope": "code-only",
  "sourceCommit": "<exact git sha>",
  "generatedAt": "2026-10-20T00:00:00.000Z",
  "budgetPolicy": {
    "reference": "<owner-approved policy/reference>",
    "sha256": "<sha256 of that policy artifact>",
    "metrics": [
      {
        "metric": "process_peak_rss_bytes",
        "unit": "bytes",
        "maximum": 1,
        "minimumSamples": 1
      },
      {
        "metric": "startup_ready_ms",
        "unit": "ms",
        "maximum": 1,
        "minimumSamples": 1
      },
      {
        "metric": "cold_index_ms",
        "unit": "ms",
        "maximum": 1,
        "minimumSamples": 1
      },
      {
        "metric": "code_query_p95_ms",
        "unit": "ms",
        "maximum": 1,
        "minimumSamples": 1
      }
    ]
  },
  "measurementEnvironment": {
    "runtime": "<exact Node/ACE/provider identity>",
    "deployment": "<host or k3s profile>",
    "hostClass": "<safe hardware class, no personal hostname/path>"
  },
  "observed": [
    {
      "metric": "process_peak_rss_bytes",
      "unit": "bytes",
      "observed": 0,
      "sampleCount": 1,
      "method": "<retained measurement method>"
    }
  ]
}
```

A real file must include every metric required by its scope; the abbreviated `observed` list above is intentionally incomplete.

## Finalize

```bash
npm run evidence:resource-budget -- \
  artifacts/resource-budget/raw-measurement.json \
  artifacts/release/resource-budget.json
```

Hard gate:

```bash
ACE_REQUIRE_RESOURCE_BUDGET_ACCEPTED=true npm run evidence:resource-budget -- ...
```

The finalizer binds the result to the current Git commit. A cross-commit result, missing required measurement, insufficient sample count, or observed value above the owner policy emits `resource-budget-exceeded`.

Both release preflights re-validate the finalized document:

- `release:preflight-code` requires `scope = code-only`;
- `release:preflight` requires `scope = full-unified`.

A green resource budget says nothing about retrieval quality, token savings, provider approval or production readiness by itself.

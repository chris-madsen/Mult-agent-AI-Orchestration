# W07 real Graphiti crash-recovery runbook

This is the executable W07 **crash-consistency** handoff. It is separate from the happy-path Graphiti lifecycle gate.

Only the committed frozen synthetic fixture is allowed. This procedure does not authorize importing private Codex history.

## Preconditions

Run a supported local Graphiti MCP server backed by the intended local FalkorDB and local inference stack.

Required:

```bash
export ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true
export ACE_GRAPHITI_COMMAND="..."
export ACE_GRAPHITI_ARGS_JSON='["..."]'
```

Required for release-quality evidence:

```bash
export ACE_GRAPHITI_VERSION="..."
export ACE_GRAPHITI_LLM_ID="..."
export ACE_GRAPHITI_EMBEDDER_ID="..."
export ACE_GRAPHITI_RERANKER_ID="..."
```

Do not leave these identities as `unknown`; the full release validator rejects unknown Graphiti/inference identities.

## Run

```bash
npm run test:real-graphiti-crash -- \
  benchmarks/fixtures/graphiti-memory-lifecycle-v1.json \
  artifacts/graphiti-crash-recovery/evidence.json
```

Optional bounded timing controls:

```bash
export ACE_GRAPHITI_CRASH_TIMEOUT_MS=120000
export ACE_GRAPHITI_CRASH_RECONCILE_ATTEMPTS=120
export ACE_GRAPHITI_CRASH_RECONCILE_DELAY_MS=500
```

## Exact failure window

The child worker performs, in this order:

1. archives the exact synthetic episode;
2. persists the durable projection-outbox intent;
3. calls the **real Graphiti projection provider**;
4. receives the provider response;
5. intentionally does **not** persist that response to the outbox;
6. receives `SIGKILL`.

This reproduces the acknowledgement gap where Graphiti may have accepted/materialized work but ACE dies before it records that fact.

The worker failpoint is test-only and requires both:

```bash
ACE_ENABLE_TEST_FAILPOINTS=true
ACE_TEST_FAILPOINT=after_graphiti_enqueue_before_outbox_receipt
```

The parent runner sets these only for the crash worker. Normal ACE runtime does not need them.

## Recovery requirements

After the child dies, the parent requires:

- durable outbox receipt still exists as `pending` with zero recorded attempts;
- production `dist/bin/ace-memory.js reconcile` is used after restart;
- reconciliation eventually reaches durable `projected`;
- reconciliation may either observe the original provider work or safely retry projection;
- real Graphiti search returns at least one fact mapped to the exact immutable episode ID, source pointer and SHA-256 digest;
- production `ace-memory delete` performs verified derived purge before archive tombstone;
- outbox becomes `tombstoned`;
- archive read returns `ARCHIVE_TOMBSTONED`;
- a final real Graphiti state check proves the derived episode remains absent.

`ace-memory reconcile` and `delete` now honor `ACE_PROVIDER_TRACE_FILE`, so retain the safe recovery trace together with the crash-worker trace.

## Retained artifacts

On success retain:

- `artifacts/graphiti-crash-recovery/evidence.json`;
- `artifacts/graphiti-crash-recovery/crash-worker-provider-trace.jsonl`;
- `artifacts/graphiti-crash-recovery/recovery-provider-trace.jsonl`.

The evidence includes the exact source commit, synthetic fixture digest, isolated workspace/group/episode IDs, Graphiti/inference identities, crash signal/failpoint, durable pre-recovery receipt, reconciliation count, provenance hit count and purge/tombstone results.

## Release boundary

The full-unified release preflight requires this evidence **in addition to** `real-graphiti-lifecycle`.

A passing crash-recovery run still does not by itself prove:

- inference provider approval;
- Graphiti performance/resource budget;
- concurrent multi-writer storage behavior;
- DBC-11 or full release readiness.

Those require the remaining exact-release evidence and owner gates.

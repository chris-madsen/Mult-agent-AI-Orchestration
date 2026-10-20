# C-A / W04 real Qdrant interrupted-writer lifecycle runbook

This runner prepares **real-provider snapshot lifecycle evidence**. It does not mark DBC-13 PASS and does not approve the embedding/LSP stack.

## Scenario

The runner uses the production `dist/bin/ace-mcp.js` path with:

- real local Qdrant;
- the configured embedding worker;
- Tree-sitter structural extraction;
- direct TypeScript Language Service;
- exact source verification;
- one explicit shared Qdrant collection;
- **two different `ACE_STATE_DIR` roots**.

The sequence is:

1. reader A publishes S1 and stays alive;
2. the worktree changes only one source file while a stable symbol remains unchanged;
3. writer B, using a different state directory, builds S2 in the same explicit collection;
4. after Qdrant upsert + membership verification but **before manifest publish**, a guarded test-only failpoint sends writer B `SIGKILL`;
5. B's manifest must remain `building`;
6. reader A must still return the unchanged S1 symbol as current;
7. writer B restarts without the failpoint, completes S2 and publishes it;
8. the restarted writer must return the changed S2 symbol;
9. reader A must still return its unchanged S1 symbol after S2 publication;
10. the two state roots must have different persistent state-owner IDs;
11. automatic snapshot GC must remain skipped because an explicit shared collection is not declared exclusive-owner.

This exercises the fail-safe design selected for cross-state sharing: **never delete a potentially active remote reader snapshot just because local lease state cannot prove it is inactive**.

## Run

Build dependencies and ensure Qdrant/embedding/Tree-sitter are available, then:

```bash
npm run test:real-qdrant-crash -- \
  artifacts/qdrant-snapshot-crash/evidence.json
```

Optional environment:

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333
ACE_QDRANT_CRASH_E2E_TIMEOUT_MS=1200000
```

By default the runner creates a unique temporary collection and deletes it best-effort afterward.

To use a pre-created disposable collection:

```bash
ACE_QDRANT_CRASH_COLLECTION=ace_ca_disposable \
npm run test:real-qdrant-crash -- artifacts/qdrant-snapshot-crash/evidence.json
```

When `ACE_QDRANT_CRASH_COLLECTION` is supplied, the runner does **not** delete it automatically.

Do not set `ACE_QDRANT_COLLECTION_EXCLUSIVE_OWNER=true` for this test. The test intentionally verifies shared explicit-collection behavior across independent state roots.

## Test-only failpoint

The runtime contains one narrowly-scoped crash point:

```text
after_qdrant_verify_before_publish
```

It is inert unless **both** variables are set:

```bash
ACE_ENABLE_TEST_FAILPOINTS=true
ACE_TEST_FAILPOINT=after_qdrant_verify_before_publish
```

Unknown failpoints fail startup. Setting `ACE_TEST_FAILPOINT` without the enable flag also fails startup.

Release runtime-config evidence refuses any environment with ACE test failpoints enabled or named.

## Retained artifacts

When an output path is supplied, retain:

- the evidence JSON;
- reader provider trace;
- crashed-writer provider trace when any events were flushed before SIGKILL;
- restarted-writer provider trace.

The evidence records exact source commit, fixture commit, request IDs, Qdrant version label, safe provider-runtime file names, trace digests and PASS/FAIL checks. It does not retain source bytes, query payloads, credentials or certificate material.

## Acceptance boundary

A successful run is bounded C-A/W04 evidence for:

- interrupted build remains unpublished;
- active S1 survives a failed S2 writer;
- restart can finish and publish S2;
- S1 survives S2 publication in the shared explicit-collection/no-GC mode.

It is **not sufficient by itself** for:

- DBC-13 normative PASS;
- performance acceptance;
- production embedding/LSP approval;
- k3s cross-host acceptance;
- full ACE production readiness.

DBC-13 still requires the selected provider stack plus retained restart, rename/delete/untracked, scale/performance and exact-release evidence.

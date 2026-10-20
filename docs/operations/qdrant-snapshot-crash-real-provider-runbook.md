# C-A / W04 real Qdrant interrupted-writer publication runbook

This runner prepares **real-provider alias-publication evidence**. It does not mark DBC-13 PASS and does not approve the embedding/LSP stack.

## Scenario

The runner uses the production `dist/bin/ace-mcp.js` path with:

- real local Qdrant;
- the configured embedding worker;
- ast-grep structural extraction;
- generic LSP client with the configured TypeScript language server;
- exact source verification;
- one workspace-scoped content-addressed collection per source generation;
- **two different `ACE_STATE_DIR` roots**.

The sequence is:

1. reader A publishes S1 and stays alive;
2. the worktree changes only one source file while a stable symbol remains unchanged;
3. writer B, using a different state directory, builds S2 in a new immutable collection;
4. after Qdrant upsert + membership verification but **before current-alias publish**, a guarded test-only failpoint sends writer B `SIGKILL`;
5. the current alias must remain pointed at S1;
6. reader A must still return the unchanged S1 symbol as current;
7. writer B restarts without the failpoint, completes S2 and atomically switches the current alias;
8. the restarted writer must return the changed S2 symbol;
9. reader A must still return its unchanged S1 symbol after S2 publication;
10. S1 and S2 must be distinct collection identities;
11. no filesystem Qdrant snapshot manifest or lease is used by the run.

This exercises the native Qdrant publication invariant: **never expose an unverified collection through the current alias**.

## Run

Build dependencies and ensure Qdrant/embedding/ast-grep are available, then:

```bash
npm run test:real-qdrant-crash -- \
  artifacts/qdrant-snapshot-crash/evidence.json
```

Optional environment:

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333
ACE_QDRANT_CRASH_E2E_TIMEOUT_MS=1200000
```

The runner derives unique workspace-scoped collection and alias names from the generated fixture workspace. Cleanup is best-effort; no operator-supplied collection override is accepted.

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

- interrupted build leaves the current alias unchanged;
- active S1 survives a failed S2 writer;
- restart can finish and atomically publish S2;
- S1 remains available while S2 is published in a separate collection.

It is **not sufficient by itself** for:

- DBC-13 normative PASS;
- performance acceptance;
- production embedding/LSP approval;
- k3s cross-host acceptance;
- full ACE production readiness.

DBC-13 still requires the selected provider stack plus retained restart, rename/delete/untracked, scale/performance and exact-release evidence.

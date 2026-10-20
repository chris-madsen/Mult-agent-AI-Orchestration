# C-A / W04 real Qdrant interrupted-writer evidence — 2026-10-20

## Disposition

**PASS for the bounded C-A/W04 real-provider scenario.** This evidence does not
approve DBC-13, provider selection, performance budgets, k3s behavior, or ACE
production readiness.

The run uses the production `dist/bin/ace-mcp.js` entrypoint, a pinned local
Qdrant, the configured FastEmbed worker, Tree-sitter structural extraction and
the direct TypeScript Language Service. It exercises two independent
`ACE_STATE_DIR` roots against one explicit shared collection.

## Reproducibility

| Item | Value |
| --- | --- |
| Evidence source commit | `07b143b1cef5fddb79d1c59be52f904c0c097762` |
| Fixture commit | `7cf7de9be119ef2cc783761efd35a14014348fb9` |
| Qdrant | `qdrant/1.19.2` |
| Qdrant image digest | `sha256:b7b0444c4c351c970b98e90a6f89c2ee4287c65b44e52b4cb503fa5b2aa927ad` |
| Qdrant endpoint class | local loopback |
| Node | `v24.15.0` |
| Embedding runtime | `fastembed-worker.sh` |
| Structural runtime | `tree-sitter-structural.py` |
| Host kernel | `6.2.6-76060206-generic` |

Raw evidence is retained in:

- [`qdrant-snapshot-crash-2026-10-20.json`](./qdrant-snapshot-crash-2026-10-20.json)
- [`reader-provider-trace`](./qdrant-snapshot-crash-2026-10-20-reader-provider-trace.jsonl)
- [`crashed-writer-provider-trace`](./qdrant-snapshot-crash-2026-10-20-crashed-writer-provider-trace.jsonl)
- [`restarted-writer-provider-trace`](./qdrant-snapshot-crash-2026-10-20-restarted-writer-provider-trace.jsonl)

SHA-256:

```text
197ed18ea52f86c4b2f18f3ef2236a40c76cf3727f61d267493b66b843d8d456  qdrant-snapshot-crash-2026-10-20.json
2b2eb8d58ba79562229f2a14c4897a990287ae63f2f7dd714db76dbd4bb31b27  qdrant-snapshot-crash-2026-10-20-reader-provider-trace.jsonl
11b56417ca9b1c48cf744a38947f8907ffb00ef149d92179d5ec94e5294c23f4  qdrant-snapshot-crash-2026-10-20-crashed-writer-provider-trace.jsonl
398f74c8d22c8b42f2f5b9758cf57257203614f77d356393ccc7ddb1b54d8520  qdrant-snapshot-crash-2026-10-20-restarted-writer-provider-trace.jsonl
```

## Checks

All eight checks in the retained evidence are `PASS`:

1. reader S1 is available before the writer starts;
2. writer B is killed after Qdrant verification and before publication;
3. the interrupted manifest remains `building`, not published;
4. reader A still serves the unchanged S1 symbol after the crash;
5. the restarted writer publishes S2;
6. reader A still serves the unchanged S1 symbol after S2 publication;
7. the two state roots have distinct persistent state-owner IDs;
8. shared explicit-collection automatic GC is skipped.

The worktree changes only `src/mutable.ts` between the S1 and S2 lifecycle
steps. Therefore the reader response after the mutation is intentionally
`complete: false`: the unchanged `src/stable.ts` evidence remains current and
source-digest identical, while the changed source is not silently reported as
covered by S1. This is truthful partial coverage, not a failed lifecycle
assertion and not a production-complete response.

The crash point is guarded by both `ACE_ENABLE_TEST_FAILPOINTS=true` and
`ACE_TEST_FAILPOINT=after_qdrant_verify_before_publish`. The test uses an
explicit collection and skips automatic deletion because the collection is
shared across independent state roots.

## Negative and residual evidence

An earlier runner revision incorrectly required every reader response to have
`complete: true`; that assertion failed on the expected partial response after
`src/mutable.ts` changed. The runner now allows and asserts the typed partial
result for the two post-mutation reader checks. No production runtime behavior
was changed by that correction.

This is a bounded real-provider lifecycle result. Remaining evidence includes
repeated scale/lifecycle runs, concurrent normal reader/writer coverage,
crash/restart behavior under the target k3s/storage semantics, and the other
provider and agent-level gates listed by the unified ACE plan.

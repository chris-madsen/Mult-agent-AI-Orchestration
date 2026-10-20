# W04 real embedding timeout refresh

**Date:** 2026-10-20  
**Status:** real-provider bounded timeout evidence; request cancellation during
startup remains open.

## Run

```bash
ACE_QDRANT_URL=http://127.0.0.1:6333 npm run test:real-qdrant-timeout -- \
  --output artifacts/w04/qdrant-timeout-cf458cc.json
```

Source commit: `cf458ccb7c253dbc502f91596b2ea6d296380bec`. The executable used
the real local Qdrant `1.19.2` path and real FastEmbed worker. The test-only
delay/timeout settings were double-opted in with
`ACE_ENABLE_TEST_FAILPOINTS=true`; no private data or cloud provider was used.

## Observed result

The worker was deliberately delayed for 1000 ms while ACE used a 100 ms
embedding timeout. The worker timed out, the MCP process remained available for
`ace_workspace_status`, and both `code_retrieval` and `unified_context` stayed
`not_ready` with reason `embedding_provider_unavailable`. A subsequent
`ace_context` returned typed `NOT_READY`; it did not return evidence or claim
provider success. Local fallback was disabled.

The retained machine-readable receipt is
`benchmarks/reports/qdrant-embedding-timeout-cf458cc.json`.

## Boundary

This closes only real worker timeout handling during pre-serve provider
initialization. ACE currently initializes the index before `serveStdio`, so an
MCP request cancellation cannot reach that startup operation. The receipt
therefore records `cancellationMeasured=false`; request cancellation remains a
separate architecture task, not a silently inferred PASS. This run also does
not approve production resource budgets, Graphiti/OAuth/Vertex, Harbor, 5×
token savings or Graphiti local-only claims.

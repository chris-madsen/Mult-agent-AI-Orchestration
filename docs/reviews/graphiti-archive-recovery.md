# Graphiti + FalkorDB archive/recovery evidence

**Date:** 2026-10-19
**Status:** local database readiness verified; Graphiti extraction/recovery not production-ready.

## Verified

- FalkorDB `v4.20.4-alpine` is running in the single-node k3s `ace` namespace
  with a 5Gi local-path PVC.
- `redis-cli ping` returned `PONG`.
- `GRAPH.QUERY ace_healthcheck "RETURN 1"` returned `1`.
- `graphiti_core` `FalkorDriver.health_check()` returned
  `graphiti-falkor-driver-health-ok`.
- Existing immutable archive contract tests pass idempotent replay, tombstone
  deletion and shared-content retention across independent archive instances.
- `npm run test:memory-process` passed with five separate worker processes:
  appending JSONL preserved the original episode ID, concurrent imports acquired
  the cross-process archive lock, and deleting one episode left the shared
  digest byte-identical for the survivor.

## Not yet claimed

Graphiti extraction requires an approved inference/embedding configuration. No
OpenAI key, fabricated key, Ollama dependency or unapproved cloud dialogue route
was introduced. Therefore no `add_memory` extraction, temporal fact recall,
forced-termination recovery or graph purge is reported as passed. The process
gate proves archive locking and shared-byte safety only; it does not prove a
Graphiti projection or purge. The next real test must use a permitted local
inference runtime, preserve the original archive, and record projection/recovery
receipts separately from database health.

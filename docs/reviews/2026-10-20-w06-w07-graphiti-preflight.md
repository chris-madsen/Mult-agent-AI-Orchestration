# W06–W07 Graphiti preflight

**Date:** 2026-10-20  
**Commit:** `4b8273b`  
**Status:** BLOCKED — no real upstream runtime available

## Completed evidence

- The pinned Amplifier/Graphiti composition remains loopback-only and
  secret-free.
- `structured_output_mode: json_object` and loopback FalkorDB configuration
  are present in the committed config.
- Existing local archive, projection outbox, purge, tombstone, crash-recovery
  and backup/restore contract suites pass. They are functional-core and
  local-storage evidence, not proof of a real Graphiti provider.
- The preflight ran with the exact pinned refs and retained its safe receipt in
  `benchmarks/reports/amplifier-graphiti-preflight-4b8273b.json`.

## Blockers

- No official Graphiti checkout or executable is configured for the pinned
  commit.
- No local FalkorDB is reachable.
- The pinned Graphiti MCP does not expose the required local
  Sentence-Transformers embedder or a selectable local BGE/Sentence-Transformers
  reranker. Adding a shim, cloud fallback, or mock would violate the plan.
- Amplifier face OAuth/model catalog is not live in this runner, so the
  requested model entitlement and structured extraction cannot be proven.

The receipt deliberately keeps `realGraphitiLifecycle`, `graphitiLocalOnly`
and `tokenSavings5x` false. No private Codex session, bearer token, or source
bytes were sent to any provider.

## Required unblock

Install or mount the exact pinned upstream Graphiti MCP and its official
dependencies, start local FalkorDB, complete the loopback Amplifier OAuth
device login, and verify the requested model in the live catalog. Only then
run the committed synthetic lifecycle fixture and record projection, temporal
search, purge, SIGKILL/reconcile and backup/restore receipts.

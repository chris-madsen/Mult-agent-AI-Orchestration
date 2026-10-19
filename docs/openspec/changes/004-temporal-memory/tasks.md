# Implementation Tasks — Immutable original Codex session archive and Graphiti temporal memory

**State: PARTIALLY IMPLEMENTED.** Immutable local archive, idempotent projection
ledger, decision FSM, temporal search and deletion tombstones are implemented.
Codex session-export and Graphiti adapters remain controlled exceptions; see
`docs/docs/spikes/SPIKE-TEMPORAL-MEMORY.md`.

## Feasibility and security
- [x] SPIKE a supported local Codex history export interface and exact source/cursor identity; the adapter preserves JSONL bytes and SHA-256 cursors, while an official cross-version exporter remains unclaimed.
- [x] Choose local-first Graphiti/FalkorDB storage backend and verify its cloud/data-residency boundary. **Experimental local inference selection is delegated to Codex/agents and is not an owner-blocking decision**; production promotion remains evidence-gated.
- [x] Document Graphiti local backend lifecycle and deletion capabilities before deployment; `FalkorDriver.health_check()` is verified and Graphiti `remove_episode`/index lifecycle is recorded, with no production episode projection enabled.

## Archives and projection
- [x] Implement source episode canonicalization boundary, content-addressed immutable storage and checksum on import.
- [x] Implement idempotent ingestion by episode identity, exclusive writes and replay detection.
- [x] Implement projection receipt keyed by `(episode, extractor version)` with incomplete status on extractor failure.
- [x] Implement typed Graphiti projection/purge boundary with policy and auth checks; backend lifecycle/deletion verification remains open.

## Decisions and retrieval
- [x] Implement DecisionRecord FSM with explicit confirmation, supersession, rejection and temporal intervals.
- [x] Implement provider-independent temporal memory search with original episode pointers and conflict warnings.
- [x] Implement authorized local archive deletion with tombstone and derived-projection purge boundary.
- [x] Expose typed MCP memory provider port; gateway remains `not_ready` when no provider is injected.

## Validation
- [x] Test conflicting extracted claims, unsupported source importer and duplicate projection replay.
- [x] Fault tests: missing archive, digest mismatch, tombstoned read and extractor retry state.
- [x] Recall a real historical Codex history record with dated, digest-backed byte citations; local smoke imported 4 episodes and found 1 hit without exporting raw dialogue. Official cross-version replay remains unclaimed.
- [ ] Harbor long-horizon paired benchmark including memory extraction and indexing cost.

## Exit criteria

- [x] Provider-independent scenarios have executable test coverage or documented controlled exception.
- [x] Provider/security failure tests pass; no fabricated historical messages or accepted decisions.
- [x] Domain and adapter dependencies comply with module boundaries and accepted ADRs.
- [ ] Review the change with the owner; do not archive until exporter/Graphiti decisions are approved.

---

## Mandatory outstanding production gates (2026-10-18)

**Architecture correction:** archive and Graphiti readiness must not be claimed from source-independent tests alone; stable event IDs across JSONL append and shared-digest deletion are unfulfilled critical contracts.
- [x] Test DBC-10 JSONL append/replay identity with real archive persistence.
- [ ] Complete DBC-11 end-to-end: shared-content archive deletion is covered, but real Graphiti derived-index purge/tombstone behavior still needs provider evidence.
- [ ] Verify supported full-session Codex transcript capture and **real local Graphiti projection** before declaring temporal memory production-ready; Graphiti must preserve original episode time via `reference_time`.
- [ ] Validate the memory-admission filter against an unfiltered baseline on a frozen bilingual durable-memory holdout; cost savings do not justify silently losing required historical recall.

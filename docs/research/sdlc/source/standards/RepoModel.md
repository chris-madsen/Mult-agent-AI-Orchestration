# RepoModel — persistence mapping without losing semantics

## Purpose
Keep storage-specific representation separate from domain entities and public protocol responses.

## Directions
- Domain → storage: transform only fields intentionally persisted; preserve IDs, versions and nullable semantics.
- Storage → domain: validate untrusted/legacy data; restore domain invariants; report corruption explicitly.
- Public response: map from application output, not from raw persistence document.
- For search indexes: retrieved candidates remain indexed copies; verify against authoritative source.

## Mapping checklist
1. Identify authoritative record/source for each field.
2. Define nullable, absent, empty and default semantics.
3. Define version/schema field and old-document migration behavior.
4. Define serialization for date/time and units.
5. Preserve IDs and stable ordering where contract requires.
6. Avoid redundant derived fields when source truth exists; if cached include source revision.
7. Validate foreign keys/references and tombstones.
8. Define optimistic concurrency, CAS or fencing for contested writes.
9. Define atomicity across multiple stores; document outbox/compensation.
10. Avoid destructive migration before backup/evidence.
11. Define crash/restart and retry idempotency.
12. Protect against orphaned shared blobs and double deletion.
13. Do not treat unknown provider errors as successful empty search.
14. Re-check source/current revision when serving exact code context.
15. Define data retention, purge and privacy scope.
16. Use precise typed adapter errors.
17. Test restored objects with domain invariants.
18. Separate mock storage success from real provider semantics.

## ACE specifics
- Qdrant collection payload is a search representation, not source-of-truth code.
- Graphiti is derived temporal memory; original session archives are immutable and citable.
- Vertex contains authorized documentation only.
- A lost tombstone or false freshness claim is correctness failure, not just cache lag.

## Required tests
Roundtrip with optional/null fields; unknown legacy version; malformed persisted value; simultaneous writers; crash after provider accept before durable receipt; restored timestamps; deletion/replay; multi-store divergence; actual provider test where claimed.

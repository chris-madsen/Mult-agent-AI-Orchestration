# Domain Model Test — invariants before adapters

## Scope
Tests for pure domain behavior without network, disk, provider SDK or runtime bootstrapping unless that *is* the domain invariant.

## Core matrix
1. Valid entity/value construction.
2. Missing required field.
3. Invalid scalar/enum/format.
4. Disallowed state transition.
5. Permitted transition with expected new state.
6. Failed transition leaves previous state unchanged.
7. Equality/identity rules.
8. Boundary values and units.
9. Default versus explicit value semantics.
10. Serialization/restoration without loss of invariant.
11. Concurrency conflicts where domain coordinates state.
12. Idempotent repeated command where contract requires.
13. Unknown future schema/enum variants.
14. Corrupted data rejected rather than "fixed" silently.
15. Error has stable domain type and safe diagnostics.
16. No hidden provider side effects in domain function.

## Fixture style
- Name the behavior and expected state, not method internals.
- Keep fixture constructors explicit and deterministic.
- Use parameterized cases where values differ but invariant is same.
- Do not mock pure values; mock only an external port when testing application behavior.
- Do not fake security principal from untrusted caller payload.
- Avoid asserting private implementation layout where public behavior is enough.

## ACE examples
- Context result cannot be COMPLETE without required sources verified.
- A memory claim cannot silently become owner-approved.
- Stale source digest cannot be labeled CURRENT.
- Policy denial is different from empty successful retrieval.

## Evidence
Each test states precondition, action, expected output and forbidden side effect. Unit tests demonstrate domain correctness only, not provider wiring or production readiness.

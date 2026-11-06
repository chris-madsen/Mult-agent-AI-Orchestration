# Architecture Layers — ownership, direction, composition

## Objective
Make architectural boundaries observable in code. The name of a folder does not prove a layer is clean; imports, runtime composition and data ownership do.

## Layer contract
- **Domain:** readonly ADTs, pure domain transitions and deterministic invariants. Does not depend on Effect I/O, HTTP, SDKs, databases or model providers.
- **Application:** Effect use cases, authorization orchestration, typed ports, CAS/transaction/cancellation and failure semantics. Depends on domain and abstract services.
- **Adapters:** generated TypeSpec wire DTO, runtime schema and explicit domain ADT mappings, vendor SDK adapters. Implements ports; no hidden domain policy.
- **Composition:** wiring, configuration, process lifecycle, health, deployment and dependency injection. May reference all layers solely to compose them.
- **Test infrastructure:** fixtures and doubles never masquerade as real providers or production-selected adapters.

## Mandatory review rules
1. Identify entrypoint and actual runtime wiring.
2. Assign every changed file to an owner/layer.
3. Trace import direction; enforce domain inward independence.
4. No protocol DTO in domain types.
5. No business rule buried in transport/controller.
6. No persistence query from domain entity.
7. No unapproved global/singleton lifecycle hiding provider choice.
8. Explicit port/adapter boundary for external provider.
9. Avoid leaking vendor errors as public application errors.
10. Confirm concurrency/state ownership at the correct layer.
11. Verify real composition selects new implementation and no dead alternate path remains.
12. Reuse installed mature SDK/protocol clients; no shadow implementation.
13. Keep DDD bounded context logical; no per-context microservice default.
14. Separate normal domain failure from infrastructure outage.
15. Prevent circular dependencies and split oversized ownership when measured.
16. For cross-context calls document contracts and source of truth.
17. For ACE preserve TypeScript + Effect modular monolith.
18. Do not introduce Rust/Python/native code without a documented boundary/need.

## ACE examples
Allowed: HTTP/MCP adapter calls application service through typed Effect dependencies. Qdrant adapter returns indexed candidates with revision/provenance to application. Application verifies source freshness before reporting complete.

Rejected: domain entity constructs Qdrant client; adapter overwrites verified source status to COMPLETE on timeout; MCP transport becomes a new general-purpose LLM gateway.

## Verification
- Source import and call graph.
- Typecheck and architecture/contract tests.
- Runtime composition check.
- Negative test against forbidden fallback.
- Documentation decision ID and exact SHA.

## Review report
| Changed path | Layer | Inbound/outbound deps | Violated rule | Source reference | Fix |
Verdict PASS/FAIL/UNKNOWN with evidence; undefined owner is UNKNOWN.

## Functional / contract-first mapping

Domain: pure state and transitions. Application: Effect shell. Adapter: generated TypeSpec-compatible protocol boundary plus runtime decoding and domain mapping. Composition: provider and authorization wiring. New generator output is not assumed available until installed, pinned and tested. Event Storming informs consistency boundaries, not deployment services.

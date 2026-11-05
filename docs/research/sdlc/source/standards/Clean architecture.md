# Clean Architecture — dependency inversion with practical boundaries

## Purpose
Preserve domain and application testability without reflexive interface/abstraction proliferation. A port exists where an external contract or independently replaceable policy justifies it.

## Rules
1. Map **use case → domain service/entity → port → adapter** per behavior.
2. Define ports in application/domain-facing contracts, not alongside vendor SDK types.
3. Keep external JSON, HTTP, MCP, SQL, Qdrant and provider DTOs at the adapter boundary.
4. Do input validation at trust boundary and domain validation at invariant boundary.
5. Errors are explicit, typed, and mapped to public outcomes once.
6. Application owns transaction/compensation orchestration, not low-level format.
7. Adapters own protocol conversions, timeout/cancellation and vendor-specific semantics.
8. Preserve referential integrity and domain invariants during persistence round-trip.
9. Config is injected; no hidden unscoped environmental access in pure core.
10. No shared mutable state without explicitly owned concurrency semantics.
11. Side-effecting commands need authorization at execution, not only at orchestration.
12. Do not multiply wrapper layers when direct maintained library adapter is enough.
13. No callback that silently bypasses required authorization or policy checks.
14. Do not turn every value object into a service.
15. Keep application boundaries versioned if external agents depend on them.
16. Cross-boundary logs should preserve correlation without leaking confidential payloads.
17. Distinguish optional degraded behavior from mandatory completeness.
18. Keep source-of-truth hierarchy explicit.

## ACE application
- Effect services and layers express dependency injection.
- Qdrant supplies retrieval candidates, not authoritative code identity.
- AST/LSP proofs retain exact parsed and semantic evidence.
- MCP is explicit tool plane; Bifrost projected context is a distinct boundary.
- Graphiti represents derived memory and never owner-approved truth by default.

## Red flags
- HTTP transport inside domain.
- Provider SDK DTO returned as canonical use-case type.
- UI/agent prompt contains security policy instead of enforced application boundary.
- Generic catch returns empty success after provider outage.
- Adapter owns a second independent index or cache with no ADR.
- An interface is justified solely by the desire to mock one function.

## Review and proof
Show an inbound and outbound dependency trace; explain why each interface exists; run typecheck and contract tests; call out untested provider wiring. Return PASS/FAIL/UNKNOWN.

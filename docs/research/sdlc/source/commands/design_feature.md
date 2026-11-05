# Design Feature — architecture and behavior contract

## Mission

Turn a user-approved feature request into a testable technical design **before writing implementation code**. This is a design task, not an invitation to refactor unrelated systems. Reuse factual research and accepted architecture. Deliver structured artifacts that an implementer can follow without silently making new architecture decisions.

## Inputs
- User goal, use cases, constraints and explicit non-goals.
- Exact repository revision, branch and affected service/bounded context.
- Applicable approved ADRs, OpenSpec requirements, root AGENTS.md and existing test strategy.
- The current implementation and any verified research report.
- Environment restrictions, privacy/data residency, external provider policy and acceptance budget.

## Phase 0: situational awareness
1. Read project rules and accepted decisions.
2. Read task or feature description in its entirety.
3. Identify affected bounded contexts and public interfaces; do not assume everything under one package is one context.
4. Enumerate external systems, state stores and authorization boundaries.
5. Inspect present runtime construction and initialization, not only conceptual diagrams.
6. Check existing related features, utilities, maintained third-party implementations and project conventions.
7. Identify conflicting existing plans/ADRs and avoid choosing a losing authority.
8. Check existing OpenSpec change for the feature; extend it rather than creating a duplicate spec.
9. Identify which design output documents are necessary.
10. If major choices are owner-controlled, list questions and propose alternatives rather than defaulting silently.

## Is deeper research needed?
Perform focused Research when:
- affected module behavior or wiring is not understood;
- the feature touches unfamiliar code;
- similar behavior may already exist in reusable form;
- dependencies/integration points are unclear;
- schema, authorization, concurrency or persisted state may change;
- failing assumptions would make the plan expensive or unsafe.

Skip a fresh report when existing research is current, evidence-backed and complete for this change. Even then verify the source SHA and relevant paths.

### Architecture discovery
For each affected context:
- find executable entry points and routing;
- locate service / Effect provider construction / DI;
- list domain entities, value objects, invariants and state transitions;
- trace use cases, ports, adapters, persistence and external gateways;
- identify existing contract and error-taxonomy conventions;
- inspect auth middleware, roles and identity propagation;
- inspect configuration and secrets provenance;
- find actual integration tests and provider acceptance;
- identify reuse opportunities from maintained libraries and previously accepted ACE implementations.

## Feature context / conditional artifact matrix

| Condition | Artifact or design section |
|---|---|
| Any nontrivial feature | Architecture + behavior + decisions + testing + index |
| New/change domain event | Events, payload versioning and consumers |
| Persisted entity/store mapping changes | Storage/repo-model, migration/compatibility |
| Public HTTP/MCP/projection interface changes | API contract, schemas, errors and compatibility |
| Cross-process/async workflow | Sequence and state machine, retries, dedup, checkpoint semantics |
| Personal/private data egress | Classification, authorization, destination and audit |
| Provider selection / build-vs-buy | Decision record with alternatives and measurable selection |
| No effect on a category | N/A in index; do not invent a blank 50-line file |

## Artifact 01 — Architecture

Describe:
1. AS-IS boundary and the reason it cannot satisfy the new requirement;
2. TO-BE boundary with responsibilities, owners and dependency direction;
3. C4 context view when actors and external systems change;
4. container/deployment view when processes/services change;
5. component view for changes within ACE modular monolith;
6. typed ports/interfaces and Effect services;
7. failure isolation, resource ownership, data classification, trust boundaries;
8. initialization and runtime composition;
9. integration with existing components and migration path;
10. why existing maintained library or provider primitive is reused, or evidence for a new owner.

Every view must distinguish observed current wiring from proposed wiring. If no boundary changes, one concise component diagram is enough.

## Artifact 02 — Behavior

For each user-visible scenario specify:
- actor and authorized precondition;
- command/query input schema and validation;
- state before; sequence of actions; state afterward;
- exact success result and postcondition;
- failure classes with typed outcomes and no false success;
- retries, cancellation, timing, idempotency or dedup where relevant;
- partial failure, rollback or compensation;
- provider degradation and source freshness;
- forbidden side effects and permissions;
- telemetry/evidence needed for acceptance.

Use sequence diagrams for multi-boundary flows and DFD for data movement, especially private source egress. A diagram that only covers success is insufficient where side effects or provider failures are involved.

## Artifact 03 — Decisions

For each unresolved material choice:
- Decision ID and owner.
- Context and constraint.
- At least two concrete feasible alternatives (including reuse).
- Proposed option and measurable rationale.
- Tradeoffs in reliability, complexity, cost, security and operations.
- Consequences, migration and rollback.
- Evidence required before production promotion.
- Status: PROPOSED / ACCEPTED / BLOCKED / SUPERSEDED.

Do not silently amend an accepted ADR. Use a proposed ADR for a material architecture change; ordinary implementation choices may stay in the OpenSpec design.

## Artifact 04 — Testing

Create an executable requirement-to-test matrix:
| AC / invariant | level | test owner / fixture | positive | negative | real-provider obligation |
|---|---|---|---|---|---|
| AC-01 | unit/contract/E2E | path or planned test | assertion | error branch | pass/fail/not run |

Require:
1. Testable preconditions and postconditions.
2. Domain invariants and invalid state checks.
3. Explicit typed error/cancellation/timeout handling.
4. Authentication, authorization and data-policy negative tests.
5. Concurrency/restart/failpoint where behavior requires it.
6. Protocol/API backward compatibility.
7. Real provider and agent E2E proof *when the integration is claimed*.
8. Deterministic fixtures and expected results, no unbounded sleep.
9. Scope-aware test selection avoiding redundant tests.
10. Source SHA and environment identity for acceptance reports.

## Conditional artifact 05 — Events
Only if events are introduced or changed: producer, trigger, versioned schema, consumer, delivery guarantee, ordering, replay, idempotency, failure recovery, correlation and privacy.

## Conditional artifact 06 — RepoModel / persistence
Only if persisted data changes: domain vs storage DTO mapping, optional/null distinctions, serialization, schema evolution, transaction boundaries, compatibility with historic records, constraints, backup/restore or tombstones, round-trip tests. For ACE, keep original archive immutable.

## Conditional artifact 07 — Feature standards
Link project policies relevant to this feature. Do not create a competing set of Go rules or reprint AGENTS.md. Record where TS/Effect, DDD, type safety, libraries and provider selection constrain the design.

## Conditional artifact 08 — API contract
For changed external interface specify:
- route/tool/event identity and method;
- request/response schema, versions and content type;
- authentication/authorization and data-class restrictions;
- validation matrix, error codes and retry semantics;
- idempotency behavior;
- clients/backward compatibility/migration;
- source citations and logs proving wiring;
- contract test owners.

### ACE boundary caveats
A newly defined MCP tool is **not** automatic model-bound context injection. A tested Bifrost connector is not proof of live provider egress. Vertex RAG is project-document-only under explicit authorization; it is not a default destination for private code.

## Integration / consistency pass

Before presenting design:
1. Every requirement has one responsible owner and one observable acceptance path.
2. Every new component appears in a real proposed wiring path, not just a C4 box.
3. No domain layer imports a transport/provider adapter.
4. No duplicate bespoke parser, transport, cache or scheduler replaces a maintained upstream without approval.
5. Negative and error sequences cover each consequential external boundary.
6. Privacy/egress and authorization are traced end-to-end.
7. Storage mapping and API contracts preserve necessary backwards compatibility.
8. Alternatives and material owner decisions are explicit.
9. Testing distinguishes mocks, actual providers and agent task success.
10. Full design remains achievable in independently verifiable slices.
11. Existing OpenSpec/ADR remain canonical and are linked, not duplicated.
12. Any unproven hypothesis remains labeled, never reported as an achieved metric.

## Output organization

For a large standalone feature, produce an index and sections analogous to:
```text
feature/
  README.md
  01-architecture.md
  02-behavior.md
  03-decisions.md
  04-testing.md
  05-events.md        (conditional)
  06-repo-model.md    (conditional)
  07-standards.md     (conditional)
  08-api-contract.md (conditional)
```

**In ACE**: reuse existing `openspec/changes/<id>/design.md`, specs, tasks and proposed ADR. The sections above may live in *one* design document until its size/complexity justifies extraction. No parallel version with conflicting requirements.

## Handoff gate
- [ ] Current facts source-cited.
- [ ] Proposed design separate from facts.
- [ ] Every user-visible behavior has testable acceptance.
- [ ] Error/rollback/cancel/privacy paths covered.
- [ ] All conditional sections considered and N/A justified.
- [ ] Material decisions explicitly approved or blocked.
- [ ] No implementation begun by this command.
- [ ] A planner can identify exact module/file owners and dependencies.

Return index paths, important alternatives, unresolved decisions, testing obligations and a clear state: READY-FOR-PLAN / NEEDS-DECISION / NEEDS-RESEARCH.

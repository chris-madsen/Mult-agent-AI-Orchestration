# Design Feature — reconstructed command

> **Source reconstruction — not an original file.** Original path: `.claude/commands/design_feature.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5602); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5603); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5604); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5605); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5606). Confidence: **partial body and conditional document table visible**. 
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Observed source sequence
- Read project standards for the affected backend code.
- Decide whether research is required: unknown module boundaries, unfamiliar implementation, potential reuse, unclear integration points.
- The original can spawn 2–3 parallel codebase-researcher tasks; consolidate evidence in `docs/{feature}/research.md` with date, service and feature.
- Research starting points include DI/container, init chain, routing, domain entities/use cases, repository and adapters.
- Explicitly inspect external clients, domain events, shared types, database collections and auth/middleware.
- Required design package: `01-architecture.md`, `02-behavior.md`, `03-decisions.md`, `04-testing.md`, `README.md`. Optional: `05-events.md` if domain events, `06-repo-model.md` if persisted backend entities, `07-standards.md` for backend, `08-api-contract.md` if REST API.

## Reconstructed completion — executable design protocol
**Input:** approved user request, current code evidence, applicable architecture decisions, regulatory/security constraints.

1. Establish context and read source-of-truth policies. Decide if new research is justified; don't regenerate it when verified and fresh.
2. Present affected bounded contexts, owners, DI/entrypoint wiring, interfaces, invariants and data destinations. Cite code in research.
3. Write 01 Architecture: C4 diagrams at necessary granularity, components, dependencies and failure boundaries. Diagrams must match current or explicitly proposed wiring.
4. Write 02 Behavior: state transitions, DFD and sequence including **negative/error paths**, retries, authorization and rollback.
5. Write 03 Decisions: each material alternative, tradeoff, chosen path and unanswered decision. Never silently settle a choice reserved for the owner.
6. Write 04 Testing: requirement→test mapping, unit/contract/integration/E2E acceptance and failure injection where relevant.
7. Conditionally write domain events, persistence mapping, feature-specific standards and API contracts, with an explicit N/A rationale when skipped.
8. Write README: scope, non-goals, acceptance criteria, doc index, status and unresolved owner decisions.
9. Present the design to the human before implementation, including risk and unknown evidence. Do not treat generated diagrams or prose as observed runtime facts.
10. Once approved, hand off to the plan stage with cross references from invariants to deliverables.

**Gate:** every requirement is represented in expected behavior and test coverage; design decisions are traceable; no unresolved material decision auto-approved.

## Detailed reconstructed design gate (not visible verbatim)

### Stage 0: understand the environment
Verify task statement and working revision; read governing project decisions and existing architecture. Decide whether new research is needed using the screenshot criteria: unfamiliar modules, unclear integration points, reusable prior implementation or unknown wiring.

### Stage 1: discover concrete integration boundaries
In the Go example, the screenshot enumerates the service container and init chain, routers/auth middleware, domain entity/use case and repository/adapter layers, external gateway clients, event bus, shared contracts and MongoDB collections. **When applying to ACE**, replace this with actual TS/Effect runtime composition, MCP/Bifrost/Hermes boundaries, Qdrant/Graphiti/Vertex only where relevant. Do not copy Go paths into ACE.

Write a research memo: init order, routing and authorization, entity patterns, repository mapping, error-code ranges, next free error codes only if actually present, existing reusable patterns, key files and unanswered questions. Link every current-system claim to real source.

### Stage 2: design as multiple views
- 01 Architecture: C4 context/container/component, ports, dependency direction, data ownership, DI and chosen integration seam.
- 02 Behavior: separate data flows and sequences for happy, failure, retries/cleanup paths; include concurrency implications.
- 03 Decisions: tradeoffs, rejected options, rationale, open owner decisions, risks and mitigations.
- 04 Testing: coverage mapping for requirements, invariants and error codes; test fixture, type and oracle.
- 05 Events only if domain events; 06 repository model only if persistence change; 07 feature standards only if backend; 08 API contract only if public endpoint/protocol change.
- README: objective, scope, references, open decisions and design acceptance.

### Design readiness checklist
[ ] Every planned public behavior has a failure path.
[ ] Each material choice has rationale, owner and rejected alternatives.
[ ] Each design requirement maps to a verification item; any mocked boundary is identified.
[ ] Sensitive data egress and authorization paths are covered.
[ ] No downstream implementation begins on unresolved accepted-ADR conflicts.
[ ] Design is reviewed by human at the required risk tier.

This is a reconstructed **continuation** of a partial screenshot, not a claim about exact source text.

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

# Adaptive Context Engine (ACE) — DDD Architecture + OpenSpec SDD Blueprint

**Version:** evolving implementation · **Updated:** 2026-10-24 · **Status:** active TypeScript + Effect implementation with real local retrieval, memory, provider and acceptance slices; full unified production approval is still evidence-gated.

## Runtime status

**Current architecture (ADR-016/017, 2026-10-24):** LangGraph or another external orchestrator owns agent coordination. For agents supporting configurable LLM endpoints, Bifrost is the **selected future model-bound context delivery path** through a thin Go connector and versioned ACE projection API; implementation and provider-wire conformance are **not yet complete**. Hermes already has a native ContextEngine bridge. MCP remains a separate existing **explicit tool-call interface**, not mandatory for context injection.

The statement that this repository contains only a blueprint is obsolete. The current implementation includes the official MCP runtime for explicit tools/expansion, the direct Hermes ContextEngine integration bridge for request-time ACE context projection, exact workspace/artifact reads, Qdrant retrieval, embedding-worker and ast-grep provider identity checks, generic LSP confirmation through the configured language server (TypeScript by default), temporal-memory archive/Graphiti integration, deterministic source routing, Vertex/Harbor acceptance tooling, request-time workspace reconciliation, snapshot/retry recovery, and evidence-backed release gates.

Use [`operations/ace-configuration-and-readiness-matrix.md`](operations/ace-configuration-and-readiness-matrix.md) for the authoritative runtime/configuration meanings. A provider flag enables a code path; it does not by itself constitute production approval.

Use [`plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md`](plans/2026-10-21-cursor-like-hybrid-context-completion-plan.md) for the current retrieval/context architecture work, [`docs/references/ADR-014-hybrid-context-engine.md`](docs/references/ADR-014-hybrid-context-engine.md) for the accepted target architecture, and [`plans/unified-production-release-preflight.md`](plans/unified-production-release-preflight.md) for the full release evidence contract.

## Deliverables

**Architecture (Markdown)**

1. [`01-strategic-ddd.md`](docs/architecture/01-strategic-ddd.md) — bounded contexts, ubiquitous language, strategic subdomains, context map and relationships.
2. [`02-event-storming.md`](docs/architecture/02-event-storming.md) — domain commands/events/policies/read models, hot spots and end-to-end flows.
3. [`03-tactical-ddd.md`](docs/architecture/03-tactical-ddd.md) — entities, value objects, aggregates, domain services, invariant boundaries.
4. [`04-fsm-workflows.md`](docs/architecture/04-fsm-workflows.md) — FSM and example workflows with success/error/race paths.
5. [`05-contracts-and-deployment.md`](docs/architecture/05-contracts-and-deployment.md) — proposed tool contracts, domain ports, external adapter boundaries and local Kubernetes topology.
6. [`06-traceability-and-review.md`](docs/architecture/06-traceability-and-review.md) — mapping PRD/ADR → OpenSpec → acceptance, unresolved design decisions.

**Agent SDD implementation packet**

- [`../openspec/README.md`](../openspec/README.md) — execution order and OpenSpec CLI guidance.
- [`../openspec/config.yaml`](../openspec/config.yaml) — project context for coding agent.
- [`../openspec/changes/`](../openspec/changes) — active spec-driven changes, including `007-hybrid-context-engine`, with `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md`.
- [`AGENTS.md`](AGENTS.md) — agent safety, scope and implementation policy.
- [`docs/references/`](docs/references) — source PRD and ADR decision record, including Accepted ADR-014 for the hybrid context target.

## DDD modular monolith, not microservices

DDD boundaries reflect different meanings/invariants; they do not automatically determine Deployments/StatefulSets. Primary code is one modular monolith in already installed local Kubernetes; Qdrant/Graphiti backends may be stateful dependencies, Vertex is managed external docs RAG, Harbor is an external benchmark runner.

## FSM usage

FSM is deliberately used for `ContextRequest`, `IndexGeneration`, `SessionArchive`, `DecisionRecord`, `BenchmarkRun`. Routing/scoring are policies, not FSM. No requirement to adopt a particular FSM library.

## Decision hierarchy

1. Explicit later user decisions / newly accepted ADR.
2. Existing accepted ADRs, including ADR-006 (no arbitrary truncation) and ADR-014 (hybrid context target).
3. PRD v1.0 for product intent, interpreted through later ADR clarifications.
4. Proposed DDD architecture and OpenSpec implementation blueprints (revisable).

The package does not claim to have achieved a 5× reduction. Several real integration paths now exist, but full production promotion remains conditional on retained provider/deployment/benchmark evidence and explicit owner approval for the exact release commit.

## Authoritative sources for SDD / components

- OpenSpec official: https://github.com/Fission-AI/OpenSpec
- OpenSpec format: https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md
- OpenSpec spec-driven schema: https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml
- Harbor: https://github.com/harbor-framework/harbor
- Source PRD and ADRs are in `docs/references/`.

# Adaptive Context Engine (ACE) — DDD Architecture + OpenSpec SDD Blueprint

**Version:** v1.0 proposed · **Date:** 2026-10-17 · **Status:** Architecture draft and implementation specifications; no code implemented in this package.

## Deliverables

**Architecture (Markdown)**

1. [`01-strategic-ddd.md`](docs/architecture/01-strategic-ddd.md) — bounded contexts, ubiquitous language, strategic subdomains, context map and relationships.
2. [`02-event-storming.md`](docs/architecture/02-event-storming.md) — domain commands/events/policies/read models, hot spots and end-to-end flows.
3. [`03-tactical-ddd.md`](docs/architecture/03-tactical-ddd.md) — entities, value objects, aggregates, domain services, invariant boundaries.
4. [`04-fsm-workflows.md`](docs/architecture/04-fsm-workflows.md) — FSM and example workflows with success/error/race paths.
5. [`05-contracts-and-deployment.md`](docs/architecture/05-contracts-and-deployment.md) — proposed tool contracts, domain ports, external adapter boundaries and local Kubernetes topology.
6. [`06-traceability-and-review.md`](docs/architecture/06-traceability-and-review.md) — mapping PRD/ADR → OpenSpec → acceptance, unresolved design decisions.

**Agent SDD implementation packet**

- [`openspec/README.md`](openspec/README.md) — execution order and OpenSpec CLI guidance.
- [`openspec/config.yaml`](openspec/config.yaml) — project context for coding agent.
- [`openspec/changes/`](openspec/changes) — five changes with `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md`.
- [`AGENTS.md`](AGENTS.md) — agent safety, scope and implementation policy.
- [`docs/references/`](docs/references) — exact copies of the source PRD v1.0 and ADR-000…010, included for portability.

## DDD modular monolith, not microservices

DDD boundaries reflect different meanings/invariants; they do not automatically determine Deployments/StatefulSets. Primary code is one modular monolith in already installed local Kubernetes; Qdrant/Graphiti backends may be stateful dependencies, Vertex is managed external docs RAG, Harbor is an external benchmark runner.

## FSM usage

FSM is deliberately used for `ContextRequest`, `IndexGeneration`, `SessionArchive`, `DecisionRecord`, `BenchmarkRun`. Routing/scoring are policies, not FSM. No requirement to adopt a particular FSM library.

## Decision hierarchy

1. Explicit later user decisions / newly accepted ADR.
2. Existing signed-off ADR-000…010 (especially ADR-006 no arbitrary truncation).
3. PRD v1.0 for product intent, interpreted through later ADR clarifications.
4. Proposed DDD architecture and OpenSpec implementation blueprints (revisable).

The package does not claim to have achieved a 5× reduction or validated production integrations. Those are product hypotheses and future experiments.

## Authoritative sources for SDD / components

- OpenSpec official: https://github.com/Fission-AI/OpenSpec
- OpenSpec format: https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md
- OpenSpec spec-driven schema: https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml
- Harbor: https://github.com/harbor-framework/harbor
- Source PRD and ADRs are in `docs/references/`.

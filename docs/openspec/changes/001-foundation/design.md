# Design — Foundation: workspace truth, safety and MCP boundary

**Status:** Proposed technical design. Decisions already accepted are listed in ADR; names, DTOs and interfaces in DDD documents are recommendations to be reviewed.

## Context

A context harness cannot supply trustworthy evidence without workspace identity, access control, source freshness and a stable agent-facing boundary.

Read `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md` plus PRD/ADRs before implementation.

## Goals / Non-Goals

**Goals:** Safe local workspace identity, explicit policy gate, modular monolith skeleton, read-only MCP tool contracts.

**Non-goals:** RAG/AST implementation, Jev, Graphiti extraction, complete observability, agent-written patch interception.

## Decisions / Design Approach

1. Use DDD modules inside one local Kubernetes modular monolith, not a microservice per context.
2. Keep domain ports independent of concrete storage and transport adapters; encode errors as typed domain failures.
3. Workspace working-tree version combines HEAD, monotonic observation and content digests; never equate HEAD with current file contents.
4. Access control runs before outbound I/O; technical outage can degrade, policy deny cannot be bypassed.
5. Kubernetes working-tree access and TypeScript implementation language remain design spikes until authorized.

## DDD ownership and boundaries

- Respect aggregate boundaries and commands/events in `docs/architecture/02-event-storming.md` and `03-tactical-ddd.md`.
- Keep provider clients out of domain packages; integration uses ports/adapters; domain events are past-tense facts, not implicit background jobs.
- Use typed `unavailable/stale/unknown/denied` results; do not manufacture successful data.
- Use one modular-monolith logical MCP facade; any external Qdrant/Graphiti/Vertex/Harbor process is an explicit supporting dependency, not a new domain microservice.

## Security, Consistency and Failure Modes

- Re-evaluate cloud data policies at transmission time. No secret material in logs or prompts.
- Maintain workspace/source digest provenance and clear missing-source status.
- Long created code and originals remain byte-identical; support exact retrieval without arbitrary fixed token caps.
- Technical outage: truthful degraded behavior; policy deny: fail-closed with safe log.
- Crash/retry paths must be idempotent where events or external IO can repeat.

## Verification / Rollout

- Implement the scenarios in `specs/*/spec.md` as automated tests and observe the additional gates in `tasks.md`.
- Every adapter integration must pin/version-check its provider's API and license; unsupported feature => explicit `unsupported`, not stubbed success.
- For retrieval/memory changes, run comparable Harbor tests and preserve unsuccessful runs.
- Review output evidence and complete tasks before applying/archiving this change.

## Open Questions / Blocking Spikes

Refer to `docs/architecture/05-contracts-and-deployment.md` §11. Do not silently settle undecided providers, transports or mount patterns. Escalate material choices to the owner through a new ADR.

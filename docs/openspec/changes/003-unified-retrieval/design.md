# Design — Unified context retrieval with Qdrant, AST/LSP and Vertex documentation

**Status:** Proposed technical design. Decisions already accepted are listed in ADR; names, DTOs and interfaces in DDD documents are recommendations to be reviewed.

## Context

The central PRD hypothesis requires all three knowledge classes in one accurate, freshness-aware context path, rather than independent unrelated MCP servers.

Read `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md` plus PRD/ADRs before implementation.

## Goals / Non-Goals

**Goals:** One-call retrieval, current code facts, static relation accuracy, time and token efficiency on real tasks.

**Non-goals:** Write own AST parser, implement full static-analysis engine, default cloud code upload, enforce arbitrary token cap, always run expensive retrieval engines.

## Decisions / Design Approach

1. Qdrant is the code candidate store; Vertex is documentation retrieval; neither substitutes for AST/LSP truth.
2. Candidates point to current source; exact snippets are materialized from a revision-checked file, never trusted solely from a stale vector payload.
3. Run explicit spikes for Tree-sitter language support, Serena vs direct TypeScript semantics, local vs cloud embedding policy/quality and Kubernetes path access.
4. Simple rule-based retrieval path is initial production routing; Jev production deployment is not authorized.
5. ContextBundle is evidence-centric and offers exact expansion, including 2000+ line code artifacts.

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

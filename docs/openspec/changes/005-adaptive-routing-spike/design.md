# Design — Evidence-based Jev strategy selector experiment

**Status:** Proposed technical design. Decisions already accepted are listed in ADR; names, DTOs and interfaces in DDD documents are recommendations to be reviewed.

## Context

The PRD hypothesizes adaptive source choice can reduce repeated and unnecessary retrieval, but extra model calls might be a net regression.

Read `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md` plus PRD/ADRs before implementation.

## Goals / Non-Goals

**Goals:** Measure route correctness, wrong-source omissions, end-to-end token/cost and elapsed time.

**Non-goals:** Automatically enable Jev in production, route every request through a cloud classifier, assume typed output means correct route.

## Decisions / Design Approach

1. Jev only spike; no production enablement without new Accepted ADR or a documented approval gate.
2. Allow multi-source plans; abstain and safe local fallback on ambiguity or policy exclusion.
3. Compare on frozen holdout and include Jev token/cost/latency. Denied cloud transmission takes precedence over route-selection result.

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

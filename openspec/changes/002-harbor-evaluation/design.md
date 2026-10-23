# Design — Harbor evaluation and provider-reported token ledger

**Status:** Proposed technical design. Decisions already accepted are listed in ADR; names, DTOs and interfaces in DDD documents are recommendations to be reviewed.

## Context

Token improvement must be established against a strong current Hermes baseline before large retrieval engineering investments. The underlying GPT model is routed through Hermes `openai-codex` with the same ChatGPT/Codex OAuth identity in both paired arms.

Read `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md` plus PRD/ADRs before implementation.

## Goals / Non-Goals

**Goals:** Real end-to-end measurements, quality protection, frozen tasks, reproducible reports.

**Non-goals:** Observability dashboards, artificial token estimation, 5x claims before controlled holdout.

## Decisions / Design Approach

1. Harbor is external evaluation infrastructure, not a required Kubernetes workload.
2. Hermes is the primary agent runtime for the current feedback loop. Pin Hermes version, `openai-codex` model/reasoning, Harbor version, source/task/image identity and the custom OAuth adapter digest.
3. ACE is registered through Hermes native MCP only on the ACE-optional arm; baseline and ACE-optional otherwise remain matched.
4. Usage exported by Hermes/Harbor/provider is authoritative when present; unavailable token/cache/cost fields remain explicit `unknown` rather than estimated.
5. Distinguish cumulative usage from per-turn delta and dedupe by source-event identity.
6. Retain aborted/failed attempts in population; report matched-success separately from all-run pass rate.

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


## Owner decision update — 2026-10-23

ADR-015 supersedes the Codex-specific primary-agent choice for this change. Harbor remains the orchestrator, but the current feedback loop uses Hermes with native MCP and the `openai-codex` ChatGPT OAuth route. Historical Codex evidence remains historical and does not close Hermes E2E gates.

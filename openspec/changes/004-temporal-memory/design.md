# Design — Immutable original Codex session archive and Graphiti temporal memory

**Status:** Proposed technical design. Decisions already accepted are listed in ADR; names, DTOs and interfaces in DDD documents are recommendations to be reviewed.

## Context

Compaction and prompt caching cannot reliably recover an architectural discussion from prior Codex sessions; summaries alone lose alternatives and decision rationale.

Read `docs/architecture/01-strategic-ddd.md` through `05-contracts-and-deployment.md` plus PRD/ADRs before implementation.

## Goals / Non-Goals

**Goals:** Accurate two-week recall, accepted/superseded states, zero hallucinated original citations, privacy controls.

**Non-goals:** Import every chat provider immediately, equate extracted summary with user approval, send raw sessions to external model without opt-in.

## Decisions / Design Approach

1. Raw episodes are authoritative and immutable by normal update operations; explicit privacy deletion is honored.
2. Graphiti is a derived temporal projection, not the only truth source. Extraction failures leave original data recoverable.
3. Approval is explicitly user-driven; keep Proposed, Accepted, Rejected and Superseded differentiated.
4. First importer is Codex, other agents/chats are interfaces only until separately scoped.

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

## Owner local-first confirmation — 2026-10-19

Graphiti + FalkorDB are selected as local-first temporal memory infrastructure. Raw Codex dialogues, derived claims and extraction payloads stay local without a separate cloud opt-in; FalkorDB locality alone does **not** prove inference locality. Codex should identify and run a real supported local Graphiti extraction/inference backend (without forcing Ollama), verify outbound traffic, projection completion vs pending state, temporal search with original citations, crash/restart reconciliation, shared-blob deletion and graph purge. Do not claim production E2E if that local backend cannot run.
\n## Admission-control constraint — 2026-10-19\n\nAdmission before Graphiti is an optimization, not an authority boundary. Raw originals are archived first regardless of projection admission. Projection/extractor failures must not stop later originals from being archived and must be represented as incomplete derived state. Any default admission filter must demonstrate non-inferior durable-memory recall against an unfiltered local baseline on representative English/Russian fixtures before production promotion. Graphiti `reference_time` must use the original episode occurrence timestamp, not import time.\n
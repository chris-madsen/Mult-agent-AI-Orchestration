# Proposal — Immutable original Codex session archive and Graphiti temporal memory

## Why

Compaction and prompt caching cannot reliably recover an architectural discussion from prior Codex sessions; summaries alone lose alternatives and decision rationale.

## What Changes

Implement Codex session importer, exact original archive, idempotent Graphiti extraction/projection, explicit approval of decisions, temporal search with original citations and deletion propagation.

## Capabilities

### New Capabilities

- `project-memory` — Original Codex archive and Graphiti temporal recall.

## Impact

- **Domain contexts:** consult `docs/architecture/01-strategic-ddd.md`; references ADR-001…010 as applicable.
- **Dependencies:** previous numbered changes must be reviewed and completed first.
- **Non-goals:** Import every chat provider immediately, equate extracted summary with user approval, send raw sessions to external model without opt-in.
- **Risk:** provider contracts/versions, security and provenance must be tested before asserting production behavior.
- **Acceptance:** normative scenarios in `specs/*/spec.md` plus `tasks.md`; no performance claim without measured evaluation.

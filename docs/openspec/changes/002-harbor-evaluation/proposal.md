# Proposal — Harbor evaluation and provider-reported token ledger

## Why

Token improvement must be established against a strong current Codex baseline before large retrieval engineering investments.

## What Changes

Integrate Harbor test runner, isolated fixtures, quality grader and Codex usage normalization. Produce auditable baseline report and initial Serena comparison.

## Capabilities

### New Capabilities

- `agent-benchmarking` — Harbor baseline, complete usage and comparative evidence.

## Impact

- **Domain contexts:** consult `docs/architecture/01-strategic-ddd.md`; references ADR-001…010 as applicable.
- **Dependencies:** previous numbered changes must be reviewed and completed first.
- **Non-goals:** Observability dashboards, artificial token estimation, 5x claims before controlled holdout.
- **Risk:** provider contracts/versions, security and provenance must be tested before asserting production behavior.
- **Acceptance:** normative scenarios in `specs/*/spec.md` plus `tasks.md`; no performance claim without measured evaluation.

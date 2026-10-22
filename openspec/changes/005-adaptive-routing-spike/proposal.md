# Proposal — Evidence-based Jev strategy selector experiment

## Why

The PRD hypothesizes adaptive source choice can reduce repeated and unnecessary retrieval, but extra model calls might be a net regression.

## What Changes

Compare deterministic route selection to optional Jev typed routing under the same frozen Harbor tasks; retain a safe rule-based default.

## Capabilities

### New Capabilities

- `adaptive-routing` — Measured strategy-selection experiment, Jev not preapproved.

## Impact

- **Domain contexts:** consult `docs/architecture/01-strategic-ddd.md`; references ADR-001…010 as applicable.
- **Dependencies:** previous numbered changes must be reviewed and completed first.
- **Non-goals:** Automatically enable Jev in production, route every request through a cloud classifier, assume typed output means correct route.
- **Risk:** provider contracts/versions, security and provenance must be tested before asserting production behavior.
- **Acceptance:** normative scenarios in `specs/*/spec.md` plus `tasks.md`; no performance claim without measured evaluation.

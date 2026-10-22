# Proposal — Foundation: workspace truth, safety and MCP boundary

## Why

A context harness cannot supply trustworthy evidence without workspace identity, access control, source freshness and a stable agent-facing boundary.

## What Changes

Create domain contracts for workspace registration and verified reads; enforce data policy; expose a single Codex-compatible MCP façade with lossless expansion and safe errors. No user-code writing.

## Capabilities

### New Capabilities

- `workspace-identity` — Registry, working-tree identity and freshness boundaries.
- `security-policy` — Cloud opt-in, deny behavior and safe failure records.
- `mcp-gateway` — Single logical MCP surface and lossless artifact boundary.

## Impact

- **Domain contexts:** consult `docs/architecture/01-strategic-ddd.md`; references ADR-001…010 as applicable.
- **Dependencies:** none (starting capability).
- **Non-goals:** RAG/AST implementation, Jev, Graphiti extraction, complete observability, agent-written patch interception.
- **Risk:** provider contracts/versions, security and provenance must be tested before asserting production behavior.
- **Acceptance:** normative scenarios in `specs/*/spec.md` plus `tasks.md`; no performance claim without measured evaluation.

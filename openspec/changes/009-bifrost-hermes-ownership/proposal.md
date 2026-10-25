# Proposal: Bifrost projection and Hermes compaction ownership

## Why
ADR-017 makes Bifrost the planned model-bound delivery plane for configurable-endpoint agents, while ADR-016 keeps Hermes's native ContextEngine as an independent request-local path. The gateway cannot prove that Hermes did not compact its transcript before ingress, and a successful gateway receipt cannot prove exclusive ACE ownership.

This change adds the missing normative contracts for the versioned ACE Gateway Projection boundary and the authenticated Hermes host-ownership evidence required before strict ACE attribution.

## Scope

- Versioned `ace.gateway.v1` request/response identities and strict decision union.
- Authenticated host attestation and one authoritative projection owner.
- Compaction event/epoch evidence with `unknown` distinct from zero.
- Request-local projection, protected-group preservation, retry/attempt binding and redacted receipts.
- OpenSpec scenarios for strict blocking, replay, provider-managed history, manual compaction and durable transcript append-only behavior.

## Out of scope

- A Bifrost fork or second TypeScript reverse proxy.
- Production provider selection, final provider-wire certification, real Hermes E2E and Harbor acceptance.
- Rewriting Hermes durable history or selecting a universal compaction policy.
- Marking existing native Hermes or MCP tool integrations obsolete.

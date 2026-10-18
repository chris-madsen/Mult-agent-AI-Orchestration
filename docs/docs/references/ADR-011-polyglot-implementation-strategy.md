# ADR-011 — TypeScript + Effect core with measured Rust extraction

**Status:** Accepted for the initial ACE implementation · **Date:** 2026-10-17
**Related source:** `docs/docs/conversations/ChatGPT-Обсуждение RAG AST LSP-20261017-2228.md`
**Related ADRs:** ADR-001, ADR-004, ADR-008

## Context

ACE is a modular monolith, not a collection of language-specific services. The
implementation still needs a language boundary that supports typed domain models,
explicit effects, MCP integration and safe filesystem orchestration. The supplied
language discussion proposes TypeScript + Effect for the core, Rust only where
measurements justify native performance, and Python for existing Graphiti/Harbor
components.

## Decision

1. The ACE core and modular-monolith runtime use **TypeScript + Effect**.
2. Runtime boundaries use Effect Schema and explicit domain ADTs. Provider DTOs do
   not cross into the domain model.
3. Rust is an approved **candidate implementation language**, not a required
   dependency. A Rust component may be introduced only after a CPU, memory, latency
   or native-analysis benchmark demonstrates a material benefit.
4. Python remains an external integration boundary for existing Graphiti and Harbor
   components; it is not added to the ACE core merely for language symmetry.
5. This language split does not imply separate deployments. The default deployment
   remains one TypeScript modular monolith with explicitly justified dependencies.

## Consequences

- Foundation and orchestration can be implemented and tested without native builds.
- Effect provides typed composition for asynchronous ports while pure domain
  functions remain independently testable.
- Any future TS/Rust boundary requires a versioned contract, benchmark evidence,
  failure isolation decision and a reviewable build path.
- Native code is deliberately deferred until the code-intelligence workload exists;
  no Rust placeholder is presented as production capability.

## Verification

- `npm run check` validates strict TypeScript contracts.
- `npm run lint` applies Airbnb TypeScript rules with zero warnings.
- `cargo fmt --check` and `cargo clippy -- -D warnings` guard the benchmark-gated Rust extension point.
- `npm test` validates domain boundaries and failure paths.
- Future Rust extraction requires a separate spike with latency/RSS/correctness
  comparisons against the TypeScript or existing-tool baseline.

## Reconsideration

Revisit this decision if TypeScript/Effect cannot meet measured orchestration or
filesystem requirements, or if a narrowly scoped Rust implementation demonstrates a
material end-to-end improvement without compromising portability and failure safety.

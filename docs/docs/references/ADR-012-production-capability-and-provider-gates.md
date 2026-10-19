# ADR-012 — Production capability gates, build-versus-buy and Meyer contracts

**Status: Accepted — explicit owner approval on 2026-10-19.** Original proposal: 2026-10-18. This acceptance policy does not silently supersede earlier approved technical provider decisions.

## Context

The repository implements validated DDD ports, a regex symbol index, deterministic hash vectors and a hand-rolled MCP transport. Real Qdrant/AST/LSP/Vertex/Graphiti adapters exist, but the running MCP bootstrap does not compose them. This is accurately labelled partial in parts of the README, yet the project's core capability cannot be accepted from port-level checkboxes and smoke tests.

## Accepted decision

1. A **capability** is production-complete only when the runtime entrypoint composes approved real dependencies and a reproducible end-to-end test proves actual behavior and failure handling.
2. Default to **selected mature implementations** (official MCP TypeScript SDK, Tree-sitter/ast-grep, Qdrant plus measured genuine embeddings, approved language service, Graphiti, Harbor). Custom algorithms/protocol implementations need a new owner-approved ADR with benchmarking/conformance justification.
3. Deterministic lexical fallback and test-double embeddings can remain as **explicitly named, opt-in/degraded/fixture-only paths**, not undisclosed production substitutes.
4. **Architecture fitness tests** are contractual: Meyer preconditions/postconditions/invariants/frame and exceptional postconditions at the actual MCP/agent boundary; see `docs/architecture/07-architecture-fitness-contracts.md`.
5. Use **vertical slices and gates** before claiming coverage. "Documented controlled exception" is `not-ready`, never a passed production exit condition. Report `port-designed`, `adapter-implemented`, `real-provider-tested`, `agent-E2E-passed`, `benchmark-evaluated` separately.
6. Benchmark claims require attribution: actual ACE calls and real retrieval-needed tests, unchanged strong Codex baseline, quality gate, total tokens/external costs. Zero ACE calls or forced trivial smoke is ineligible evidence of ACE savings.

## Consequences

More honest incomplete status and earlier integration failures; less false confidence from green unit tests; stronger real-provider coupling and testing infrastructure. No microservice proliferation is authorized. This ADR adds an acceptance policy; the underlying DDD/context boundaries remain unchanged.

## Alternatives considered

- Keep port-level checklist with manually reviewed limitations: too easy to mistake interface completion for runtime value.
- Rewrite the full harness immediately: unjustified until we have a correct integrated vertical slice.
- Replace mature providers with simplified in-house engines: only defensible after explicit measured benefit and ADR; not chosen.

## Verification and adoption

Owner explicitly approved all six acceptance rules on 2026-10-19; implement `006-production-retrieval-vertical-slice` and required E2E/fitness tests before accepting retrieval as done. Existing docs that say "partially implemented" remain historically true. Acceptance of this ADR does not establish that runtime, E2E or 5× acceptance has passed.

## Owner sign-off checklist (approved — 2026-10-19)

This ADR is a **policy for accepting capabilities**, not a claim that any real provider is ready or that the 5× goal has been reached. Review compatibility with Accepted ADR-001/003/004/005/006/007/009 and explicitly confirm:

- [x] Real runtime composition and provider E2E required before production-complete.
- [x] Proven mature engines and maintained official protocols preferred to bespoke substitutes.
- [x] Explicit experimental/fallback/test-only status; mocks cannot pass production gates.
- [x] Meyer preconditions, postconditions, invariants, frame conditions and exceptional postconditions must be observable.
- [x] Separate design/adapter/provider-E2E/agent-E2E/benchmark/owner states; no unchecked blocker passed by "controlled exception".
- [x] Fair Harbor paired test with source/provenance and total tokens/cost; never claim 5× without evidence.

**Approval was explicitly granted by the owner on 2026-10-19 in the architecture decision conversation.** No unit test or implementation PR could substitute for that approval. **Testing is not blocked by this approval:** Codex may immediately install candidate providers, compare LSPs, use public/synthetic fixtures, and run exploratory Harbor. Only final production promotion requires the owner decision and evidence.

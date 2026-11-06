# Functional Domain Modeling — DDD without rich mutable entities

**Status:** selected ACE engineering style under the project owner decision dated 2026-11-05. This is a *modeling practice*, not a requirement to port all existing code immediately. See [functional DDD + TypeSpec architecture](../../ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md).

## Intent

DDD's responsibilities, ubiquitous language, bounded contexts and invariants survive the choice of programming paradigm. Default to **immutable domain data, discriminated unions and pure functions** instead of mutable class-based entities and OO domain services. A module of pure domain functions is behavior-rich even when its data values are passive.

## Rule catalog

- **FP-01: Immutable state.** Domain data is readonly; no state change through public setters, mutable global maps or provider callbacks. Preserve structured sharing if an efficient immutable representation warrants it.
- **FP-02: ADTs for alternatives.** Model success, denial, partial/unavailable, stale, not-ready and error as explicit tagged cases when semantically distinct. Don't replace typed cases with booleans or catch-all \`string\`.
- **FP-03: Pure transitions.** Domain rule is \`(State, Command) → Result<Transition, DomainError>\` or a state-independent pure function. It receives time/IDs/observations as explicit validated input when relevant.
- **FP-04: Cohesive behavior.** Functions live in the bounded context that owns the invariant. External handlers should not duplicate those rules.
- **FP-05: Functional core, Effect shell.** I/O, cancellation, concurrency limits, transactions, telemetry, network and process lifecycle live in Effect application/adapters. The domain never directly imports Qdrant, Vertex, MCP SDK or Bifrost client DTOs.
- **FP-06: Aggregate as consistency boundary.** Owner for atomic state transition and version/CAS, not a mandatory mutable root-object instance.
- **FP-07: No fake illegal-state safety.** Types are compile-time guarantees only for checked code; validate untrusted JSON/wire/persisted values at runtime. Branded IDs must be constructed through validated factories.
- **FP-08: Exact errors and exhaustive matches.** A new ADT variant must trigger affected exhaustive switch/match/compiler/test updates. Use the project's pinned Effect release and idioms rather than modern APIs from an unverified version.
- **FP-09: Domain events are outcomes, not mandatory event sourcing.** Event Storming identifies meaningful past-tense facts. Emitting/storing events requires a real consumer/audit or durable workflow need, not ceremonial boilerplate.
- **FP-10: No dispersed giant service.** Reject a controller that knows all invariants, a monolithic \`RepositoryService\` or cross-context access to another module's internal storage.
- **FP-11: Explicit context boundaries.** Across contexts use coarse contracts/messages/ports and ownership. Avoid one bounded context importing another's private state and helper functions.
- **FP-12: State recovery.** Replay/cancellation behavior must preserve idempotency and not turn unavailable into successful empty data; persist with CAS/outbox if required, not a universal transaction/event framework.

## How to derive model from Event Storming

1. Collect events, commands, actors, policies, hot spots and external dependencies.
2. Name bounded contexts by ownership of language and decisions, not package count.
3. Identify commands with consistency constraints. Their owning boundaries are candidate aggregates even with readonly state.
4. List states and forbidden transitions; represent them as ADT where it meaningfully eliminates illegal cases.
5. Write \`decide\` or \`transition\` functions with explicit input, next state, error and domain-event outputs.
6. Distinguish process-level policies involving external I/O from pure domain decisions.
7. Provide transition tables and example/property tests, not just UML class diagrams.
8. Map outcomes to TypeSpec *wire* unions through explicit adapters; domain types are not generated from external DTOs by default.
9. Check cross-context subscriptions, eventual consistency and permission at actual I/O boundaries.
10. Avoid generating an Event Sourcing store as an implicit consequence.

## Illustrative functional core / shell (pseudocode signatures)

\`\`\`ts
type Result<A, E> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Error"; readonly error: E };

type DomainState = Readonly<{
  version: number;
  status: "draft" | "published";
}>;

type DomainCommand = Readonly<{
  _tag: "Publish";
  expectedVersion: number;
}>;

type DomainError =
  | Readonly<{ _tag: "VersionConflict" }>
  | Readonly<{ _tag: "AlreadyPublished" }>;

type DomainEvent = Readonly<{ _tag: "Published"; version: number }>;

type Transition = Readonly<{
  state: DomainState;
  events: readonly DomainEvent[];
}>;

const publish = (
  state: DomainState,
  cmd: DomainCommand,
): Result<Transition, DomainError> => {
  if (cmd.expectedVersion !== state.version) {
    return { _tag: "Error", error: { _tag: "VersionConflict" } };
  }
  if (state.status === "published") {
    return { _tag: "Error", error: { _tag: "AlreadyPublished" } };
  }
  const next = { ...state, status: "published" as const, version: state.version + 1 };
  return {
    _tag: "Ok",
    value: { state: next, events: [{ _tag: "Published", version: next.version }] },
  };
};
\`\`\`

Here the application still must compare-and-swap durable version and atomically record any required outbox. The pure function does **not** itself solve concurrent writes or provider failure.

## Testing
- Property tests for invariant preservation under valid transitions.
- Table cases for invalid commands, missing/unknown ADT variants and stale versions.
- Determinism: same state/command gives same result.
- No mutation of input (frozen fixture if useful).
- Correct domain events/none on refusal.
- Proper roundtrip to/from external TypeSpec-generated wire representation, including unknown version/schema input.
- State recovery and idempotency in separate application/provider integration tests.

## Reviewer output
Which bounded context owns the invariant? Which pure function enforces it? Does the compiler force all ADT branches? Who validates real input? Where are I/O and effectful authorization? What evidence proves persistence/replay? Record exact path:line and PASS/FAIL/UNKNOWN.

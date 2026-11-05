# ACE architecture policy — Event Storming + functional DDD/ADT + TypeSpec

**Decision source:** explicit project-owner preference recorded on 2026-11-05.
**Status:** chosen target architecture for future SDLC work; TypeSpec toolchain and generated artifacts are **not implemented** by this document. No accepted ADR/OpenSpec may be silently contradicted: reconcile any conflict in an owner-reviewed ADR/spec change.
**Applies to:** ACE's TypeScript + Effect modular monolith, its public tool/gateway protocols and related development process.

## Non-negotiable choices

1. **Event Storming is the first-class discovery/design method** for T2 domain behavior and a focused method for T1 when useful. Event Storming informs commands, events, policy, invariants, ownership and eventual consistency; it is not necessarily Event Sourcing.
2. **DDD remains strategic**: subdomains, bounded contexts, context map, ubiquitous language, anti-corruption layers, consistency boundaries and responsibilities.
3. **Domain implementation defaults to functional style**: immutable data/ADT, algebraic operations as pure functions, total pattern matching, explicit errors and state transitions. Do **not** mandate mutable OO entities, inheritance, aggregate methods, DI in domain objects or class-oriented Domain Service patterns.
4. **TypeSpec is the selected contract-first language for public machine interfaces**, where it can express the contract. Start with the ACE Gateway Projection HTTP interface and explicitly versioned JSON protocol shapes. Evaluate mapping to MCP tool input/output JSON Schema and non-HTTP native bridge without assuming TypeSpec has a first-party MCP emitter.
5. **OpenSpec is the source of behavior/requirements and acceptance tests; TypeSpec is the source of protocol shapes, operations and wire constraints; accepted ADRs give architectural rationale.** They must remain mutually consistent without duplicating an entire schema in prose.
6. **Effect owns application composition, capabilities, cancellation and I/O**, while domain policy/state transitions remain pure and testable. Use the existing Effect version/API; don't invent an upgrade or force every computation into an Effect.
7. **One bounded context ≠ one service**. Keep the existing TS+Effect modular monolith and explicit in-process module APIs; remote boundaries are justified operationally, not generated from a sticky note.
8. **Do not confuse a domain event with durable publish/subscribe or full Event Sourcing.** Most events can be transition outcomes with an optional outbox at an actual durability boundary.

## Why "anemic" data need not imply an anemic domain

The OO anti-pattern is a passive DTO with all business rules scattered across controllers and services, causing weak invariants and duplicated rules. Functional modeling deliberately uses passive, immutable **data** plus a cohesive **domain function module**. Behavior is concentrated in the *bounded context's functions* and validated at its boundary, not distributed across transport handlers.

**Prefer:** \`Workspace\` / \`IndexGeneration\` as readonly data, \`observeWorkspace\` / \`publishIndexGeneration\` as pure rules/transition functions. A consistency boundary still exists even if there is no JavaScript \`class Workspace\`.

**Reject:** giant \`RepositoryService\` with dozens of unrelated methods; god-object \`DomainService\`; handlers manipulating domain flags and writing directly to Qdrant; cross-context code reaching inside another context's persistence; duplicated validation logic in HTTP, MCP and native bridge.

**Identity, aggregate and ADT are different concerns:**
- Entity identity: \`workspaceId\`/revision can identify data through time, even if data is immutable.
- Aggregate boundary: which transition must be coherent under CAS/transaction and whose invariants must be protected. It does **not** require a mutable root object.
- ADT: shape of state, commands, results and allowed alternatives. A valid discriminant supports exhaustive pattern matching.
- Domain function: \`transition(state, command) → Result<{nextState, events}, DomainError>\` or \`decide(state, command) → domain events\` + \`evolve(state, event)\`; use the simpler non-event-sourced variant unless event replay is a real requirement.
- Effect use case: load snapshot → authorize at execution boundary → call pure domain rule → commit with version/CAS → publish durable event/outbox if needed → map result to public wire type.

## End-to-end modeling sequence

### 1. Event Storming
Big Picture → Process Level → Design Level for a bounded scenario:
- Actors and externally meaningful business outcomes (past-tense events).
- Commands, initiators and authorization/policies.
- Consistency boundaries/aggregates; commands rejected when invariants fail.
- Hot spots: concurrent writes, partial provider failures, policy changes, stale source, outbox/retry.
- External system boundaries and read projections.
- Ubiquitous language and explicit unresolved product decisions.

Event artifacts are **proposal-level until accepted**, not proof that a production event bus exists.

### 2. Functional domain contract
For each bounded context specify:
- Readonly ADT for state (sum types) and lawful transitions.
- Command types and required preconditions.
- Invariant, postcondition, exceptional/denial outcome and frame conditions.
- Event(s) produced only when domain fact matters, not a log line for every function.
- Pure function signatures and representative transition table.
- Storage consistency mechanism where real state is persisted.
- Anticorruption mapping to another bounded context (never share raw provider DTO).
- Security: pure policy can return \`Allow | Deny\`, but the **external transmission** checks currently authorized policy at send time.

### 3. TypeSpec protocol
Start from accepted external operations and data transfer, then define \`typespec/\` source using pinned TypeSpec compiler/emitters. Source material from OpenSpec/ADR determines semantics, not implementation inertia.

Proposed progression:
\`\`\`text
OpenSpec scenarios/acceptance & owner ADR
      │
      ├─ Event Storming → bounded contexts → ADT + pure functions
      │
      └─ TypeSpec public contract (wire only)
             ├─ @typespec/openapi3 → generated OpenAPI (HTTP)
             ├─ @typespec/json-schema → generated JSON Schema (JSON messages)
             ├─ appropriate TS client/server types (generation method pinned)
             └─ explicit MCP tool schema conversion where needed
                   └─ official MCP SDK (no handwritten competing transport)

Adapter decodes generated validated wire schema
  → maps to domain ADT (no raw DTO leakage)
  → Effect application use case → pure domain rules
  → typed outcome → adapter encodes public result
\`\`\`

**Important:** OpenSpec and TypeSpec should not independently specify conflicting field names/enums. OpenSpec references the named TypeSpec contract and states behavior/invariants. TypeSpec owns the wire shape but cannot capture all authorization, replay, source freshness or task-quality invariants.

### 4. Implementation in TS/Effect
- Domain: \`types.ts\` (readonly ADTs), \`decide.ts\`/\`transition.ts\`, \`invariants.ts\`, \`events.ts\` if needed; no provider network calls or \`Effect.runPromise\` here.
- Application: \`useCases/*.ts\` built from Effect services/typed ports; orchestrates providers, transactions, cancellation, policy at I/O time.
- Adapters: TypeSpec-generated contract DTOs, runtime validation and exact mapping at MCP/HTTP/JSONL boundary; Qdrant/LSP/Graphiti/Vertex providers.
- Composition: layers/config/entrypoints; decides actual selected providers.
- Tests: property and example-based pure domain tests, protocol roundtrip and compatibility, real provider/agent E2E for claimed wiring.
Keep actual existing ACE directories where possible; this is a logical ownership map, not a prescribed mass file move.

### Illustrative TypeScript ADT (design example; adapt to actual repo)
\`\`\`ts
type Verified = Readonly<{
  _tag: "Verified";
  revision: string;
  sourceDigest: string;
}>;
type Missing = Readonly<{ _tag: "Missing"; path: string }>;
type Unavailable = Readonly<{ _tag: "Unavailable"; provider: string }>;
type PolicyDenied = Readonly<{ _tag: "PolicyDenied"; reason: string }>;

type EvidenceState = Verified | Missing | Unavailable | PolicyDenied;

type Completion =
  | Readonly<{ _tag: "Complete"; verifiedRevision: string }>
  | Readonly<{ _tag: "Partial"; reasons: readonly string[] }>
  | Readonly<{ _tag: "Denied"; reason: string }>;

const decideCompletion = (
  required: readonly EvidenceState[],
): Completion => {
  const denied = required.find(
    (e): e is PolicyDenied => e._tag === "PolicyDenied",
  );
  if (denied) return { _tag: "Denied", reason: denied.reason };
  const incomplete = required.filter((e) => e._tag !== "Verified");
  if (incomplete.length > 0) {
    return { _tag: "Partial", reasons: incomplete.map((e) => e._tag) };
  }
  // Single common revision is an illustrative simplification: the real ACE
  // must prove the full authorized working-tree source identity and coverage.
  return { _tag: "Complete", verifiedRevision: "source-verified" };
};
\`\`\`
The last line is **not** a production freshness algorithm; it intentionally calls out the obligation to compute actual common source evidence. Prefer a separate \`VerifiedCoverage\` opaque/validated input if the actual ACE invariant requires it. Do not paste this sample into runtime unchanged.

For exhaustive matching prefer established TypeScript \`never\` checks, a maintained matching library, or an Effect API available in the project's pinned version. ADTs do not by themselves validate untrusted JSON at runtime.

## Detailed source-of-truth matrix

| Question | Canonical owner | Generated / derived |
|---|---|---|
| What outcome must occur and what error is acceptable? | OpenSpec acceptance | tests, plan |
| Why is a bounded context or gateway needed? | accepted ADR/context map | architecture diagram |
| Which external route/tool/field/version exists? | TypeSpec (after migration) | OpenAPI, JSON Schema, wire DTO/types |
| What invariants and legal transitions hold? | domain ADT/pure functions + accepted specs | property/transition tests |
| Which dependency/provider does runtime choose? | Effect composition and deployed config | build/runtime receipts |
| Is a source current and policy-authorized? | source truth + policy domain and send-time checks | context bundle |
| Was a task truly completed and cost reduced? | observed real-provider/agent benchmarks | reports |

## TypeSpec adoption in ACE: actual implementation plan, not an implicit tool installation

**Slice TS-0 — inventory and decision**
- Survey existing MCP input/output schema authors, gateway projection schema, Hermes JSONL and public error/enum names.
- Identify which fields are actual **public/versioned** contracts and which are private domain types or test-only.
- Record existing clients/compat obligations and the baseline wire JSON for roundtrip.
- Confirm generated toolchain licenses and pinned versions; select a single owner per public schema.
- Ensure TypeSpec does not overwrite accepted contracts merely because a generator emits different serialization.

**Slice TS-1 — tiny vertical proof**
- Create a minimal pinned \`typespec/\` definition for **one** existing public ACE Gateway Projection operation.
- Compile to OpenAPI/JSON Schema with official emitters; validate generated output and tracked artifacts strategy.
- Generate or reliably derive TypeScript boundary types; validate runtime JSON input.
- Implement explicit mapper to an existing domain ADT (do not expose generated DTO as domain type).
- Test accepted input, invalid input, all error variants and request↔response serialization; compare against existing wire baseline.
- Ensure old and new paths cannot diverge; do not enable new endpoint unless owner approved.

**Slice TS-2 — MCP/native bridge**
- Define the relevant MCP tool schema shapes in TypeSpec where representable.
- Derive MCP SDK-compatible input schemas through tested JSON Schema conversion/validation; assess unsupported keywords, tagged unions, optional/null and errors.
- Keep MCP SDK transport; do not claim a direct TypeSpec MCP emitter exists without verifying it.
- For Hermes native JSONL establish exact versioned message schema and preserve bridge-specific semantics.
- Test TypeSpec→schema→SDK↔wire roundtrip, invalid payloads, tagged/error variants and mixed client versions.

**Slice TS-3 — CI quality gate**
- Pin compiler/emitters/codegen and commit generated artifacts only per accepted strategy.
- \`typespec compile\` and emitters as actual scripts, reproducible outputs from a clean checkout.
- CI generate→diff clean, schema validation, API compatibility against base \`main\`, contract tests and negative fixtures.
- Any generated file marked generated and never edited by hand; coverage includes headers/file manifests.
- Require owner-reviewed version bump/migration for incompatible changes.
- Do not mark gate ACTIVE until deliberate bad input fails CI and valid unchanged contract passes at exact SHA.

**Slice TS-4 — migrate remaining public surfaces**
- Port one stable contract at a time, keeping compatibility until accepted removal.
- Remove duplicate handwritten schema authority and update references in OpenSpec.
- Preserve existing real provider and agent-E2E tests; generated schema passing is never provider proof.
- Review generative schema quality on tagged unions and explicit errors; if TypeSpec cannot faithfully express a given native protocol, use an approved documented adapter rather than inventing false equivalence.

## Quality gates for the functional design

| Gate | Observable proof |
|---|---|
| DDD-ES | Commands, event facts, policies, hot spots and boundaries linked to acceptance; does not imply event sourcing |
| FP-01 | Domain functions are pure, deterministic, immutable and own named invariants |
| FP-02 | Illegal states/commands captured by ADT + runtime decoder; transition tests reject them |
| FP-03 | No provider I/O or direct adapter imports in domain code; application Effect owns I/O and cancellation |
| FP-04 | Retry/replay does not duplicate state/effects; CAS/transaction or outbox where required |
| FP-05 | Cross-context API stable; avoid direct reads of foreign aggregate storage |
| TSP-01 | TypeSpec compiler emits expected OpenAPI/JSON schema at pinned version |
| TSP-02 | No hand-maintained duplicate public wire shapes and no handwritten generated artifacts |
| TSP-03 | Wire+domain mapping roundtrips tested for every supported variant |
| TSP-04 | New contract compatible or explicitly versioned/breaking with owner approval |
| TSP-05 | CI generated output clean, invalid schema fails, changed source triggers required check |
| E2E | Actual MCP/Hermes/Bifrost and providers selected and observed as changed capability requires |

All gates in this section are **policy targets** until real scripts/tests exist and are executed.

## Explicit boundaries and risks

- **TypeSpec is an API description language, not a domain decision engine.** Do not force private domain ADTs into generated transport models.
- **Projections and CQRS:** optional; separating immutable read projections from writes may be sensible, but no automatic event store.
- **Event Storming is collaborative discovery:** generated events alone are not proof of correct ubiquitous language.
- **"Anemic" is about where behavior lives, not whether data has methods.** Functional modules must remain cohesive and own the invariants.
- **No big-bang rewrite:** the existing API protocols, providers and test portfolio remain operational during phased conversion.
- **No production-claim inflation:** a TypeSpec-generated schema is not actual gateway model-bound injection nor policy enforcement.

## Full codegen shell and skill import (implementation guidance)

See [codegen coverage](TYPESPEC-CODEGEN-COVERAGE.md) for the Sphericon-inspired expanded targets, typed metadata and fail-on-unmapped mapping gates. Our [reviewed Matt skills selection](MATT-POCOCK-SKILLS.md) identifies the original `domain-modeling`, `to-spec`, `to-tickets`, `tdd` and `code-review` prompts. Under ACE policy they are supporting techniques only: OpenSpec is already installed, single-agent execution stays primary, domain ADTs are immutable and business rules are pure.

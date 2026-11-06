# TypeSpec Contract First — public wire schemas for ACE

**Owner choice:** TypeSpec is the selected canonical language for new and migrated ACE **public machine contracts**. Its tools and generated artifacts are *planned*, not present merely because this standard exists.

## Authority and scope

OpenSpec answers **what behavior is required**, ADR answers **why architecture is chosen**, TypeSpec answers **what is sent over versioned interfaces**, and domain ADTs/pure functions answer **how invariants are enforced**. Do not manufacture a second manually maintained enum or DTO definition in each layer.

Use TypeSpec for:
- ACE Gateway Projection HTTP operations and request/response/error payloads;
- MCP tool input/output public JSON schemas where the compiled schema can be faithfully mapped into the official MCP SDK;
- relevant native Hermes bridge JSONL message contract where serialization is explicit and versioned;
- other public versioned JSON API/SDK surfaces as actually present.

Keep internal domain state and Effect service ports separate unless the types genuinely are exposed publicly. **Do not publish private source or provider-specific configuration as an accidental contract.**

## Source-to-artifact chain

\`\`\`text
Accepted OpenSpec requirements + ADR
          |
          v
TypeSpec source (typespec/) — public operation and wire schema authority
          |
          +--> @typespec/openapi3 --> OpenAPI --> supported client/server generation
          |
          +--> @typespec/json-schema --> JSON Schema
                                      --> explicit tested MCP SDK schema adaptation
          |
          +--> generated TypeScript DTO/type artifacts (selected pinned generation)
          |
          v
adapter validation/mapping ↔ internal immutable ADT ↔ pure domain rules
\`\`\`

**No TypeSpec-to-MCP leap:** Verify the exact compiler/JSON Schema keyword dialect and SDK schema adapter compatibility. TypeSpec doesn't magically implement MCP method registration, authorization, transport routing, Effect DI, or provider-bound Bifrost behavior.

## Contract design rules

1. Document and own each external operation exactly once, including required parameters, body and named response/error cases.
2. Model explicit literal discriminants for sums: success, partial, denial, provider unavailable and stale where semantically distinct.
3. Check emitted discriminated union shape and optional/null semantics against the actual target JSON wire contract; emitter defaults may differ between OpenAPI and JSON Schema.
4. Version contracts where independent clients exist; define compatibility policy and intentional breaking migration.
5. Use nullable/optional carefully and test omitted field vs null vs empty.
6. Validate request at trust boundary at runtime. Generated TypeScript types **do not** validate arbitrary JSON by themselves.
7. Map wire DTO to domain ADT using explicit one-way functions and return stable typed errors; do not leak generated HTTP types into domain core.
8. Avoid hand-maintained copies of field constraints/enums in README/tests/client/server; generate fixtures, SDK, validators where verified/appropriate.
9. Use the project's accepted official MCP SDK; do not emit a new homebrew MCP transport.
10. Confirm whether TypeSpec can represent native stream, cancellation, error and protocol features; if not, document a narrow adapter and preserve semantics rather than lying in the spec.
11. Keep data classification, authorization and policy enforcement in application boundary. The wire annotation is **not** proof a request was authorized.
12. A generated schema that parses is not evidence the right real provider was invoked; preserve ACE provider and agent E2E.
13. Generated artifacts are either reproducibly committed per policy or built in a deterministic CI step; document exact owning sources/paths.
14. Never manually edit an output file owned by codegen.
15. Pin TypeSpec compiler, official emitters and downstream generators; verify license and compatibility.
16. Preserve baseline wire behavior before converting existing schemas, then compare old/new generated artifacts.
17. A test should deliberately introduce a breaking field/variant and show compatibility gate failure.
18. Use real source SHA and compiler/tool version for every emission/contract check.

## First vertical adoption acceptance
- Inventory current gateway projection, MCP tool schemas and Hermes wire messages.
- Select one existing public Gateway Projection operation as a safe slice.
- Pin TypeSpec and its emitter libraries.
- Produce OpenAPI and/or JSON Schema and validate generation is reproducible.
- Map generated type/validator to the existing internal ADT through one adapter.
- Test exact existing wire fixture + all error variants and invalid inputs.
- Confirm clean generation, no duplicate handwritten API schema authority.
- Test compatibility and actual chosen runtime path.
- Then migrate additional operations incrementally and update OpenSpec pointers.

## Quality gate candidates
The ID meanings below are canonical and match [codegen coverage](../../TYPESPEC-CODEGEN-COVERAGE.md):
- `TSP-01`: pinned compiler/emitters and reproducible OpenAPI/JSON Schema output.
- `TSP-02`: owned generated artifacts, no manual edits or untracked codegen drift.
- `TSP-03`: generated typed SDK/server/protocol shell compiles and contract-matches.
- `TSP-04`: exhaustive DTO mapping including enum, optional/null, nested lists and errors; unknown/new fields fail.
- `TSP-05`: typed permission/scope metadata roundtrip **and actual runtime authorization negative tests**.
- `TSP-06`: backward compatibility against base `main`, with explicit versioning/owner decision for breaking changes.
- `TSP-07`: invalid JSON/unknown variants are rejected by runtime decoder with no fabricated defaults.
- `TSP-08`: actual route/MCP/native adapter and provider E2E, distinct from pure codegen tests.

**Do not call these gates ACTIVE until scripts, pinned versions and positive+negative fixtures actually run in CI at the PR HEAD.**

## Generated implementation shell — expanded scope

Read [full ACE codegen coverage](../../TYPESPEC-CODEGEN-COVERAGE.md). The selected architecture aims to generate **as much mechanical integration code as safely supported**, not only types: OpenAPI/JSON Schema, typed client SDK, server handler interfaces/route scaffolds, runtime decoders, mechanically mapped DTOs, enum checks, scope/permission metadata, typed mocks/fixtures and public docs. Prefer official or maintained generators for every output. A custom emitter/checker is allowed only after the named upstream/maintained options are inspected and shown unable to satisfy a concrete ACE invariant, with the smallest scope and owner-approved rationale required by root `AGENTS.md`; otherwise leave that output BLOCKED/DEFERRED. TypeSpec alone does not produce these integration behaviors automatically.

A new external field without a correct mapping is a **compile/generation/contract-test failure**, not an implicit undefined/default. Generated permission tables still require independently enforced application authorization. Functional business invariants and domain state transitions remain manually authored pure functions.

# Contract-first code generation — Sphericon lessons applied to ACE

**Owner choice:** TypeSpec is the canonical language for new/migrated ACE public machine contracts. The goal is **substantial generated integration boilerplate**, not merely TypeScript types. This document proposes actual generation coverage and gates; no TypeSpec generator is installed by writing it.

## Inspected concrete Sphericon pipeline

Source: [getsphericon/sphericon/docs/agents/codegen.md](https://github.com/getsphericon/sphericon/blob/main/docs/agents/codegen.md), [mise/tasks.toml](https://github.com/getsphericon/sphericon/blob/main/mise/tasks.toml), [check-generated.ts](https://github.com/getsphericon/sphericon/blob/main/mise/scripts/check-generated.ts).

Their \`mise run generate\` sequence covers:
1. **TypeSpec** declarations for multiple service surfaces → **OpenAPI**.
2. OpenAPI → generated **Go server interfaces/DTOs** via \`ogen\`.
3. OpenAPI → generated **TypeScript clients, SDK operations, validators, React Query support** via \`openapi-ts\`, with different outputs per surface.
4. **Ent** storage schema → generated ORM, scoped clients and storage models.
5. **Goverter** converts server/API DTOs ↔ storage types from **hand-written converter interface declarations**; generated implementations fail when mappings are missing. Enum transformers require explicit handling rather than silent casts.
6. \`moq\` generates test doubles from interfaces; fixture and configuration references have code generators.
7. Typed **TypeSpec decorators** express scopes/permissions, "untrusted" and MCP operation metadata. A custom generator creates permission/scope tables; tests validate decorator usage and emitted contract extensions.
8. \`.gitattributes\` identifies generated output; \`check-generated.ts\` validates header→attribute and attribute→file consistency.
9. CI checks generated drift, contract semantics, architecture and permission requirements; generator output is not edited by hand.

**This is not all free out of the box:** several generators are custom project code, particularly policy and mapping generators. Avoid claiming TypeSpec alone emits production handlers or policy enforcement.

## ACE target coverage matrix

| Layer | Generation target | Candidate approach | Ownership / proof |
|---|---|---|---|
| Protocol source | versioned Gateway Projection HTTP, MCP JSON messages, Hermes native envelope | \`typespec/\` authoring, shared models and official emitters | **TypeSpec** for wire, OpenSpec for behavioral requirements |
| Protocol artifacts | OpenAPI and JSON Schema | \`@typespec/openapi3\`, \`@typespec/json-schema\`, pinned | deterministic compiler output |
| Typed clients | HTTP request/response DTOs, operations, client SDK | maintained OpenAPI→TS client generator, assess \`@hey-api/openapi-ts\` | generated files, wire compatibility |
| Server surface | typed handler signature, operation IDs, routing adapter scaffold | OpenAPI-aware TypeScript server generator or small **thin verified adapter**, after spike | handlers only; no domain decisions generated |
| Runtime validation | request/response schema parsers | generated JSON Schema validators or supported Zod/Effect Schema toolchain | invalid/unknown enum and missing field negative tests |
| Permissions | operation→required policy/scope table | typed TypeSpec decorators + tested generator/extension checker **if actually needed** | application enforces at I/O time, generated metadata never the final security boundary |
| DTO↔ADT mapping | request DTO→validated domain input; domain outcome→response DTO | generated mapping for mechanical fields; explicit pure functions for semantic rules/variants | full field coverage; **compile/test FAIL on unmapped fields/enums** |
| Error contracts | tagged error DTO and stable code/status handling | TypeSpec union metadata + generated error classification/mapping as feasible | no technical failure silently becomes complete/success |
| Test mocks | API client/server typed doubles and illustrative fixtures | generated from typed protocol contracts or OpenAPI/MSW where appropriate | mock ≠ real-provider evidence |
| Docs | API/SDK reference, operation list and public error matrix | generators from TypeSpec/OpenAPI | generated drift check |
| Client UI | React Query/hooks only if a real ACE UI/client exists | optional openapi-ts plugins | **not required** for backend-only ACE |
| Storage | Qdrant/FalkorDB payload maps, schema versions, historical archive format | separate store-specific contracts; no automatic Ent/SQL migration | preserve source identity, history and schema evolution |

### Key rule: generate boilerplate, not ownership decisions

Generated:
- canonical wire types, versioned schemas, typed client request builders;
- server endpoint interfaces/routing registrations if supported by a tested generator;
- mechanical DTO mappers and normalizers;
- permission/scope **metadata tables**, error classifications and contract fixtures;
- generated docs and deterministic schema clients.

Hand-written (functional core):
- domain ADTs, validated state/command transitions and invariants;
- policy **decisions and runtime enforcement**, authorized egress;
- idempotency, compensation, retries and cancellation policies;
- source-current verification and correctness semantics;
- Event Storming interpretation and bounded-context ownership;
- Effect use cases/provider composition;
- semantic mapping when field meanings differ or values are not mechanically isomorphic.

**Important:** "generated handler" means typed route+interface/dispatch scaffolding, not generated business behavior. A generated \`requiresScopes\` table is metadata; the application still must check current policy before invoking an external effect. A generated enum converter is safe only if exhaustiveness is tested and unknown variants fail rather than cast.

## Example: TypeSpec contract → generated and handwritten paths

\`\`\`text
Event Storming → commands/events/policies/hot spots
           ↘ bounded context → ADT + pure domain rules (hand-written)
OpenSpec AC + accepted ADR
           ↘ TypeSpec (wire + typed decorator)
                ├── OpenAPI → typed client SDK
                ├── OpenAPI → server handler/route types
                ├── JSON Schema → boundary decoder/validator
                ├── annotations → operation access table
                ├── mapping declaration → mechanical mapper (if tool selected)
                └── contract fixtures/docs/mocks
                   ↘ protocol adapter → Effect use case → pure domain rules
\`\`\`

### Build gate for one added field

Given TypeSpec defines \`indexGenerationId\` on response:
1. Compile TypeSpec; generated schema/client/server DTO includes the new field.
2. Build the mapper: if domain data has no explicit source for the new field, mapping generation/check **fails** (no empty string, undefined or silent omission).
3. The older client schema remains compatible if change is additive; deliberate removal or changed enum is blocked pending owner-approved versioning.
4. Fixture roundtrip: client SDK request → decoded type → Effect use case → pure domain result → mapper → encoder → SDK response.
5. Check exact invalid/unknown/denied/unavailable variants and authorization metadata.
6. Regenerate from clean checkout and assert no diff or tracked output discrepancy; CI uses exact SHA.
7. Provider E2E is independent: mock and schema codegen cannot prove real Bifrost/MCP/Hermes integration.

## Recommended staged implementation in ACE

**TS-00: inventory and authority.** Audit current MCP schema definitions, Hermes JSONL, Bifrost Gateway Projection API, Effect domain DTOs and error contracts. Decide explicit canonical schema owners and current-version baseline. Do not overwrite existing runtime.

**TS-01: HTTP thin vertical slice.** Pin TypeSpec compiler/emitters and one maintained TS OpenAPI client generator. Define one Gateway Projection operation, generate its wire model and SDK, implement thin server adapter and explicit DTO→ADT mapping. Compare exact old/new wire output.

**TS-02: automated mapping completeness.** Select maintainable TS mapper/generator or a narrow static complete-coverage check; probe nullable/missing/null, enums, lists, tagging and paging. Test intentionally unmapped field/unknown enum and require **failure**. Do not build an expansive home-grown mapping DSL without measured need.

**TS-03: policy/schema metadata.** If TypeSpec decorators are appropriate, define types for access scope, data classification and trusted/untrusted transfer. Generate metadata table **only after** proving a supported compile/emitter path. Enforce at actual application send-time as an independent negative-test gate.

**TS-04: MCP/native bridge.** TypeSpec JSON Schema → tested mapping to official MCP SDK schemas; Hermes versioned message mapper; no claim of native MCP emitter without proof. Test protocol-specific wire variants; keep gateway and explicit MCP planes distinct.

**TS-05: generated artifact policy.** Generated output directory/header, \`.gitattributes\`, reproducible \`generate\` task, generated-diff check and schema compatibility gate. Include semantic tests for transport/permissions/mapping; ensure codegen changes are scope-aware in CI.

**TS-06: wider migration.** Move public interfaces incrementally, remove old handwritten duplicate schema authority only after compatibility proof. No big-bang replacement of functional domain modules.

## Required gates

- **TSP-01** pinned compiler/emitters and reproducible OpenAPI/JSON Schema output.
- **TSP-02** owned generated artifacts, no manual edits or untracked codegen drift.
- **TSP-03** generated typed SDK/server/protocol shell compile and contract-match.
- **TSP-04** exhaustive DTO mapping including enum, optional/null, nested lists and errors; unknown/new field fails.
- **TSP-05** typed permission/scope metadata roundtrip **and actual runtime authorization negative tests**.
- **TSP-06** backward compatibility against base main, explicit breaking version/owner decision.
- **TSP-07** invalid JSON/unknown variant rejected by runtime decoder, no fabricated defaults.
- **TSP-08** actual route/MCP/native adapter and provider E2E **distinct from pure codegen tests**.

**Result:** a generated shell around a handwritten functional domain core, with hard failures for incomplete mapping and protocol drift — not just prettier interfaces.

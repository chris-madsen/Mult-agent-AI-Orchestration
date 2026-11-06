---
name: ace-typespec-codegen
description: Design, extend and verify ACE TypeSpec-first public contracts and generated API boilerplate, preserving functional DDD, exhaustive mappings, policy and protocol compatibility.
---

# ACE TypeSpec Contract-First Codegen

Read root \`AGENTS.md\`, the accepted OpenSpec change, ADR and [full codegen plan](../../../docs/research/sdlc/TYPESPEC-CODEGEN-COVERAGE.md). This is a project-owned skill inspired by the observed Sphericon pipeline; it is **not** a copied Matt Pocock skill.

## When to invoke
- Adding/changing a public Gateway Projection operation or error.
- Changing MCP or native Hermes JSON schema after evaluating TypeSpec compatibility.
- Adding generated SDK/server/validator, permission metadata or DTO mappers.
- A PR changes generator/compiler, schema or output files.

## Procedure
1. Confirm existing source-of-truth and version; inspect actual runtime and current public wire fixtures.
2. Event Storming and OpenSpec define semantics; TypeSpec owns public shape; immutable ADTs/pure functions own business behavior.
3. Define/update TypeSpec operation and tagged result/errors with explicit required/optional/null and version semantics.
4. Run pinned emitters (if installed) and verify emitted OpenAPI/JSON Schema.
5. Regenerate supported SDK, server interface, schema validators, mock interfaces and docs **only where a maintained generator is selected**.
6. Inspect mechanical mappings. Added fields and enum values MUST be covered; if there is no correct source mapping, fail generation or test, never emit a placeholder.
7. Confirm generated access metadata and independently test actual send-time policy enforcement.
8. Validate wire→decoder→domain ADT→pure function/Effect→encoder/SDK roundtrip, including invalid/denied/partial/unavailable and old client cases.
9. Run generation→diff clean, compatibility check against base and any actual provider/agent E2E required.
10. Report tool names/versions, commands/exits, generated files, mapping completeness, unsupported emitter features, exact SHA, real tests and NOT-RUN gates.

## Don't
- Don't write business invariants into generated handlers or generated mapping templates.
- Don't implement an alternate MCP transport in place of official SDK.
- Don't add a handwritten duplicate public schema source.
- Don't call uninstalled TypeSpec emitters or imagined plugins PASS.
- Don't infer protocol compatibility from TypeScript compiler success alone.
- Don't silently default an unmapped field.
- Don't make TypeSpec directives your only security enforcement.
- Don't overwrite existing working clients while migrating.

## Output
\`\`\`markdown
# TypeSpec codegen evidence
OpenSpec AC/ADR:
Public contract owner/version:
Changed .tsp:
Generated artifacts / generator versions:
Mapper field coverage:
Allowed schema variants:
Breaking changes and owner approval:
Commands + exit at source SHA:
Provider E2E real / mock / NOT-RUN:
Gates TSP-01..08:
Remaining unsupported syntax/adapter work:
\`\`\`

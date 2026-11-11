# SDLC-QG2 architecture fitness rule selection

**Date:** 2026-11-10  
**Status:** implementation research / report-only pilot  
**Governing requirement:** `docs/research/sdlc/QUALITY-GATES-IMPLEMENTATION-PLAN.md`, **PR-QG2 — architecture fitness rules 1.0**.

## Objective

Turn a small set of already-accepted ACE architecture invariants into executable, tested ast-grep rules without inventing a new architecture or making current accepted code fail by surprise.

This pilot is deliberately **report-only**. Rule promotion to blocking requires owner approval of semantic equivalence after observed positive, negative and false-positive fixtures.

## Current implementation inspected

Source baseline: `main@92bfccf147ade03f6b18b24b7745e2a12f653ea3`.

### Domain dependency direction

All 57 current `src/domain/*.ts` files were inspected for imports.

Observed:
- domain imports are local domain modules plus two Node standard-library helpers:
  - `src/domain/source-text.ts` → `node:util`;
  - `src/domain/structural-language.ts` → `node:path`;
- no current domain module imports `src/adapters`.

Accepted authority:
- `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md` FP-03: **no provider I/O or direct adapter imports in domain code; application Effect owns I/O and cancellation**.
- root `AGENTS.md`: adapters/provider DTOs stay outside domain and dependencies flow through typed ports.

Decision:
- pilot only the directly stated, currently clean invariant **domain must not import `../adapters/*`**.
- do **not** ban `node:*` in this PR; current accepted domain code uses it.
- do **not** add a broad application→adapter ban; current accepted application code contains explicit adapter imports, including `graphiti-lifecycle-gate.ts` and `retained-memory.ts`.

### MCP explicit-tool plane vs Gateway Projection plane

Accepted authority:
- ADR-014: MCP is the explicit tool-call plane; model-bound delivery uses native/gateway paths.
- ADR-017 `ace-bifrost-gateway-protocol`: Bifrost/Gateway Projection is a separate delivery mechanism alongside MCP explicit tools.
- `docs/docs/architecture/07-architecture-fitness-contracts.md` repeats that MCP conformance proves explicit tools, not automatic model-bound context injection.

Current code:
- `src/transport/mcp-sdk-stdio.ts` imports the MCP server SDK and `../gateway/mcp-gateway.js`; it does not import Gateway Projection domain/service/transport modules.
- `src/transport/gateway-projection-http.ts` imports HTTP + Gateway Projection domain types; it does not import MCP SDK, `mcp-gateway`, or `mcp-sdk-stdio`.

Decision:
- encode both dependency directions separately so accidental plane collapse is visible:
  - MCP stdio transport must not import Gateway Projection domain/application/transport modules.
  - Gateway Projection HTTP transport must not import MCP SDK/MCP gateway/MCP stdio transport.

These are intentionally narrow import-edge rules. They do not claim that no shared domain/application code may ever serve both planes.

## Selected rules

### ACE-ARCH-001 — domain-no-adapter-import

**Invariant:** `src/domain/**` must not import an outward relative path resolving into `adapters/**`; the rule accepts one or more parent traversals so a future nested domain folder cannot evade the boundary with `../../adapters/**`.

**Owner source:** FP-03 + root AGENTS adapter/domain boundary.

**Repair hint:** move provider/I/O dependency behind an application port and keep provider implementation in adapters.

### ACE-ARCH-002 — mcp-transport-no-gateway-projection-import

**Invariant:** `src/transport/mcp-sdk-stdio.ts` must not directly import:
- `../domain/gateway-projection.js`;
- `../application/gateway-projection-service.js`;
- `./gateway-projection-http.js`.

**Owner source:** ADR-014/017 plane separation.

**Repair hint:** keep explicit MCP tool transport on MCP contracts; share only a lower neutral domain/application abstraction if behavior is genuinely common.

### ACE-ARCH-003 — gateway-transport-no-mcp-import

**Invariant:** `src/transport/gateway-projection-http.ts` must not directly import:
- `@modelcontextprotocol/*`;
- `../gateway/mcp-gateway.js`;
- `./mcp-sdk-stdio.js`.

**Owner source:** ADR-014/017 plane separation.

**Repair hint:** keep model-bound Gateway Projection transport independent from MCP framing/tool transport.

## Why the suggested provider-failure rule is not in 1.0

The QG2 plan suggests a possible rule for provider failure being converted into complete/empty success.

That invariant is real and important, but a simple syntax pattern such as `catch { return [] }` is not semantically equivalent in ACE:
- some empty results are valid for optional providers or genuine empty searches;
- completeness depends on source obligations and typed result state, not one syntax form;
- broad catch/return patterns risk false positives and false confidence.

Therefore this pilot does **not** add a fake semantic rule. A later typed/data-flow rule may cover this only if a precise accepted code shape and oracle are identified.

## Tool decision

ACE already pins:
- `@ast-grep/cli@0.51.0`;
- `@ast-grep/napi@0.51.0`.

No new architecture parser or dependency tool is needed for this pilot.

Use ast-grep's native:
- YAML rule IDs/messages/notes;
- `files` scoping;
- built-in `ast-grep test` valid/invalid cases;
- `ast-grep scan` for production source.

Rules start at `severity: warning`. In ast-grep, warning findings are reported but do not make the scan fail; configuration/runtime errors still fail. Promotion to `severity: error` is a separate owner-approved step.

## Fixture requirements

For every selected rule:

1. **invalid** code must match;
2. **valid** code must not match;
3. **false-positive** text/comment/string containing a suspicious path must not match.

The production source scan must also pass on current `main` without suppressing real accepted files.

## Planned repository shape

```text
architecture/
  sgconfig.yml
  rules/
    ace-domain-no-adapter-import.yml
    ace-mcp-transport-no-gateway-projection-import.yml
    ace-gateway-transport-no-mcp-import.yml
  rule-tests/
    ace-domain-no-adapter-import-test.yml
    ace-mcp-transport-no-gateway-projection-import-test.yml
    ace-gateway-transport-no-mcp-import-test.yml
```

Package scripts:
- `test:arch-rules` — blocking rule-fixture verification;
- `check:arch` — report-only production scan while rule severity is warning.

CI:
- run fixture tests when architecture rules/config/package script changes;
- run report-only scan when TypeScript source or architecture rules change;
- do not call the rules blocking until owner approves the semantics and promotion.

## Exit for this pilot

QG2 pilot is implemented when:
- all three rule tests demonstrate valid/invalid/false-positive behavior;
- production source is scanned with zero unexpected findings;
- rule IDs and repair hints are visible;
- CI evidence is bound to exact PR source head + tested checkout SHA;
- owner approval for blocking promotion remains explicitly pending unless separately given.

## Semantic review follow-up (2026-11-11)

A direct `export ... from` statement can introduce the same forbidden
dependency without a literal `import` statement. The initial rules limited
the AST parent to `import_statement` and would silently miss that case.

All three rule parents now accept either `import_statement` or
`export_statement`, with a new negative re-export fixture for each rule.
This is a bounded strengthening of the same accepted import-edge invariants,
not a new rule or a type-aware dependency graph. The scoped project scan
continues to be advisory (`severity: warning`). Native ast-grep fixtures
and the exact PR HEAD/CI checkout must be revalidated before merge.

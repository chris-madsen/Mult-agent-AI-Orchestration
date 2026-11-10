# SDLC-QG2 architecture fitness rule selection

**Date:** 2026-11-10  
**Status:** implementation research for SDLC-QG2  
**Governing plan:** `docs/plans/2026-11-10-sdlc-adoption-execution-plan.md` → **SDLC-QG2 — architecture fitness rules 1.0**  
**Normative source:** `docs/research/sdlc/source/standards/Architecture Layers.md`

## Objective

Pilot a small set of executable architecture checks with ACE's already installed `@ast-grep/cli@0.51.0`.

This slice does **not** redefine architecture. It turns two already accepted import-direction rules into observable report-only diagnostics.

## Why only two rules

The plan permits 2–3 rules. Only invariants with unambiguous static import semantics are automated here.

Fuzzy concepts such as "business logic in a controller", "hidden domain policy", or "incorrect state ownership" remain human/design review concerns until an exact structural oracle exists. Encoding them as broad regexes would create false confidence and false positives.

## ARCH-FIT-001 — domain has no infrastructure/outward imports

Source rule:

- Domain is readonly ADTs, pure transitions and deterministic invariants.
- Domain does not depend on Effect I/O, HTTP, SDKs, databases or providers.
- Import direction is inward.

Initial executable scope catches static TypeScript imports in `src/domain/` of:

- `effect`;
- MCP/Qdrant/Zod protocol/provider packages;
- I/O/network/process Node builtins (`fs`, `http`, `https`, `net`, `tls`, `child_process`);
- ACE outward layers: application, adapters, gateway, transport and bin.

This intentionally does **not** ban every Node builtin or every third-party pure library. The rule is narrow enough to correspond to the accepted invariant.

Repair: move the dependency to an application port / adapter / composition owner.

## ARCH-FIT-002 — application does not import concrete outer layers

Source rule:

- Application owns Effect use cases, authorization/orchestration, typed ports and failure semantics.
- Adapters implement ports.
- Composition wires concrete dependencies.

Initial executable scope catches static TypeScript imports in `src/application/` from:

- `../adapters/*`;
- `../transport/*`;
- `../gateway/*`;
- `../bin/*`.

Repair: move the shared contract inward (domain/application port) and let composition inject the concrete implementation.

## Current baseline observation

Static inspection before implementation found current outward application dependencies:

- `src/application/context-transform-service.ts` imports `ContextProvider` from `../gateway/mcp-gateway.js`;
- `src/application/graphiti-lifecycle-gate.ts` imports `AsyncMemoryArchivePort` from `../adapters/file-memory-archive.js`.

Therefore ARCH-FIT-002 must start **report-only**. This PR exposes existing debt; it does not silently convert pre-existing violations into a merge blocker.

The domain rule is expected to be clean at baseline.

## ast-grep implementation shape

Each rule:

- has a stable rule ID;
- matches a `string_fragment` only when it is structurally inside an `import_statement`;
- uses a narrow Rust-regex over the import specifier;
- carries a repair note;
- has severity `warning` for production scanning.

Controlled fixtures cover:

- one violating import;
- one valid import;
- one false-positive string/comment-shaped example.

For fixture self-tests the CLI promotes the selected rule to `error`. A bad fixture must return non-zero; valid and false-positive fixtures must return zero.

Production scans retain `warning` severity, so findings are visible without blocking while the baseline is evaluated.

## Promotion rule

Do not promote either rule to blocking merely because the parser works.

Promotion requires:

1. observed bad/good/false-positive fixture behavior;
2. review of current production findings;
3. repair or explicitly owner-approved baseline treatment of existing debt;
4. low false-positive risk on real PRs;
5. owner decision to change severity.

Until then, production findings are report-only.

# ACE historical architecture remediation — import-boundary ledger

**Baseline:** `main@6df583fad7d45a4cda6586632240b6f364c08a8a` (2026-11-14).  
**Architecture authority:** ADR-014/017/019, root `AGENTS.md`, `docs/research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md`, and QG2 pilot `docs/reviews/2026-11-10-sdlc-qg2-architecture-rule-selection.md`.  
**Status:** source-audited targeted fixes, **not** unconditional certification of all ACE behavior.

## Scope and source evidence

Source tree has 128 TypeScript files under `src/` (57 domain, 22 application, 39 adapters, 3 transport, 6 bin, 1 gateway). The QG2 inventory already inspected the 57 domain imports and found no adapters; this remediation separately inspected all application and adapter import clauses and confirmed the concrete import violations below. Dynamic imports, non-TypeScript integrations and semantic data-flow are **not** proven by import-only scans. CI checks exact committed source, not a live production deployment.

## Confirmed findings / remediation

| ID | Baseline defect | Fix and proof | State |
|---|---|---|---|
| A-001 | `context-transform-service.ts` imports `ContextProvider` from the MCP-specific `gateway/mcp-gateway.ts`; application owns neither the port nor a neutral import | #237 places `ContextProvider` in `src/application/ports.ts`, preserves a type re-export in gateway and adds regression; `ACE-ARCH-004` reports recurrence | Fixed in PR; merge pending |
| A-002 | `graphiti-lifecycle-gate.ts` and `retained-memory.ts` import `AsyncMemoryArchivePort` from concrete `adapters/file-memory-archive.ts` | #237 moves port type to `application/ports.ts` and keeps adapter's compatibility type re-export; `ACE-ARCH-005` reports application→adapter imports | Fixed in PR; merge pending |
| A-003 | `application/file-workspace-store.ts` implements concrete Node filesystem persistence and cross-process fencing rather than an adapter-owned `WorkspaceStore` | Separate #245 relocates the existing implementation into `adapters/file-workspace-store.ts` and updates composition, exports and race test without changing the persistence schema or algorithm | Fixed in PR; merge pending |
| A-004 | Policy denial prefix logic did not reject files beneath the `.git/` and `secrets/` prefixes and `.env.*` variants consistently | #237 normalizes the path and enforces exact/descendant and traversal-negative fixtures in existing contract tests | Fixed in PR; merge pending |
| A-005 | Gateway v1 public DTO/schema authority is manually duplicated among JSON Schema, TypeScript and Go | Separate #244 implements TypeSpec compiler/OpenAPI/JSON Schema/SDK codegen, strict schema diff tests and incremental typed HTTP response binding | TypeSpec vertical slice staged; production Go/other wire migration needs independent proof |

## Architecture fitness enforcement

`npm run test:arch-rules` tests actual ast-grep rules with valid/invalid and false-positive cases; `npm run check:arch` scans the source tree. The rules are **report-only**, in keeping with QG2 and the owner's decision not to introduce new blocking merge policy:

- ACE-ARCH-001 — domain does not directly import concrete adapters
- ACE-ARCH-002 — explicit MCP tool transport does not import Gateway Projection implementation
- ACE-ARCH-003 — Gateway Projection transport does not import MCP framing
- ACE-ARCH-004 — generic application code does not import MCP gateway implementation
- ACE-ARCH-005 — application services do not import concrete adapters
- ACE-ARCH-006 — domain does not import application orchestration

A native import-edge rule cannot prove provider failures are never turned into false completion, privacy authorization occurs at send time, or provenance/Graphiti readiness is production-certified. Do not add syntactic approximations that falsely claim those semantics.

## Remaining acceptance / exclusions

1. Independent PR CI and security on **each** final HEAD; review and integrate #237 and #245, then rerun `verify:pr` on the merged code. No branch protection/required-check settings are changed.
2. Functional acceptance of T2 ACE slices requires actual agent/provider E2E, authorization/freshness negative tests and G02 evidence where relevant. The import scan alone does not certify them.
3. The separate TS-00…TS-06 migration under #244 must retain old-version compatibility and cannot treat generated MCP/native schemas as transport replacements without SDK and JSONL proof.
4. Previously inventoried worker lifecycle/persistence similarities remain *candidates* for separate semantic review, not established violations mandating consolidation. No large refactor is authorized from matching filenames alone.

**Claim allowed:** the identified structural import violations were repaired and covered by report-only regression rules. **Claim prohibited:** all historical ACE automatically conforms to every functional architecture/security invariant solely because static tests pass.

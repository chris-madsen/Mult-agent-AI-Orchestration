# Design — Observable provider composition and Design by Contract

**Status: Proposed.** Normative cases in `specs/production-retrieval/spec.md` and `specs/architecture-fitness/spec.md`. PRD/ADR source and proposed ADR-012 prevail over opportunistic adapter convenience.

## Vertical runtime contract

`Codex → official MCP SDK → gateway → ProjectDataPolicy → Context Orchestration → [Qdrant + real embeddings] → [Tree-sitter + approved LSP as required] → Workspace Truth digest/span verification → rank/dedupe/contextualize → ContextBundle → exact expansion`.

Vertex docs / Graphiti memory join only if task and policy request them. Each required source has `status: succeeded | unavailable | stale | denied | skipped_not_required`; `complete` requires all required sources to have succeeded and evidence verification to hold. A policy denial must not degrade to a forbidden cloud request. Cold-start unavailable providers produce `not_ready` or explicit degraded results, not fabricated success.

## API and source representation

Use an official maintained TypeScript MCP SDK. Version-pin and test with installed Codex. Runtime-wired providers expose provenance receipts in **safe test diagnostics** (provider id/version, operation, input class, output source digest and duration), never raw secrets. AST symbol span is distinct from full-file exact expansion; never identify code symbols using regex alone in the production path. Do not silently limit exact artifacts.

## Contract test doubles vs real dependencies

- In unit tests: deterministic ports and SHA256-derived test vectors allowed, labelled fixtures.
- In provider tests: real Qdrant and real embedding model, AST grammar, approved LSP. Required operations instrumented; assertion is on actual call and result.
- In agent E2E: actual Codex MCP handshake/call; verify output, code state, and counters. No `TODO→DONE` toy-only gate.
- In benchmark: paired strong native Codex, pinned tasks/repos/model/permissions, quality; require ACE used for attribution.

## No accidental code rewrite

Existing implementation is **partially implemented**. This change specifies gates only. Do not delete snapshots/artifact infrastructure or claimed smoke evidence; refactor toward approved providers once spike and ADR are reviewed.

## Migration

1. Introduce SDK alongside old transport behind testing boundary.
2. Wire real providers under explicit config and policy without claiming default readiness until approved.
3. Replace regex whole-file symbol selection with AST spans, preserve lexical fallback for offline use with explicit partial label.
4. Add integration/agent E2E and Harbor tasks; record run fingerprints.
5. Review; switch default only when all gates pass and owner approves.


## Current provider-composition update — 2026-10-21

The production runtime has moved beyond the historical migration sketch above: PR #94 replaced custom structural/Qdrant-lifecycle/semantic project machinery with ast-grep, provider-native Qdrant alias publication and generic LSP wiring.

For future production promotion, the code-retrieval portion of the vertical contract is extended by Accepted ADR-014 and OpenSpec 007:

```text
Qdrant dense + sparse/BM25 -> RRF fusion -> optional approved reranker -> exact source verification -> LSP enrichment
```

The existing DBC requirements remain applicable. Hybrid/reranker layers are not considered production evidence until their own frozen quality/latency/agent ablations pass.

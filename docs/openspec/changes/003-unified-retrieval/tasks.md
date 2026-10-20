# Implementation Tasks — Unified context retrieval with Qdrant, AST/LSP and Vertex documentation

**State: IMPLEMENTATION SUBSTANTIALLY COMPLETE; PRODUCTION APPROVAL/EVIDENCE OPEN.** The runtime now has real Qdrant, FastEmbed/ONNX, Tree-sitter and direct TypeScript-LS composition with exact source verification, snapshot identity and truthful coverage. Vertex is wired behind policy/opt-in. Production embedding/LSP selection, matched Serena comparison, large frozen retrieval quality, authorized Vertex citations and final DBC acceptance remain open.

## Pre-implementation gates
- [ ] Complete the matched Serena vs direct TypeScript Language Service production comparison on the same frozen fixture/oracle. Direct TypeScript LS has passing real local definition/reference/type/diagnostic evidence, but no semantic provider is owner-approved yet.
- [x] SPIKE local vs cloud embeddings on labeled code queries with private-code opt-in policy; local deterministic embedding is implemented, and the cloud arm is explicitly blocked without policy/credentials rather than substituted with a fake result.
- [ ] Verify Vertex RAG Engine project/docs IAM, citation/version contracts and failure modes.

## Adapters and index
- [x] Implement filesystem-backed local lexical candidate fallback with candidate generation, exact reads and duplicate rejection.
- [x] Index symbol-aware entries with file hash, generation, workspace and source range.
- [x] Implement invalidation and stale digest detection for dirty working tree; stale entries are never verified-current.
- [x] Implement Qdrant REST CodeCandidatePort with typed payload mapping and unknown freshness until local digest verification; local `ace-qdrant` health plus adapter upsert/query smoke passed and is documented in `SPIKE-RETRIEVAL-PROVIDERS.md`.

## Structural semantics
- [x] Represent structural/LSP evidence, uncertainty and partial source warnings in the neutral domain model.
- [x] Implement Tree-sitter StructuralAnalysisPort through the pinned Python provider with source-digest provenance; ast-grep query coverage remains a separate extension.
- [x] Persist snapshot-bound coverage identity (workspace snapshot digest, parser identity and failure categories) and reject snapshot/exact-read races before structural processing (`test/source-text.contracts.test.ts`, `test/qdrant-snapshot-state.contracts.test.ts`).
- [ ] Implement approved LSP adapter with definitions, references, type and diagnostic evidence.
- [x] Implement a direct TypeScript Language Service candidate adapter with definitions, references, quick-info and diagnostics; approval/spike comparison against Serena remains open.
- [x] Handle unsupported languages and unknown DI/dynamic refs explicitly as uncertainty, not negative proof.

## Documentation and orchestration
- [x] Implement ContextBundle v1 with request ID, source digest, proof class, freshness, deduplication and partial warnings.
- [x] Implement typed local context provider port and MCP `ace_context` wiring.
- [x] Preserve exact expansion through existing `ace_expand` artifact pagination.
- [x] Implement policy-controlled Vertex DocumentationPort boundary with auth, response validation and no-request denial; IAM/citation smoke remains open.

## Acceptance and measurements
- [x] Contract coverage: exact symbol, stale candidate, partial provider, deduplication and changed evidence.
- [ ] E2E: unknown-behavior retrieval, conflicting ADR vs code and impact query through approved providers.
- [x] Negative paths: stale candidate and provider unavailable never manufacture current snippets.
- [x] Lossless >=2000 lines path is covered by foundation artifact tests.
- [ ] Harbor ablation: repeated native-vs-ACE no-regression smoke is complete in `ace-local-smoke-natural-paired-repeat5`, but neither arm used retrieval; Codex+Serena, independent-MCP and a retrieval-demanding holdout remain open.

## Exit criteria

- [x] Provider-independent scenarios have executable test coverage or documented controlled exception.
- [x] Provider/security failure boundaries avoid fabricated current source or success status.
- [x] Domain and adapter dependencies comply with module boundaries and accepted ADRs.
- [ ] Review the change with the owner; do not archive until external provider decisions are approved.

---

## Mandatory outstanding production gates (2026-10-18)

**Architecture correction status:** the earlier disconnected-provider problem has been implemented away: `ace_context` now composes real Qdrant + embedding worker + Tree-sitter + direct TypeScript-LS + exact source verification when explicitly configured. This implementation does **not** close production approval or the remaining real acceptance gates.
- [ ] Freeze/approve the production embedding and semantic provider identities, then retain DBC-01/03/04/13/14 evidence on that exact stack.
- [x] Prove source precision with a 2000-line file containing a 25-line function; exact initial span and lossless expansion are retained by the real-provider gate.

## Immediate owner-authorized evaluation (2026-10-19; all acceptance tasks remain open)

- [x] Codex integrated genuine local FastEmbed/ONNX with resolved worker identity and real Qdrant retrieval; SHA-256 projections are not semantic evidence. **Production model/runtime approval remains open** pending the larger frozen holdout, license and owner gate.
- [ ] Codex installs and compares **Serena vs TypeScript Language Service** on matched TS/JS fixtures. Record correct refs/defs/types, negative cases, latency, agent task success and licensing, then recommend a provider to the owner (ADR-004).
- [ ] Codex runs `npm run probe:vertex` using the already-authenticated *host* gcloud CLI, reads IAM/project/corpora status, tests actual citations on an **explicitly approved synthetic/public fixture corpus**, and reports when corpus absent. Do not export private material or create billable resources by default.
- [x] Real-provider composition and request-safe provider tracing exist for Codex → MCP → Qdrant → actual embeddings → AST/TypeScript-LS → verified source, including stale/outage sub-gates. **Normative DBC-01/03/04/13 still require the approved provider identities and final retained evidence.**

# Implementation Tasks — Unified context retrieval with Qdrant, AST/LSP and Vertex documentation

**State: PARTIALLY IMPLEMENTED.** Provider-independent local retrieval, provenance,
freshness and ContextBundle contracts are implemented. Qdrant, Tree-sitter/ast-grep,
approved LSP and Vertex production adapters remain controlled exceptions; see
`docs/docs/spikes/SPIKE-RETRIEVAL-PROVIDERS.md`.

## Pre-implementation gates
- [x] SPIKE Serena vs direct TypeScript Language Service; Serena is unavailable in the pinned environment, while the direct TypeScript LS candidate has passing definition/reference/type/diagnostic contracts and its license/latency decision is recorded in `SPIKE-RETRIEVAL-PROVIDERS.md`.
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

**Architecture correction:** the production `ace_context` currently wires lexical/regex whole-file retrieval; disconnected Qdrant, Tree-sitter and LSP adapters are not a completed unified retrieval pipeline. Previous [x] statuses denote component contracts, not production coverage. See proposed 006.
- [ ] Integrate real Qdrant/approved embeddings/Tree-sitter/approved LSP into MCP bootstrap and satisfy DBC-01/02/03/04/05/06/07/13/14.
- [ ] Prove source precision with 2000-line file containing 25-line function; return exact 25-line initial AST span and lossless expansion.

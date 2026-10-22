# production-retrieval — Spec Delta

## ADDED Requirements

### Requirement: Real executable production composition

The system SHALL expose `ace_context` through a standards-compliant official TypeScript MCP SDK facade and SHALL invoke selected, configured real retrieval providers in the production runtime when required by an authorized request, rather than satisfying the capability with a disconnected adapter, test double or lexical fallback.

#### Scenario: DBC-01 actual provider wiring

- **WHEN** an authorized code-intelligence query requires semantic discovery, AST spans and LSP semantics in a pinned environment with approved providers
- **THEN** an observable Codex MCP call reaches actual Qdrant with a genuine approved embedding, Tree-sitter/ast-grep, approved LSP and current source verification, and the resulting evidence carries provider and source provenance
- **AND** an implementation where only a regex/full-file local provider is invoked SHALL fail this scenario

#### Scenario: Unapproved production dependency

- **WHEN** the required real provider is unavailable or its selection has not been approved
- **THEN** the capability is `not_ready` or explicitly degraded with failed sources, and never falsely claims provider-backed success

### Requirement: Precise relevant retrieval and lossless expansion

The system SHALL use real AST-derived symbol boundaries, distinguish verified semantics from lexical candidates, prioritize relevant excerpts and permit lossless exact expansion.

#### Scenario: DBC-02 2000-line source with 25-line symbol

- **WHEN** a 2000-line source has a 25-line relevant function and user asks for that function
- **THEN** the delivered initial excerpt is limited to the actual function span with current digest/provenance, and the complete exact 2000-line source remains available via an authorized handle
- **AND** returning the entire file as the function's source range SHALL fail the contract

#### Scenario: DBC-03 behavior without identifier

- **WHEN** a user describes an implementation behavior without naming its symbol and decoy files share surface keywords
- **THEN** a real approved semantic retriever identifies relevant candidates, which are checked against current source, with quality measured on labeled fixtures
- **AND** deterministic SHA-256 pseudo-vectors SHALL NOT satisfy the semantic retrieval requirement

#### Scenario: DBC-04 same-name references

- **WHEN** two classes define `save()` and call sites resolve to different declarations
- **THEN** the approved semantic service returns the correct definition/references for each declaration without conflating `isWriteAccess` and `isDefinition`

### Requirement: Route-coverage completeness and trusted source truth

The system SHALL determine completeness from all required route sources and verification, not solely from freshness of returned items, and SHALL fail closed on policy denial.

#### Scenario: DBC-05 source races

- **WHEN** a source changes from digest D1 to D2 after indexing but before delivery
- **THEN** the system re-verifies current D2 or labels D1 `stale/changed_during_request`, never `current`

#### Scenario: DBC-06 required provider fails

- **WHEN** Qdrant is a required route and times out while available local AST still yields results
- **THEN** the bundle reports Qdrant failure and `complete=false`, even when all returned local evidence is fresh

#### Scenario: DBC-07 private code cloud denied

- **WHEN** project data policy denies private-code outbound retrieval or embeddings
- **THEN** the forbidden transport makes zero outbound calls, reports typed denial, retains safe audit evidence, and SHALL NOT reroute to another cloud endpoint

### Requirement: Traceable protocol and evidence-preserving performance claims

The system SHALL prove end-to-end behavior with official SDK/client conformance and quality-gated, attribution-aware Harbor comparisons.

#### Scenario: DBC-09 MCP conformance

- **WHEN** Codex initializes and invokes ACE under supported SDK protocol, including errors, cancellation and concurrent calls
- **THEN** the official MCP SDK facade remains interoperable and preserves typed failure semantics

#### Scenario: DBC-12 agent benchmark attribution

- **WHEN** a report attributes improved end-to-end token counts to ACE
- **THEN** the experiment uses retrieval-demanding paired tasks, confirms successful ACE calls and real required-provider invocations, reports quality, all total tokens, external costs and failures
- **AND** zero ACE calls or only a forced `TODO→DONE` smoke SHALL NOT constitute proof of ACE retrieval benefit

### Requirement: Safe restarts and conditional cross-source retrieval

The system SHALL preserve persisted-index freshness across restarts and SHALL surface contradictions between documents and current code.

#### Scenario: DBC-13 dirty-tree restart

- **WHEN** ACE restarts while a Qdrant index generation predates working-tree edits
- **THEN** startup reports stale/unknown index status and rebuilds or uses a verified overlay, without silently upgrading the old generation to current

#### Scenario: DBC-14 conflicting documentation

- **WHEN** approved documentation asserts X but current verified source implements Y
- **THEN** `ace_context` exposes both with source classification, timestamp/revision and explicit conflict rather than silently preferring documentation as current code truth

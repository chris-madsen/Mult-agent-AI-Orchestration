# architecture-fitness — Spec Delta

## ADDED Requirements

### Requirement: Meyer design-by-contract gates at observable boundaries

The system SHALL validate production capabilities with explicit **preconditions**, **postconditions**, **class/aggregate invariants**, **frame conditions**, and **exceptional postconditions** at real provider integration or Codex MCP E2E level; isolated mocks SHALL be insufficient as sole evidence of production acceptance.

#### Scenario: Valid external query precondition

- **WHEN** a query references a registered authorized workspace and its required providers are approved and reachable
- **THEN** the resulting bundle fulfills precise source/span/citation postconditions and the user worktree remains unchanged as a frame condition

#### Scenario: Exception handling invariant

- **WHEN** a required provider fails, a source races or an unauthorized outbound route is requested
- **THEN** the result explicitly distinguishes partial/unavailable/stale/denied, never fabricates success, and no forbidden network request is sent

### Requirement: Lossless original artifacts and source provenance

The system SHALL guarantee exact reversible access to original source and generated artifacts while returning initially relevance-ranked snippets.

#### Scenario: DBC-08 exact artifact round-trip

- **WHEN** an artifact contains more than 2000 lines, including edge-case Unicode and newline patterns
- **THEN** an authorized paged read reconstructs the identical original bytes and SHA-256, independent of initial excerpt size

### Requirement: Stable memory identity and safe content sharing

The system SHALL preserve episode identity across append/replay and SHALL not destroy shared original content when deleting one reference, including derived-graph purge obligations.

#### Scenario: DBC-10 append and reimport

- **WHEN** a new record is appended to an existing Codex history JSONL file and history is imported again
- **THEN** previously imported episode identifiers and citations remain stable and only the new episode is added

#### Scenario: DBC-11 shared content deletion

- **WHEN** two episodes reference a shared content-addressed blob and one episode is deleted
- **THEN** its reference and derived projections become inaccessible, the surviving episode remains readable, and original bytes are removed only when no authorized references remain

### Requirement: Mandatory exit-gate semantics

The system SHALL separate port-designed, adapter-implemented, real-provider-tested, agent-E2E-passed, benchmark-evaluated and owner-approved states. A documented controlled exception SHALL NOT count as a passed mandatory acceptance contract.

#### Scenario: Adapter passes but runtime composition fails

- **WHEN** isolated Qdrant and LSP adapter tests pass but the MCP executable does not invoke them
- **THEN** capability remains `not_ready`, and all mandatory relevant runtime gate tasks remain unchecked

#### Scenario: Zero ACE calls despite lower tokens

- **WHEN** a paired run consumes fewer tokens but makes zero ACE calls
- **THEN** the report may report observed difference but SHALL NOT claim attributable ACE retrieval savings

# code-discovery — Spec Delta

## Purpose

Local hybrid code candidates, versioned indexes.

## ADDED Requirements

### Requirement: Qdrant code discovery

The system SHALL use a local Qdrant-backed code candidate index with symbol-aware references and a lexical fallback.

#### Scenario: Unknown behavior search

- **WHEN** a user describes code behavior without a symbol name
- **THEN** the system returns ranked local candidates with workspace ID, file, range and digest

#### Scenario: Exact identifier

- **WHEN** a query contains an exact known identifier
- **THEN** lexical matching can identify candidates without a required cloud request

### Requirement: Index generations and invalidation

The system SHALL version indexed code entries and invalidate stale candidates after observed working-tree mutations.

#### Scenario: Edit after index

- **WHEN** a file changes after its code entry was indexed
- **THEN** the old entry remains stale or is superseded, never verified-current

#### Scenario: Index rebuild failure

- **WHEN** Qdrant is unavailable during rebuild
- **THEN** the system reports stale/unavailable and does not manufacture current snippets

### Requirement: Snapshot-bound coverage and race handling

The system SHALL retain a deterministic digest of the workspace snapshot metadata and the parser identity with index coverage. A source whose exact read no longer matches the snapshot observation SHALL be excluded from the index and reported as a digest race; it SHALL NOT be treated as successfully indexed.

#### Scenario: Source changes between snapshot and exact read

- **WHEN** the workspace snapshot observes source digest D1 but the authoritative exact read returns D2
- **THEN** the source is not sent to the structural provider, coverage records `digest_raced`, and the resulting index remains incomplete for the failed path

#### Scenario: Coverage identity changes

- **WHEN** the workspace snapshot metadata or parser identity changes
- **THEN** the persisted coverage/snapshot identity changes and a previous Qdrant snapshot is not reused as if it were the same source state

### Requirement: Embedding provider selection

The system SHALL support a locally allowed embedding path and SHALL require explicit project policy approval for cloud embeddings.

#### Scenario: Cloud provider not selected

- **WHEN** no embedding provider has been approved by a measured spike
- **THEN** the production integration remains blocked rather than selecting an unreviewed SaaS

---

### Requirement: Genuine semantic and structurally precise production index

Production code discovery SHALL use approved real semantic embeddings with local Qdrant candidates and real parser-derived symbol boundaries; regex identifiers, hash projections and whole-file-per-symbol records MAY be used as declared test doubles/fallbacks but SHALL NOT satisfy real semantic/AST acceptance.

#### Scenario: DBC-02 exact 25-line function

- **WHEN** the target function is 25 lines inside a 2000-line file
- **THEN** its indexed verified range represents the true 25-line AST span and the full file remains separately available exactly

#### Scenario: DBC-03 unlabeled behavior query

- **WHEN** a behavior query does not contain exact symbol names
- **THEN** measured real semantic retrieval discovers relevant candidates, and SHA-256 pseudo-vectors are not reported as semantic success

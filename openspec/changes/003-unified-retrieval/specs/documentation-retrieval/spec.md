# documentation-retrieval — Spec Delta

## Purpose

Vertex AI RAG for project documentation.

## ADDED Requirements

### Requirement: Allowed document retrieval

The system SHALL query project documentation through Vertex AI RAG Engine only for documents and projects authorized by policy.

#### Scenario: Architecture intent query

- **WHEN** Codex requests the rationale from a permitted ADR
- **THEN** a cited document section and version are returned

#### Scenario: Private document disallowed

- **WHEN** a document is not authorized for cloud retrieval
- **THEN** the operation is refused before upload or query payload transfer

### Requirement: Document and code disagreement

The system SHALL preserve both cited documentation assertions and live code evidence when they disagree.

#### Scenario: Outdated ADR

- **WHEN** an ADR states behavior that contradicts current code
- **THEN** both sources and their versions are shown with a conflict warning instead of silent reconciliation

### Requirement: Honest outage handling

The system SHALL treat document-service errors as source unavailability while preserving allowed local lookup.

#### Scenario: Vertex timeout

- **WHEN** Vertex does not respond before configured timeout
- **THEN** the bundle notes missing documentation and continues only through permitted sources

# unified-context — Spec Delta

## Purpose

Adaptive-composable evidence and lossless disclosure.

## ADDED Requirements

### Requirement: Single composite request

The system SHALL assemble local candidates, AST/LSP facts, documentation and optionally memory into one source-attributed ContextBundle.

#### Scenario: Multi-source issue

- **WHEN** a query requires code, types and an ADR
- **THEN** one `ace_context` request returns a deduplicated bundle with cited evidence

#### Scenario: Simple known symbol

- **WHEN** a user asks for one exact function
- **THEN** unnecessary cloud routes are not mandatory

### Requirement: Truthful freshness and completeness

The system SHALL expose source revision, evidence method, freshness and incompleteness for substantive claims.

#### Scenario: Partial semantic analysis

- **WHEN** a dynamic edge may exist but is not statically resolved
- **THEN** the bundle states uncertainty instead of `no call exists`

#### Scenario: Mid-request change

- **WHEN** the working tree changes before delivery
- **THEN** the evidence is rechecked or marked `changed_during_request`

### Requirement: Relevance not arbitrary truncation

The system SHALL reduce irrelevant context through ranking, deduplication and disclosure, without mandatory fixed token ceilings or silent truncation of exact sources.

#### Scenario: Long required snippet

- **WHEN** a relevant generated source has at least 2000 lines
- **THEN** the source is preserved exactly and can be fetched completely via `ace_expand`

#### Scenario: Pathological result

- **WHEN** a backend returns an unbounded log or recursive graph traversal
- **THEN** the system reports explicit pagination/guard status without pretending the returned text is complete

### Requirement: Distinct failure types

The system SHALL deliver partial evidence with explicit source failures for technical outages and SHALL block forbidden operations for policy denials.

#### Scenario: Qdrant offline

- **WHEN** code retrieval fails but local AST/LSP remains allowed
- **THEN** the bundle is partial with truthful missing sources

#### Scenario: Secret leak attempt

- **WHEN** a route tries to disclose a protected key
- **THEN** that operation is denied and audited without fallback to another cloud endpoint

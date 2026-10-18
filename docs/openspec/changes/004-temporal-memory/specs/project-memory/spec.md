# project-memory — Spec Delta

## Purpose

Original Codex archive and Graphiti temporal recall.

## ADDED Requirements

### Requirement: Original session preservation

The system SHALL store original permitted Codex session episodes with source pointers, times and content digests independently of extracted summaries.

#### Scenario: Session captured

- **WHEN** a supported Codex export is available
- **THEN** the exact source is archived and digest verified before retrieval as original evidence

#### Scenario: Importer unavailable

- **WHEN** the installed Codex version cannot expose a supported source
- **THEN** capture reports unsupported and does not fabricate prior messages

### Requirement: Idempotent derived projection

The system SHALL project memory facts into Graphiti without modifying archived originals and SHALL retry extraction idempotently.

#### Scenario: Extraction fails

- **WHEN** Graphiti or the extractor is unavailable
- **THEN** the original remains readable while the derived projection is marked incomplete

#### Scenario: Duplicate ingestion

- **WHEN** the same session and extractor version are processed twice
- **THEN** no duplicate accepted decision or duplicate source episode is created

### Requirement: Explicit decision confirmation

The system SHALL require explicit human confirmation before promoting extracted candidate decisions to accepted architectural decisions.

#### Scenario: Unconfirmed memory

- **WHEN** a language model infers that the team selected Qdrant
- **THEN** the statement stays proposed and cannot be presented as an accepted ADR

#### Scenario: New accepted alternative

- **WHEN** a later decision supersedes an accepted one
- **THEN** the previous decision remains historically accessible with its valid time and successor

### Requirement: Temporal memory retrieval

The system SHALL answer prior-session queries using original episodes, time-aware decision history and source citations.

#### Scenario: Two-week-old discussion

- **WHEN** a new Codex session asks about a proposal from fourteen days earlier
- **THEN** the system returns matching original episode references and its then-current decision status

#### Scenario: Conflicting statements

- **WHEN** two episodes disagree on the accepted solution
- **THEN** the answer preserves the conflict and does not fabricate an authoritative synthesis

### Requirement: Deletion and privacy propagation

The system SHALL permit authorized deletion of archived data and corresponding derived Graphiti entries without leaving retrievable content.

#### Scenario: Erase session

- **WHEN** a permitted user requests deletion of an archived session
- **THEN** the system deletes/tombstones originals and derived indexes per policy and records a safe audit result

---

### Requirement: Stable session identity and safe content-addressed deletion

Codex episode identity SHALL survive append-only changes and retries; deleting one episode SHALL not remove original bytes shared by another live episode. Derived graph deletion SHALL respect tombstones.

#### Scenario: DBC-10 appended JSONL

- **WHEN** a new JSONL episode is appended after initial import
- **THEN** original episode IDs remain unchanged and replay is idempotent

#### Scenario: DBC-11 shared blob

- **WHEN** two episodes reference the same content digest and one is deleted
- **THEN** the survivor is readable exactly and only the deleted episode becomes inaccessible with derived projections purged

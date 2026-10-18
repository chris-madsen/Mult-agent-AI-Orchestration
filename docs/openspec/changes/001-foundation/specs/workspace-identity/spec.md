# workspace-identity — Spec Delta

## Purpose

Registry, working-tree identity and freshness boundaries.

## ADDED Requirements

### Requirement: Canonical workspace identity

The system SHALL register only authorized, canonical workspace roots and issue stable workspace identifiers.

#### Scenario: Valid workspace

- **WHEN** a user registers an accessible repository under an allowlisted root
- **THEN** a WorkspaceId and canonical root are persisted

#### Scenario: Path escape

- **WHEN** a path or symlink escapes the authorized root
- **THEN** registration or read is denied and a safe security event is recorded

### Requirement: Working tree is not just HEAD

The system SHALL track current file content digests and observation epochs independently of the repository HEAD.

#### Scenario: Uncommitted edit

- **WHEN** a tracked or untracked source file is modified without a commit
- **THEN** a new observation identifies the changed content and invalidates its prior freshness

#### Scenario: Concurrent write

- **WHEN** a file changes between observation and final evidence materialization
- **THEN** the source is marked changed_during_request or retried safely, never verified-current

### Requirement: Safe current file access

The system SHALL expose revision-checked file read operations to domain clients without allowing cross-workspace traversal.

#### Scenario: Matching digest

- **WHEN** a permitted file matches its expected digest
- **THEN** a verified read returns exact content and digest

#### Scenario: Digest mismatch

- **WHEN** the content digest differs from the expected digest
- **THEN** a typed mismatch is returned instead of silently substituting old bytes

### Requirement: Pod worktree-access spike

The system SHALL document and verify a safe way for the existing local Kubernetes deployment to access the live working tree before claiming real-time freshness.

#### Scenario: No accepted mount pattern

- **WHEN** the host-to-pod access design has not passed permissions and race tests
- **THEN** the integration is marked experimental and cannot claim live current verification

# gateway-ownership specification

## ADDED Requirements

### Requirement: Exclusive projection ownership

A strict model request SHALL have exactly one authoritative context owner: `native`, `gateway`, `assist-only`, `observe-only` or `off`.

#### Scenario: dual owner
- **WHEN** a request claims native and gateway ACE ownership together without an authenticated deduplicated composition
- **THEN** admission returns `DUAL_PROJECTION_OWNER`
- **AND** no provider attempt is sent.

#### Scenario: explicit non-projecting mode
- **WHEN** projection mode is `off`, `observe-only` or `assist-only`
- **THEN** the decision states that no model-bound ACE projection is being claimed
- **AND** a missing ACE projection is not relabeled as success.

### Requirement: Trusted host ownership attestation

Strict ACE attribution SHALL require an authenticated host attestation bound to session, workspace and tenant identity.

#### Scenario: missing or stale attestation
- **WHEN** host engine identity, compression controls, transcript revision, attestor identity or compaction epoch is missing, stale or mismatched
- **THEN** the request is blocked with a typed ownership error
- **AND** no upstream provider call occurs.

#### Scenario: unknown epoch
- **WHEN** `hostCompactionEpoch` is unknown
- **THEN** it is not interpreted as epoch zero
- **AND** strict ownership remains unverified.

### Requirement: No hidden host compaction

Strict H2/H3 ACE evidence SHALL reject active host, manual, micro, idle, proactive, provider-native or app-server compaction that is not separately authorized and attributed.

#### Scenario: manual compaction
- **WHEN** a manual or forced compaction is requested during a strict ACE run
- **THEN** it is denied or proven to be a no-op
- **AND** the old active transcript rows remain byte-stable.

#### Scenario: fallback engine
- **WHEN** Hermes falls back from the configured engine to a built-in compressor or the engine identity drifts after resume, child spawn or model switch
- **THEN** strict attribution is blocked
- **AND** the fallback is recorded without raw transcript data.

### Requirement: Request-local projection and protected groups

ACE SHALL alter only the provider request and SHALL preserve unknown fields and complete protected message groups.

#### Scenario: valid apply
- **WHEN** the original body digest, route, workspace, attestation and deadline are valid
- **THEN** the response may return `APPLY` with original/projected digests, projection ID and receipt ID
- **AND** durable transcript and worktree bytes remain unchanged.

#### Scenario: provider-managed history
- **WHEN** the request depends on hidden provider-managed history that ACE cannot reconstruct
- **THEN** strict G3 is blocked or downgraded to an explicit lower capability
- **AND** it is never advertised as full context replacement.

### Requirement: Strict failure and attempt evidence

An ACE timeout, malformed response, stale digest, replay, policy denial or unverified final send SHALL fail closed for strict routes.

#### Scenario: replay or stale projection
- **WHEN** a projection is reused with a different session, attempt group, body digest, route or expired deadline
- **THEN** the decision is `BLOCK`
- **AND** the provider receives zero requests.

#### Scenario: retry/fallback
- **WHEN** Bifrost changes provider, model or serialization for a retry
- **THEN** each effective attempt is reauthorized and bound to its own wire evidence
- **AND** an unguarded attempt is blocked.

### Requirement: Redacted receipts

Ownership and projection receipts SHALL contain only identities, digests, statuses, selected/omitted evidence IDs and typed failure metadata.

#### Scenario: secret-bearing input
- **WHEN** credentials or raw private payloads would be written to a receipt or diagnostic
- **THEN** the receipt is rejected or sanitized
- **AND** the secret bytes are absent from persisted evidence.

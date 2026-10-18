# security-policy — Spec Delta

## Purpose

Cloud opt-in, deny behavior and safe failure records.

## ADDED Requirements

### Requirement: Explicit outbound authorization

The system SHALL authorize every external payload transmission against a versioned project data policy before sending it.

#### Scenario: Private code no opt-in

- **WHEN** a private code embedding or routing request is attempted without an allowed project opt-in
- **THEN** the outbound request is denied before any payload leaves the machine

#### Scenario: Provider switch

- **WHEN** the selected SaaS provider fails and a different provider is considered
- **THEN** a fresh authorization is required before sending a replacement request

### Requirement: Technical degraded vs forbidden

The system SHALL distinguish retrieval outages from policy/authentication violations and SHALL never bypass a denial via fallback.

#### Scenario: Technical timeout

- **WHEN** a permitted Qdrant or Vertex query times out
- **THEN** the failure is marked technical and an allowed local fallback may be reported

#### Scenario: Authorization failure

- **WHEN** the operation is denied due to credentials, policy, residency or a secret
- **THEN** the forbidden route fails closed and the deny is logged

### Requirement: Secret-free audit

The system SHALL write structured error/audit records without storing credentials, raw private prompts or source snippets.

#### Scenario: Safe failure log

- **WHEN** a policy denial or source outage occurs
- **THEN** the log records timestamp, component, category, correlation ID and outcome without secret payload

### Requirement: Untrusted retrieval content

The system SHALL treat code snippets, documentation and imported dialogue content as untrusted data rather than executable instructions.

#### Scenario: Injected instruction in README

- **WHEN** retrieved text contains instructions to change policy or exfiltrate data
- **THEN** the system includes only permitted evidence and does not execute or elevate the instruction

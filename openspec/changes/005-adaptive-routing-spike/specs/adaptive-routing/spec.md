# adaptive-routing — Spec Delta

## Purpose

Measured strategy-selection experiment, Jev not preapproved.

## ADDED Requirements

### Requirement: Deterministic reference strategy

The system SHALL provide a rule-based routing implementation as the control condition for adaptive retrieval experiments.

#### Scenario: Known symbol

- **WHEN** the request names an exact symbol and file
- **THEN** the reference strategy can route directly to local semantic lookup without mandatory Vertex query

### Requirement: Candidate Jev strategy

The system SHALL treat Jev as an optional experimental strategy selector and SHALL NOT enable it as production default without an explicit later approval.

#### Scenario: Jev spike

- **WHEN** the comparison experiment runs with a permitted, available Jev interface
- **THEN** its routes, failures, provider usage and latency are recorded alongside the reference policy

#### Scenario: Privacy blocked

- **WHEN** the query includes private code and no Jev opt-in exists
- **THEN** no Jev request is sent and rule-based routing remains available

### Requirement: Multi-source and fallback correctness

A selected routing plan SHALL support multiple evidence sources and preserve fallback on uncertainty or technical failure.

#### Scenario: Ambiguous question

- **WHEN** an intent needs both code and prior decisions
- **THEN** the plan can include both code retrieval and memory search

#### Scenario: Wrong route

- **WHEN** Jev skips a source required to answer the task
- **THEN** the comparison records the miss and does not count token savings as success

### Requirement: Acceptance by end-to-end evidence

Jev SHALL be introduced into the production path only after a separately approved decision supported by frozen evaluation results.

#### Scenario: No quality improvement

- **WHEN** Jev increases full cost or harms task success compared with the rule-based policy
- **THEN** the production default remains deterministic and the negative finding is preserved

# gateway-attempt-reauthorization — Spec Delta

## ADDED Requirements

### Requirement: Authorization belongs to each actual attempt

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-009 — Second attempt after transient failure
- **WHEN** Bifröst intends to retry the same provider/model after an initial attempt
- **THEN** mint or derive a distinct single-use attempt identity and perform fresh ACE authorization against the exact final model-bound body before any second send
- **AND** the original ingress APPLY receipt alone SHALL NOT authorize the retry

#### Scenario: G11-010 — Fallback changes destination or model
- **WHEN** Bifröst proposes a fallback provider/model or data residency boundary
- **THEN** re-evaluate opt-in, allowed provider, actual data class, protected payload, source freshness and model-bound request for the new destination
- **AND** reject forbidden or unverified fallbacks with zero new provider egress

### Requirement: Replay prevention and failure transparency

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-011 — Reused, stale, raced or mismatched receipt
- **WHEN** a receipt belongs to a different physical request, attempt number, session correlation, body digest or provider/model, or is consumed twice
- **THEN** deny the attempt with an auditable typed outcome, including concurrent attempts and process restart where applicable
- **AND** do not reuse a permitted decision merely because an inbound digest matches

#### Scenario: G11-012 — Uncertain reauthorization result
- **WHEN** ACE policy/projection times out, returns NOT_READY, detects likely secrets or cannot bind the final attempt
- **THEN** fail closed before dispatch and preserve an honest attempt-level denial record
- **AND** retain the currently implemented retry/fallback block until an approved, tested replacement is available


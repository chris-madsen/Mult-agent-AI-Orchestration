# gateway-real-agent-and-economics — Spec Delta

## ADDED Requirements

### Requirement: Real agent on the sole approved route

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-013 — End-to-end real coding-agent task
- **WHEN** an explicitly selected coding-agent process uses a configurable Bifröst endpoint for a nontrivial source-retrieval coding task
- **THEN** prove the same task traverses agent, loaded Bifröst ACE plugin, authenticated ACE projection and an allowed real LLM provider
- **AND** retain agent/provider/runtime/build IDs, source SHA, bound request/attempt receipt, task result and actual provider evidence

#### Scenario: G11-014 — Host context attestation limits
- **WHEN** Bifröst observes only provider-compatible HTTP requests and no independent authenticated host transcript/compaction attestor is installed
- **THEN** label durable host history and compaction as unattested; permit only truthful additive visible-request claims
- **AND** do not claim exclusive context ownership, compaction suppression or attributable savings from request bytes alone

#### Scenario: G11-015 — Hidden provider-managed state or bypass attempt
- **WHEN** a request uses a hidden provider-held continuation, a second ACE agent-facing path, or an agent bypasses configured Bifröst
- **THEN** block the unsupported path or mark the uncontrolled run ineligible for G11 acceptance
- **AND** no implicit model tool call, separate Hermes context bridge or fake host attestation can satisfy this gate

#### Scenario: G11-016 — Authorization and acceptance of real work
- **WHEN** a real agent/provider trial lacks explicit external opt-in, provider allowlist, appropriate project data policy, safe synthetic input or an independently checked task outcome
- **THEN** do not perform unapproved provider egress or mark the task accepted
- **AND** retain security, task-quality and source-freshness failure evidence as first-class outcomes

### Requirement: Paired Harbor economics must be quality-gated and causally attributable

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-017 — Strong paired baseline
- **WHEN** Harbor compares a Gateway-delivered ACE task with a baseline on a frozen task/revision
- **THEN** match agent, model/provider, reasoning effort, tools, permissions, timeout and task environment while preserving baseline native capabilities
- **AND** record all trial arms and matched task identities as specified by the existing agent-benchmarking capability

#### Scenario: G11-018 — Exact usage or unavailable counters
- **WHEN** provider/agent reports input, output, cached, reasoning or billed usage inconsistently or not at all
- **THEN** count cached and reasoning subsets only once, record total external spend and latency independently, and keep missing measurements UNKNOWN rather than zero
- **AND** estimated token savings remain non-blocking telemetry and cannot be presented as provider-reported cost or accepted-task savings

#### Scenario: G11-019 — Quality degradation or failed trials
- **WHEN** a supposedly cheaper ACE task fails quality tests, times out, aborts or is rejected by the source/egress gate
- **THEN** retain that trial in denominator and quality reporting and refuse a fivefold improvement claim
- **AND** publish repetitions and quality-first outcomes instead of filtering failed runs

#### Scenario: G11-020 — Unverified ACE attribution or release claim
- **WHEN** an ACE arm has no valid attempt-bound APPLY receipt, only additive context, incomplete final-wire proof, or lacks accepted frozen holdout and owner signoff
- **THEN** separate observed token difference from causal ACE benefit and keep full G11/release status NOT_RUN, PARTIAL or BLOCKED as appropriate
- **AND** do not declare the project production-ready or at least fivefold better from a mock, a partial run or one selected trace


# gateway-streaming — Spec Delta

## ADDED Requirements

### Requirement: Streaming is separately certifiable

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-005 — Complete streaming success
- **WHEN** an authorized stream=true provider-native Responses request is sent through the exact pinned route after streaming support is explicitly enabled for that route
- **THEN** prove the final request preserves ACE projection, provider/model, tools and original ordered input/reasoning/tool-result semantics and the live provider stream completes with a valid terminal event
- **AND** retain correlated chunk ordering, terminal status, usage availability and final network-attempt identity without logging private chunk content

#### Scenario: G11-006 — Unsupported streaming variant
- **WHEN** a requested protocol, vendor extension, multimedia or tool-stream shape lacks verified lossless/semantically safe support
- **THEN** deny the attempt before external egress with an explicit unsupported capability result
- **AND** never silently turn stream=true into false, remove opaque fields or claim a successful projection

### Requirement: Cancellation and partial failures

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-007 — Client cancellation or deadline
- **WHEN** a client disconnects, a deadline expires or cancellation arrives before dispatch or during a streaming response
- **THEN** stop pending work, avoid new unauthorized attempts and report the correct cancelled or partial outcome
- **AND** retain provider-side bytes already sent as egress evidence; never report rollback of irreversible sends

#### Scenario: G11-008 — Midstream failure and incomplete usage
- **WHEN** provider streaming aborts, chunks are truncated, a transport error occurs or usage data is omitted
- **THEN** preserve the error/partial transcript and unknown usage fields and do not emit a fabricated clean terminal success
- **AND** ensure the run remains visible to G11 and Harbor quality/cost accounting


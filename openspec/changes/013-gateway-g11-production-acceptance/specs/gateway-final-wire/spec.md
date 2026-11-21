# gateway-final-wire — Spec Delta

## ADDED Requirements

### Requirement: Final-send observation, not hook inference

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-001 — Exact allowed outbound projection
- **WHEN** an authorized provider-native, non-streaming Responses request with explicit store:false is projected and dispatched through pinned Bifröst
- **THEN** capture the actual final provider-bound request after every mutating hook; compare its model, destination, original ordered input items (including function_call and function_call_output linkage), reasoning/opaque items, tool payload, stream setting, unknown fields and exactly one permitted ACE context insertion to the authorized snapshot
- **AND** retain ingress/receipt/attempt/final-send digests and report a mismatch as failure; a PreLLM PASS alone is insufficient

#### Scenario: G11-002 — Later mutation or unverified plugin ordering
- **WHEN** a custom plugin after ACE changes or can change provider-bound content, or the loaded plugin order is not established
- **THEN** reject final-wire certification and block an unsafe route before real provider egress whenever enforcement is possible
- **AND** a mock upstream capturing changed bytes MUST expose the violation rather than turning it into PASS

### Requirement: Real provider evidence and truthful capabilities

The ACE context extension implementation SHALL satisfy the following observable G11 criteria before the named capability is certified. Repository-only and mock-only evidence MUST NOT count as external-provider or real-agent acceptance.

#### Scenario: G11-003 — Authorized actual provider trial
- **WHEN** an operator explicitly permits a disposable synthetic/public-data trial with a specified provider/model and approved egress policy
- **THEN** observe an instrumented final-send boundary and a correlated real provider response for the exact route and pinned runtime identities
- **AND** keep restricted raw payload local, publish redacted evidence and hashes, and distinguish this from a mock-upstream-only run

#### Scenario: G11-004 — Unsupported or changed route
- **WHEN** a route/protocol/stream mode is untested, the Bifröst or ACE source/config changes, or the capability report still says not_certified
- **THEN** keep **ordinary generation** unavailable and block unsafe paths, retries, mutation and fallback rather than forwarding without ACE
- **AND** the only pre-certification live call is a separately owner-authorized, disposable PUBLIC C03–C05 test probe under an already verified per-physical-send guard and transmission-time privacy/target policy; a probe does not certify general routing
- **AND** require fresh route-by-route evidence after relevant version/config changes; no blanket Gateway certification


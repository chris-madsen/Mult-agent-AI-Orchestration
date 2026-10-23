# hermes-context-integration — Spec Delta

## ADDED Requirements

### Requirement: Request-time ACE transformation

ACE SHALL be able to transform the context of the next Hermes provider request without requiring Hermes to call an ACE MCP tool.

#### Scenario: ContextEngine projection

- **WHEN** Hermes invokes the configured ACE ContextEngine for a request
- **THEN** ACE returns a bounded request-only context projection with source/evidence identity
- **AND** the durable Hermes transcript remains unchanged.

#### Scenario: Current query and workspace

- **WHEN** the current user query and workspace identity are sent to ACE
- **THEN** retrieval uses the current verified workspace state and the request budget
- **AND** stale or raced source evidence cannot be marked current.

### Requirement: Direct bridge contract

The Hermes plugin and ACE runtime SHALL communicate through a versioned local request/response bridge with request IDs and typed readiness status.

#### Scenario: Valid bridge request

- **WHEN** a schema-valid request reaches the bridge
- **THEN** exactly one response with the same request ID is returned
- **AND** the response contains transformation receipt and provider/runtime identity.

#### Scenario: Bridge failure

- **WHEN** the bridge times out, returns malformed JSON, exits, or reports a required provider failure
- **THEN** the plugin reports `UNKNOWN` or `BLOCKED`
- **AND** the result is not interpreted as `ACE_NOT_USED` or measured zero.

### Requirement: Message-group integrity

The Hermes plugin SHALL preserve provider-valid logical message groups while selecting request context.

#### Scenario: Tool-call group

- **WHEN** an assistant tool call is retained or omitted
- **THEN** its matching tool result is retained or omitted with it
- **AND** no unmatched provider tool message reaches the provider.

#### Scenario: Provider reasoning carrier

- **WHEN** a provider-specific reasoning/signature carrier is required by a retained assistant message
- **THEN** the carrier remains attached to the logical group
- **AND** the plugin does not normalize it by deleting provider-required metadata.

### Requirement: Receipt-bound benchmark evidence

A Hermes+ACE trial SHALL bind request-time transformation receipts to the generated job, source/runtime identity, raw trial artifacts, and ACE provider traces.

#### Scenario: Missing receipt

- **WHEN** a trial has no valid transformation receipt for an expected ACE request
- **THEN** the trial remains `UNKNOWN` or `BLOCKED`
- **AND** it cannot claim ACE-caused context economy.

#### Scenario: Native arm

- **WHEN** the native Hermes arm runs
- **THEN** it has no ACE plugin/bridge transformation
- **AND** no ACE context or ACE receipt is attributed to the baseline.

### Requirement: Quality-first context economy

ACE context economy SHALL be accepted only when task quality is non-inferior and transformation evidence is complete.

#### Scenario: Context reduction with quality regression

- **WHEN** the transformed request uses fewer tokens but task quality regresses
- **THEN** the paired result is not accepted as an ACE improvement.

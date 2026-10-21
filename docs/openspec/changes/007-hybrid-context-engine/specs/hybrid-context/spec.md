# hybrid-context — Spec Delta

## ADDED Requirements

### Requirement: Hybrid dense and lexical code retrieval

The system SHALL support independent dense semantic and sparse lexical retrieval over the same verified structural code chunks and SHALL be able to fuse the candidate lists without requiring a second search database.

#### Scenario: Behavior query without identifier

- **WHEN** a query describes behavior without naming a symbol
- **THEN** dense retrieval contributes relevant candidates to the fused shortlist.

#### Scenario: Exact identifier or configuration key

- **WHEN** a query contains an exact rare symbol, environment key, UUID/hash-like literal or configuration token
- **THEN** sparse/lexical retrieval can contribute the matching chunk even when dense similarity is weak.

#### Scenario: Hybrid fusion

- **WHEN** dense and sparse branches return overlapping and distinct candidates
- **THEN** the system fuses them with a documented provider-native algorithm and retains branch/fused provenance.

### Requirement: Evidence-gated reranking

The system MAY rerank a bounded fused shortlist using an approved maintained local reranker and SHALL expose whether reranking actually ran.

#### Scenario: Reranker unavailable

- **WHEN** reranking is optional and the reranker is unavailable
- **THEN** fused ranking MAY be used with an explicit degraded/omitted reranker status
- **AND** the response SHALL NOT claim reranker-backed ordering.

### Requirement: Dynamic working context

The system SHALL incorporate authoritative current Git/worktree state and MAY incorporate client-provided focus/open-file hints as ranking priors.

#### Scenario: Focus hint

- **WHEN** the client supplies a focused file/range
- **THEN** matching current evidence may receive a ranking prior
- **AND** the hint SHALL NOT make stale or unrelated evidence authoritative.

#### Scenario: Dirty tree

- **WHEN** an indexed chunk conflicts with current working-tree bytes
- **THEN** current bytes win and stale evidence cannot be delivered as current.

### Requirement: Context receipt and delta delivery

The system SHALL assign stable bundle/evidence identities and SHALL support suppressing unchanged previously-known evidence bodies.

#### Scenario: Repeated context request

- **WHEN** a client presents a prior bundle/evidence receipt and relevant evidence is unchanged
- **THEN** ACE returns a compact reference for unchanged evidence instead of retransmitting the same body
- **AND** exact bytes remain available through authorized expansion.

#### Scenario: Evidence changed

- **WHEN** evidence with the same logical source changes digest/range/content
- **THEN** the new evidence is delivered as changed/new rather than hidden behind the prior receipt.

### Requirement: Quality-gated context economy

The system SHALL measure context savings only together with task/retrieval quality.

#### Scenario: Token reduction with quality regression

- **WHEN** a candidate architecture reduces context bytes/tokens but fails the predeclared quality/non-inferiority gate
- **THEN** it SHALL NOT be accepted as an ACE improvement.

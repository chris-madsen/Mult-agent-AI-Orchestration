# agent-benchmarking — Spec Delta

## Purpose

Harbor baseline, complete usage and comparative evidence.

## ADDED Requirements

### Requirement: Strong native Codex baseline

The system SHALL run the unmodified Codex baseline with normal code-search, shell, tests, caching and compaction available.

#### Scenario: Baseline preparation

- **WHEN** a baseline task is launched
- **THEN** the model, reasoning effort, task input, repository commit and tool permissions match its paired experiment configuration

### Requirement: Harbor run isolation

The system SHALL use Harbor to run reproducible tasks in isolated environments while retaining failed and aborted runs.

#### Scenario: Independent rerun

- **WHEN** a benchmark task is repeated for a new configuration
- **THEN** a fresh isolated environment and the pinned base commit are used

#### Scenario: Timeout

- **WHEN** a run times out or crashes
- **THEN** the failed run is recorded in pass rate and cost analysis instead of being discarded

### Requirement: Correct provider-reported usage

The system SHALL capture available Codex provider-reported token usage and SHALL distinguish cumulative snapshots from per-step deltas.

#### Scenario: Cached and reasoning subsets

- **WHEN** input, cached_input, output and reasoning_output counters are present
- **THEN** total is input plus output without adding cached or reasoning subsets twice

#### Scenario: Cumulative event

- **WHEN** two events represent successive cumulative totals
- **THEN** the ledger uses final/differenced semantics and never sums both totals as independent usage

#### Scenario: Missing usage

- **WHEN** usage is unavailable for a failed run
- **THEN** unknown is recorded explicitly rather than zero or estimated tokens

### Requirement: Independent quality gate

The system SHALL evaluate functional correctness and regressions independently of token counts.

#### Scenario: Cheaper wrong patch

- **WHEN** ACE uses fewer tokens but fails hidden or explicit tests
- **THEN** the run is not counted as an accepted success and 5x is not claimed

### Requirement: Frozen holdout and comparison

The system SHALL support versioned exploratory and frozen holdout suites and report all relevant runs with provenance.

#### Scenario: Claiming fivefold savings

- **WHEN** a report asserts >=5x end-to-end token reduction
- **THEN** it includes frozen-suite identity, baseline, quality gate, repeat counts, raw events and limitations

#### Scenario: Competitor comparison

- **WHEN** Serena or Augment is included
- **THEN** the report identifies exact versions, permissions and any instrumentation limitations

### Requirement: Other provider costs

The system SHALL record the attributable cost of Vertex, embeddings, memory extraction, Jev and indexing separately from Codex tokens.

#### Scenario: External work saved no Codex tokens

- **WHEN** a run used third-party model calls
- **THEN** their provider usage/cost is included in the cost ledger rather than omitted

---

### Requirement: Agent-level causal attribution and realistic retrieval tasks

The system SHALL separate measured token differences from demonstrated ACE-caused benefit and SHALL use retrieval-demanding paired tasks for any retrieval-efficiency claim.

#### Scenario: DBC-12 zero ACE calls

- **WHEN** ACE-enabled Codex uses fewer tokens than baseline but invokes zero ACE tools
- **THEN** the report records the difference and SHALL explicitly deny attribution to ACE retrieval

#### Scenario: Trivial forced tool smoke

- **WHEN** the only paired task replaces a known TODO token and ACE invocation is forced by instruction
- **THEN** the result may validate protocol integration but SHALL NOT pass the code-retrieval benefit acceptance gate

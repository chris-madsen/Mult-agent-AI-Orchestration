# ACE post-merge correctness and acceptance plan

> **Этот план объединён в [единый рабочий план](./2026-10-19-unified-ace-correctness-and-production-plan.md).** Для новых задач используйте единый backlog; этот файл сохранён для истории и проверки источников. Он не является самостоятельной очередью выполнения.


Date: 2026-10-19
Baseline reviewed: `2a4c2f79d958ed8babd28dd14ef339ac0fb9c180` (main after PR #8).
Status: proposed execution plan; no task below is claimed complete.

## 0. Scope and evidence discipline

This plan addresses the five findings from the post-merge static review and the remaining verification necessary to close them. It is not a complete repository security audit. Reconfirm each finding against the implementation branch before editing; preserve reproduction evidence and distinguish a reachable production defect from a defensive-contract gap.

Authority: root `AGENTS.md`, accepted ADRs and applicable OpenSpec capabilities. This document is temporary execution guidance, not a replacement for normative specs. Put new observable requirements and negative scenarios into OpenSpec before claiming acceptance. Do not modify accepted ADRs without owner approval. Use reviewable implementation branches and PRs; do not implement these code changes directly on main. Leave benchmark/production gates open until their actual evidence exists.

Already present at the reviewed baseline, not new work: final source reread after documentation calls; existing Qdrant dimension and Cosine validation; strict UTF-8 span validation; rejected-report label preservation; binding Sentence-Transformers loading and hashing to one local snapshot. Preserve their regression tests.

## 1. Execution order

1. Capture failing fixtures and freeze their expected outcomes.
2. Track A: immutable snapshot isolation, publication and safe lifecycle.
3. Track B: exact semantic identity; may run in parallel with A.
4. Track C: index coverage and truthful completeness; integrate with A/B.
5. Track D: resolved embedding configuration and actual worker identity; complete before real-provider validation of A.
6. Track E: temporal decision history; independent of retrieval fixes.
7. Run cross-track failure/restart/concurrency tests, CI and real MCP/provider gates.
8. Reconcile specs, review findings and readiness evidence; then owner review.

Priorities: A-D are P1 correctness work. E is P2 and must not block unrelated retrieval experiments. No 5x result is a prerequisite for running tests.

## 2. Track A — Qdrant snapshot isolation and lifecycle (P1)

Files: `src/adapters/http-provider-boundaries.ts`, `src/adapters/qdrant-context-provider.ts`, `src/bin/ace-mcp.ts`; relevant ports/storage contracts.

Observed mechanism: point ID depends on candidateId, whereas index_key is only payload. An unchanged file keeps its candidate IDs across workspace snapshots. Upserting S2 can therefore overwrite S1 points before S2 is complete. Startup pruning can also delete S1 while another MCP process still reads it. Real concurrency/restart reproduction is required before closing the finding.

Tasks:
- [ ] Reproduce two processes on one collection/workspace: A serves S1; B builds S2 after changing only one file. Prove unchanged-file candidates are not lost to A.
- [ ] Define point identity from workspace + snapshot identity + candidate identity using a deterministic collision-resistant encoding. Preserve idempotent upsert within one snapshot. Do not derive IDs by stripping non-hex characters from arbitrary identifiers.
- [ ] Decide snapshot granularity and document reader/writer concurrency explicitly. Do not use observationEpoch as content identity.
- [ ] Define build states such as building/validated/published/retired. Publish only after all expected batches and manifest validation succeed; a point count alone is not proof of exact membership or successful publication.
- [ ] Validate candidate IDs/membership and relevant model/schema identity against a persisted manifest before warm reuse. Equal counts with wrong membership must not pass.
- [ ] Protect same-snapshot concurrent rebuilds and collection creation; serialize or make operations safely idempotent. Avoid clearing a partition another builder just completed.
- [ ] Replace unconditional deletion of all other snapshots with a safe reader-lifecycle protocol. Define leases/refcounts or an equivalent coordinated mechanism, including process death, grace periods, restart recovery and bounded retention. Age alone is not proof that no reader exists.
- [ ] Prefer retaining uncertain/orphan snapshots to deleting possibly active data. Add an operator-visible cleanup procedure and bound storage growth.
- [ ] Migrate old point-ID/schema layout explicitly: new namespace/version or controlled rebuild. Never silently warm-reuse incompatible old points.

Acceptance: S2 build failure/cancellation leaves S1 usable; S2 publication never exposes partial data; active S1 readers survive publication/cleanup; eventual cleanup does not remove active snapshots; restart with unchanged bytes reuses a verified snapshot; dirty restart cannot serve stale source as current. Verify through actual MCP clients and real Qdrant, not only mocked HTTP.

## 3. Track B — exact LSP identity (P1)

Files: `src/adapters/qdrant-context-provider.ts`, `src/adapters/typescript-language-service.ts`, `src/adapters/local-code-index.ts`, `src/domain/semantic.ts`.

Observed gap: confirmation checks only file and enclosing start/end lines. Columns and exact identifier identity are ignored. This is insufficient to distinguish definitions on one line or nested definitions within a large node.

Tasks:
- [ ] Add negative fixtures with two same-line declarations, nested shadowing and misleading same-name symbols. Separate provider correctness from the consumer's acceptance predicate.
- [ ] Retain an exact identifier range, not merely a start position. Validate the anchor is inside the verified syntax node and refers to its actual declared identifier.
- [ ] Specify coordinate systems: Tree-sitter UTF-8 byte columns versus TypeScript UTF-16 columns; one-based adapter contract and exclusive end positions. Test CRLF, BOM, Cyrillic and astral characters before the identifier.
- [ ] Match returned definition to the intended declaration/identifier range. Compare same-file location and exact coordinates; name is additional evidence, never sufficient identity by itself.
- [ ] Specify valid overload/alias/multiple-definition behavior. Do not reject valid results merely to make one-definition fixtures pass; retain ambiguity explicitly.
- [ ] Ensure semantic analysis uses source consistent with the verified evidence snapshot. Detect changed dependency files, not just edits to the selected snippet, or report semantic freshness as unverified.
- [ ] Preserve byte-exact source evidence on semantic failure, but do not label semantic identity confirmed; return truthful partial/uncertain status.

Acceptance: wrong same-line/nested definition never earns semantic confirmation; valid Unicode anchors resolve correctly; stale semantic state cannot become a current semantic proof; all existing exact expansion behavior remains lossless.

## 4. Track C — index coverage and completeness (P1)

Files: `src/adapters/local-code-index.ts`, `src/bin/ace-mcp.ts`, `src/adapters/qdrant-context-provider.ts`, retrieval domain/ports and workspace status.

Observed mechanism: unreadable files and structural failures are skipped with build warnings; runtime prints warnings but does not carry build coverage into ContextBundle. Successful retrieval from surviving candidates can therefore hide a degraded index.

Tasks:
- [ ] Define a coverage manifest with attempted/indexed/skipped/failed paths, reasons, parser identity, source snapshot and syntax-error state.
- [ ] Distinguish authorized policy exclusions and unsupported out-of-scope languages from failures on required source coverage. Do not make every harmless exclusion a failure.
- [ ] Persist coverage with the snapshot and verify it on warm reuse. Include coverage-relevant identity in cache validity.
- [ ] Propagate coverage status through runtime composition, workspace status and retrieval completeness; stderr alone is not an API contract.
- [ ] Define completeness against the authorized retrieval plan. If a failed required path cannot be ruled out as relevant, report degraded coverage rather than complete.
- [ ] Keep an empty result from a healthy index distinct from no result because required source coverage failed. Do not automatically mark every zero-hit query incomplete.
- [ ] Make later path recovery/change observable; define refresh/invalidation behavior instead of retaining startup-only failure state indefinitely.

Tests: one healthy file plus unreadable required file; parser crash; syntax-error partial parse; policy-excluded secret file; healthy zero matches; all required files fail; recovery and warm reuse. Acceptance: incomplete required coverage is visible in structured responses without exposing secret paths/content beyond policy.

## 5. Track D — resolved embedding configuration and worker identity (P1)

Files: `src/bin/ace-mcp.ts`, `src/adapters/process-embedding.ts`, Python workers, launcher scripts and artifact verifier.

Observed gap: bootstrap computes defaults used in collection identity/trace labels, but spawn inherits original environment rather than receiving that resolved configuration. Explicitly exported settings may work; omitted settings can leave metadata claiming a revision the worker never received.

Tasks:
- [ ] Create one typed, validated resolved config: provider, upstream model/revision, actual artifact model/revision/digest, dimension, preprocessing and inference runtime identity.
- [ ] Pass it explicitly to the selected worker through an allowlisted environment/protocol. Preserve required execution environment without logging credentials.
- [ ] Require a startup receipt containing actual loaded artifact identity and effective settings. Compare receipt with requested config before indexing/querying or warm reuse.
- [ ] Build collection/cache identity and provider labels from verified effective settings. A label supplied by the parent is not a provider receipt.
- [ ] Reject unknown providers and mismatched dimensions/revisions/digests; identify deliberately unpinned experimental mode explicitly.
- [ ] Verify a pinned artifact before model execution where supported; preserve local-only inference and fail closed when loaded-artifact identity is unavailable.
- [ ] Test both FastEmbed and Sentence-Transformers; preserve no-Ollama default. Do not substitute an unrelated cached snapshot as verification.

Tests: omitted environment defaults; whitespace/default normalization; explicit overrides; incompatible custom worker; missing cache; revision/digest mismatch; receipt mismatch; same dimension but different model; worker timeout/exit/cancellation. Acceptance: worker, collection key and trace identity agree, including default-only startup. Real model load/inference is a separate required gate from protocol test doubles.

## 6. Track E — historical decision semantics (P2)

File: `src/domain/memory.ts`; persistence/projection/search callers as applicable.

Observed mechanism: asOfMs filters episode occurrence times, but search returns today's decision.state and computes conflicts from today's Accepted records. That is not a historical decision-state snapshot.

Tasks:
- [ ] Define whether as_of means valid time, knowledge/import time, or both. Specify exact boundary behavior and document late-imported evidence.
- [ ] Store immutable decision transition events with timestamps, source evidence and explicit confirmation provenance. Track proposal, confirmation, rejection and supersession separately.
- [ ] Derive state at the requested time; validFromMs and today's state alone cannot reconstruct confirmation history.
- [ ] Calculate conflicts only among decisions effective in the same workspace/subject at that time. Do not mix unrelated workspaces.
- [ ] Preserve source citations and successor relationships. Reject self-links and invalid timelines; validate graph-level cycles/existence at the appropriate service boundary.
- [ ] Migrate existing records without inventing missing confirmation times. Return explicit historical uncertainty when reconstruction is impossible.
- [ ] Keep original archive bytes immutable; derived-state repair must not rewrite source sessions.

Tests: proposed -> accepted -> superseded at three distinct times; rejection; future decision excluded; non-overlapping accepted intervals not conflicting; overlapping contradictory decisions conflicting; same subject in different workspaces; late import; tombstones/replay; legacy missing history.

Acceptance: yesterday's query returns yesterday's justified state, not today's mutation. Current-state search still behaves correctly; unavailable historical facts remain unknown.

## 7. Validation and CI

- [ ] Establish baseline CI status for the exact implementation commit; do not infer main validation from a different PR head.
- [ ] Add deterministic unit/contract regressions for A-E before changing acceptance logic.
- [ ] Run npm ci, npm run check, npm run lint, npm test and npm run build; retain exact commands, commit and outputs. Keep Python artifact integrity tests enabled.
- [ ] Validate affected OpenSpec changes strictly using the repository's verified CLI/environment.
- [ ] Add real Qdrant lifecycle tests with two independent MCP processes and fault injection during batches/publication/pruning.
- [ ] Run actual embedding workers and structural/LSP providers through the official MCP client; test startup, timeout, cancellation, outage and restart.
- [ ] Check exact artifact expansion, progressive payloads, source-frame conditions, secret-safe diagnostics and no unauthorized egress.
- [ ] Separate deterministic CI from credential/hardware-dependent gates. Skipped integration means unverified, never passed. Do not weaken assertions or delete failing tests to get green CI.

## 8. Evaluation and production follow-through

- [ ] After correctness gates, measure cold build, verified warm reuse, repeated warm queries and dirty changes separately.
- [ ] Run frozen native-natural / ACE-optional-natural / ACE-forced-diagnostic Harbor arms with pinned model/settings/tasks; preserve request-correlated traces, failures and raw usage.
- [ ] Record task quality, actual ACE calls, duplicated native reads, evidence payload size, total/cached/uncached/output tokens, latency and measured or unknown local infrastructure cost.
- [ ] Keep forced diagnostics and production acceptance distinct; do not rewrite historical negative measurements.
- [ ] Close only applicable proven sub-gates. Independent Graphiti deletion/recall, approved Vertex citation/conflict, semantic-provider comparison, incremental indexing and owner promotion remain open unless separately evidenced.

## 9. Deliverables and exit criteria

Each implementation PR must include: reproduction; source fix; negative and recovery tests; relevant OpenSpec updates; migration notes; exact tested commit; CI result; real-provider evidence or an explicit blocker; residual risks.

Suggested PR slices: (1) snapshot identity/publication/lifecycle, (2) semantic identity + coverage integration, (3) worker config/receipts, (4) temporal history, (5) cross-track real-provider and benchmark evidence. Coordinate A/D before validating warm-cache behavior.

This plan is complete only when A-E acceptance scenarios are demonstrated or their scope is explicitly revised with owner approval, combined regressions pass, migrations/recovery are tested, and the review records distinguish implemented, real-provider-tested, agent-E2E-tested, benchmark-evaluated and owner-approved. Green CI alone never means no semantic bugs remain.

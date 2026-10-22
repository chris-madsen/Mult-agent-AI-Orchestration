# Xiaomi memory adoption: one-pass execution slices

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` task-by-task.
>
> **Source spec:** [xiaomi-memory-adoption-plan.md](./xiaomi-memory-adoption-plan.md)

**Goal:** add operational checkpoint/resume memory only if it measurably helps long-running coding tasks, while keeping ACE immutable history and Graphiti/decision authority intact.

**Architecture:** original session episodes remain source truth. Checkpoints, resume envelopes, lexical indexes and Dream/Distill outputs are versioned derived projections with source pointers and explicit status.

**Tech stack:** TypeScript/Node.js, Effect, existing file archive/outbox/Graphiti adapters, MCP, Harbor/feedback tooling.

## Global constraints

- Never let a checkpoint, Dream summary or Graphiti claim become an Accepted engineering decision automatically.
- Never call historical test/tool output “current” without live source/worktree revalidation.
- Deterministic checkpointing first; model-based writer only after a measured need.
- No new mandatory database before comparing existing archive/Graphiti/cheap lexical approaches.
- Private session data remains local unless destination-specific transmission is authorized.
- Every slice must preserve deletion/tombstone propagation.

## Review focus

1. Fork/parallel-session lineage must not choose the wrong “latest” checkpoint.
2. Replayed/crashed writes must be idempotent and cannot create ghost completed work.
3. Deleted originals must not survive via FTS/Dream/checkpoint projections.
4. Newer user intent must supersede stored `nextAction`.
5. Resume delivery must distinguish “prepared” from “actually consumed by the agent”.

---

### Slice XM-01: Codex lifecycle feasibility probe

**Files:** evidence/review artifact only; no production source changes.

- [ ] Inspect current `src/adapters/codex-session-history.ts`, Codex client/runtime capabilities and actual session export format.
- [ ] Determine which events are observable: user message, assistant/tool events, session id, timestamps, token usage, compaction/restart boundary.
- [ ] Record exact unavailable fields as `UNKNOWN`.
- [ ] Decide whether MVP uses automatic lifecycle hooks or explicit checkpoint/resume calls.

**Done when:** capture boundary is factual, not assumed.

---

### Slice XM-02: Second-client lifecycle probe

**Depends on:** none; can run independently from XM-01.

- [ ] Pick one actually available non-Codex MCP client.
- [ ] Record the same lifecycle matrix as XM-01.
- [ ] Identify the smallest agent-neutral event schema common to both.
- [ ] Do not change ACE runtime.

**Done when:** agent-neutral assumptions are tested against two clients or explicitly blocked.

---

### Slice XM-03: Frozen interruption-task corpus

**Depends on:** XM-01.

**Files:**
- Create benchmark manifest/fixture files under `benchmarks/`.
- Reuse current feedback task identity/digest rules where possible.

- [ ] Choose 3–5 long tasks that can be deterministically interrupted.
- [ ] Pin repository/task SHA and interruption point.
- [ ] Define acceptance: final quality, repeat file reads/searches, tokens, duration.
- [ ] Keep an untouched holdout subset.

**Done when:** checkpoint work has a fixed target before implementation.

---

### Slice XM-04: Native and current-ACE interruption baseline

**Depends on:** XM-03 and runtime availability.

- [ ] Run native agent interrupted/resumed without new memory.
- [ ] Run current ACE retrieval-only on same task/point.
- [ ] Retain provider usage and repeated-read/search metrics.
- [ ] If runtime unavailable, record `BLOCKED`.

**Done when:** there is a baseline to beat.

---

### Slice XM-05: SessionCheckpoint domain contract

**Depends on:** XM-01 common observable fields.

**Files:**
- Create: `src/domain/session-checkpoint.ts`
- Create: `test/session-checkpoint.contracts.test.ts`
- Read/reuse types from `src/domain/memory.ts`.

**Produces:** versioned `SessionCheckpoint` with workspace/session identity, sequence/predecessor, source episode IDs/cursor, extractor/policy version, intent/next action/task state/touched files and status.

- [ ] RED-test malformed IDs, missing source links, invalid sequence/predecessor and cross-workspace references.
- [ ] RED-test explicit unknown fields rather than invented values.
- [ ] Implement pure validation/identity constructors only.
- [ ] Commit.

---

### Slice XM-06: Deterministic checkpoint projector

**Depends on:** XM-05.

**Files:**
- Create: `src/application/session-checkpoint.ts`
- Create: `test/session-checkpoint-projector.contracts.test.ts`

**Interfaces:**
- Consumes: archived `SessionEpisode` references and deterministic client events.
- Produces: a checkpoint draft; no LLM inference.

- [ ] RED-test no-op with no new events.
- [ ] RED-test newer direct user intent supersedes stored next action.
- [ ] RED-test completed/open/blocked task transitions.
- [ ] Implement projector and commit.

---

### Slice XM-07: Checkpoint storage with CAS/idempotency

**Depends on:** XM-05.

**Files:**
- Create: `src/adapters/file-session-checkpoint.ts`
- Create: `test/file-session-checkpoint.contracts.test.ts`

- [ ] RED-test repeated write same id, concurrent N/N+1, stale predecessor, crash-safe publication and restart.
- [ ] Implement local derived storage using existing repository file-storage/locking patterns.
- [ ] Do not duplicate original episode bytes.
- [ ] Commit.

**Done when:** stale writer cannot overwrite a newer checkpoint.

---

### Slice XM-08: Archive-first checkpoint integration

**Depends on:** XM-06, XM-07.

**Files:**
- Extend application import/reconcile flow in the narrowest place, likely alongside `src/application/memory-import.ts`.
- Test: extend memory process/import contracts.

- [ ] RED-test original episode archived before checkpoint becomes `ready`.
- [ ] RED-test archive failure leaves no ready checkpoint.
- [ ] RED-test retry produces same deterministic checkpoint identity.
- [ ] Implement integration and commit.

---

### Slice XM-09: Tombstone/deletion propagation

**Depends on:** XM-07/08.

**Files:**
- Extend deletion/reconcile application logic.
- Test: extend `test/retained-memory-delete.contracts.test.ts` plus checkpoint-specific cases.

- [ ] RED-test deleting/revoking an episode invalidates every active checkpoint that depends on it.
- [ ] Verify shared immutable blobs are not destroyed while still referenced.
- [ ] Verify no orphaned checkpoint is returned.
- [ ] Commit.

---

### Slice XM-10: ResumeContext domain assembly

**Depends on:** XM-05.

**Files:**
- Create: `src/domain/resume-context.ts`
- Create: `test/resume-context.contracts.test.ts`

**Produces:** bounded initial envelope containing exact latest user intent reference, next action, pending/done/blocked tasks, historical results, file/digest hints, decision states and expansion pointers.

- [ ] RED-test precedence of newer user intent.
- [ ] RED-test omitted/unknown data.
- [ ] RED-test initial-budget projection retains exact expansion handles.
- [ ] Implement pure assembly and commit.

---

### Slice XM-11: Resume freshness revalidation

**Depends on:** XM-10.

**Files:**
- Create: `src/application/resume-freshness.ts`
- Test: `test/resume-freshness.contracts.test.ts`

- [ ] RED-test branch switch, changed file digest, deleted file and stale historical test result.
- [ ] Mark hints/results `needs_recheck`; never silently promote.
- [ ] Reuse current workspace/source digest primitives rather than inventing another snapshot model.
- [ ] Commit.

---

### Slice XM-12: Explicit checkpoint/resume application API

**Depends on:** XM-08, XM-10, XM-11 and XM-01 decision.

**Files:**
- Add application port/handler first.
- Modify MCP/OpenSpec/transport only if the feasibility decision says public tools are needed.
- Test: application contract + transport contract if exposed.

- [ ] Define `saveCheckpoint`/ `prepareResume` semantics or equivalent.
- [ ] Return status/provenance/unknown fields.
- [ ] Distinguish `resume_prepared` from `resume_consumed`.
- [ ] Commit.

**OUT:** automatic compaction interception.

---

### Slice XM-13: One real interrupted resume smoke

**Depends on:** XM-12 plus runtime.

- [ ] Execute one XM-03 task through interruption and restart.
- [ ] Verify checkpoint persisted, exact episode pointers resolve, resume was actually consumed and stale source was rechecked.
- [ ] Compare repeated reads/searches and task quality against XM-04.
- [ ] Negative result is retained honestly.

**Done when:** checkpoint/resume works or fails under a real agent, not just mocks.

---

### Slice XM-14: Paired checkpoint/resume evaluation

**Gate:** XM-13 smoke is valid.

- [ ] Run the remaining frozen tasks native/current ACE vs deterministic checkpoint/resume.
- [ ] Count all agent + writer/retrieval tokens; deterministic writer cost may be zero, but telemetry unknown is not zero.
- [ ] Report quality first, then repeat-work ratio, tokens, cost and duration.
- [ ] Decide `CONTINUE`, `NO_GAIN`, `INCONCLUSIVE`.

**This is the gate for all P1/P2 memory work.**

---

### Slice XM-15: Bounded LLM checkpoint writer

**Gate:** XM-14 shows resume value but deterministic extraction omits semantically important state.

**Files:**
- Create optional writer port/adapter.
- Test: `test/checkpoint-writer.contracts.test.ts`

- [ ] Strict JSON schema output with exact source episode IDs.
- [ ] Reject fabricated tool success/file change/owner decision.
- [ ] Enforce local/data-policy boundary and bounded source window.
- [ ] Keep disabled by default.
- [ ] Commit.

---

### Slice XM-16: Writer semantic-error evaluation

**Depends on:** XM-15.

- [ ] Build a hand-labeled sample from existing frozen sessions.
- [ ] Measure omission and false-action/false-decision rates.
- [ ] Compare resume quality and total token overhead.
- [ ] Reject writer if it does not beat deterministic projection safely.

---

### Slice XM-17: Raw-history lexical-search baseline

**Gate:** real resume/debug traces show history lookup latency/recall problem.

**Files:**
- Create benchmark/evidence script first; no SQLite dependency yet.

- [ ] Compare current Graphiti/memory search with simple bounded lexical scan on exact archived episodes.
- [ ] Test Unicode/punctuation/IDs and session/time filters.
- [ ] Record recall/latency/maintenance cost.

**Done when:** need for persistent FTS is measured.

---

### Slice XM-18: Rebuildable FTS5 prototype

**Gate:** XM-17 proves bounded scan inadequate and FTS materially useful.

**Files:**
- Add local projection adapter behind a port.
- Add scope/deletion/rebuild/corruption tests.

- [ ] Index raw history and curated checkpoint fields as distinct source types.
- [ ] Keep immutable archive authoritative.
- [ ] Tombstone purge must remove searchability.
- [ ] Benchmark again before retention.

---

### Slice XM-19: MemoryPromotionProposal domain

**Gate:** checkpoint/resume already useful; repeated cross-session learnings exist.

**Files:**
- Create: `src/domain/memory-promotion.ts`
- Test: `test/memory-promotion.contracts.test.ts`

- [ ] Model proposal claim, exact episode refs, extractor/version, conflict/obsolete status and review outcome.
- [ ] Disallow direct `Accepted` transition from extractor output.
- [ ] Integrate conceptually with existing `memory-admission.ts` and Decision FSM only through explicit application flow.

---

### Slice XM-20: Dream candidate extractor

**Depends on:** XM-19.

**Files:** optional local/authorized extractor adapter + application service + tests.

- [ ] Return `NO_CHANGE` legitimately.
- [ ] Verify every claim against original episodes; source-code claims additionally require current source verification.
- [ ] Deduplicate without treating repeated summaries as independent evidence.
- [ ] Produce reviewable proposals only.

---

### Slice XM-21: Dream owner-review/promotion workflow

**Depends on:** XM-20.

- [ ] Wire accept/reject review to existing decision/admission mechanisms.
- [ ] Retain rejected/superseded history.
- [ ] Add replay/deletion/rollback tests.
- [ ] No automatic ADR/AGENTS edits.

---

### Slice XM-22: Distill workflow-mining evidence pass

**Gate:** enough real multi-session trajectories exist.

- [ ] Mine raw tool-call/outcome sequences, not summaries.
- [ ] Cluster repeated workflows and compare with existing scripts/skills/runbooks.
- [ ] Output only proposals with source episodes, estimated savings and failure risk.
- [ ] Empty shortlist is valid.

---

### Slice XM-23: Governed strategy ledger

**Gate:** at least two memory-policy variants are actually being evaluated.

**Files:**
- Create simple versioned JSON/domain artifact first, not a database.
- Test validation/rollback linkage.

- [ ] Record strategy/version/commit/corpus/provider, baseline-vs-candidate, privacy/deletion checks, cost/latency/quality, state and rollback target.
- [ ] Support shadow/trial/rejected/owner_accepted/rolled_back.
- [ ] Do not let shadow policy affect production answers.

---

## Dependency DAG

```text
XM-01 ─┬─> XM-03 -> XM-04
       └─> XM-05 -> XM-06 ─┐
                 └-> XM-07 ├-> XM-08 -> XM-09
                            │
XM-05 -> XM-10 -> XM-11 ----┴-> XM-12 -> XM-13 -> XM-14
                                                   |
                  ┌────────────────────────────────┼─────────────────────┐
                  v                                v                     v
               XM-15/16                        XM-17/18              XM-19->20->21
                                                                          |
                                                                       XM-22/23

XM-02 validates agent-neutral assumptions independently before production promotion.
```

## Self-review

- Checkpoint model/storage, resume assembly, runtime exposure and evaluation are separate one-pass gates.
- Model writer and FTS cannot sneak in before deterministic checkpoint/resume earns value.
- Dream/Distill remain proposals with existing ACE decision authority intact.
- Deletion/freshness/lineage failure modes have owning slices rather than “handle edge cases” notes.
